import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, GLOSSARY, STAT_HELP, makeGoals, trackGoals, narrate } from '../src/app/guide.js';
import { DEFAULTS, K } from '../src/sim/params.js';

const frame = (over = {}) => ({ kind: 'surface', step: 1000, T: 30, census: { live: 0, replicase: 3, parasite: 0, junk: 4000, busy: 0 }, ...over });

test('every chapter has text, something to try and a goal', () => {
  const ids = new Set();
  for (const c of CHAPTERS) {
    assert.ok(c.title && c.body.length && c.tries.length && c.goal.text, c.id);
    assert.ok(!ids.has(c.id), `duplicate ${c.id}`);
    ids.add(c.id);
    if (c.predict) assert.ok(c.predict.answer < c.predict.options.length && c.predict.why, c.id);
  }
  assert.ok(GLOSSARY.length >= 10);
  for (const label of ['Replicases', 'Parasites', 'Other strands', 'Double strands', 'Copying now', 'Families of 12+', 'Vesicles']) assert.ok(STAT_HELP[label], label);
});

test('the narrator follows the temperature cycle', () => {
  const base = { history: [], params: { ...DEFAULTS }, events: [] };
  assert.match(narrate({ ...base, last: frame({ T: 70 }) }).now, /Warm spell/);
  assert.match(narrate({ ...base, last: frame({ T: 30 }) }).now, /Cool spell/);
  assert.match(narrate({ ...base, params: { ...DEFAULTS, tempAmp: 10 }, last: frame() }).now, /No warm spell/);
});

test('the narrator tells the population story', () => {
  const params = { ...DEFAULTS };
  const events = [{ id: 'replicase', step: 500 }];
  const history = [{ step: 500, live: 100, para: 10 }];
  const grow = narrate({ last: frame({ census: { live: 400, parasite: 50, busy: 3 } }), history, params, events });
  assert.match(grow.trend, /spreading/);
  const fall = narrate({ last: frame({ census: { live: 30, parasite: 300, busy: 0 } }), history, params, events });
  assert.match(fall.trend, /falling/);
  const mixed = narrate({ last: frame({ census: { live: 30, parasite: 30 } }), history, params: { ...params, wellMixed: true }, events });
  assert.match(mixed.trend, /Well mixed/);
  const none = narrate({ last: frame(), history: [], params, events: [] });
  assert.match(none.trend, /replicases|copies itself/);
});

test('goals tick themselves off', () => {
  const g = makeGoals();
  const p = { ...DEFAULTS };
  trackGoals(g, frame({ T: K.activeBelow + 10 }), p, 'clay');
  trackGoals(g, frame({ T: 30 }), p, 'clay');
  assert.equal(g.sawCycle, false, 'the cycle only counts in its chapter');
  trackGoals(g, frame({ T: K.activeBelow + 10 }), p, 'cycle');
  trackGoals(g, frame({ T: 30 }), p, 'cycle');
  assert.equal(g.sawCycle, true);
  trackGoals(g, frame({ inspect: { strand: { role: 'replicase' } } }), p, 'fold');
  assert.ok(g.inspected && g.inspectedReplicase);
  const mixed = { ...p, wellMixed: true };
  trackGoals(g, frame({ census: { live: 500 } }), mixed, 'space');
  trackGoals(g, frame({ census: { live: 400 } }), mixed, 'space');
  assert.equal(g.mixedCrash, false);
  trackGoals(g, frame({ census: { live: 100 } }), mixed, 'space');
  assert.equal(g.mixedCrash, true);
});
