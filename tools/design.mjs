// Finds the hand-made sequences used by the presets and the validation:
// a self-copying replicase and its parasite, and a five-member hypercycle in
// which each replicase copies only the next one. Run it to regenerate the
// sequences printed into src/sim/designs.js.
import { phenotype, matches, tagFor } from '../src/sim/pheno.js';
import { Rng } from '../src/sim/rng.js';
import { randomSeq, complement } from '../src/sim/rna.js';

const rng = new Rng('design');

// A replicase with a given recognition loop and tag, by random search over
// scaffolds: random sequence, then write the loop into its 5′-most strong
// hairpin and the tag onto the 3′ end, and keep it if the fold still works.
function replicase(loop, tag, { minQ = 0.6, minL = 44, maxL = 60 } = {}) {
  for (let k = 0; k < 400000; k++) {
    const L = minL + rng.int(maxL - minL + 1);
    let s = randomSeq(rng, L - 4) + tag;
    let p = phenotype(s);
    if (!p.rep) continue;
    const at = p.rep.loopAt;
    s = s.slice(0, at) + loop + s.slice(at + 4);
    p = phenotype(s);
    if (p.rep && p.rep.loop === loop && p.tag === tag && p.promoter && p.rep.q >= minQ) return s;
  }
  throw new Error(`no replicase for ${loop}/${tag}`);
}

// A short parasite: one strong hairpin right before the tag, nothing else.
function parasite(tag, L = 18) {
  for (let k = 0; k < 400000; k++) {
    const s = randomSeq(rng, L - 4) + tag;
    const p = phenotype(s);
    if (!p.rep && p.promoter && p.lig < 0.15) return s;
  }
  throw new Error('no parasite');
}

const selfTag = 'CGAG';
const selfLoop = tagFor(selfTag).split('').reverse().map(complement).reverse().join('');
const self = replicase(tagFor(selfTag) === selfTag ? selfLoop : 'CUCG', selfTag);
console.log('self', self, phenotype(self).db, phenotype(self).rep.loop, phenotype(self).rep.q.toFixed(2));
const para = parasite(selfTag);
console.log('parasite', para, phenotype(para).db);

// Hypercycle tags: five tags whose loops (complements) match only the
// next tag in the cycle.
function loopFor(tag) {
  // loop[k] pairs with tag[3 - k]
  let l = '';
  for (let k = 0; k < 4; k++) l += complement(tag[3 - k]);
  return l;
}
let tags;
for (let k = 0; k < 100000; k++) {
  const t = Array.from({ length: 5 }, () => randomSeq(rng, 4));
  let ok = true;
  for (let i = 0; i < 5 && ok; i++) {
    for (let j = 0; j < 5 && ok; j++) {
      const m = matches(loopFor(t[(i + 1) % 5]), t[j]);
      if (j === (i + 1) % 5 ? m !== 4 : m > 1) ok = false;
    }
  }
  if (ok) {
    tags = t;
    break;
  }
}
const cycle = tags.map((t, i) => replicase(loopFor(tags[(i + 1) % 5]), t, { minQ: 0.55 }));
cycle.forEach((s, i) => {
  const p = phenotype(s);
  console.log('hyper', i, s, p.db, p.rep.loop, p.tag, p.rep.q.toFixed(2));
});
const hpara = parasite(tags[0]);
console.log('hyperParasite', hpara);
console.log(JSON.stringify({ self, parasite: para, hypercycle: cycle, hyperParasite: hpara }, null, 2));
