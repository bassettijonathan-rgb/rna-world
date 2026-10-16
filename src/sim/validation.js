// The Validation tab: five experiments, each run live with the simulation's
// own chemistry, each reporting a measured number and pass or fail.

import { Rng } from './rng.js';
import { drawErrors, copySeq, randomSeq } from './rna.js';
import { pheno } from './pheno.js';
import { Surface } from './surface.js';
import { Vesicles } from './vesicles.js';
import { DEFAULTS } from './params.js';
import { spiralCores } from './spiral.js';
import { SELF_REPLICASE, SELF_PARASITE } from './designs.js';
import { selectLigase, crossReplicate, exponentialFit, reverseComplement } from './lab.js';

const fmt = (v) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en'));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const tick = () => new Promise((r) => setTimeout(r, 0));
// Hand control back now and then so a page (or a worker's message queue)
// is never held up for long.
let lastYield = 0;
function breathe() {
  if (now() - lastYield < 25) return null;
  lastYield = now();
  return tick();
}

// ---------------------------------------------------------------------------
// 1. Eigen's error threshold. A master sequence of length L replicates σ
// times faster than its mutants; each copy is error-free with probability
// (1 − μ)^L (the simulation's own error draw). Below the threshold the
// master holds on as a quasispecies; above it, it is lost. Theory: the
// longest sequence that survives is L ≈ ln σ / μ.

function masterSurvives(L, mu, { sigma, N, gens, rng }) {
  let m = N;
  for (let g = 0; g < gens; g++) {
    const pMaster = (sigma * m) / (sigma * m + (N - m));
    const parents = rng.binomial(N, pMaster);
    let good = 0;
    for (let k = 0; k < parents; k++) if (!drawErrors(L, mu, rng, 0).any) good++;
    m = good;
    if (m === 0) return false;
  }
  return true;
}

