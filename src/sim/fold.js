// Secondary structure: a simplified Zuker minimum-free-energy fold.
//
// Pairs are Watson–Crick or G·U wobble. Energies (kcal/mol) follow the shape
// of the Turner nearest-neighbour model with far fewer parameters: stacked
// pairs score by the strength of both pairs, hairpins, bulges and interior
// loops pay a size-dependent cost, multiloops pay a linear cost, and GNRA
// tetraloops get a small bonus. Loops inside a helix are limited to
// MAX_LOOP unpaired bases, which keeps the fold O(n³) with a small constant.
// Results are cached by sequence.

const MAX_N = 200;
const MAX_LOOP = 6;
const MIN_HAIRPIN = 3;
const INF = 1e9;

// Pair classes: 0 none, 1 GC/CG, 2 AU/UA, 3 GU/UG.
const CODE = { A: 0, C: 1, G: 2, U: 3 };
const PAIR = [
  //A C G U
  [0, 0, 0, 2], // A
  [0, 0, 1, 0], // C
  [0, 1, 0, 3], // G
  [2, 0, 3, 0], // U
];
const STRENGTH = [0, 1.6, 0.55, 0.3];
const TERMINAL_AU = 0.5;
const ML_A = 3.4;
const ML_C = 0.4;
const RT = 0.616;
const HAIRPIN = [INF, INF, INF, 5.4, 5.6, 5.7, 5.4];

const HAIRPIN_TABLE = new Float64Array(201).map((_, n) => (n < HAIRPIN.length ? HAIRPIN[n] : 5.4 + 1.75 * RT * Math.log(n / 6)));
function hairpinInit(n) {
  return HAIRPIN_TABLE[n];
}

const V = new Float64Array(MAX_N * MAX_N);
const WM = new Float64Array(MAX_N * MAX_N);
// WM transposed (WMT[j * n + i] = WM[i * n + j]) so the O(n) loops read
// memory in order.
const WMT = new Float64Array(MAX_N * MAX_N);
const F = new Float64Array(MAX_N + 1);
const S = new Uint8Array(MAX_N);
const PT = new Uint8Array(MAX_N * MAX_N);
let N = 0; // row stride of V, WM, WMT and PT for the current fold

function terminal(p) {
  return p === 1 ? 0 : TERMINAL_AU;
}

function hairpinEnergy(i, j) {
  const n = j - i - 1;
  let e = hairpinInit(n) + terminal(PAIR[S[i]][S[j]]);
  // GNRA tetraloop (G, any, purine, A).
  if (n === 4 && S[i + 1] === 2 && (S[i + 3] === 0 || S[i + 3] === 2) && S[i + 4] === 0) e -= 1.5;
  return e;
}

// Loop closed by (i, j) outside and (k, l) inside.
function interiorEnergy(i, j, k, l) {
  const n1 = k - i - 1;
  const n2 = j - l - 1;
  const p1 = PAIR[S[i]][S[j]];
  const p2 = PAIR[S[k]][S[l]];
  if (n1 === 0 && n2 === 0) return -(STRENGTH[p1] + STRENGTH[p2]);
  const n = n1 + n2;
  if (n1 === 0 || n2 === 0) {
    if (n === 1) return 3.8 - (STRENGTH[p1] + STRENGTH[p2]);
    return 2.8 + 0.4 * n + terminal(p1) + terminal(p2);
  }
  return 0.5 + 0.5 * n + 0.5 * Math.abs(n1 - n2) + terminal(p1) + terminal(p2);
}

