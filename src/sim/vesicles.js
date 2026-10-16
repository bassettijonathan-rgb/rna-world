// Vesicle mode: the same chemistry, but strands live inside fatty-acid
// vesicles instead of on the open surface. Inside a vesicle everything
// touches everything (well mixed); strands never cross membranes, while
// activated nucleotides seep in from outside.
//
// Vesicles grow by taking up free lipid. RNA inside pulls in water and
// swells the membrane, so vesicles with more RNA grow faster (Chen, Roberts
// & Szostak 2004). A vesicle that reaches twice its starting area splits in
// two, each strand going to either daughter at random. Space is limited:
// when the dish is full, a division washes out a random other vesicle.
// So vesicles whose replicases keep making RNA out-divide the rest, and a
// parasite only hurts the vesicle it is in.

import { pheno, templateAffinity } from './pheno.js';
import { copySeq, MAX_LEN, MIN_LEN } from './rna.js';
import { Lineages, ROLE, roleOf, classKey } from './lineage.js';
import { K, temperature } from './params.js';

export const V = {
  startArea: 30, // in surface sites
  capacityPerArea: 1.3, // strands a vesicle holds per unit area
  maxVesicles: 140,
  lipidUptake: 0.02,
  osmotic: 1 / 25, // growth boost per nucleotide per unit area
  baseGrowth: 0.04,
  permeability: 0.05, // nucleotide exchange with outside per step
  burst: 0.0002,
};

export class Vesicles {
  constructor({ size = 128, rng, params, lineages = null }) {
    this.kind = 'vesicles';
    this.W = size;
    this.H = size;
    this.rng = rng;
    this.p = params;
    this.step = 0;
    this.T = 25;
    this.ves = [];
    this.lineages = lineages ?? new Lineages(rng);
    this.counters = { copies: 0, ligations: 0, breaks: 0, made: 0, neCopies: 0, divisions: 0, washouts: 0 };
  }

  makeVesicle(x, y, area = V.startArea, gen = 0) {
    this.nextId = (this.nextId ?? 0) + 1;
    const v = { id: this.nextId, x, y, area, food: area * K.foodCap * 0.5, strands: [], gen, born: this.step };
    this.ves.push(v);
    return v;
  }

  radius(v) {
    return Math.sqrt(v.area / Math.PI);
  }

  capacity(v) {
    return Math.floor(v.area * V.capacityPerArea);
  }

  addStrand(v, p, lin) {
    if (v.strands.length >= this.capacity(v)) return null;
    const s = { p, lin, dp: null, dlin: 0, busy: 0, partner: null, lockedBy: null };
    v.strands.push(s);
    if (lin > 0) this.lineages.add(lin, this.step);
    return s;
  }

  removeStrand(v, s) {
    const k = v.strands.indexOf(s);
    if (k < 0) return;
    v.strands[k] = v.strands[v.strands.length - 1];
    v.strands.pop();
    s.dead = true;
    if (s.partner) {
      s.partner.lockedBy = null;
      s.partner = null;
    }
    if (s.lockedBy) {
      s.lockedBy.busy = 0;
      s.lockedBy.partner = null;
      s.lockedBy = null;
    }
    if (s.lin > 0) this.lineages.drop(s.lin, this.step);
    if (s.dp && s.dlin > 0) this.lineages.drop(s.dlin, this.step);
  }

  // Spread vesicles over the dish without overlap.
  scatter(n) {
    for (let k = 0; k < n; k++) this.makeVesicle(this.rng.float() * this.W, this.rng.float() * this.H);
    for (let k = 0; k < 40; k++) this.relax(1);
  }

  advance() {
    const rng = this.rng;
    this.step++;
    this.T = temperature(this.step, this.p);
    this.cold = this.T < K.activeBelow;
    this.heat = Math.exp((this.T - 25) / K.heatScale);
    const order = rng.shuffle(this.ves.slice());
    for (const v of order) {
      if (v.gone) continue;
      this.chemistry(v);
      this.grow(v);
    }
    this.move();
  }

