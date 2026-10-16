import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eigenThreshold, spiegelman } from '../src/sim/validation.js';
import { selectLigase, crossReplicate, exponentialFit, reverseComplement } from '../src/sim/lab.js';
import { pheno } from '../src/sim/pheno.js';

test('Eigen: the longest surviving master falls as ln(σ)/μ', () => {
  const rows = eigenThreshold({ gens: 150 });
  for (const r of rows) assert.ok(Math.abs(r.ratio - 1) <= 0.2, `μ ${r.mu}: ${r.Lmax} vs ${r.theory.toFixed(0)}`);
  assert.ok(rows[0].Lmax > rows[1].Lmax && rows[1].Lmax > rows[2].Lmax);
});

test('Spiegelman: strands shrink under serial transfer', async () => {
  const r = await spiegelman();
  assert.ok(r.final / r.start <= 0.25, `${r.start} → ${r.final}`);
});

test('Joyce lab: selection finds a ligase pair that amplifies exponentially', () => {
  const sel = selectLigase({ rounds: 8 });
  assert.ok(sel.trace.at(-1).mean > 5 * sel.trace[0].mean);
  const run = crossReplicate({ a: pheno(sel.best).lig, ab: pheno(reverseComplement(sel.best)).lig });
  for (const ph of run.phases) assert.ok(exponentialFit(ph.points, 4).r2 >= 0.98);
  const none = crossReplicate({ a: 0.5, ab: 0.5, start: 0, transfers: 0 });
  assert.equal(none.curve.at(-1).total, 0);
});
