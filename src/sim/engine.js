// The engine: one world (surface or vesicles), its parameters, the running
// census and history, the event cards and what the screen needs each frame.
// It runs the same in a Web Worker, on the main thread and in Node.

import { Rng } from './rng.js';
import { Surface } from './surface.js';
import { Vesicles, surfaceToVesicles, vesiclesToSurface } from './vesicles.js';
import { DEFAULTS } from './params.js';
import { pheno, affinity } from './pheno.js';
import { ROLE, roleOf } from './lineage.js';
import { paintSurface } from './paint.js';
import { spiralCores } from './spiral.js';
import { SELF_REPLICASE, SELF_PARASITE, HYPERCYCLE, HYPER_PARASITE } from './designs.js';

export const PRESETS = {
  soup: {
    label: 'Primordial soup',
    blurb: 'Random strands on warm clay. Nothing is designed to copy itself.',
    params: {},
    build(e) {
      e.world.seedRandom(0.45, 10, 70);
    },
  },
  duel: {
    label: 'Replicase vs parasite',
    blurb: 'One colony of a replicase that copies its own kind, with a few short parasites in it.',
    params: { breakdown: 1.5 },
    build(e) {
      const w = e.world;
      w.seedRandom(0.12, 10, 40);
      const lr = w.lineages.found(0, pheno(SELF_REPLICASE), 0);
      w.lineages.get(lr).hue = 160;
      const lp = w.lineages.found(lr, pheno(SELF_PARASITE), 0);
      w.lineages.get(lp).hue = 345;
      w.forDisc(64, 64, 7, (i) => w.seed(SELF_REPLICASE, i, lr));
      for (let k = 0; k < 4; k++) w.seed(SELF_PARASITE, (64 + k) * 128 + 60, lp);
    },
  },
  hypercycle: {
    label: 'Hypercycle',
    blurb: 'Five replicases in a ring: each copies only the next. Watch for spiral waves.',
    params: { errorRate: 0.001 },
    build(e) {
      const w = e.world;
      const lins = HYPERCYCLE.map((s, k) => {
        const id = w.lineages.found(0, pheno(s), 0);
        w.lineages.get(id).hue = (k * 72 + 20) % 360;
        return id;
      });
      for (let i = 0; i < w.N; i++) {
        if (w.rng.float() < 0.25) {
          const k = w.rng.int(5);
          w.seed(HYPERCYCLE[k], i, lins[k]);
        }
      }
      e.hyperLineages = lins;
      e.pendingParasite = { at: 600, seq: HYPER_PARASITE, parent: lins[4] };
    },
  },
  vesicles: {
    label: 'Vesicles',
    blurb: 'The replicase and its parasite again, but packed into fatty-acid vesicles.',
    params: {},
    world: 'vesicles',
    build(e) {
      const v = e.world;
      const lr = v.lineages.found(0, pheno(SELF_REPLICASE), 0);
      v.lineages.get(lr).hue = 160;
      const lp = v.lineages.found(lr, pheno(SELF_PARASITE), 0);
      v.lineages.get(lp).hue = 345;
      v.scatter(110);
      for (const ves of v.ves) {
        const r = v.rng.float();
        if (r < 0.5) for (let k = 0; k < 4; k++) v.addStrand(ves, pheno(SELF_REPLICASE), lr);
        if (r < 0.25) v.addStrand(ves, pheno(SELF_PARASITE), lp);
      }
    },
  },
};