export function eigenThreshold({ sigma = 10, N = 1000, gens = 250, mus = [0.004, 0.008, 0.016], seed = 'eigen' } = {}) {
  const rng = new Rng(seed);
  const rows = [];
  for (const mu of mus) {
    const theory = Math.log(sigma) / mu;
    let lo = 1;
    let hi = Math.ceil(2 * theory);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (masterSurvives(mid, mu, { sigma, N, gens, rng })) lo = mid;
      else hi = mid;
    }
    rows.push({ mu, Lmax: lo, theory, ratio: lo / theory });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2. Spiegelman's monster. An outside replicase (as Qβ replicase was in
// Spiegelman's tubes) copies any strand with a promoter, one base at a
// time, so short templates finish sooner. Every few rounds a small sample
// moves to a fresh tube. Deletions that keep the promoter win, and the
// strands shrink toward the smallest thing that is still copied.

function startTemplate(rng, L) {
  for (let k = 0; k < 2000; k++) {
    const s = randomSeq(rng, L);
    if (pheno(s).promoter) return s;
  }
  throw new Error('no start template');
}

export async function spiegelman({ seed = 'spiegelman', startLen = 200, transfers = 40, cap = 300, sample = 12, mu = 0.01, speed = 6, init = 2, maxSteps = 400 } = {}) {
  const rng = new Rng(seed);
  const start = startTemplate(rng, startLen);
  let tube = [start];
  const medians = [];
  const median = (arr) => {
    const a = arr.map((s) => s.length).sort((x, y) => x - y);
    return a[a.length >> 1];
  };
  medians.push(median(tube));
  for (let t = 0; t < transfers; t++) {
    let strands = tube.map((s) => ({ s, busy: 0 }));
    for (let step = 0; step < maxSteps && strands.length < cap; step++) {
      const born = [];
      for (const x of strands) {
        if (x.busy > 0) {
          if (--x.busy === 0) {
            const c = copySeq(x.s, mu, rng);
            if (c.length >= 8) born.push({ s: c, busy: 0 });
          }
        } else if (pheno(x.s).promoter) x.busy = init + Math.ceil(x.s.length / speed);
      }
      strands = strands.concat(born);
      const b = breathe();
      if (b) await b;
    }
    // Serial transfer: a small random sample seeds the next tube.
    rng.shuffle(strands);
    tube = strands.slice(0, sample).map((x) => x.s);
    medians.push(median(strands.map((x) => x.s)));
  }
  return { start: startLen, medians, final: medians[medians.length - 1], shortest: Math.min(...tube.map((s) => s.length)) };
}

// ---------------------------------------------------------------------------
// 3 and 4. Replicases and parasites: a well-mixed pot, the open surface and
// vesicles, all with the same chemistry and starting mix.

// Average over the last quarter of a run, so one stray strand made by
// chance at the very end does not decide the result.
function tailMean(trace, key) {
  const tail = trace.slice(Math.floor(trace.length * 0.75));
  return tail.reduce((a, t) => a + t[key], 0) / Math.max(1, tail.length);
}

export const PARASITE_TEST = { breakdown: 1.5, mixing: 0.003, size: 128, steps: 12000, replicase: 0.15, parasite: 0.015 };

function seedMix(add, rng, n, T) {
  const lr = T.lineages.found(0, pheno(SELF_REPLICASE), 0);
  const lp = T.lineages.found(0, pheno(SELF_PARASITE), 0);
  for (let i = 0; i < n; i++) {
    const r = rng.float();
    if (r < PARASITE_TEST.replicase) add(i, SELF_REPLICASE, lr);
    else if (r < PARASITE_TEST.replicase + PARASITE_TEST.parasite) add(i, SELF_PARASITE, lp);
  }
}

export async function parasiteRun({ wellMixed = false, seed = 'parasites', steps = PARASITE_TEST.steps, size = PARASITE_TEST.size, params = {}, every = 250, onProgress } = {}) {
  const rng = new Rng(seed);
  const p = { ...DEFAULTS, breakdown: PARASITE_TEST.breakdown, mixing: PARASITE_TEST.mixing, ...params, wellMixed };
  const s = new Surface({ W: size, H: size, rng, params: p });
  seedMix((i, seq, lin) => s.seed(seq, i, lin), rng, s.N, s);
  const trace = [];
  let coreSum = 0;
  let coreN = 0;
  for (let k = 1; k <= steps; k++) {
    s.advance();
    const b = breathe();
    if (b) {
      onProgress?.(k / steps);
      await b;
    }
    if (k % every === 0) {
      const c = s.census();
      const cores = wellMixed ? 0 : spiralCores(s, 4).cores.length;
      if (k > steps / 2) {
        coreSum += cores;
        coreN++;
      }
      trace.push({ step: k, rep: c.live, para: c.parasite, cores });
    }
  }
  return { trace, rep: tailMean(trace, 'rep'), para: tailMean(trace, 'para'), cores: coreN ? coreSum / coreN : 0 };
}

export async function vesicleRun({ seed = 'parasites', steps = PARASITE_TEST.steps, size = PARASITE_TEST.size, params = {}, every = 250, onProgress } = {}) {
  const rng = new Rng(seed);
  const p = { ...DEFAULTS, breakdown: PARASITE_TEST.breakdown, mixing: PARASITE_TEST.mixing, ...params };
  const v = new Vesicles({ size, rng, params: p });
  v.scatter(110);
  // Same starting mix, packed vesicle by vesicle.
  const lr = v.lineages.found(0, pheno(SELF_REPLICASE), 0);
  const lp = v.lineages.found(0, pheno(SELF_PARASITE), 0);
  for (const ves of v.ves) {
    const n = v.capacity(ves) >> 1;
    for (let k = 0; k < n; k++) {
      const r = rng.float();
      if (r < PARASITE_TEST.replicase / 0.5) v.addStrand(ves, pheno(SELF_REPLICASE), lr);
      else if (r < (PARASITE_TEST.replicase + PARASITE_TEST.parasite) / 0.5) v.addStrand(ves, pheno(SELF_PARASITE), lp);
    }
  }
  const trace = [];
  for (let k = 1; k <= steps; k++) {
    v.advance();
    const b = breathe();
    if (b) {
      onProgress?.(k / steps);
      await b;
    }
    if (k % every === 0) {
      const c = v.census();
      trace.push({ step: k, rep: c.live, para: c.parasite, ves: c.vesicles, withRep: c.withReplicase });
    }
  }
  const last = trace[trace.length - 1];
  return { trace, rep: tailMean(trace, 'rep'), para: tailMean(trace, 'para'), withRep: last.withRep, divisions: v.counters.divisions };
}

// ---------------------------------------------------------------------------

export async function runValidation({ quick = false, onRow, onProgress } = {}) {
  const rows = [];
  const emit = (row) => {
    rows.push(row);
    onRow?.(row);
  };
  const scale = quick ? 0.5 : 1;

  // 1. Eigen
  {
    const t0 = Date.now();
    const res = eigenThreshold({ gens: quick ? 150 : 250 });
    const worst = Math.max(...res.map((r) => Math.abs(r.ratio - 1)));
    const falling = res.every((r, k) => k === 0 || r.Lmax < res[k - 1].Lmax);
    emit({
      id: 'eigen',
      title: 'Eigen’s error threshold',
      value: res.map((r) => `${r.Lmax}`).join(' · '),
      unit: `longest surviving length at μ = ${res.map((r) => r.mu).join(', ')}`,
      expected: res.map((r) => Math.round(r.theory)).join(' · '),
      pass: worst <= 0.2 && falling,
      detail: `Within ${(worst * 100).toFixed(0)}% of ln σ / μ (σ = 10), and it falls as μ rises.`,
      how: 'A master sequence that copies 10× faster than its mutants, in a pot of 1,000. Copies use the simulation’s error draw. Bisection finds the longest master that is still there after 250 generations.',
      source: 'Eigen (1971); Eigen & Schuster (1977)',
      chart: { kind: 'bars', labels: res.map((r) => `μ ${r.mu}`), a: res.map((r) => r.Lmax), b: res.map((r) => r.theory), aLabel: 'measured', bLabel: 'ln σ / μ' },
      ms: Date.now() - t0,
    });
    await tick();
  }

  // 2. Spiegelman
  {
    const t0 = Date.now();
    const res = await spiegelman();
    const shrink = res.final / res.start;
    const tail = res.medians.slice(-4);
    const plateau = Math.max(...tail) - Math.min(...tail) <= Math.max(4, 0.2 * res.final);
    emit({
      id: 'spiegelman',
      title: 'Spiegelman’s monster',
      value: `${res.start} → ${res.final} bases`,
      unit: 'median strand length after serial transfer',
      expected: 'shrinks to a small fraction, then levels off',
      pass: shrink <= 0.25 && plateau,
      detail: `Strands end at ${(shrink * 100).toFixed(0)}% of their starting length and stop shrinking; the shortest copyable strand left is ${res.shortest} bases.`,
      how: 'An outside replicase copies anything with a promoter, base by base, with deletions now and then. Each tube grows to 300 strands, then 12 go into a fresh tube.',
      source: 'Mills, Peterson & Spiegelman (1967): Qβ RNA fell from about 4,500 to 218 bases',
      chart: { kind: 'line', series: [{ label: 'median length', values: res.medians }], xLabel: 'transfer' },
      ms: Date.now() - t0,
    });
    await tick();
  }

  // 3. Pot vs surface
  let pot;
  {
    const t0 = Date.now();
    const steps = Math.round(PARASITE_TEST.steps * scale);
    pot = await parasiteRun({ wellMixed: true, steps, onProgress: (f) => onProgress?.('surface', f / 2) });
    const surf = await parasiteRun({ wellMixed: false, steps, onProgress: (f) => onProgress?.('surface', 0.5 + f / 2) });
    emit({
      id: 'surface',
      title: 'Parasites: pot versus surface',
      value: `${fmt(pot.rep)} vs ${fmt(surf.rep)}`,
      unit: `replicases, pot vs surface, averaged over the last quarter of ${steps.toLocaleString('en')} steps`,
      expected: 'near 0 in the pot (under 5), at least 20 and ten times as many on the surface',
      pass: pot.rep < 5 && surf.rep >= 20 && surf.rep >= 10 * pot.rep,
      detail: `On the surface replicases and parasites roll over the clay in waves (on average ${surf.cores.toFixed(1)} spiral cores in the second half of the run). Stirred into a pot, the parasites win and only the odd stray replicase is left.`,
      how: 'The same start (15% replicases, 1.5% parasites with the same tag) on the 128 × 128 surface, once well mixed every step and once left alone with slow diffusion.',
      source: 'Boerlijst & Hogeweg (1991); Takeuchi & Hogeweg (2009)',
      chart: { kind: 'line', series: [{ label: 'pot', values: pot.trace.map((t) => t.rep) }, { label: 'surface', values: surf.trace.map((t) => t.rep) }], xLabel: 'replicases over time' },
      ms: Date.now() - t0,
    });
    await tick();
  }

  // 4. Vesicles
  {
    const t0 = Date.now();
    const steps = Math.round(PARASITE_TEST.steps * scale);
    const open = pot;
    const ves = await vesicleRun({ steps, onProgress: (f) => onProgress?.('vesicles', f) });
    emit({
      id: 'vesicles',
      title: 'Vesicles rescue cooperation',
      value: `${fmt(open.rep)} vs ${fmt(ves.rep)}`,
      unit: 'replicases, open and well mixed vs in vesicles, averaged over the last quarter',
      expected: 'near 0 open (under 5), at least 20 and ten times as many in vesicles',
      pass: open.rep < 5 && ves.rep >= 20 && ves.rep >= 10 * open.rep,
      detail: `${ves.withRep} vesicles still hold replicases after ${ves.divisions.toLocaleString('en')} divisions. A vesicle taken over by parasites stops growing and is washed out; one with replicases keeps dividing.`,
      how: 'The same chemistry and starting mix as the pot, but packed into 110 fatty-acid vesicles that grow with their RNA content and split at twice their size.',
      source: 'Szathmáry & Demeter (1987), stochastic corrector; Chen, Roberts & Szostak (2004)',
      chart: { kind: 'line', series: [{ label: 'open', values: open.trace.map((t) => t.rep) }, { label: 'vesicles', values: ves.trace.map((t) => t.rep) }], xLabel: 'replicases over time' },
      ms: Date.now() - t0,
    });
    await tick();
  }

  // 5. Joyce lab
  {
    const t0 = Date.now();
    const sel = selectLigase({ rounds: quick ? 8 : 12 });
    const a = pheno(sel.best).lig;
    const ab = pheno(reverseComplement(sel.best)).lig;
    const run = crossReplicate({ a, ab });
    const fits = run.phases.map((ph) => exponentialFit(ph.points, 4));
    const control = crossReplicate({ a, ab, start: 0, transfers: 0 });
    const gain = sel.trace[sel.trace.length - 1].mean / Math.max(1e-4, sel.trace[0].mean);
    const r2 = Math.min(...fits.map((f) => f.r2));
    const rates = fits.map((f) => f.rate);
    const steady = Math.max(...rates) / Math.min(...rates) <= 1.25;
    const doubling = Math.LN2 / (rates.reduce((x, y) => x + y, 0) / rates.length);
    const flat = control.curve[control.curve.length - 1].total === 0;
    emit({
      id: 'joyce',
      title: 'Joyce lab: a self-sustained ligase pair',
      value: `R² = ${r2.toFixed(3)}`,
      unit: `log-linear fit of growth, worst of ${fits.length} serial transfers`,
      expected: 'exponential (R² ≥ 0.98), the same rate after each transfer',
      pass: r2 >= 0.98 && steady && flat && gain >= 5,
      detail: `Selection raised the pool’s ligase activity ${gain.toFixed(0)}×. The pair then doubles every ${doubling.toFixed(0)} steps, at the same rate after every transfer, and does nothing without a starting enzyme.`,
      how: `${quick ? 8 : 12} rounds of selection on 240 random 44-mers (each paired with its reverse complement), then cross-replication from halves, with the E·E′ product duplexes melting apart.`,
      source: 'Lincoln & Joyce (2009): exponential growth, doubling about every hour, kept up through serial transfers',
      chart: { kind: 'log', series: [{ label: 'E + E′', values: run.curve.filter((_, k) => k % 4 === 0).map((c) => c.total) }], xLabel: 'time, with transfers' },
      ms: Date.now() - t0,
    });
  }
  return rows;
}
