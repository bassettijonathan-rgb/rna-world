// Hairpin diagrams. A fold given as dot-bracket is laid out the usual way:
// stems as straight ladders, every loop as a regular polygon, the exterior
// strand as a straight baseline with its stems standing on it.

export const BASE_RGB = { A: '#ffcf73', C: '#7fd8ff', G: '#b99cff', U: '#ff8f9c' };

function pairTable(db) {
  const n = db.length;
  const pt = new Int32Array(n).fill(-1);
  const st = [];
  for (let i = 0; i < n; i++) {
    if (db[i] === '(') st.push(i);
    else if (db[i] === ')') {
      const j = st.pop();
      if (j !== undefined) {
        pt[i] = j;
        pt[j] = i;
      }
    }
  }
  return pt;
}

// Coordinates in units of one backbone step.
export function layoutFold(db) {
  const n = db.length;
  const pt = pairTable(db);
  const x = new Float64Array(n);
  const y = new Float64Array(n);

  function stem(i, j, ix, iy, jx, jy, dx, dy) {
    x[i] = ix;
    y[i] = iy;
    x[j] = jx;
    y[j] = jy;
    while (i + 1 < j - 1 && pt[i + 1] === j - 1) {
      i++;
      j--;
      ix += dx;
      iy += dy;
      jx += dx;
      jy += dy;
      x[i] = ix;
      y[i] = iy;
      x[j] = jx;
      y[j] = jy;
    }
    // The loop closed by (i, j).
    const items = [];
    for (let k = i + 1; k < j; k++) {
      if (pt[k] > k) {
        items.push([k, pt[k]]);
        k = pt[k];
      } else items.push([k, -1]);
    }
    const m = 2 + items.reduce((s, it) => s + (it[1] >= 0 ? 2 : 1), 0);
    const step = (2 * Math.PI) / m;
    const apo = 1 / (2 * Math.tan(Math.PI / m));
    const mx = (ix + jx) / 2;
    const my = (iy + jy) / 2;
    const cx = mx + dx * apo;
    const cy = my + dy * apo;
    const R = 1 / (2 * Math.sin(Math.PI / m));
    const ti = Math.atan2(iy - cy, ix - cx);
    const tj = Math.atan2(jy - cy, jx - cx);
    let d = tj - ti;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const s = d > 0 ? -1 : 1;
    let v = 1;
    const at = (v) => [cx + R * Math.cos(ti + s * step * v), cy + R * Math.sin(ti + s * step * v)];
    for (const [k, l] of items) {
      if (l < 0) {
        [x[k], y[k]] = at(v);
        v++;
      } else {
        const [ax, ay] = at(v);
        const [bx, by] = at(v + 1);
        v += 2;
        let ox = (ax + bx) / 2 - cx;
        let oy = (ay + by) / 2 - cy;
        const len = Math.hypot(ox, oy) || 1;
        ox /= len;
        oy /= len;
        stem(k, l, ax, ay, bx, by, ox, oy);
      }
    }
  }

  // Exterior: lay each top-level stem out on its own, then line them up
  // along the baseline with room between them.
  let cursor = 0;
  let k = 0;
  while (k < n) {
    if (pt[k] > k) {
      const l = pt[k];
      stem(k, l, 0, 0, 1, 0, 0, -1);
      let lo = Infinity;
      let hi = -Infinity;
      for (let q = k; q <= l; q++) {
        lo = Math.min(lo, x[q]);
        hi = Math.max(hi, x[q]);
      }
      const shift = cursor - lo + (k > 0 ? 0.6 : 0);
      for (let q = k; q <= l; q++) x[q] += shift;
      // Keep the stem's foot on the baseline.
      cursor = hi + shift + 1;
      k = l + 1;
    } else {
      x[k] = cursor;
      y[k] = 0;
      cursor += 1;
      k++;
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let q = 0; q < n; q++) {
    minX = Math.min(minX, x[q]);
    maxX = Math.max(maxX, x[q]);
    minY = Math.min(minY, y[q]);
    maxY = Math.max(maxY, y[q]);
  }
  return { n, x, y, pt, minX, maxX, minY, maxY };
}

const cache = new Map();
export function cachedLayout(db) {
  let l = cache.get(db);
  if (!l) {
    if (cache.size > 2000) cache.clear();
    l = layoutFold(db);
    cache.set(db, l);
  }
  return l;
}

// Draw a fold into the box (bx, by, bw, bh). opts: seq (colour the bases),
// color (one colour for everything), marks: {from, to, color}[] to highlight
// stretches such as the tag, letters: draw base letters when roomy.
export function drawFold(ctx, db, bx, by, bw, bh, opts = {}) {
  const L = cachedLayout(db);
  if (!L.n) return;
  const pad = 0.8;
  const w = L.maxX - L.minX + 2 * pad;
  const h = L.maxY - L.minY + 2 * pad;
  const s = Math.min(bw / w, bh / h);
  const ox = bx + (bw - w * s) / 2 + (pad - L.minX) * s;
  const oy = by + (bh - h * s) / 2 + (pad - L.minY) * s;
  const X = (q) => ox + L.x[q] * s;
  const Y = (q) => oy + L.y[q] * s;
  const color = opts.color ?? 'rgba(200,235,255,0.9)';

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Base pairs.
  ctx.strokeStyle = opts.pairColor ?? color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(0.6, s * 0.18);
  ctx.beginPath();
  for (let q = 0; q < L.n; q++) {
    const p = L.pt[q];
    if (p > q) {
      ctx.moveTo(X(q), Y(q));
      ctx.lineTo(X(p), Y(p));
    }
  }
  ctx.stroke();
  // Backbone.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.8, s * 0.22);
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  for (let q = 1; q < L.n; q++) ctx.lineTo(X(q), Y(q));
  ctx.stroke();
  // Highlighted stretches.
  for (const m of opts.marks ?? []) {
    ctx.strokeStyle = m.color;
    ctx.lineWidth = Math.max(2, s * 0.55);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(X(m.from), Y(m.from));
    for (let q = m.from + 1; q <= m.to && q < L.n; q++) ctx.lineTo(X(q), Y(q));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Bases.
  if (opts.seq && s >= 3) {
    const r = Math.max(1, s * 0.34);
    for (let q = 0; q < L.n; q++) {
      ctx.fillStyle = BASE_RGB[opts.seq[q]] ?? color;
      ctx.beginPath();
      ctx.arc(X(q), Y(q), r, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (opts.letters && s >= 11) {
      ctx.fillStyle = '#081418';
      ctx.font = `600 ${Math.round(s * 0.5)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let q = 0; q < L.n; q++) ctx.fillText(opts.seq[q], X(q), Y(q) + 0.5);
    }
    // Labels for the marked stretches, pushed outward from the middle of
    // the drawing so they sit clear of the strand.
    let mx = 0;
    let my = 0;
    for (let q = 0; q < L.n; q++) {
      mx += X(q);
      my += Y(q);
    }
    mx /= L.n;
    my /= L.n;
    for (const m of opts.marks ?? []) {
      if (!m.label) continue;
      const mid = (m.from + m.to) >> 1;
      let dx = X(mid) - mx;
      let dy = Y(mid) - my;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const fs = Math.max(10, Math.min(13, s * 0.6));
      ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
      const tw = ctx.measureText(m.label).width;
      let lx = X(mid) + dx * s * 2.2;
      let ly = Y(mid) + dy * s * 2.2;
      lx = Math.max(bx + tw / 2 + 4, Math.min(bx + bw - tw / 2 - 4, lx));
      ly = Math.max(by + fs, Math.min(by + bh - fs, ly));
      ctx.fillStyle = 'rgba(4,8,11,0.82)';
      ctx.fillRect(lx - tw / 2 - 4, ly - fs * 0.7, tw + 8, fs * 1.4);
      ctx.fillStyle = m.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.label, lx, ly);
    }
    // 5′ and 3′ ends.
    if (opts.ends) {
      ctx.fillStyle = opts.endColor ?? 'rgba(200,235,255,0.7)';
      ctx.font = `${Math.max(9, Math.round(s * 0.55))}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('5′', X(0) - s * 0.7, Y(0));
      ctx.textAlign = 'left';
      ctx.fillText('3′', X(L.n - 1) + s * 0.7, Y(L.n - 1));
    }
  }
  ctx.restore();
}