function fill(n) {
  N = n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) PT[i * n + j] = PAIR[S[i]][S[j]];
  for (let i = n - 1; i >= 0; i--) {
    const row = i * n;
    WM[row + i] = INF;
    WMT[row + i] = INF;
    V[row + i] = INF;
    for (let j = i + 1; j < n; j++) {
      const ij = row + j;
      // V: i and j paired.
      let v = INF;
      const p = j - i - 1 >= MIN_HAIRPIN ? PT[ij] : 0;
      if (p) {
        v = hairpinEnergy(i, j);
        const sp = STRENGTH[p];
        const tp = terminal(p);
        const kMax = Math.min(i + MAX_LOOP + 1, j - MIN_HAIRPIN - 2);
        for (let k = i + 1; k <= kMax; k++) {
          const n1 = k - i - 1;
          const lMin = Math.max(k + MIN_HAIRPIN + 1, j - 1 - (MAX_LOOP - n1));
          const krow = k * n;
          for (let l = j - 1; l >= lMin; l--) {
            const vk = V[krow + l];
            if (vk >= INF) continue;
            const q = PT[krow + l];
            const n2 = j - l - 1;
            let e;
            if (n1 === 0 && n2 === 0) e = -(sp + STRENGTH[q]);
            else if (n1 === 0 || n2 === 0) {
              const m = n1 + n2;
              e = m === 1 ? 3.8 - (sp + STRENGTH[q]) : 2.8 + 0.4 * m + tp + terminal(q);
            } else e = 0.5 + 0.5 * (n1 + n2) + 0.5 * Math.abs(n1 - n2) + tp + terminal(q);
            e += vk;
            if (e < v) v = e;
          }
        }
        const close = ML_A + ML_C + tp;
        const r1 = (i + 1) * n;
        const c1 = (j - 1) * n;
        let best = INF;
        for (let u = i + 2; u < j - 1; u++) {
          const e = WM[r1 + u] + WMT[c1 + u + 1];
          if (e < best) best = e;
        }
        if (best < INF && best + close < v) v = best + close;
      }
      V[ij] = v;
      // WM: inside a multiloop, at least one branch.
      let w = v < INF ? v + ML_C + terminal(p) : INF;
      const down = WM[(i + 1) * n + j];
      if (i + 1 <= j && down < w) w = down;
      if (j - 1 > i && WM[ij - 1] < w) w = WM[ij - 1];
      const cj = j * n;
      for (let u = i + 1; u < j - 1; u++) {
        const e = WM[row + u] + WMT[cj + u + 1];
        if (e < w) w = e;
      }
      if (w > INF) w = INF;
      WM[ij] = w;
      WMT[cj + i] = w;
    }
  }
  // Exterior loop: F[j + 1] is the best energy of the prefix 0..j.
  F[0] = 0;
  for (let j = 0; j < n; j++) {
    let f = F[j];
    for (let i = 0; i < j - MIN_HAIRPIN; i++) {
      const v = V[i * n + j];
      if (v >= INF) continue;
      const e = F[i] + v + terminal(PT[i * n + j]);
      if (e < f) f = e;
    }
    F[j + 1] = f;
  }
}

const EPS = 1e-9;

function traceback(n, pairs) {
  const stack = [['F', n - 1, 0]];
  while (stack.length) {
    const [kind, a, b] = stack.pop();
    if (kind === 'F') {
      const j = a;
      if (j < 0) continue;
      if (Math.abs(F[j + 1] - F[j]) < EPS) {
        stack.push(['F', j - 1, 0]);
        continue;
      }
      let found = false;
      for (let i = 0; i < j - MIN_HAIRPIN; i++) {
        const v = V[i * N + j];
        if (v >= INF) continue;
        if (Math.abs(F[i] + v + terminal(PAIR[S[i]][S[j]]) - F[j + 1]) < EPS) {
          stack.push(['F', i - 1, 0], ['V', i, j]);
          found = true;
          break;
        }
      }
      if (!found) stack.push(['F', j - 1, 0]);
    } else if (kind === 'V') {
      const i = a;
      const j = b;
      pairs[i] = j;
      pairs[j] = i;
      const v = V[i * N + j];
      if (Math.abs(v - hairpinEnergy(i, j)) < EPS) continue;
      let done = false;
      const kMax = Math.min(i + MAX_LOOP + 1, j - MIN_HAIRPIN - 2);
      for (let k = i + 1; k <= kMax && !done; k++) {
        const n1 = k - i - 1;
        const lMin = Math.max(k + MIN_HAIRPIN + 1, j - 1 - (MAX_LOOP - n1));
        for (let l = j - 1; l >= lMin; l--) {
          const vk = V[k * N + l];
          if (vk >= INF) continue;
          if (Math.abs(interiorEnergy(i, j, k, l) + vk - v) < EPS) {
            stack.push(['V', k, l]);
            done = true;
            break;
          }
        }
      }
      if (done) continue;
      const close = ML_A + ML_C + terminal(PAIR[S[i]][S[j]]);
      for (let u = i + 2; u < j - 1; u++) {
        const x = WM[(i + 1) * N + u];
        const y = WM[(u + 1) * N + j - 1];
        if (x >= INF || y >= INF) continue;
        if (Math.abs(x + y + close - v) < EPS) {
          stack.push(['M', i + 1, u], ['M', u + 1, j - 1]);
          break;
        }
      }
    } else {
      const i = a;
      const j = b;
      const w = WM[i * N + j];
      const v = V[i * N + j];
      if (v < INF && Math.abs(v + ML_C + terminal(PAIR[S[i]][S[j]]) - w) < EPS) {
        stack.push(['V', i, j]);
        continue;
      }
      if (i + 1 < j && Math.abs(WM[(i + 1) * N + j] - w) < EPS) {
        stack.push(['M', i + 1, j]);
        continue;
      }
      if (j - 1 > i && Math.abs(WM[i * N + j - 1] - w) < EPS) {
        stack.push(['M', i, j - 1]);
        continue;
      }
      for (let u = i + 1; u < j - 1; u++) {
        const x = WM[i * N + u];
        const y = WM[(u + 1) * N + j];
        if (x >= INF || y >= INF) continue;
        if (Math.abs(x + y - w) < EPS) {
          stack.push(['M', i, u], ['M', u + 1, j]);
          break;
        }
      }
    }
  }
}

