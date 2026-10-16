// Small canvas charts: the live population chart, the family tree and the
// little charts on the validation cards. Colours come from the page's CSS
// tokens so the charts match the rest of the bench.

export function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { bg: v('--bg'), line: v('--line'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), mint: v('--mint'), coral: v('--coral'), gold: v('--gold'), slate: v('--slate'), sky: v('--sky'), mono: v('--mono') };
}

export function prepCanvas(canvas, cssHeight) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 300;
  const h = cssHeight ?? (canvas.clientHeight || 150);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const fmtCount = (v) => (v >= 1000 ? `${v / 1000}k` : `${v}`);

// history: [{step, live, para, junk, dup, food, T}]
export function drawPopulation(canvas, history, opts = {}) {
  const t = tokens();
  const { ctx, w, h } = prepCanvas(canvas, 180);
  const padL = 34;
  const padR = 8;
  const padT = 10;
  const strip = 8;
  const padB = 22 + strip;
  const pw = w - padL - padR;
  const ph = h - padT - padB;
  if (history.length < 2) {
    ctx.fillStyle = t.ink3;
    ctx.font = `12px ${t.mono}`;
    ctx.fillText('waiting for data', padL, padT + 20);
    return;
  }
  const s0 = history[0].step;
  const s1 = Math.max(s0 + 1, history[history.length - 1].step);
  let top = 10;
  for (const p of history) top = Math.max(top, p.live, p.para, p.junk);
  const yMax = Math.log10(top * 1.4 + 1);
  const X = (s) => padL + ((s - s0) / (s1 - s0)) * pw;
  const Y = (v) => padT + ph - (Math.log10(v + 1) / yMax) * ph;

  // Grid at powers of ten.
  ctx.font = `10px ${t.mono}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let p = 1; p <= top * 1.4; p *= 10) {
    const y = Y(p);
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillStyle = t.ink3;
    ctx.fillText(fmtCount(p), padL - 5, y);
  }
  // Step labels.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const span = s1 - s0;
  const stepTick = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000].find((v) => span / v <= 5) ?? 1000000;
  for (let s = Math.ceil(s0 / stepTick) * stepTick; s <= s1; s += stepTick) {
    ctx.fillStyle = t.ink3;
    ctx.fillText(s.toLocaleString('en'), X(s), h - 12);
  }
  // Temperature strip.
  for (let k = 1; k < history.length; k++) {
    const p = history[k];
    const f = Math.max(0, Math.min(1, (p.T - 25) / 70));
    ctx.fillStyle = `hsl(${200 - 200 * f}, 70%, ${18 + 30 * f}%)`;
    ctx.fillRect(X(history[k - 1].step), h - padB + 4, Math.max(1, X(p.step) - X(history[k - 1].step)), strip - 2);
  }
  const series = [
    ['junk', t.slate, 1],
    ['para', t.coral, 1.6],
    ['live', t.mint, 2],
  ];
  for (const [key, color, lw] of series) {
    // Soft area under the line.
    ctx.beginPath();
    ctx.moveTo(X(history[0].step), Y(0));
    for (const p of history) ctx.lineTo(X(p.step), Y(p[key]));
    ctx.lineTo(X(history[history.length - 1].step), Y(0));
    ctx.closePath();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    history.forEach((p, k) => (k ? ctx.lineTo(X(p.step), Y(p[key])) : ctx.moveTo(X(p.step), Y(p[key]))));
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
    // Endpoint.
    const last = history[history.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X(last.step), Y(last[key]), 2.6, 0, 2 * Math.PI);
    ctx.fill();
  }
  if (opts.events) {
    for (const e of opts.events) {
      if (e.step < s0) continue;
      const x = X(e.step);
      ctx.strokeStyle = t.gold;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }
}

// lineages: [{id, parent, born, died, count, peak, role, hue}]
export function drawTree(canvas, tree, now) {
  const t = tokens();
  const { ctx, w, h } = prepCanvas(canvas, 260);
  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  let lins = tree?.lineages ?? [];
  if (!lins.length) {
    ctx.fillStyle = t.ink3;
    ctx.font = `12px ${t.mono}`;
    ctx.fillText('no families yet', padL + 4, padT + 16);
    return 0;
  }
  // Keep the biggest families (and their ancestors) when there are many.
  const byId = new Map(lins.map((l) => [l.id, l]));
  if (lins.length > 90) {
    const keep = new Set();
    for (const l of [...lins].sort((a, b) => b.peak - a.peak).slice(0, 90)) {
      let x = l;
      while (x && !keep.has(x.id)) {
        keep.add(x.id);
        x = byId.get(x.parent);
      }
    }
    lins = lins.filter((l) => keep.has(l.id));
  }
  const kids = new Map();
  const roots = [];
  for (const l of lins) {
    if (l.parent && byId.has(l.parent) && lins.includes(byId.get(l.parent))) {
      if (!kids.has(l.parent)) kids.set(l.parent, []);
      kids.get(l.parent).push(l);
    } else roots.push(l);
  }
  const order = [];
  const visit = (l) => {
    order.push(l);
    for (const c of (kids.get(l.id) ?? []).sort((a, b) => a.born - b.born)) visit(c);
  };
  roots.sort((a, b) => a.born - b.born).forEach(visit);
  const t0 = Math.min(...order.map((l) => l.born));
  const t1 = Math.max(now, t0 + 1);
  const X = (s) => padL + ((s - t0) / (t1 - t0)) * (w - padL - padR);
  const rowH = (h - padT - padB) / order.length;
  const row = new Map(order.map((l, k) => [l.id, padT + (k + 0.5) * rowH]));
  const maxPeak = Math.max(...order.map((l) => l.peak));
  // Branch connectors first, then the family lines over them.
  ctx.lineWidth = 1;
  for (const l of order) {
    if (!row.has(l.parent)) continue;
    ctx.strokeStyle = `hsla(${l.hue}, 60%, 60%, 0.35)`;
    ctx.beginPath();
    ctx.moveTo(X(l.born), row.get(l.parent));
    ctx.lineTo(X(l.born), row.get(l.id));
    ctx.stroke();
  }
  for (const l of order) {
    const y = row.get(l.id);
    const end = l.died >= 0 ? l.died : now;
    const lw = Math.max(1, Math.min(rowH * 0.8, 1 + 4 * Math.sqrt(l.peak / maxPeak)));
    const alive = l.died < 0;
    ctx.strokeStyle = l.role === 1 ? `hsla(${l.hue}, 85%, 66%, ${alive ? 1 : 0.55})` : `hsla(${l.hue}, 70%, 55%, ${alive ? 0.8 : 0.4})`;
    ctx.lineWidth = lw;
    if (l.role !== 1) ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(X(l.born), y);
    ctx.lineTo(Math.max(X(l.born) + 1.5, X(end)), y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (alive) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(X(end), y, Math.min(3, lw), 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.fillStyle = t.ink3;
  ctx.font = `10px ${t.mono}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`step ${t0.toLocaleString('en')}`, padL, h - 14);
  ctx.textAlign = 'right';
  ctx.fillText(`now ${now.toLocaleString('en')}`, w - padR, h - 14);
  return order.length;
}

