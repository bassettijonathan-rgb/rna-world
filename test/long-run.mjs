// A long headless run: every preset for many steps, with the bookkeeping
// checked as it goes, then the five validation checks. Exits non-zero on
// any crash, broken invariant or failed check.
//
//   node test/long-run.mjs            default lengths
//   STEPS=50000 node test/long-run.mjs

import { Engine } from '../src/sim/engine.js';
import { K } from '../src/sim/params.js';
import { runValidation } from '../src/sim/validation.js';

const STEPS = Number(process.env.STEPS ?? 20000);
const SKIP_VALIDATION = process.env.SKIP_VALIDATION === '1';
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

function checkSurface(w, where) {
  const counts = new Map();
  const bump = (l) => l > 0 && counts.set(l, (counts.get(l) ?? 0) + 1);
  for (let i = 0; i < w.N; i++) {
    const f = w.food[i];
    if (!(f >= 0 && f <= 3 * K.foodCap + 1e-9)) return fail(`${where}: food ${f} at ${i}`);
    if (!w.ph[i]) {
      if (w.dph[i] || w.busy[i] || w.lock[i] >= 0) return fail(`${where}: empty site ${i} holds state`);
      continue;
    }
    bump(w.lin[i]);
    if (w.dph[i]) bump(w.dlin[i]);
    if (w.busy[i] > 0) {
      const j = w.partner[i];
      if (j >= 0 && w.lock[j] !== i) return fail(`${where}: replicase ${i} lost its template`);
    }
    if (w.lock[i] >= 0 && w.partner[w.lock[i]] !== i) return fail(`${where}: template ${i} locked by a stranger`);
  }
  for (const l of w.lineages.byId.values()) {
    if ((counts.get(l.id) ?? 0) !== l.count) return fail(`${where}: family ${l.id} counts ${l.count}, really ${counts.get(l.id) ?? 0}`);
  }
}

function checkVesicles(w, where) {
  for (const v of w.ves) {
    if (!(v.area > 0) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return fail(`${where}: vesicle ${v.id} broken`);
    if (!(v.food >= 0)) return fail(`${where}: vesicle ${v.id} food ${v.food}`);
  }
  if (w.ves.length > 160) fail(`${where}: ${w.ves.length} vesicles`);
}

for (const preset of ['soup', 'duel', 'hypercycle', 'vesicles']) {
  const t0 = performance.now();
  const e = new Engine({ seed: `long-${preset}`, preset });
  const steps = preset === 'soup' ? STEPS : Math.round(STEPS / 2);
  try {
    for (let k = 0; k < steps; k += 500) {
      e.run(500);
      const where = `${preset} step ${e.step}`;
      if (e.world.kind === 'surface') checkSurface(e.world, where);
      else checkVesicles(e.world, where);
      e.frame('lineage');
      e.tree();
      if (e.history.length > 1300) fail(`${where}: history ${e.history.length}`);
      if (e.world.lineages.byId.size > 20000) fail(`${where}: ${e.world.lineages.byId.size} families kept`);
    }
    // Switch worlds and back, as the page lets you.
    e.setWorldKind(e.world.kind === 'surface' ? 'vesicles' : 'surface');
    e.run(500);
    e.setWorldKind(e.world.kind === 'surface' ? 'vesicles' : 'surface');
    e.run(500);
    if (e.world.kind === 'surface') checkSurface(e.world, `${preset} after switching`);
  } catch (err) {
    fail(`${preset}: ${err.stack}`);
  }
  const c = e.last;
  console.log(`${preset.padEnd(10)} ${e.step} steps in ${((performance.now() - t0) / 1000).toFixed(0)} s: ${c.live} replicases, ${c.parasite} parasites, ${c.junk} others; events ${e.events.map((x) => `${x.id}@${x.step}`).join(' ') || 'none'}`);
  if (preset === 'soup' && !e.flags.replicase) fail('soup: no replicase emerged');
}

if (!SKIP_VALIDATION) {
  console.log('\nvalidation');
  const rows = await runValidation({
    onRow: (r) => console.log(`${r.pass ? 'pass' : 'FAIL'} ${r.title}: ${r.value} (${r.unit}; expected ${r.expected}) ${(r.ms / 1000).toFixed(0)} s`),
  });
  for (const r of rows) if (!r.pass) fail(`check failed: ${r.title}`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
