import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pheno, affinity, templateAffinity } from '../src/sim/pheno.js';
import { roleOf, ROLE } from '../src/sim/lineage.js';
import { SELF_REPLICASE, SELF_PARASITE, HYPERCYCLE, HYPER_PARASITE } from '../src/sim/designs.js';

test('the designed self-replicase folds into a replicase that reads its own tag', () => {
  const p = pheno(SELF_REPLICASE);
  assert.ok(p.rep, 'is a replicase');
  assert.equal(p.rep.loop, 'CUCG');
  assert.equal(p.tag, 'CGAG');
  assert.ok(affinity(p.rep.loop, p.tag) >= 0.6);
  assert.ok(p.promoter, 'can itself be copied');
});

test('the designed parasite is copied by the replicase but copies nothing', () => {
  const r = pheno(SELF_REPLICASE);
  const q = pheno(SELF_PARASITE);
  assert.equal(q.rep, null);
  assert.equal(roleOf(q), ROLE.parasite);
  assert.ok(q.promoter);
  assert.ok(templateAffinity(r.rep, q) > 0.1);
});

test('the hypercycle members each copy the next one round the ring', () => {
  const ps = HYPERCYCLE.map(pheno);
  ps.forEach((p, k) => {
    assert.ok(p.rep, `member ${k} is a replicase`);
    const next = ps[(k + 1) % ps.length];
    assert.ok(affinity(p.rep.loop, next.tag) >= 0.6, `member ${k} reads member ${k + 1}`);
  });
  const par = pheno(HYPER_PARASITE);
  assert.equal(par.rep, null);
});

test('without a promoter a template is barely copied', () => {
  const r = pheno(SELF_REPLICASE);
  const open = pheno('AAAAAAAAAAAAAAAAAACGAG');
  assert.ok(templateAffinity(r.rep, open) < 0.05 * templateAffinity(r.rep, pheno(SELF_PARASITE)));
});