export const EVENT_TEXT = {
  replicase: {
    title: 'First replicase',
    text: 'A strand folded into a replicase that is being copied by its own kind. Its family is growing on its own.',
  },
  parasite: {
    title: 'First parasite takeover',
    text: 'Parasites now outnumber replicases: strands that get copied but copy nothing, often broken-off tails of replicases that kept the tag.',
  },
  hypercycle: {
    title: 'First hypercycle',
    text: 'Two or more replicase families copy each other in a ring, and none copies itself well. They stand or fall together.',
  },
  spiral: {
    title: 'Spiral waves',
    text: 'Replicases, then parasites, then bare clay roll across the surface and curl around fixed cores. Parasites are left behind at the outside of each turn.',
  },
  vesicle: {
    title: 'First vesicle division',
    text: 'A vesicle full of RNA swelled, took up lipid and split in two. Each daughter got a random share of its strands.',
  },
  extinct: {
    title: 'Replicases gone',
    text: 'Every replicase is gone. Without them nothing gets copied; the surface goes back to random chemistry.',
  },
};

const SAMPLE_EVERY = 10;
const HISTORY_MAX = 1200;

export class Engine {
  constructor({ seed = 'rna-world', preset = 'soup', size = 128 } = {}) {
    this.size = size;
    this.reset({ seed, preset });
  }

  reset({ seed = this.seed, preset = this.preset, params } = {}) {
    this.seed = seed;
    this.preset = preset;
    const pre = PRESETS[preset] ?? PRESETS.soup;
    this.params = { ...DEFAULTS, ...pre.params, ...(params ?? {}) };
    this.rng = new Rng(seed);
    this.history = [];
    this.events = [];
    this.newEvents = [];
    this.flags = {};
    this.hyperLineages = null;
    this.pendingParasite = null;
    this.cores = [];
    if (pre.world === 'vesicles') this.world = new Vesicles({ size: this.size, rng: this.rng, params: this.params });
    else this.world = new Surface({ W: this.size, H: this.size, rng: this.rng, params: this.params });
    pre.build(this);
    this.sample();
  }

  get step() {
    return this.world.step;
  }

  setParams(patch) {
    Object.assign(this.params, patch);
  }

  setWorldKind(kind) {
    if (kind === this.world.kind) return;
    if (kind === 'vesicles') this.world = surfaceToVesicles(this.world, this.rng, this.params);
    else {
      const s = new Surface({ W: this.size, H: this.size, rng: this.rng, params: this.params });
      s.lineages = this.world.lineages;
      vesiclesToSurface(this.world, s);
      this.world = s;
    }
  }

  run(n) {
    for (let k = 0; k < n; k++) {
      this.world.advance();
      const st = this.world.step;
      if (this.pendingParasite && this.world.kind === 'surface' && st >= this.pendingParasite.at) this.dropParasite();
      if (st % SAMPLE_EVERY === 0) this.sample();
      if (st % 100 === 0) this.checkSlow();
      if (st % 500 === 0) this.world.lineages.prune(st);
    }
  }

  // A few parasites dropped into the hypercycle preset once it has settled.
  dropParasite() {
    const w = this.world;
    const { seq, parent } = this.pendingParasite;
    this.pendingParasite = null;
    const lp = w.lineages.found(parent, pheno(seq), w.step);
    w.lineages.get(lp).hue = 345;
    let placed = 0;
    for (let k = 0; k < 4000 && placed < 30; k++) {
      const i = w.rng.int(w.N);
      if (!w.ph[i] && Math.hypot((i % w.W) - 64, ((i / w.W) | 0) - 64) < 12) {
        w.put(i, pheno(seq), lp);
        placed++;
      }
    }
  }

  sample() {
    const c = this.world.census();
    c.step = this.world.step;
    c.T = this.world.T;
    this.last = c;
    this.history.push({ step: c.step, live: c.live, rep: c.replicase, para: c.parasite, junk: c.junk, dup: c.duplex, food: c.food, T: c.T, ves: c.vesicles ?? 0 });
    if (this.history.length > HISTORY_MAX) this.history = this.history.filter((_, k) => k % 2 === 0);
    this.checkFast(c);
  }

  fire(id, extra = {}) {
    if (this.flags[id]) return;
    this.flags[id] = true;
    const ev = { id, step: this.world.step, ...EVENT_TEXT[id], ...extra };
    this.events.push(ev);
    this.newEvents.push(ev);
  }

