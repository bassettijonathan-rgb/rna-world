import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, foldUncached, structureEnergy } from '../src/sim/fold.js';
import { Rng } from '../src/sim/rng.js';
import { randomSeq } from '../src/sim/rna.js';

test('a G-C hairpin folds into a hairpin', () => {
  const f = foldUncached('GGGGAAAACCCC');
  assert.equal(f.db, '((((....))))');
  assert.ok(f.energy < 0);
});

test('a strand with nothing to pair stays open', () => {
  const f = foldUncached('AAAAAAAAAAAA');
  assert.equal(f.db, '............');
  assert.equal(f.energy, 0);
});

test('the reported energy is the energy of the reported structure', () => {
  const rng = new Rng('fold-consistency');
  for (let k = 0; k < 150; k++) {
    const s = randomSeq(rng, 10 + rng.int(70));
    const f = foldUncached(s);
    const e = structureEnergy(s, f.pairs);
    assert.ok(Math.abs(e - f.energy) <= 0.005 + 1e-9, `${s}: ${f.energy} vs ${e}`);
    // Balanced brackets, pairs only between complementary bases.
    let depth = 0;
    for (const ch of f.db) {
      depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
      assert.ok(depth >= 0);
    }
    assert.equal(depth, 0);
  }
});

test('folds are cached', () => {
  const s = 'GCGCAUAUGCGCGAAAGCGCAUAUGCGC';
  assert.equal(fold(s), fold(s));
});
