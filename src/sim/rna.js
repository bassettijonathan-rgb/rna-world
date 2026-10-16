// Strands as strings of A, C, G and U, read 5′ → 3′, and the copying
// chemistry shared by every part of the simulation.

export const BASES = 'ACGU';
export const MAX_LEN = 200;
export const MIN_LEN = 4;

const COMP = { A: 'U', C: 'G', G: 'C', U: 'A' };

export function complement(b) {
  return COMP[b];
}

// Watson–Crick pairs only: these are what a template is read by.
export function wcPair(a, b) {
  return COMP[a] === b;
}

export function randomSeq(rng, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += BASES[rng.int(4)];
  return s;
}

export function gcFraction(seq) {
  let n = 0;
  for (let i = 0; i < seq.length; i++) {
    const c = seq.charCodeAt(i);
    if (c === 67 || c === 71) n++;
  }
  return seq.length ? n / seq.length : 0;
}

// Melting temperature of a strand paired with its copy, in °C. A simplified
// rule of thumb: GC pairs hold harder than AU pairs and longer duplexes
// hold harder than short ones.
export function duplexTm(seq) {
  const L = Math.max(4, seq.length);
  return 30 + 40 * gcFraction(seq) + 12 * Math.log(L / 20);
}

// Fraction of copying errors that insert or delete a base rather than
// substitute one, and the chance per base copied (relative to the error
// rate) that the copying end slips forward and skips a stretch of template.
export const INDEL_SHARE = 0.08;
export const JUMP_SHARE = 0.06;

// Copy a template with per-base error rate `mu`. Substitutions, small
// insertions and deletions, and occasional jumps that drop a stretch. The
// number of each kind of error is drawn from a binomial distribution; the
// Eigen validation uses the same draw, so error-free copies happen with
// probability (1 − μ)^L there and here.
export function drawErrors(L, mu, rng, jumpShare = JUMP_SHARE) {
  const subs = rng.binomial(L, mu * (1 - 2 * INDEL_SHARE));
  const dels = rng.binomial(L, mu * INDEL_SHARE);
  const ins = rng.binomial(L, mu * INDEL_SHARE);
  const jump = 1 - Math.pow(1 - mu * jumpShare, L);
  const jumped = jump > 0 && rng.float() < jump;
  return { subs, dels, ins, jumped, any: subs + dels + ins > 0 || jumped };
}

export function copySeq(seq, mu, rng, jumpShare = JUMP_SHARE) {
  const L = seq.length;
  const { subs, dels, ins, jumped, any } = drawErrors(L, mu, rng, jumpShare);
  if (!any) return seq;
  const out = seq.split('');
  for (let k = 0; k < subs; k++) {
    const i = rng.int(L);
    out[i] = BASES[(BASES.indexOf(out[i]) + 1 + rng.int(3)) % 4];
  }
  for (let k = 0; k < ins; k++) {
    const i = rng.int(L);
    out[i] = out[i] + BASES[rng.int(4)];
  }
  for (let k = 0; k < dels; k++) out[rng.int(L)] = '';
  if (jumped && L > 12) {
    const len = 1 + rng.int(Math.min(30, L >> 2));
    const at = 1 + rng.int(L - len - 1);
    for (let i = at; i < at + len; i++) out[i] = '';
  }
  let s = out.join('');
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN);
  return s;
}

// Probability that a single copy of a length-L strand has no error at all.
export function errorFreeProbability(L, mu) {
  return Math.pow(1 - mu, L);
}