  chemistry(v) {
    const rng = this.rng;
    // Nucleotides seep across the membrane.
    const capFood = v.area * K.foodCap * 0.5;
    v.food += V.permeability * (this.p.foodSupply / 0.02) * (capFood - v.food) * 0.2;
    if (v.food > capFood) v.food = capFood;
    const list = rng.shuffle(v.strands.slice());
    for (const s of list) {
      if (s.dead) continue;
      this.visit(v, s);
    }
  }

  visit(v, s) {
    const rng = this.rng;
    const P = s.p;
    const shield = s.dp ? K.duplexShield : 1;
    const r = rng.float();
    const pLoss = K.decay * this.p.breakdown * this.heat * shield;
    if (r < pLoss) {
      this.removeStrand(v, s);
      return;
    }
    if (r < pLoss + K.hydrolysis * this.p.breakdown * (P.L - 1) * this.heat * shield) {
      this.split(v, s);
      return;
    }
    if (s.busy > 0) {
      if (!this.cold) {
        this.abort(s);
        return;
      }
      if (--s.busy === 0) this.finishCopy(v, s);
      return;
    }
    if (s.dp) {
      if (this.T > Math.min(P.tm, s.dp.tm) && v.strands.length < this.capacity(v)) {
        const p = s.dp;
        const lin = s.dlin;
        s.dp = null;
        s.dlin = 0;
        if (lin > 0) this.lineages.drop(lin, this.step);
        this.addStrand(v, p, lin);
      }
      return;
    }
    if (s.lockedBy || !this.cold) return;
    const n = v.strands.length;
    if (P.rep && n > 1) {
      const o = v.strands[rng.int(n)];
      if (o !== s && !o.dp && !o.lockedBy && o.busy === 0) {
        const a = templateAffinity(P.rep, o.p);
        if (a > 0 && rng.float() < a * K.bind && v.food >= o.p.L) {
          v.food -= o.p.L;
          s.busy = K.initiation + Math.ceil(o.p.L / P.rep.speed);
          s.partner = o;
          o.lockedBy = s;
          return;
        }
      }
    }
    if (rng.float() < K.nonEnzymatic && v.food >= P.L) {
      v.food -= P.L;
      const c = pheno(copySeq(P.seq, K.nonEnzymaticError, rng));
      if (c.L >= MIN_LEN) {
        const lin = s.lin > 0 && this.lineages.get(s.lin)?.key === classKey(c) ? s.lin : s.lin > 0 ? -s.lin : s.lin;
        s.dp = c;
        s.dlin = lin;
        if (lin > 0) this.lineages.add(lin, this.step);
        this.counters.neCopies++;
      }
      return;
    }
    if (n > 1) {
      const o = v.strands[rng.int(n)];
      if (o !== s && !o.dp && !o.lockedBy && o.busy === 0 && P.L + o.p.L <= MAX_LEN) {
        let pj = K.ligation;
        if (P.lig > 0 || o.p.lig > 0) pj *= 1 + K.ligaseBoost * Math.max(P.lig, o.p.lig);
        if (rng.float() < pj) {
          const anc = s.lin || o.lin;
          const joined = pheno(P.seq + o.p.seq);
          this.removeStrand(v, o);
          this.removeStrand(v, s);
          this.addStrand(v, joined, anc > 0 ? -anc : anc);
          this.counters.ligations++;
        }
      }
    }
  }

  abort(s) {
    if (s.partner) s.partner.lockedBy = null;
    s.partner = null;
    s.busy = 0;
  }

  finishCopy(v, s) {
    const t = s.partner;
    s.partner = null;
    if (!t || t.lockedBy !== s) return;
    t.lockedBy = null;
    if (t.dp || t.dead) return;
    const c = pheno(copySeq(t.p.seq, this.p.errorRate * s.p.rep.errMul, this.rng));
    if (c.L < MIN_LEN) return;
    t.dp = c;
    t.dlin = this.lineages.forCopy(t.lin, c, this.step);
    if (t.dlin > 0) this.lineages.add(t.dlin, this.step);
    this.counters.copies++;
  }

  split(v, s) {
    const P = s.p;
    const anc = s.lin > 0 ? -s.lin : s.lin;
    const cut = 1 + this.rng.int(P.L - 1);
    this.removeStrand(v, s);
    this.counters.breaks++;
    const a = P.seq.slice(0, cut);
    const b = P.seq.slice(cut);
    if (a.length >= MIN_LEN) this.addStrand(v, pheno(a), anc);
    if (b.length >= MIN_LEN) this.addStrand(v, pheno(b), anc);
  }

