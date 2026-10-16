// The "Joyce lab" challenge, after Lincoln & Joyce (2009): evolve a pair of
// RNA ligases that each build the other from two halves, then watch the
// pair amplify itself in a tube with no proteins.
//
// Stage 1, selection. A pool of random strands. Each strand E has a partner
// E′ (its reverse complement, which carries the complementary binding arms).
// Both are ligases only if their folds say so (pheno.lig). In each round a
// pair survives in proportion to how well E and E′ each catalyse joining;
// survivors are re-amplified with error-prone copying.
//
// Stage 2, cross-replication. E joins the halves of E′ and E′ joins the
// halves of E. The products pair with each other into inactive E·E′
// duplexes, which fall apart again at the reaction temperature. Substrates
// run out, then a small sample is moved into fresh substrate (serial
// transfer) and growth starts again.

import { pheno } from './pheno.js';
import { copySeq, randomSeq, complement } from './rna.js';
import { Rng } from './rng.js';

export function reverseComplement(s) {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += complement(s[i]);
  return out;
}

export function pairActivity(seq) {
  return Math.sqrt(pheno(seq).lig * pheno(reverseComplement(seq)).lig);
}

export function selectLigase({ seed = 'joyce', pool = 240, rounds = 12, length = 44, mu = 0.01 } = {}) {
  const rng = new Rng(seed);
  let tube = Array.from({ length: pool }, () => randomSeq(rng, length));
  const trace = [];
  let best = tube[0];
  for (let r = 0; r <= rounds; r++) {
    const acts = tube.map(pairActivity);
    const mean = acts.reduce((a, b) => a + b, 0) / acts.length;
    let bi = 0;
    for (let k = 1; k < acts.length; k++) if (acts[k] > acts[bi]) bi = k;
    best = tube[bi];
    trace.push({ round: r, mean, best: acts[bi] });
    if (r === rounds) break;
    // Selection: a pair is kept if it ligated during the incubation.
    const kept = tube.filter((_, k) => rng.float() < 1 - Math.exp(-4 * acts[k]) || rng.float() < 0.005);
    if (!kept.length) kept.push(best);
    tube = Array.from({ length: pool }, () => {
      const s = copySeq(kept[rng.int(kept.length)], mu, rng);
      return s.length >= 20 ? s : kept[0];
    });
  }
  return { best, trace, activity: pairActivity(best) };
}

// Deterministic kinetics of the cross-replicating pair. Concentrations are
// in µM, time in steps.
export function crossReplicate({ a = 0.5, ab = 0.5, start = 0.01, substrate = 10, transfers = 3, dilution = 100, kcat = 0.12, kOn = 0.5, kOff = 2, dt = 0.05 } = {}) {
  let E = start;
  let Ep = start;
  let EE = 0; // inactive E·E′ duplex
  let A = substrate; // halves of E (A + B)
  let Ap = substrate; // halves of E′
  const curve = [];
  const phases = [];
  let t = 0;
  for (let round = 0; round <= transfers; round++) {
    const phase = { start: t, points: [] };
    while (true) {
      // Each enzyme joins the partner's halves when both are bound.
      const fillA = A / substrate;
      const fillAp = Ap / substrate;
      const makeE = kcat * ab * Ep * fillA * fillA;
      const makeEp = kcat * a * E * fillAp * fillAp;
      const anneal = kOn * E * Ep;
      const melt = kOff * EE;
      E += dt * (makeE - anneal + melt);
      Ep += dt * (makeEp - anneal + melt);
      EE += dt * (anneal - melt);
      A = Math.max(0, A - dt * makeE);
      Ap = Math.max(0, Ap - dt * makeEp);
      t += dt;
      const total = E + Ep + 2 * EE;
      if (Math.abs(t - Math.round(t)) < dt / 2) {
        curve.push({ t: Math.round(t), total });
        phase.points.push({ t: Math.round(t), total });
      }
      if (A < 0.1 * substrate || t - phase.start > 600) break;
    }
    phases.push(phase);
    if (round === transfers) break;
    E /= dilution;
    Ep /= dilution;
    EE /= dilution;
    A = substrate;
    Ap = substrate;
  }
  return { curve, phases };
}

// Least-squares slope and R² of log(total) over the exponential part of a
// phase (until a fifth of the substrate is used).
export function exponentialFit(points, ceiling) {
  const pts = points.filter((p) => p.total < ceiling);
  if (pts.length < 5) return { rate: 0, r2: 0, n: pts.length };
  const xs = pts.map((p) => p.t);
  const ys = pts.map((p) => Math.log(p.total));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < n; k++) {
    sxy += (xs[k] - mx) * (ys[k] - my);
    sxx += (xs[k] - mx) ** 2;
    syy += (ys[k] - my) ** 2;
  }
  const rate = sxy / sxx;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { rate, r2, n };
}