// Fold a sequence. Returns the pairing partner of each base (−1 if
// unpaired), the dot-bracket string and the free energy.
export function foldUncached(seq) {
  const n = Math.min(seq.length, MAX_N);
  for (let i = 0; i < n; i++) S[i] = CODE[seq[i]];
  const pairs = new Int16Array(n).fill(-1);
  if (n >= MIN_HAIRPIN + 2) {
    fill(n);
    traceback(n, pairs);
  }
  let db = '';
  for (let i = 0; i < n; i++) db += pairs[i] < 0 ? '.' : pairs[i] > i ? '(' : ')';
  const energy = n >= MIN_HAIRPIN + 2 ? Math.min(0, F[n]) : 0;
  return { pairs, db, energy: Math.round(energy * 100) / 100 };
}

// Energy of a given structure under the same model, used by the tests to
// check the fold is self-consistent.
export function structureEnergy(seq, pairs) {
  const n = seq.length;
  for (let i = 0; i < n; i++) S[i] = CODE[seq[i]];
  let e = 0;
  const loopEnergy = (i, j) => {
    // Branches directly inside (i, j).
    const branches = [];
    let k = i + 1;
    while (k < j) {
      if (pairs[k] > k) {
        branches.push([k, pairs[k]]);
        k = pairs[k] + 1;
      } else k++;
    }
    if (branches.length === 0) return hairpinEnergy(i, j);
    if (branches.length === 1) return interiorEnergy(i, j, branches[0][0], branches[0][1]);
    let m = ML_A + ML_C + terminal(PAIR[S[i]][S[j]]);
    for (const [a, b] of branches) m += ML_C + terminal(PAIR[S[a]][S[b]]);
    return m;
  };
  for (let i = 0; i < n; i++) {
    if (pairs[i] > i) e += loopEnergy(i, pairs[i]);
  }
  // Exterior branches.
  let k = 0;
  while (k < n) {
    if (pairs[k] > k) {
      e += terminal(PAIR[S[k]][S[pairs[k]]]);
      k = pairs[k] + 1;
    } else k++;
  }
  return e;
}

const cache = new Map();
const CACHE_MAX = 30000;

export function fold(seq) {
  let r = cache.get(seq);
  if (r) return r;
  r = foldUncached(seq);
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest quarter: Map iterates in insertion order.
    let k = CACHE_MAX >> 2;
    for (const key of cache.keys()) {
      cache.delete(key);
      if (--k <= 0) break;
    }
  }
  cache.set(seq, r);
  return r;
}

export function canPair(a, b) {
  return PAIR[CODE[a]][CODE[b]] !== 0;
}
