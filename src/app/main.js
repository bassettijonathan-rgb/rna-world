// The page: wires the simulation host, the microscope view and the bench.

import { createHost } from './host.js';
import { View } from './view.js';
import { drawPopulation, drawTree, drawCheckChart } from './charts.js';
import { renderInspector } from './inspector.js';
import { PRESETS } from '../sim/engine.js';
import { DEFAULTS, RANGES, K } from '../sim/params.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) {
    try {
      return localStorage.getItem(`rna-world:${k}`);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`rna-world:${k}`, v);
    } catch {
      /* private window: fine */
    }
  },
};

const SLIDERS = [
  { key: 'errorRate', label: 'Copying errors', fmt: (v) => `${(v * 1000).toFixed(0)} per 1,000 bases`, help: 'For a perfectly folded replicase; sloppier folds make more.' },
  { key: 'tempAmp', label: 'Warm spell', fmt: (v) => `25 → ${25 + v} °C`, help: `Double strands melt apart when it is warm. Above ${K.activeBelow} °C the folds come undone and nothing is copied.` },
  { key: 'tempPeriod', label: 'Day length', fmt: (v) => `${v} steps`, help: 'One cool spell for copying, one warm spell for melting.' },
  { key: 'foodSupply', label: 'Food supply', fmt: (v) => `${(v * 100).toFixed(1)}%`, help: 'How fast activated nucleotides flow back over the clay.' },
  { key: 'mixing', label: 'Mixing', fmt: (v) => `${(v * 1000).toFixed(0)} ‰`, help: 'How often a strand swaps places with a neighbour each step. Turn on Well mixed to stir everything.' },
  { key: 'breakdown', label: 'Breakdown', fmt: (v) => `${v.toFixed(2)}×`, help: 'How fast strands fall apart, mostly in the warm spells.' },
];

const RATES = [
  { label: 'Slow', v: 15 },
  { label: 'Normal', v: 60 },
  { label: 'Fast', v: 240 },
  { label: 'Max', v: 0 },
];

const state = {
  host: null,
  running: false,
  preset: 'soup',
  seed: 'clay',
  mode: 'lineage',
  tab: 'lab',
  world: 'surface',
  params: { ...DEFAULTS },
  history: [],
  events: [],
  tree: null,
  last: null,
  waiting: false,
  inspectAt: null,
  inspectInfo: null,
  rate: 60,
  stepTimes: [],
  dirtyCharts: true,
};

// ---------------------------------------------------------------- view

const view = new View($('view'), {
  onTap(x, y) {
    if (state.world === 'surface') view.selected = [Math.floor(x), Math.floor(y)];
    else view.selected = null;
    state.inspectAt = [x, y];
    state.wantInspect = true;
    selectTab('strand');
  },
  onTool(tool, x, y) {
    state.host?.send({ type: 'tool', tool, x: Math.round(x), y: Math.round(y), r: 6 });
  },
  onCamera() {
    updateScale();
  },
});
view.mode = state.mode;
new ResizeObserver(() => view.resize()).observe($('view'));

const LEGENDS = {
  lineage: [
    ['hsl(160, 85%, 66%)', 'bright: a replicase family'],
    ['hsl(160, 60%, 38%)', 'dim: parasites in a family'],
    ['var(--slate)', 'grey: never copied'],
  ],
  role: [
    ['var(--mint)', 'replicase'],
    ['var(--coral)', 'parasite'],
    ['var(--gold)', 'ligase'],
    ['var(--slate)', 'never copied'],
  ],
  food: [
    ['hsl(165, 70%, 45%)', 'activated nucleotides'],
    ['#b8c8cc', 'strands'],
  ],
};

function updateLegend() {
  $('legend').innerHTML = LEGENDS[state.mode].map(([c, t]) => `<span class="sw" style="--c:${c}">${t}</span>`).join('');
}

function updateScale() {
  const z = view.cam.z / view.dpr;
  const close = z >= 9;
  $('scale').textContent = close ? `${z.toFixed(0)} px per site\ntap a strand` : `${view.W} × ${view.H} sites`;
  $('scale').style.whiteSpace = 'pre';
}

$('z-in').onclick = () => view.zoomBy(1.6);
$('z-out').onclick = () => view.zoomBy(1 / 1.6);
$('z-fit').onclick = () => view.fit();

for (const b of document.querySelectorAll('.tools [data-tool]')) {
  b.onclick = () => {
    view.tool = b.dataset.tool;
    $('field').dataset.tool = view.tool;
    for (const o of document.querySelectorAll('.tools [data-tool]')) o.setAttribute('aria-pressed', String(o === b));
  };
}

// ---------------------------------------------------------------- bench