  ntContent(v) {
    let nt = 0;
    for (const s of v.strands) nt += s.p.L + (s.dp ? s.dp.L : 0);
    return nt;
  }

  grow(v) {
    const rng = this.rng;
    if (rng.float() < V.burst) {
      this.wash(v);
      return;
    }
    const density = this.ntContent(v) / v.area;
    v.area += V.lipidUptake * (V.baseGrowth + V.osmotic * density) * (this.p.foodSupply > 0 ? 1 : 0.5);
    if (v.area >= 2 * V.startArea) this.divide(v);
  }

  divide(v) {
    const rng = this.rng;
    const ang = rng.float() * Math.PI * 2;
    const r = this.radius(v) * 0.5;
    const d = this.makeVesicle(v.x + Math.cos(ang) * r, v.y + Math.sin(ang) * r, v.area / 2, v.gen + 1);
    v.x -= Math.cos(ang) * r;
    v.y -= Math.sin(ang) * r;
    v.area /= 2;
    d.food = v.food / 2;
    v.food /= 2;
    const keep = [];
    for (const s of v.strands) {
      if (s.busy) this.abort(s);
      if (s.lockedBy) {
        s.lockedBy.partner = null;
        s.lockedBy.busy = 0;
        s.lockedBy = null;
      }
    }
    for (const s of v.strands) {
      if (rng.float() < 0.5) keep.push(s);
      else d.strands.push(s);
    }
    v.strands = keep;
    this.counters.divisions++;
    if (!this.firstDivision) this.firstDivision = { step: this.step, x: v.x, y: v.y };
    while (this.ves.length > V.maxVesicles) {
      const victim = this.ves[rng.int(this.ves.length)];
      if (victim === v || victim === d) continue;
      this.wash(victim);
      this.counters.washouts++;
    }
  }

  wash(v) {
    for (const s of v.strands.slice()) this.removeStrand(v, s);
    v.gone = true;
    const k = this.ves.indexOf(v);
    if (k >= 0) this.ves.splice(k, 1);
  }

  // Brownian drift with soft repulsion, on a wrapping dish.
  move() {
    const rng = this.rng;
    for (const v of this.ves) {
      v.x += (rng.float() - 0.5) * 0.6;
      v.y += (rng.float() - 0.5) * 0.6;
    }
    this.relax(0.5);
  }

  relax(strength) {
    const { W, H } = this;
    const vs = this.ves;
    for (let a = 0; a < vs.length; a++) {
      const A = vs[a];
      const ra = this.radius(A);
      for (let b = a + 1; b < vs.length; b++) {
        const B = vs[b];
        let dx = B.x - A.x;
        let dy = B.y - A.y;
        if (dx > W / 2) dx -= W;
        else if (dx < -W / 2) dx += W;
        if (dy > H / 2) dy -= H;
        else if (dy < -H / 2) dy += H;
        const min = ra + this.radius(B) + 0.6;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5 * strength;
        A.x -= dx * push;
        A.y -= dy * push;
        B.x += dx * push;
        B.y += dy * push;
      }
    }
    for (const v of vs) {
      v.x = ((v.x % W) + W) % W;
      v.y = ((v.y % H) + H) % H;
    }
  }

  // ---- tools ----

  pour(cx, cy, radius, amount) {
    for (const v of this.ves) {
      if (Math.hypot(v.x - cx, v.y - cy) <= radius + this.radius(v)) v.food += amount * v.area * 0.5;
    }
  }

  stir(cx, cy, radius) {
    for (const v of this.ves) {
      if (Math.hypot(v.x - cx, v.y - cy) <= radius) {
        v.x = (v.x + (this.rng.float() - 0.5) * radius * 2 + this.W) % this.W;
        v.y = (v.y + (this.rng.float() - 0.5) * radius * 2 + this.H) % this.H;
      }
    }
    this.relax(1);
  }

  // ---- counting ----

