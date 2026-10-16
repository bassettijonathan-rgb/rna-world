// The mineral surface: a W × H grid (wrapping at the edges). Each site holds
// at most one strand, which may carry a copy of itself annealed to it as a
// double strand. Activated nucleotides diffuse over the same grid.
//
// One step visits every site in a fresh random order. A strand can break
// down, melt off its copy, start or finish copying a neighbour (if it is a
// replicase), get copied slowly with no replicase at all, or join a
// neighbour end to end. Empty sites can make a short random strand on the
// mineral. Then strands wander and food diffuses and flows back in.

import { pheno, templateAffinity } from './pheno.js';
import { copySeq, randomSeq, MAX_LEN, MIN_LEN } from './rna.js';
import { Lineages, ROLE, roleOf, classKey } from './lineage.js';
import { K, temperature } from './params.js';

const NB8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

export class Surface {
  constructor({ W = 128, H = 128, rng, params }) {
    this.kind = 'surface';
    this.W = W;
    this.H = H;
    const N = (this.N = W * H);
    this.rng = rng;
    this.p = params;
    this.step = 0;
    this.T = 25;
    this.ph = new Array(N).fill(null);
    this.lin = new Int32Array(N);
    this.dph = new Array(N).fill(null);
    this.dlin = new Int32Array(N);
    this.busy = new Int16Array(N);
    this.partner = new Int32Array(N).fill(-1);
    this.lock = new Int32Array(N).fill(-1);
    this.food = new Float32Array(N).fill(K.foodCap);
    this.food2 = new Float32Array(N);
    this.order = new Int32Array(N);
    for (let i = 0; i < N; i++) this.order[i] = i;
    this.nb = new Int32Array(N * 8);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let k = 0; k < 8; k++) {
          const xx = (x + NB8[k][0] + W) % W;
          const yy = (y + NB8[k][1] + H) % H;
          this.nb[(y * W + x) * 8 + k] = yy * W + xx;
        }
      }
    }
    this.aff = new Float64Array(8);
    this.lineages = new Lineages(rng);
    this.counters = { copies: 0, ligations: 0, breaks: 0, made: 0, neCopies: 0 };
  }

  // ---- placing and removing strands, with lineage bookkeeping ----

  put(i, p, lin) {
    this.ph[i] = p;
    this.lin[i] = lin;
    this.busy[i] = 0;
    this.partner[i] = -1;
    this.lock[i] = -1;
    if (lin > 0) this.lineages.add(lin, this.step);
  }

  clear(i) {
    if (!this.ph[i]) return;
    if (this.busy[i] > 0) this.abortJob(i);
    if (this.lock[i] >= 0) {
      const r = this.lock[i];
      if (this.partner[r] === i) {
        this.busy[r] = 0;
        this.partner[r] = -1;
      }
      this.lock[i] = -1;
    }
    if (this.lin[i] > 0) this.lineages.drop(this.lin[i], this.step);
    if (this.dph[i] && this.dlin[i] > 0) this.lineages.drop(this.dlin[i], this.step);
    this.ph[i] = null;
    this.dph[i] = null;
    this.lin[i] = 0;
    this.dlin[i] = 0;
  }

  setDuplex(i, p, lin) {
    this.dph[i] = p;
    this.dlin[i] = lin;
    if (lin > 0) this.lineages.add(lin, this.step);
  }

  abortJob(i) {
    const j = this.partner[i];
    if (j >= 0 && this.lock[j] === i) this.lock[j] = -1;
    this.busy[i] = 0;
    this.partner[i] = -1;
  }

  // A random occupied neighbour, or −1.
  touching(i) {
    const start = this.rng.int(8);
    const base = i * 8;
    for (let k = 0; k < 8; k++) {
      const j = this.nb[base + ((start + k) & 7)];
      if (this.ph[j]) return j;
    }
    return -1;
  }

  emptyNeighbour(i) {
    const start = this.rng.int(8);
    const base = i * 8;
    for (let k = 0; k < 8; k++) {
      const j = this.nb[base + ((start + k) & 7)];
      if (!this.ph[j]) return j;
    }
    return -1;
  }

  seed(seq, i, lin = 0) {
    if (this.ph[i]) this.clear(i);
    this.put(i, pheno(seq), lin);
  }

  // Scatter random strands over a fraction of the sites.
  seedRandom(density, minLen, maxLen) {
    for (let i = 0; i < this.N; i++) {
      if (this.rng.float() < density) this.seed(randomSeq(this.rng, minLen + this.rng.int(maxLen - minLen + 1)), i);
    }
  }

  // ---- one step ----

  advance() {
    const { rng, N } = this;
    this.step++;
    this.T = temperature(this.step, this.p);
    this.cold = this.T < K.activeBelow;
    this.heat = Math.exp((this.T - 25) / K.heatScale);
    const order = this.order;
    for (let k = N - 1; k > 0; k--) {
      const j = rng.int(k + 1);
      const t = order[k];
      order[k] = order[j];
      order[j] = t;
    }
    for (let k = 0; k < N; k++) this.visit(order[k]);
    this.mix();
    this.diffuseFood();
  }

  visit(i) {
    const rng = this.rng;
    const P = this.ph[i];
    if (!P) {
      const f = this.food[i];
      if (rng.float() < (K.synthesis * f) / K.foodCap) {
        const len = K.synthMin + rng.int(K.synthMax - K.synthMin + 1);
        if (f >= len) {
          this.food[i] = f - len;
          this.put(i, pheno(randomSeq(rng, len)), 0);
          this.counters.made++;
        }
      }
      return;
    }
    // Breakdown: the whole strand is lost, or one bond hydrolyses.
    const shield = this.dph[i] ? K.duplexShield : 1;
    const r = rng.float();
    const pLoss = K.decay * this.p.breakdown * this.heat * shield;
    if (r < pLoss) {
      this.clear(i);
      return;
    }
    if (r < pLoss + K.hydrolysis * this.p.breakdown * (P.L - 1) * this.heat * shield) {
      this.split(i);
      return;
    }
    // A copy in progress.
    if (this.busy[i] > 0) {
      if (!this.cold) {
        this.abortJob(i);
        return;
      }
      if (--this.busy[i] === 0) this.finishCopy(i);
      return;
    }
    // A double strand: it melts apart when the surface is hot enough.
    if (this.dph[i]) {
      if (this.T > Math.min(P.tm, this.dph[i].tm)) this.release(i);
      return;
    }
    if (this.lock[i] >= 0 || !this.cold) return;

    if (P.rep && this.startCopy(i, P)) return;
    // Slow, sloppy copying with no enzyme at all (template-directed
    // chemistry with activated nucleotides).
    if (rng.float() < K.nonEnzymatic && this.food[i] >= P.L) {
      this.food[i] -= P.L;
      const c = pheno(copySeq(P.seq, K.nonEnzymaticError, rng));
      if (c.L >= MIN_LEN) {
        // Only replicase-made copies found lineages; a chemical copy stays
        // in its template's lineage if it has one.
        const lin = this.lin[i] > 0 && this.lineages.get(this.lin[i])?.key === classKey(c) ? this.lin[i] : this.lin[i] > 0 ? -this.lin[i] : this.lin[i];
        this.setDuplex(i, c, lin);
        this.counters.neCopies++;
      }
      return;
    }
    // Spontaneous joining, much faster next to a ligase.
    const j = this.nb[i * 8 + rng.int(8)];
    const Q = this.ph[j];
    if (Q && !this.dph[j] && this.lock[j] < 0 && this.busy[j] === 0 && P.L + Q.L <= MAX_LEN) {
      let pj = K.ligation;
      if (P.lig > 0 || Q.lig > 0) pj *= 1 + K.ligaseBoost * Math.max(P.lig, Q.lig);
      if (rng.float() < pj) {
        const anc = this.lin[i] || this.lin[j];
        const joined = pheno(P.seq + Q.seq);
        this.clear(j);
        this.clear(i);
        this.put(i, joined, anc > 0 ? -anc : anc);
        this.counters.ligations++;
      }
    }
  }

  // A replicase looks at all eight neighbours and docks on one of the free
  // templates, picked in proportion to how well each one matches.
  startCopy(i, P) {
    const rng = this.rng;
    const base = i * 8;
    let total = 0;
    const aff = this.aff;
    for (let k = 0; k < 8; k++) {
      const j = this.nb[base + k];
      const Q = this.ph[j];
      let a = 0;
      if (Q && !this.dph[j] && this.lock[j] < 0 && this.busy[j] === 0) a = templateAffinity(P.rep, Q);
      aff[k] = a;
      total += a;
    }
    if (total <= 0 || rng.float() >= Math.min(1, K.bind * total)) return false;
    let pick = rng.float() * total;
    let k = 0;
    while (k < 7 && pick >= aff[k]) pick -= aff[k++];
    const j = this.nb[base + k];
    const Q = this.ph[j];
    const fi = this.food[i];
    const fj = this.food[j];
    if (fi + fj < Q.L) return false;
    const take = Q.L / (fi + fj);
    this.food[i] = fi * (1 - take);
    this.food[j] = fj * (1 - take);
    this.busy[i] = K.initiation + Math.ceil(Q.L / P.rep.speed);
    this.partner[i] = j;
    this.lock[j] = i;
    return true;
  }

  finishCopy(i) {
    const j = this.partner[i];
    this.partner[i] = -1;
    if (j < 0 || this.lock[j] !== i) return;
    this.lock[j] = -1;
    const T = this.ph[j];
    if (!T || this.dph[j]) return;
    const R = this.ph[i];
    const c = pheno(copySeq(T.seq, this.p.errorRate * R.rep.errMul, this.rng));
    if (c.L < MIN_LEN) return;
    this.setDuplex(j, c, this.lineages.forCopy(this.lin[j], c, this.step));
    this.counters.copies++;
  }

  release(i) {
    const e = this.emptyNeighbour(i);
    if (e < 0) return;
    const p = this.dph[i];
    const lin = this.dlin[i];
    this.dph[i] = null;
    this.dlin[i] = 0;
    // Moving the lineage count with the strand: drop then add.
    if (lin > 0) this.lineages.drop(lin, this.step);
    this.put(e, p, lin);
  }

  split(i) {
    const P = this.ph[i];
    const lin = this.lin[i];
    const anc = lin > 0 ? -lin : lin;
    const cut = 1 + this.rng.int(P.L - 1);
    const a = P.seq.slice(0, cut);
    const b = P.seq.slice(cut);
    this.clear(i);
    this.counters.breaks++;
    if (a.length >= MIN_LEN) this.put(i, pheno(a), anc);
    if (b.length >= MIN_LEN) {
      const e = this.ph[i] ? this.emptyNeighbour(i) : i;
      if (e >= 0) this.put(e, pheno(b), anc);
    }
  }

  movable(i) {
    return this.busy[i] === 0 && this.lock[i] < 0;
  }

  swap(i, j) {
    const { ph, lin, dph, dlin } = this;
    let t = ph[i];
    ph[i] = ph[j];
    ph[j] = t;
    t = dph[i];
    dph[i] = dph[j];
    dph[j] = t;
    let u = lin[i];
    lin[i] = lin[j];
    lin[j] = u;
    u = dlin[i];
    dlin[i] = dlin[j];
    dlin[j] = u;
  }

  mix() {
    const { rng, N } = this;
    if (this.p.wellMixed) {
      for (let i = N - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        if (this.movable(i) && this.movable(j)) this.swap(i, j);
      }
      return;
    }
    const m = this.p.mixing * N;
    let n = Math.floor(m);
    if (rng.float() < m - n) n++;
    for (let k = 0; k < n; k++) {
      const i = rng.int(N);
      const j = this.nb[i * 8 + rng.int(8)];
      if ((this.ph[i] || this.ph[j]) && this.movable(i) && this.movable(j)) this.swap(i, j);
    }
  }

  diffuseFood() {
    const { W, H, food, food2 } = this;
    const D = K.foodDiffusion;
    const s = this.p.foodSupply;
    const cap = K.foodCap;
    for (let y = 0; y < H; y++) {
      const up = ((y + H - 1) % H) * W;
      const dn = ((y + 1) % H) * W;
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const l = x === 0 ? W - 1 : x - 1;
        const r = x === W - 1 ? 0 : x + 1;
        const f = food[row + x];
        const lap = food[row + l] + food[row + r] + food[up + x] + food[dn + x] - 4 * f;
        const g = f + D * lap;
        food2[row + x] = g + s * (cap - g);
      }
    }
    if (this.p.wellMixed) {
      let sum = 0;
      for (let i = 0; i < food2.length; i++) sum += food2[i];
      food2.fill(sum / food2.length);
    }
    this.food = food2;
    this.food2 = food;
  }

  // ---- tools ----

  pour(cx, cy, radius, amount) {
    this.forDisc(cx, cy, radius, (i) => {
      this.food[i] = Math.min(3 * K.foodCap, this.food[i] + amount);
    });
  }

  stir(cx, cy, radius) {
    const cells = [];
    this.forDisc(cx, cy, radius, (i) => {
      if (this.movable(i)) cells.push(i);
    });
    for (let k = cells.length - 1; k > 0; k--) {
      const j = this.rng.int(k + 1);
      this.swap(cells[k], cells[j]);
    }
  }

  forDisc(cx, cy, radius, fn) {
    const { W, H } = this;
    const r2 = radius * radius;
    for (let dy = -Math.ceil(radius); dy <= radius; dy++) {
      for (let dx = -Math.ceil(radius); dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = (((Math.round(cx) + dx) % W) + W) % W;
        const y = (((Math.round(cy) + dy) % H) + H) % H;
        fn(y * W + x);
      }
    }
  }

  // ---- counting ----

  recount() {
    for (const l of this.lineages.byId.values()) l.count = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.ph[i] && this.lin[i] > 0) this.lineages.add(this.lin[i], this.step);
      if (this.dph[i] && this.dlin[i] > 0) this.lineages.add(this.dlin[i], this.step);
    }
    for (const l of this.lineages.byId.values()) if (l.count === 0 && l.died < 0) l.died = this.step;
  }

  census() {
    const c = { replicase: 0, live: 0, parasite: 0, ligase: 0, junk: 0, duplex: 0, strands: 0, nt: 0, repLen: 0, food: 0, busy: 0 };
    for (let i = 0; i < this.N; i++) {
      c.food += this.food[i];
      const P = this.ph[i];
      if (!P) continue;
      this.tally(c, P, this.lin[i]);
      if (this.busy[i] > 0) c.busy++;
      if (this.dph[i]) {
        c.duplex++;
        this.tally(c, this.dph[i], this.dlin[i]);
      }
    }
    c.food /= this.N * K.foodCap;
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
