import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Engine } from '../src/sim/engine.js';

function fingerprint(e) {
  const h = createHash('sha1');
  const f = e.frame('lineage');
  h.update(Buffer.from(f.image ?? []));
  h.update(JSON.stringify(e.last));
  return h.digest('hex');
}

test('the same seed gives the same run', () => {
  const a = new Engine({ seed: 'same', preset: 'soup', size: 48 });
  const b = new Engine({ seed: 'same', preset: 'soup', size: 48 });
  a.run(400);
  b.run(400);
  assert.equal(fingerprint(a), fingerprint(b));
  assert.deepEqual(a.history, b.history);
});

test('a different seed gives a different run', () => {
  const a = new Engine({ seed: 'one', preset: 'soup', size: 48 });
  const b = new Engine({ seed: 'two', preset: 'soup', size: 48 });
  a.run(200);
  b.run(200);
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test('drawing frames does not change the run', () => {
  const a = new Engine({ seed: 'look', preset: 'duel', size: 64 });
  const b = new Engine({ seed: 'look', preset: 'duel', size: 64 });
  for (let k = 0; k < 30; k++) {
    a.run(10);
    a.frame('role');
    a.region(20, 20, 20, 20);
    a.inspect(32, 32);
    a.tree();
    b.run(10);
  }
  assert.equal(fingerprint(a), fingerprint(b));
});

test('every preset starts, runs and switches worlds', () => {
  for (const preset of ['soup', 'duel', 'hypercycle', 'vesicles']) {
    const e = new Engine({ seed: 'presets', preset, size: 64 });
    e.run(150);
    const f = e.frame('lineage');
    assert.ok(f.step === 150, preset);
    e.setWorldKind(e.world.kind === 'surface' ? 'vesicles' : 'surface');
    e.run(100);
    assert.equal(e.step, 250);
  }
});

test('the replicase colony takes hold', () => {
  const e = new Engine({ seed: 'colony', preset: 'duel' });
  e.run(1500);
  assert.ok(e.last.live > 100, `live replicases ${e.last.live}`);
});

test('vesicle runs repeat exactly too', () => {
  const a = new Engine({ seed: 'ves', preset: 'vesicles' });
  const b = new Engine({ seed: 'ves', preset: 'vesicles' });
  a.run(600);
  b.run(600);
  assert.deepEqual(a.frame('lineage').vesicles, b.frame('lineage').vesicles);
  assert.deepEqual(a.history, b.history);
});