// chart: {kind:'bars', labels, a, b, aLabel, bLabel} | {kind:'line'|'log', series:[{label, values}], xLabel}
export function drawCheckChart(canvas, chart) {
  const t = tokens();
  const { ctx, w, h } = prepCanvas(canvas, 120);
  const padL = 36;
  const padR = 8;
  const padT = 16;
  const padB = 18;
  const pw = w - padL - padR;
  const ph = h - padT - padB;
  const colors = [t.coral, t.mint, t.sky];
  ctx.font = `10px ${t.mono}`;
  ctx.textBaseline = 'middle';
  if (chart.kind === 'bars') {
    const max = Math.max(...chart.a, ...chart.b) * 1.1;
    const n = chart.labels.length;
    const gw = pw / n;
    for (let k = 0; k < n; k++) {
      const x = padL + k * gw + gw * 0.18;
      const bw = gw * 0.3;
      const ha = (chart.a[k] / max) * ph;
      const hb = (chart.b[k] / max) * ph;
      ctx.fillStyle = t.mint;
      ctx.fillRect(x, padT + ph - ha, bw, ha);
      ctx.fillStyle = t.ink3;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x + bw + 2, padT + ph - hb, bw, hb);
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.ink3;
      ctx.textAlign = 'center';
      ctx.fillText(chart.labels[k], padL + (k + 0.5) * gw, h - 8);
    }
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(max).toString(), padL - 4, padT);
    ctx.fillText('0', padL - 4, padT + ph);
    legend(ctx, t, [
      [chart.aLabel, t.mint],
      [chart.bLabel, t.ink3],
    ], padL, 6);
    return;
  }
  const log = chart.kind === 'log';
  const all = chart.series.flatMap((s) => s.values);
  const n = Math.max(...chart.series.map((s) => s.values.length));
  let lo = log ? Math.min(...all.filter((v) => v > 0)) : 0;
  let hi = Math.max(...all, 1);
  if (log) {
    lo = Math.log10(lo);
    hi = Math.log10(hi);
  }
  const Y = (v) => {
    const u = log ? Math.log10(Math.max(v, 1e-9)) : v;
    return padT + ph - ((u - lo) / (hi - lo || 1)) * ph;
  };
  const X = (k) => padL + (k / Math.max(1, n - 1)) * pw;
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + ph);
  ctx.lineTo(w - padR, padT + ph);
  ctx.stroke();
  chart.series.forEach((s, si) => {
    ctx.strokeStyle = chart.series.length === 1 ? t.mint : colors[si % colors.length];
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    s.values.forEach((v, k) => (k ? ctx.lineTo(X(k), Y(v)) : ctx.moveTo(X(k), Y(v))));
    ctx.stroke();
  });
  ctx.fillStyle = t.ink3;
  ctx.textAlign = 'right';
  const fmt = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.abs(v) >= 10 ? Math.round(v) : v.toPrecision(2));
  ctx.fillText(String(fmt(log ? 10 ** hi : hi)), padL - 4, padT);
  ctx.fillText(String(fmt(log ? 10 ** lo : lo)), padL - 4, padT + ph);
  ctx.textAlign = 'center';
  ctx.fillText(chart.xLabel ?? '', padL + pw / 2, h - 7);
  if (chart.series.length > 1) legend(ctx, t, chart.series.map((s, si) => [s.label, colors[si % colors.length]]), padL, 6);
}

function legend(ctx, t, items, x, y) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const [label, color] of items) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 3, 8, 6);
    ctx.fillStyle = t.ink2;
    ctx.fillText(label, x + 12, y);
    x += 22 + ctx.measureText(label).width;
  }
}