  checkFast(c) {
    const lins = this.world.lineages;
    if (!this.flags.replicase) {
      for (const l of lins.byId.values()) {
        if (l.role === ROLE.replicase && l.count >= 25 && this.preset === 'soup') {
          this.fire('replicase', { lineage: l.id });
          break;
        }
      }
      if (this.preset !== 'soup' && c.live >= 25) this.fire('replicase');
    }
    if (this.flags.replicase && !this.flags.parasite && c.parasite >= 50 && c.parasite > c.live) this.fire('parasite');
    if (this.flags.replicase && !this.flags.extinct && c.live === 0) this.fire('extinct');
    if (this.world.kind === 'vesicles' && this.world.firstDivision) this.fire('vesicle');
  }

  checkSlow() {
    if (!this.flags.hypercycle) {
      const ring = this.findHypercycle();
      if (ring) this.fire('hypercycle', { members: ring });
    }
    if (this.world.kind === 'surface') {
      const { cores } = spiralCores(this.world, 4);
      this.cores = cores;
      // A lone pair of opposite cores is common noise; ask for a few that
      // stay put between checks.
      const prev = this.prevCores ?? [];
      const steady = cores.filter((c) => prev.some((p) => Math.abs(p.x - c.x) <= 8 && Math.abs(p.y - c.y) <= 8 && p.sign === c.sign));
      this.prevCores = cores;
      this.steadyCores = steady.length;
      if (steady.length >= 2 && this.flags.replicase) this.fire('spiral', { cores: steady.length });
    } else this.cores = [];
  }

  // Replicase families that copy each other in a ring, none copying itself.
  findHypercycle() {
    const reps = [];
    for (const l of this.world.lineages.byId.values()) if (l.role === ROLE.replicase && l.count >= 12 && l.loop) reps.push(l);
    if (reps.length < 2 || reps.length > 400) return null;
    const self = (a) => affinity(a.loop, a.tag) >= 0.6;
    const cands = reps.filter((r) => !self(r));
    const out = new Map(cands.map((a) => [a.id, cands.filter((b) => b !== a && affinity(a.loop, b.tag) >= 0.6)]));
    // Depth-limited search for a cycle of length 2..6.
    for (const start of cands) {
      const stack = [[start, [start.id]]];
      while (stack.length) {
        const [node, path] = stack.pop();
        for (const nx of out.get(node.id)) {
          if (nx.id === start.id && path.length >= 2) return path;
          if (path.length < 6 && !path.includes(nx.id) && nx.id > start.id) stack.push([nx, [...path, nx.id]]);
        }
      }
    }
    return null;
  }

  // ---- tools ----

  pour(x, y, r = 6) {
    this.world.pour(x, y, r, 80);
  }

  stir(x, y, r = 6) {
    this.world.stir(x, y, r);
  }

  // ---- what the screen needs ----

  frame(mode = 'lineage') {
    const w = this.world;
    const msg = {
      kind: w.kind,
      step: w.step,
      T: w.T,
      census: this.last,
      events: this.newEvents.splice(0),
      cores: this.cores,
    };
    if (w.kind === 'surface') {
      msg.W = w.W;
      msg.H = w.H;
      msg.image = paintSurface(w, mode);
    } else {
      msg.W = w.W;
      msg.H = w.H;
      msg.vesicles = w.ves.map((v) => {
        const strands = [];
        for (const s of v.strands) {
          const role = roleOf(s.p);
          strands.push(role === ROLE.replicase ? 1 : s.lin > 0 ? (role === ROLE.ligase ? 3 : 2) : 0, s.lin > 0 ? Math.round(w.lineages.hue(s.lin)) : -1, s.p.L, s.dp ? 1 : 0);
        }
        return { id: v.id, x: v.x, y: v.y, r: w.radius(v), area: v.area, food: v.food / (v.area * 30), strands };
      });
    }
    return msg;
  }

  historySince(step) {
    return this.history.filter((h) => h.step > step);
  }