function selectTab(id) {
  state.tab = id;
  for (const t of document.querySelectorAll('[role=tab]')) {
    const on = t.id === `t-${id}`;
    t.setAttribute('aria-selected', String(on));
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (id === 'log') $('t-log').querySelector('.dot')?.remove();
  state.dirtyCharts = true;
  store.set('tab', id);
}
for (const t of document.querySelectorAll('[role=tab]')) t.onclick = () => selectTab(t.id.slice(2));

function buildPresets() {
  const box = $('presets');
  box.innerHTML = '';
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.dataset.preset = id;
    b.setAttribute('aria-pressed', String(id === state.preset));
    b.innerHTML = `<b>${p.label}</b><span>${p.blurb}</span>`;
    b.onclick = () => restart({ preset: id });
    box.appendChild(b);
  }
}

function buildSliders() {
  const box = $('sliders');
  for (const s of SLIDERS) {
    const r = RANGES[s.key];
    const div = document.createElement('div');
    div.className = 'slider';
    div.innerHTML = `<label for="s-${s.key}">${s.label}</label><output id="o-${s.key}"></output>
      <input type="range" id="s-${s.key}" min="${r.min}" max="${r.max}" step="${r.step}">
      <small>${s.help}</small>`;
    box.appendChild(div);
    const input = div.querySelector('input');
    input.oninput = () => {
      const v = Number(input.value);
      state.params[s.key] = v;
      $(`o-${s.key}`).textContent = s.fmt(v);
      state.host?.send({ type: 'params', patch: { [s.key]: v } });
    };
  }
  const sp = document.createElement('div');
  sp.className = 'slider';
  sp.innerHTML = `<label>Speed</label><output id="o-rate"></output>
    <div class="seg" role="group" aria-label="Speed" style="grid-column:1/-1;width:max-content">${RATES.map((r) => `<button type="button" data-rate="${r.v}">${r.label}</button>`).join('')}</div>`;
  box.appendChild(sp);
  for (const b of sp.querySelectorAll('[data-rate]')) {
    b.onclick = () => {
      state.rate = Number(b.dataset.rate);
      syncRate();
      if (state.running) state.host.send({ type: 'run', running: true, rate: state.rate });
    };
  }
  syncRate();
}

function syncRate() {
  for (const b of document.querySelectorAll('[data-rate]')) b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === state.rate));
  $('o-rate').textContent = state.rate ? `${state.rate} steps/s` : 'as fast as it goes';
}

function syncSliders() {
  for (const s of SLIDERS) {
    const v = state.params[s.key];
    $(`s-${s.key}`).value = v;
    $(`o-${s.key}`).textContent = s.fmt(v);
  }
  $('well-mixed').checked = !!state.params.wellMixed;
  for (const b of document.querySelectorAll('[data-world]')) b.setAttribute('aria-pressed', String(b.dataset.world === state.world));
  for (const b of document.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === state.preset));
}

$('well-mixed').onchange = (e) => {
  state.params.wellMixed = e.target.checked;
  state.host?.send({ type: 'params', patch: { wellMixed: e.target.checked } });
};

for (const b of document.querySelectorAll('[data-world]')) {
  b.onclick = () => {
    state.world = b.dataset.world;
    view.selected = null;
    state.host?.send({ type: 'world', kind: state.world });
    syncSliders();
  };
}

for (const b of document.querySelectorAll('[data-mode]')) {
  b.onclick = () => {
    state.mode = b.dataset.mode;
    view.mode = state.mode;
    for (const o of document.querySelectorAll('[data-mode]')) o.setAttribute('aria-pressed', String(o === b));
    store.set('mode', state.mode);
    updateLegend();
  };
}

const WORDS = ['clay', 'tidepool', 'basalt', 'vent', 'pumice', 'ice', 'mica', 'zircon', 'hadean', 'brine', 'geyser', 'olivine', 'pyrite', 'lagoon'];
$('b-dice').onclick = () => {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  $('seed').value = `${w}-${Math.floor(Math.random() * 900 + 100)}`;
  restart({});
};
$('b-restart').onclick = () => restart({});
$('seed').onkeydown = (e) => {
  if (e.key === 'Enter') restart({});
};

$('b-play').onclick = () => setRunning(!state.running);
$('b-step').onclick = () => {
  if (!state.host) return;
  setRunning(false);
  state.host.send({ type: 'step', n: 10 });
};

function setRunning(on) {
  state.running = on;
  $('b-play').textContent = on ? 'Pause' : 'Play';
  state.host?.send({ type: 'run', running: on, rate: state.rate });
}

