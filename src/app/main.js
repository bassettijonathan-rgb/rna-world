// The page: wires the simulation host, the microscope view and the bench.

import { createHost } from './host.js';
import { View } from './view.js';
import { drawPopulation, drawTree, drawCheckChart } from './charts.js';
import { renderInspector } from './inspector.js';
import { PRESETS } from '../sim/engine.js';
import { DEFAULTS, RANGES, K } from '../sim/params.js';
import { CHAPTERS, GLOSSARY, STAT_HELP, makeGoals, trackGoals, narrate } from './guide.js';

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
  goals: makeGoals(),
  chapter: 0,
  done: new Set(),
  guesses: {},
  fromGuide: false,
};

// ---------------------------------------------------------------- view

const view = new View($('view'), {
  onTap(x, y) {
    if (state.world === 'surface') view.selected = [Math.floor(x), Math.floor(y)];
    else view.selected = null;
    state.inspectAt = [x, y];
    state.wantInspect = true;
    state.fromGuide = state.tab === 'learn';
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
  $('back-guide').hidden = !(id === 'strand' && state.fromGuide);
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
  state.goals.mixedFrom = 0;
  state.goals.errorFrom = 0;
  state.goals.hotSeen = false;
  state.host.send({ type: 'reset', seed: state.seed, preset });
  state.host.send({ type: 'params', patch: state.params });
  store.set('preset', preset);
  store.set('seed', state.seed);
}

// ---------------------------------------------------------------- frames

function onMessage(m) {
  if (m.type === 'frame') onFrame(m);
  else if (m.type === 'located') onLocated(m);
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
    if (f.inspect.gone) {
      // Keep the last picture and say what happened.
      state.inspectGone = true;
      $('inspector').querySelector('.gone')?.remove();
      $('inspector').insertAdjacentHTML('afterbegin', '<p class="gone">This strand is gone: it broke down, snapped in two or was joined to another. Tap another strand.</p>');
    } else {
      state.inspectGone = false;
      if (f.inspect.strand && state.world === 'surface' && f.inspect.x !== undefined) {
        // It may have stepped to a neighbouring site.
        state.inspectAt = [f.inspect.x + 0.5, f.inspect.y + 0.5];
        view.selected = [f.inspect.x, f.inspect.y];
      }
      state.inspectInfo = f.inspect;
      renderInspector($('inspector'), f.inspect);
    }
  }
  trackGoals(state.goals, f, state.params, CHAPTERS[state.chapter].id);
  updateGuideProgress();
  // Say so at once when the warm spell starts or ends.
  const hot = f.T > K.activeBelow;
  updateNarrator(hot !== state.wasHot);
  state.wasHot = hot;
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
    const show = { replicase: 'replicase', parasite: 'parasite', spiral: 'spiral', vesicle: 'replicase', hypercycle: 'replicase' }[e.id];
    const chap = CHAPTER_FOR_EVENT[e.id];
    card.innerHTML = `<h3>${e.title}</h3><p>${e.text}</p><div class="card-foot"><small>step ${e.step.toLocaleString('en')}</small>${show ? '<button type="button" class="link" data-act="show">Show me</button>' : ''}${chap !== undefined ? '<button type="button" class="link" data-act="explain">Explain</button>' : ''}</div>`;
    card.onclick = (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (act === 'show') api.showMe(show);
      else if (act === 'explain') {
        state.chapter = chap;
        renderGuide();
        selectTab('learn');
      }
      card.remove();
    };
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
  $('census').innerHTML = items.map(([l, v, col]) => `<button type="button" class="stat" data-stat="${l}" aria-pressed="${state.statHelp === l}" style="--c:${col}"><b>${(v ?? 0).toLocaleString('en')}</b><span>${l}</span></button>`).join('');
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
    if (state.inspectAt && (state.wantInspect || (state.tab === 'strand' && state.running && !state.inspectGone && t - (state.lastInspect ?? 0) > 1000))) {
      // A refresh follows the strand on show; a new tap looks at the spot.
      const follow = state.wantInspect ? undefined : state.inspectInfo?.strand?.seq;
      msg.inspect = [...state.inspectAt, follow];
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
      state.goals.ranChecks = true;
      updateGuideProgress();
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
  loadGuide();
  renderGuide();
  renderGlossary();
  const tab = store.get('tab');
  selectTab(tab && $(`t-${tab}`) && tab !== 'strand' ? tab : 'learn');
  state.host = await createHost(onMessage);
  document.documentElement.dataset.host = state.host.kind;
  state.host.send({ type: 'init', seed: state.seed, preset: state.preset, size: 128 });
  requestAnimationFrame(loop);
  // Start running straight away: the soup is the point.
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) setRunning(true);
}

// ---------------------------------------------------------------- learning

const CHAPTER_FOR_EVENT = { replicase: 3, parasite: 4, spiral: 5, vesicle: 7, extinct: 5 };

// What the guide's buttons can do.
const api = {
  restart(preset) {
    restart({ preset });
    if (!state.running) setRunning(true);
  },
  setParam(key, v) {
    state.params[key] = v;
    state.host?.send({ type: 'params', patch: { [key]: v } });
    syncSliders();
    note(key === 'wellMixed' ? (v ? 'Well mixed is on: the whole surface is stirred every step.' : 'Well mixed is off.') : `${SLIDERS.find((x) => x.key === key)?.label ?? key} set to ${SLIDERS.find((x) => x.key === key)?.fmt(v) ?? v}.`);
  },
  setRate(v) {
    state.rate = v;
    syncRate();
    setRunning(true);
  },
  setMode(m) {
    document.querySelector(`[data-mode="${m}"]`)?.click();
  },
  zoomClose() {
    view.flyTo(view.cam.x, view.cam.y, 34);
    showField();
    note('Zoomed in. Each strand is drawn as its fold. Tap one.');
  },
  showMe(kind) {
    if (kind === 'spiral') {
      const c = state.last?.cores?.[0];
      if (c) {
        view.flyTo(c.x, c.y, 6);
        api.setMode('role');
        showField();
        note('A spiral core: replicases, parasites and bare clay turn around this point.');
      } else note('No spiral core on the surface right now.');
      return;
    }
    state.host?.send({ type: 'locate', kind });
  },
  openTab(id) {
    selectTab(id);
  },
};

function onLocated(m) {
  const names = { replicase: 'replicase', parasite: 'parasite', busy: 'strand being copied', duplex: 'double strand' };
  if (!m.at) {
    note(`There is no ${names[m.kind] ?? 'strand'} on the surface right now. Let it run a little.`);
    return;
  }
  if (m.at.vesicle) {
    view.flyTo(m.at.x, m.at.y, 12);
    view.selected = null;
  } else {
    view.flyTo(m.at.x + 0.5, m.at.y + 0.5, 40);
    view.selected = [m.at.x, m.at.y];
  }
  state.inspectAt = [m.at.x + 0.5, m.at.y + 0.5];
  state.wantInspect = true;
  state.fromGuide = state.tab === 'learn';
  selectTab('strand');
}

// On a phone the field can be scrolled out of sight while reading the
// guide; bring it back when a button changes what it shows.
function showField() {
  const r = $('field').getBoundingClientRect();
  if (r.bottom < 80 || r.top > window.innerHeight - 80) $('field').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// A short line over the field that fades out.
function note(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(note.timer);
  note.timer = setTimeout(() => (el.hidden = true), 4500);
}

let lastNarration = 0;
function updateNarrator(force) {
  const now = performance.now();
  if (!force && now - lastNarration < 1200) return;
  lastNarration = now;
  const n = narrate(state);
  if ($('n-now').textContent !== n.now) $('n-now').textContent = n.now;
  if ($('n-trend').textContent !== n.trend) $('n-trend').textContent = n.trend;
}

function loadGuide() {
  try {
    const g = JSON.parse(store.get('guide') ?? 'null');
    if (g) {
      state.chapter = Math.max(0, Math.min(CHAPTERS.length - 1, g.chapter | 0));
      state.done = new Set(g.done ?? []);
    }
  } catch {
    /* start fresh */
  }
}

function saveGuide() {
  store.set('guide', JSON.stringify({ chapter: state.chapter, done: [...state.done] }));
}

const ctx = { hasEvent: (id) => state.events.some((e) => e.id === id), preset: () => state.preset };

function updateGuideProgress() {
  let changed = false;
  CHAPTERS.forEach((c) => {
    if (!state.done.has(c.id) && c.goal.done(state.goals, ctx)) {
      state.done.add(c.id);
      changed = true;
      if (c === CHAPTERS[state.chapter]) note(`Done: ${c.goal.text}`);
    }
  });
  if (changed) {
    saveGuide();
    renderGuide();
  }
}

function renderGuide() {
  const c = CHAPTERS[state.chapter];
  const done = state.done.has(c.id);
  $('chapters').innerHTML = CHAPTERS.map(
    (x, k) => `<button type="button" class="chap" data-chap="${k}" aria-current="${k === state.chapter}" title="${x.title}"><span>${k + 1}</span>${state.done.has(x.id) ? '<i aria-label="done">✓</i>' : ''}</button>`,
  ).join('');
  $('lesson').innerHTML = `
    <p class="eyebrow">Chapter ${state.chapter + 1} of ${CHAPTERS.length}</p>
    <h3>${c.title}</h3>
    ${c.body.map((p) => `<p>${p}</p>`).join('')}
    ${c.predict ? renderPredict(c) : ''}
    <div class="tries">${c.tries.map((t, k) => `<button type="button" class="btn" data-try="${k}">${t.label}</button>`).join('')}</div>
    <div class="goal" data-done="${done}"><span class="tick" aria-hidden="true">${done ? '✓' : ''}</span><span><b>${done ? 'Done' : 'Watch for'}</b> ${c.goal.text}</span></div>
    <div class="row lesson-nav">
      <button type="button" class="btn" id="g-prev" ${state.chapter === 0 ? 'disabled' : ''}>Back</button>
      <button type="button" class="btn ${done ? 'primary' : ''}" id="g-next" ${state.chapter === CHAPTERS.length - 1 ? 'disabled' : ''}>Next chapter</button>
    </div>`;
  $('g-prev').onclick = () => goChapter(state.chapter - 1);
  $('g-next').onclick = () => goChapter(state.chapter + 1);
  for (const b of $('lesson').querySelectorAll('[data-try]')) b.onclick = () => c.tries[Number(b.dataset.try)].act(api);
  for (const b of $('lesson').querySelectorAll('[data-guess]')) {
    b.onclick = () => {
      state.guesses[c.id] = Number(b.dataset.guess);
      renderGuide();
    };
  }
  for (const b of $('chapters').querySelectorAll('[data-chap]')) b.onclick = () => goChapter(Number(b.dataset.chap));
}

function renderPredict(c) {
  const g = state.guesses[c.id];
  const answered = g !== undefined;
  const opts = c.predict.options
    .map((o, k) => {
      const mark = !answered ? '' : k === c.predict.answer ? 'right' : k === g ? 'wrong' : '';
      return `<button type="button" class="guess" data-guess="${k}" data-mark="${mark}" aria-pressed="${g === k}">${o}</button>`;
    })
    .join('');
  const verdict = answered ? `<p class="why"><b>${g === c.predict.answer ? 'Right.' : 'Not quite.'}</b> ${c.predict.why} Now try it below.</p>` : '';
  return `<div class="predict"><p class="q"><span class="n-label">Predict</span> ${c.predict.q}</p><div class="guesses">${opts}</div>${verdict}</div>`;
}

function goChapter(k) {
  state.chapter = Math.max(0, Math.min(CHAPTERS.length - 1, k));
  saveGuide();
  renderGuide();
  $('p-learn').scrollTop = 0;
}

function renderGlossary() {
  $('glossary').innerHTML = GLOSSARY.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('');
}

$('census').onclick = (e) => {
  const b = e.target.closest('[data-stat]');
  if (!b) return;
  const key = b.dataset.stat;
  state.statHelp = state.statHelp === key ? null : key;
  $('census-help').textContent = state.statHelp ? `${state.statHelp}: ${STAT_HELP[state.statHelp] ?? ''}` : 'Tap a number to see what it counts.';
  updateCensus();
};

$('back-guide').onclick = () => {
  state.fromGuide = false;
  selectTab('learn');
};

window.__rnaWorld = state;
start();