  tree() {
    const lins = this.world.lineages;
    const keep = lins.tree(12);
    const ids = new Set(keep.map((l) => l.id));
    // Point each kept lineage at its nearest kept ancestor.
    for (const l of keep) {
      let p = l.parent;
      let k = 0;
      while (p && !ids.has(p) && k++ < 500) p = lins.get(p)?.parent ?? 0;
      l.parent = ids.has(p) ? p : 0;
    }
    return { step: this.world.step, lineages: keep };
  }

  describeStrand(p, lin, dupP) {
    const l = lin > 0 ? this.world.lineages.get(lin) : null;
    const role = roleOf(p);
    return {
      seq: p.seq,
      db: p.db,
      L: p.L,
      energy: p.energy,
      tm: p.tm,
      gc: p.gc,
      tag: p.tag,
      tagOpen: p.tagOpen,
      promoter: p.promoter,
      role: role === ROLE.replicase ? 'replicase' : lin > 0 ? (role === ROLE.ligase ? 'ligase' : 'parasite') : 'unreplicated',
      rep: p.rep ? { loop: p.rep.loop, loopAt: p.rep.loopAt, q: p.rep.q, speed: p.rep.speed, err: this.params.errorRate * p.rep.errMul, selfCopy: affinity(p.rep.loop, p.tag) } : null,
      lig: p.lig,
      lineage: l ? { id: l.id, hue: l.hue, born: l.born, count: l.count, peak: l.peak, parent: l.parent } : lin < 0 ? { debrisOf: -lin } : null,
      duplex: dupP ? { seq: dupP.seq, L: dupP.L } : null,
    };
  }

  inspect(x, y) {
    const w = this.world;
    if (w.kind === 'surface') {
      const xi = ((Math.floor(x) % w.W) + w.W) % w.W;
      const yi = ((Math.floor(y) % w.H) + w.H) % w.H;
      const i = yi * w.W + xi;
      if (!w.ph[i]) return { x: xi, y: yi, empty: true, food: w.food[i] };
      return { x: xi, y: yi, strand: this.describeStrand(w.ph[i], w.lin[i], w.dph[i]), busy: w.busy[i] > 0, food: w.food[i] };
    }
    let best = null;
    let bd = Infinity;
    for (const v of w.ves) {
      const d = Math.hypot(v.x - x, v.y - y) - w.radius(v);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (!best || bd > 3) return { x, y, empty: true };
    const strands = best.strands.slice().sort((a, b) => (b.p.rep ? 1 : 0) - (a.p.rep ? 1 : 0) || b.p.L - a.p.L);
    return {
      vesicle: { id: best.id, area: best.area, gen: best.gen, count: best.strands.length },
      strand: strands.length ? this.describeStrand(strands[0].p, strands[0].lin, strands[0].dp) : null,
      contents: strands.slice(0, 40).map((s) => ({ role: s.p.rep ? 'replicase' : s.lin > 0 ? 'parasite' : 'unreplicated', L: s.p.L })),
    };
  }

  // Strands in a rectangle, for drawing them one by one when zoomed in.
  region(x0, y0, w, h, max = 700) {
    const W = this.world;
    if (W.kind !== 'surface') return [];
    const out = [];
    for (let y = Math.floor(y0); y < y0 + h && out.length < max; y++) {
      for (let x = Math.floor(x0); x < x0 + w && out.length < max; x++) {
        const xi = ((x % W.W) + W.W) % W.W;
        const yi = ((y % W.H) + W.H) % W.H;
        const i = yi * W.W + xi;
        const p = W.ph[i];
        if (!p) continue;
        const role = roleOf(p);
        out.push({ x, y, db: p.db, seq: p.seq, role: role === ROLE.replicase ? 1 : W.lin[i] > 0 ? 2 : 0, hue: W.lin[i] > 0 ? W.lineages.hue(W.lin[i]) : -1, dup: !!W.dph[i], busy: W.busy[i] > 0 });
      }
    }
    return out;
  }
}
