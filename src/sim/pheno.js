// What a fold does. This is the simulation's invented chemistry, kept small
// enough to read in one go:
//
// - Tag: the last four bases at the 3′ end. A replicase docks on a template
//   whose tag is single-stranded and sits just after a strong hairpin (the
//   promoter); other strands it copies only rarely.
// - Replicase: a fold with at least two strong hairpins (stems of four or
//   more stacked pairs). The loop of the 5′-most strong hairpin is the
//   recognition loop: it binds templates whose tag is its complement. The
//   more stacked pairs the two hairpins hold, the better the replicase:
//   faster and more accurate.
// - Ligase: a single strong hairpin flanked by two single-stranded arms of
//   at least five bases, which hold two other strands end to end so they
//   can be joined.
//
// Anything else is inert, but can still be copied if its tag is right:
// that is how parasites arise.

import { fold } from './fold.js';
import { wcPair, gcFraction, duplexTm } from './rna.js';

export const TAG_LEN = 4;
const MIN_STEM = 4;
const PROMOTER_GAP = 8;
const GRIP_HALF = 25; // template length at which the grip is half its maximum

// Affinity of a recognition loop for a tag by the number of Watson–Crick
// matches, read antiparallel.
export const AFFINITY = [0, 0.01, 0.06, 0.6, 1];

export function matches(loop, tag) {
  let m = 0;
  for (let k = 0; k < TAG_LEN; k++) if (wcPair(loop[k], tag[TAG_LEN - 1 - k])) m++;
  return m;
}

export function affinity(loop, tag) {
  return AFFINITY[matches(loop, tag)];
}

// The tag that a recognition loop binds best.
export function tagFor(loop) {
  const comp = { A: 'U', C: 'G', G: 'C', U: 'A' };
  let t = '';
  for (let k = TAG_LEN - 1; k >= 0; k--) t += comp[loop[k]];
  return t;
}

// Hairpins: helices closing a loop with no pairs inside.
export function hairpins(pairs) {
  const out = [];
  const n = pairs.length;
  for (let i = 0; i < n; i++) {
    const j = pairs[i];
    if (j <= i) continue;
    let inner = false;
    for (let k = i + 1; k < j; k++) {
      if (pairs[k] >= 0) {
        inner = true;
        break;
      }
    }
    if (inner) continue;
    let a = i;
    let b = j;
    let stem = 1;
    while (a > 0 && b < n - 1 && pairs[a - 1] === b + 1) {
      a--;
      b++;
      stem++;
    }
    out.push({ outer: a, inner: i, close: j, stem, loopStart: i + 1, loopEnd: j - 1 });
  }
  return out;
}

function exteriorArms(pairs) {
  let a5 = 0;
  while (a5 < pairs.length && pairs[a5] < 0) a5++;
  let a3 = 0;
  while (a3 < pairs.length && pairs[pairs.length - 1 - a3] < 0) a3++;
  return { a5, a3 };
}

export function phenotype(seq) {
  const L = seq.length;
  const f = fold(seq);
  const hp = hairpins(f.pairs);
  const strong = hp.filter((h) => h.stem >= MIN_STEM);
  const tag = seq.slice(-TAG_LEN);
  let tagOpen = L >= TAG_LEN + 1;
  for (let k = L - TAG_LEN; k < L && tagOpen; k++) if (f.pairs[k] >= 0) tagOpen = false;

  // A template needs a promoter: a strong hairpin ending close to the open
  // tag, which the replicase docks on (as Qβ replicase needs structure near
  // the 3′ end of its templates).
  const promoter = tagOpen && strong.some((h) => h.close >= L - TAG_LEN - PROMOTER_GAP - 1);

  let rep = null;
  if (strong.length >= 2) {
    const loopHp = strong.find((h) => h.loopEnd - h.loopStart + 1 >= TAG_LEN);
    if (loopHp) {
      const top = strong.map((h) => h.stem).sort((x, y) => y - x);
      const pairsHeld = top[0] + top[1];
      const q = 1 - Math.exp(-(pairsHeld - 7) / 5);
      rep = {
        loop: seq.slice(loopHp.loopStart, loopHp.loopStart + TAG_LEN),
        q,
        speed: 3 + 6 * q, // bases copied per step
        errMul: 1 + 2 * (1 - q), // error rate relative to the slider's
        loopAt: loopHp.loopStart,
      };
    }
  }

  let lig = 0;
  const arms = exteriorArms(f.pairs);
  if (!rep && strong.length === 1 && arms.a5 >= 5 && arms.a3 >= 5) {
    const h = strong[0];
    const gnra = h.loopEnd - h.loopStart === 3 && seq[h.loopStart] === 'G' && 'AG'.includes(seq[h.loopStart + 2]) && seq[h.loopStart + 3] === 'A';
    lig = (1 - Math.exp(-(h.stem - 3) / 3)) * Math.min(1, arms.a5 / 8) * Math.min(1, arms.a3 / 8) * (gnra ? 1 : 0.4);
  }

  return {
    seq,
    L,
    db: f.db,
    energy: f.energy,
    pairs: f.pairs,
    hairpins: hp,
    tag,
    tagOpen,
    promoter,
    rep,
    lig,
    gc: gcFraction(seq),
    tm: duplexTm(seq),
  };
}

const cache = new Map();
const CACHE_MAX = 40000;

export function pheno(seq) {
  let p = cache.get(seq);
  if (p) return p;
  p = phenotype(seq);
  if (cache.size >= CACHE_MAX) {
    let k = CACHE_MAX >> 2;
    for (const key of cache.keys()) {
      cache.delete(key);
      if (--k <= 0) break;
    }
  }
  cache.set(seq, p);
  return p;
}

// How readily a replicase starts copying this template.
export function templateAffinity(rep, templ) {
  if (templ.L < TAG_LEN + 1) return 0;
  // Longer templates offer the replicase more contacts and bind it longer.
  const grip = templ.L / (templ.L + GRIP_HALF);
  return affinity(rep.loop, templ.tag) * grip * (templ.promoter ? 1 : templ.tagOpen ? 0.03 : 0.002);
}