  recount() {
    for (const l of this.lineages.byId.values()) l.count = 0;
    for (const v of this.ves) {
      for (const s of v.strands) {
        if (s.lin > 0) this.lineages.add(s.lin, this.step);
        if (s.dp && s.dlin > 0) this.lineages.add(s.dlin, this.step);
      }
    }
    for (const l of this.lineages.byId.values()) if (l.count === 0 && l.died < 0) l.died = this.step;
  }

  census() {
    const c = { replicase: 0, live: 0, parasite: 0, ligase: 0, junk: 0, duplex: 0, strands: 0, nt: 0, repLen: 0, food: 0, busy: 0, vesicles: this.ves.length, withReplicase: 0 };
    let cap = 0;
    for (const v of this.ves) {
      let hasRep = false;
      c.food += v.food;
      cap += v.area * K.foodCap * 0.5;
      for (const s of v.strands) {
        this.tally(c, s.p, s.lin);
        if (s.p.rep && s.lin > 0) hasRep = true;
        if (s.busy) c.busy++;
        if (s.dp) {
          c.duplex++;
          this.tally(c, s.dp, s.dlin);
        }
      }
      if (hasRep) c.withReplicase++;
    }
    c.food = cap ? c.food / cap : 0;
    c.repLen = c.replicase ? c.repLen / c.replicase : 0;
    return c;
  }

  tally(c, P, lin) {
    c.strands++;
    c.nt += P.L;
    const role = roleOf(P);
    if (role === ROLE.replicase) {
      c.replicase++;
      if (lin > 0) c.live++;
      c.repLen += P.L;
    } else if (lin > 0) {
      if (role === ROLE.ligase) c.ligase++;
      else c.parasite++;
    } else c.junk++;
  }
}

// Package the strands of a surface into vesicles: each strand joins the
// nearest vesicle that still has room, so neighbours stay together.
export function surfaceToVesicles(surface, rng, params, count = 110) {
  const ves = new Vesicles({ size: surface.W, rng, params, lineages: surface.lineages });
  ves.step = surface.step;
  ves.scatter(count);
  const { W } = surface;
  const cell = 8;
  const grid = new Map();
  for (const v of ves.ves) {
    const key = `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(v);
  }
  for (let i = 0; i < surface.N; i++) {
    const p = surface.ph[i];
    if (!p) continue;
    const x = i % W;
    const y = (i / W) | 0;
    let best = null;
    let bd = Infinity;
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const n = Math.ceil(W / cell);
        const list = grid.get(`${(gx + dx + n) % n},${(gy + dy + n) % n}`);
        if (!list) continue;
        for (const v of list) {
          if (v.strands.length >= ves.capacity(v)) continue;
          const d = Math.hypot(v.x - x, v.y - y);
          if (d < bd) {
            bd = d;
            best = v;
          }
        }
      }
    }
    if (!best) continue;
    const lin = surface.lin[i];
    // Moving strands between worlds: the lineage counts follow.
    const s = { p, lin, dp: surface.dph[i], dlin: surface.dlin[i], busy: 0, partner: null, lockedBy: null };
    best.strands.push(s);
  }
  ves.recount();
  return ves;
}

// Burst every vesicle and spill its strands onto the surface around it.
export function vesiclesToSurface(ves, surface) {
  for (let i = 0; i < surface.N; i++) if (surface.ph[i]) surface.clear(i);
  const { W, H } = surface;
  for (const v of ves.ves) {
    const cx = Math.round(v.x);
    const cy = Math.round(v.y);
    let r = 0;
    let k = 0;
    for (const s of v.strands) {
      // Walk outward in rings until an empty site turns up.
      let placed = false;
      while (!placed && r < 12) {
        const ring = Math.max(1, r * 8);
        for (; k < ring && !placed; k++) {
          const ang = (k / ring) * Math.PI * 2;
          const x = (((cx + Math.round(Math.cos(ang) * r)) % W) + W) % W;
          const y = (((cy + Math.round(Math.sin(ang) * r)) % H) + H) % H;
          const i = y * W + x;
          if (!surface.ph[i]) {
            surface.ph[i] = s.p;
            surface.lin[i] = s.lin;
            surface.dph[i] = s.dp;
            surface.dlin[i] = s.dp ? s.dlin : 0;
            placed = true;
          }
        }
        if (!placed) {
          r++;
          k = 0;
        }
      }
    }
  }
  surface.step = ves.step;
  surface.recount();
}