function restart({ preset = state.preset }) {
  if (!state.host) return;
  state.preset = preset;
  state.seed = $('seed').value.trim() || 'clay';
  const pre = PRESETS[preset];
  state.world = pre.world ?? 'surface';
  state.params = { ...DEFAULTS, ...pre.params };
  state.history = [];
  state.events = [];
  state.tree = null;
  state.inspectInfo = null;
  view.selected = null;
  $('log').innerHTML = '';
  $('log-empty').hidden = false;
  $('cards').innerHTML = '';
  renderInspector($('inspector'), null);
  syncSliders();
  state.host.send({ type: 'reset', seed: state.seed, preset });
  state.host.send({ type: 'params', patch: state.params });
  store.set('preset', preset);
  store.set('seed', state.seed);
}

// ---------------------------------------------------------------- frames

function onMessage(m) {
  if (m.type === 'frame') onFrame(m);
}

function onFrame(f) {
  state.waiting = false;
  state.last = f;
  view.setFrame(f);
  if (f.world !== undefined) state.world = f.kind;
  if (f.kind !== state.world) {
    state.world = f.kind;
    syncSliders();
  }
  if (f.historyReset) state.history = [];
  if (f.history?.length) {
    state.history.push(...f.history);
    if (state.history.length > 1600) state.history = state.history.filter((_, k) => k % 2 === 0 || k === state.history.length - 1);
    state.dirtyCharts = true;
  }
  if (f.tree) {
    state.tree = f.tree;
    state.dirtyCharts = true;
  }
  if (f.allEvents) {
    state.events = [];
    $('log').innerHTML = '';
    for (const e of f.allEvents) addEvent(e, false);
  }
  for (const e of f.events ?? []) addEvent(e, true);
  if (f.inspect) {
    state.inspectInfo = f.inspect;
    renderInspector($('inspector'), f.inspect);
  }
  // Readout.
  $('r-step').textContent = f.step.toLocaleString('en');
  $('r-temp').textContent = Math.round(f.T);
  $('r-thermo').style.width = `${Math.max(4, Math.min(100, ((f.T - 25) / 70) * 100))}%`;
  const now = performance.now();
  state.stepTimes.push([now, f.step]);
  while (state.stepTimes.length > 2 && now - state.stepTimes[0][0] > 2000) state.stepTimes.shift();
  if (state.stepTimes.length > 1) {
    const [t0, s0] = state.stepTimes[0];
    const rate = ((f.step - s0) / (now - t0)) * 1000;
    $('r-rate').textContent = Number.isFinite(rate) ? Math.max(0, Math.round(rate)) : 0;
  }
  if (state.running !== f.running && f.running !== undefined && !f.running && state.running) {
    /* keep the page's own idea of running */
  }
}

function addEvent(e, fresh) {
  state.events.push(e);
  $('log-empty').hidden = true;
  const li = document.createElement('li');
  li.dataset.kind = e.id;
  li.innerHTML = `<b>${e.title}</b><small>step ${e.step.toLocaleString('en')}</small><p>${e.text}</p>`;
  $('log').prepend(li);
  if (fresh) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.kind = e.id;
    card.setAttribute('role', 'status');
    card.innerHTML = `<h3>${e.title}</h3><p>${e.text}</p><small>step ${e.step.toLocaleString('en')}</small>`;
    card.onclick = () => card.remove();
    $('cards').appendChild(card);
    while ($('cards').children.length > 2) $('cards').firstChild.remove();
    setTimeout(() => card.remove(), 9000);
    if (state.tab !== 'log' && !$('t-log').querySelector('.dot')) $('t-log').insertAdjacentHTML('beforeend', '<span class="dot" aria-label="new"></span>');
  }
  state.dirtyCharts = true;
}

function updateCensus() {
  const c = state.last?.census;
  if (!c) return;
  const items = [
    ['Replicases', c.live, 'var(--mint)'],
    ['Parasites', c.parasite, 'var(--coral)'],
    ['Other strands', c.junk, 'var(--slate)'],
    ['Double strands', c.duplex, 'var(--ink)'],
    ['Copying now', c.busy, 'var(--ink)'],
    [c.vesicles !== undefined ? 'Vesicles' : 'Families of 12+', c.vesicles ?? (state.tree ? state.tree.lineages.filter((l) => l.died < 0).length : 0), 'var(--sky)'],
  ];
  $('census').innerHTML = items.map(([l, v, col]) => `<div class="stat" style="--c:${col}"><b>${(v ?? 0).toLocaleString('en')}</b><span>${l}</span></div>`).join('');
}

