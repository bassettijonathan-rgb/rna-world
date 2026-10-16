// Seeded random numbers (sfc32). The same seed gives the same stream on
// every run, which is what makes a whole simulation reproducible.

function hash32(seed) {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed = 1) {
    const h = hash32(seed);
    this.a = h;
    this.b = (h ^ 0x9e3779b9) >>> 0;
    this.c = (h ^ 0x243f6a88) >>> 0;
    this.d = 1;
    for (let i = 0; i < 16; i++) this.u32();
  }

  u32() {
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    return t >>> 0;
  }

  float() {
    return this.u32() / 4294967296;
  }

  int(n) {
    return Math.floor(this.float() * n);
  }

  // Number of successes in n trials of probability p. Inversion for small
  // means (the usual case: errors in one copy), normal approximation above.
  binomial(n, p) {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (p > 0.5) return n - this.binomial(n, 1 - p);
    const mean = n * p;
    if (mean < 25) {
      const q = 1 - p;
      const s = p / q;
      const a = (n + 1) * s;
      let r = Math.pow(q, n);
      let u = this.float();
      let x = 0;
      while (u > r) {
        u -= r;
        x++;
        if (x > n) return n;
        r *= a / x - s;
        if (r <= 0) break;
      }
      return x;
    }
    const sd = Math.sqrt(mean * (1 - p));
    const z = Math.sqrt(-2 * Math.log(1 - this.float())) * Math.cos(2 * Math.PI * this.float());
    return Math.max(0, Math.min(n, Math.round(mean + sd * z)));
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
}
