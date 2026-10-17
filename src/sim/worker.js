// Runs the engine off the main thread. The page sends commands; the worker
// steps the simulation at the requested rate and answers frame requests
// with the latest picture, census, history and events.

import { Engine } from './engine.js';
import { runValidation } from './validation.js';

export function createSimServer(post) {
  let engine = null;
  let running = false;
  let rate = 60; // steps per second; 0 = as fast as possible
  let mode = 'lineage';
  let lastHist = -1;
  let lastTree = -Infinity;
  let owed = 0;
  let lastTick = 0;
  let timer = null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function tick() {
    timer = null;
    if (!engine || !running) return;
    const t = now();
    const dt = Math.min(0.25, (t - lastTick) / 1000);
    lastTick = t;
    const budget = 28; // ms of work per slice
    if (rate > 0) owed = Math.min(owed + rate * dt, rate * 0.25);
    const start = now();
    let ran = 0;
    while (now() - start < budget) {
      if (rate > 0 && owed < 1) break;
      engine.run(1);
      ran++;
      if (rate > 0) owed -= 1;
    }
    schedule(ran === 0 ? 8 : 0);
  }

  function schedule(ms) {
    if (!timer && running) timer = setTimeout(tick, ms);
  }

  function frame(opts = {}) {
    const msg = engine.frame(opts.mode ?? mode);
    msg.type = 'frame';
    msg.running = running;
    msg.history = engine.historySince(lastHist);
    if (msg.history.length) lastHist = msg.history[msg.history.length - 1].step;
    if (opts.resetHistory) {
      msg.history = engine.history.slice();
      msg.historyReset = true;
      lastHist = engine.history.length ? engine.history[engine.history.length - 1].step : -1;
    }
    if (engine.step - lastTree >= 50 || opts.tree) {
      msg.tree = engine.tree();
      lastTree = engine.step;
    }
    if (opts.region) msg.region = engine.region(...opts.region);
    if (opts.inspect) msg.inspect = engine.inspect(opts.inspect[0], opts.inspect[1], opts.inspect[2]);
    msg.params = engine.params;
    msg.preset = engine.preset;
    msg.seed = engine.seed;
    msg.allEvents = opts.events ? engine.events : undefined;
    const transfer = msg.image ? [msg.image.buffer] : [];
    post(msg, transfer);
  }

  return function handle(m) {
    switch (m.type) {
      case 'ping':
        post({ type: 'pong' });
        break;
      case 'init':
        engine = new Engine({ seed: m.seed, preset: m.preset, size: m.size ?? 128 });
        if (m.params) engine.setParams(m.params);
        lastHist = -1;
        lastTree = -Infinity;
        frame({ resetHistory: true, tree: true, events: true });
        break;
      case 'reset':
        engine.reset({ seed: m.seed, preset: m.preset });
        lastHist = -1;
        lastTree = -Infinity;
        frame({ resetHistory: true, tree: true, events: true });
        break;
      case 'params':
        engine.setParams(m.patch);
        break;
      case 'world':
        engine.setWorldKind(m.kind);
        frame({ tree: true });
        break;
      case 'run':
        running = !!m.running;
        if (m.rate !== undefined) rate = m.rate;
        lastTick = now();
        owed = 0;
        schedule(0);
        break;
      case 'step':
        engine.run(m.n ?? 1);
        frame();
        break;
      case 'tool':
        if (m.tool === 'pour') engine.pour(m.x, m.y, m.r);
        else if (m.tool === 'stir') engine.stir(m.x, m.y, m.r);
        break;
      case 'frame':
        if (m.mode) mode = m.mode;
        frame(m);
        break;
      case 'locate':
        post({ type: 'located', kind: m.kind, at: engine.locate(m.kind) });
        break;
      case 'validate':
        runValidation({
          quick: m.quick,
          onRow: (row) => post({ type: 'vrow', row }),
          onProgress: (id, frac) => post({ type: 'vprogress', id, frac }),
        }).then((rows) => post({ type: 'vdone', rows }));
        break;
      default:
        break;
    }
  };
}

// Inside a worker: wire the server to the message port.
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  const handle = createSimServer((msg, transfer) => self.postMessage(msg, transfer));
  self.onmessage = (e) => handle(e.data);
}