let lastCharts = 0;
function loop(t) {
  requestAnimationFrame(loop);
  if (!state.host) return;
  if (!state.waiting) {
    state.waiting = true;
    const msg = { type: 'frame', mode: state.mode };
    const reg = view.visibleRegion();
    if (reg) msg.region = reg;
    if (state.inspectAt && (state.wantInspect || (state.tab === 'strand' && state.running && t - (state.lastInspect ?? 0) > 1000))) {
      msg.inspect = state.inspectAt;
      state.wantInspect = false;
      state.lastInspect = t;
    }
    state.host.send(msg);
    // A main-thread host answers on a timer; guard against a lost reply.
    clearTimeout(state.frameGuard);
    state.frameGuard = setTimeout(() => (state.waiting = false), 1500);
  }
  view.draw();
  if (state.dirtyCharts && t - lastCharts > 250) {
    lastCharts = t;
    state.dirtyCharts = false;
    if (state.tab === 'life') {
      updateCensus();
      drawPopulation($('pop'), state.history, { events: state.events });
      drawTree($('tree'), state.tree, state.last?.step ?? 0);
    }
  }
}

// ---------------------------------------------------------------- checks

let vhost = null;
const vrows = new Map();
const CHECK_TITLES = [
  ['eigen', 'Eigen’s error threshold'],
  ['spiegelman', 'Spiegelman’s monster'],
  ['surface', 'Parasites: pot versus surface'],
  ['vesicles', 'Vesicles rescue cooperation'],
  ['joyce', 'Joyce lab: a self-sustained ligase pair'],
];

function renderCheckShells() {
  const box = $('checks');
  box.innerHTML = '';
  for (const [id, title] of CHECK_TITLES) {
    const el = document.createElement('article');
    el.className = 'check';
    el.id = `c-${id}`;
    el.innerHTML = `<header><h3>${title}</h3><span class="verdict wait">WAITING</span></header><div class="bar"><i></i></div>`;
    box.appendChild(el);
  }
}

function renderCheck(row) {
  vrows.set(row.id, row);
  const el = $(`c-${row.id}`);
  if (!el) return;
  el.innerHTML = `<header><h3>${row.title}</h3><span class="verdict ${row.pass ? 'pass' : 'fail'}">${row.pass ? 'PASS' : 'FAIL'}</span></header>
    <div><div class="value">${row.value}</div><div class="unit">${row.unit}</div></div>
    <div class="expected">Expected: ${row.expected}</div>
    <canvas class="chart" height="120"></canvas>
    <p>${row.detail}</p>
    <details><summary>How it was measured</summary><p>${row.how}</p><p>Compare: ${row.source}. Took ${(row.ms / 1000).toFixed(1)} s.</p></details>`;
  const cv = el.querySelector('canvas');
  requestAnimationFrame(() => drawCheckChart(cv, row.chart));
}

$('b-validate').onclick = async () => {
  const btn = $('b-validate');
  btn.disabled = true;
  btn.textContent = 'Running…';
  renderCheckShells();
  const started = performance.now();
  if (vhost) vhost.terminate();
  vhost = await createHost((m) => {
    if (m.type === 'vrow') {
      renderCheck(m.row);
      const n = vrows.size;
      $('v-status').textContent = `${n} of 5 done`;
    } else if (m.type === 'vprogress') {
      const bar = $(`c-${m.id}`)?.querySelector('.bar i');
      if (bar) bar.style.width = `${Math.round(m.frac * 100)}%`;
    } else if (m.type === 'vdone') {
      const passed = m.rows.filter((r) => r.pass).length;
      $('v-status').textContent = `${passed} of ${m.rows.length} passed in ${Math.round((performance.now() - started) / 1000)} s`;
      btn.disabled = false;
      btn.textContent = 'Run again';
    }
  });
  vrows.clear();
  $('v-status').textContent = vhost.kind === 'main' ? 'Running on the page itself; the view may stutter.' : 'Running…';
  vhost.send({ type: 'validate' });
};

// ---------------------------------------------------------------- start

async function start() {
  state.preset = store.get('preset') && PRESETS[store.get('preset')] ? store.get('preset') : 'soup';
  state.seed = store.get('seed') || 'clay';
  const mode = store.get('mode');
  if (mode && ['lineage', 'role', 'food'].includes(mode)) {
    state.mode = mode;
    view.mode = mode;
    for (const o of document.querySelectorAll('[data-mode]')) o.setAttribute('aria-pressed', String(o.dataset.mode === mode));
  }
  $('seed').value = state.seed;
  const pre = PRESETS[state.preset];
  state.world = pre.world ?? 'surface';
  state.params = { ...DEFAULTS, ...pre.params };
  updateLegend();
  buildPresets();
  buildSliders();
  syncSliders();
  updateScale();
  renderCheckShells();
  const tab = store.get('tab');
  if (tab && $(`t-${tab}`) && tab !== 'strand') selectTab(tab);
  state.host = await createHost(onMessage);
  document.documentElement.dataset.host = state.host.kind;
  state.host.send({ type: 'init', seed: state.seed, preset: state.preset, size: 128 });
  requestAnimationFrame(loop);
  // Start running straight away: the soup is the point.
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) setRunning(true);
}

window.__rnaWorld = state;
start();
