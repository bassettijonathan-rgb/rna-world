// The microscope view: the surface (or the vesicles) on a canvas, with a
// soft glow, zoom and pan, and single strands drawn as their folds when
// close enough.

import { drawFold } from './foldview.js';

const ROLE_COLOR = ['rgba(150,170,195,0.85)', '#78ffd6', '#ff7a8c', '#ffcd6e'];
const GLYPH_AT = 9; // pixels per site above which strands are drawn one by one
const FOLD_AT = 26; // ... and above which they are drawn as full folds

function hueColor(h, role, a = 1) {
  if (h < 0) return ROLE_COLOR[role === 1 ? 0 : role] ?? ROLE_COLOR[0];
  return `hsla(${h.toFixed(0)}, 85%, ${role === 1 ? 66 : 55}%, ${a})`;
}

export class View {
  constructor(canvas, { onTap, onTool, onCamera }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTap = onTap;
    this.onTool = onTool;
    this.W = 128;
    this.H = 128;
    this.cam = { x: 64, y: 64, z: 4 };
    this.fitted = true;
    this.tool = 'look';
    this.frame = null;
    this.region = null;
    this.selected = null;
    this.src = document.createElement('canvas');
    this.glow = document.createElement('canvas');
    this.glow.width = 48;
    this.glow.height = 48;
    this.pointers = new Map();
    this.dpr = 1;
    this.resize();
    this.onCamera = onCamera;
    this.bind();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * this.dpr));
    const h = Math.max(1, Math.round(r.height * this.dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.fitted) this.fit();
  }

  fit() {
    const s = Math.min(this.canvas.width, this.canvas.height);
    // The field is round; fit the square surface's inscribed circle a little
    // past the edge so the corners are just cut off.
    this.cam = { x: this.W / 2, y: this.H / 2, z: (s / this.W) * 1.12 };
    this.fitted = true;
    this.onCamera?.();
  }

  zoomBy(f, sx = this.canvas.width / 2, sy = this.canvas.height / 2) {
    const [wx, wy] = this.toWorld(sx, sy);
    const minZ = (Math.min(this.canvas.width, this.canvas.height) / this.W) * 0.7;
    const z = Math.max(minZ, Math.min(140 * this.dpr, this.cam.z * f));
    this.cam.z = z;
    // Keep the point under the finger fixed.
    this.cam.x = wx - (sx - this.canvas.width / 2) / z;
    this.cam.y = wy - (sy - this.canvas.height / 2) / z;
    this.fitted = false;
    this.onCamera?.();
  }

  toWorld(sx, sy) {
    return [this.cam.x + (sx - this.canvas.width / 2) / this.cam.z, this.cam.y + (sy - this.canvas.height / 2) / this.cam.z];
  }

  toScreen(wx, wy) {
    return [(wx - this.cam.x) * this.cam.z + this.canvas.width / 2, (wy - this.cam.y) * this.cam.z + this.canvas.height / 2];
  }

  // The rectangle of sites to ask the simulation for when drawing strands.
  visibleRegion() {
    if (!this.frame || this.frame.kind !== 'surface' || this.cam.z < GLYPH_AT * this.dpr) return null;
    const [x0, y0] = this.toWorld(0, 0);
    const [x1, y1] = this.toWorld(this.canvas.width, this.canvas.height);
    return [Math.floor(x0), Math.floor(y0), Math.ceil(x1 - x0) + 1, Math.ceil(y1 - y0) + 1];
  }

  bind() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr];
    };
    let drag = null;
    let pinch = null;
    let lastTool = 0;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, pos(e));
      if (this.pointers.size === 1) {
        const [x, y] = pos(e);
        drag = { x, y, sx: x, sy: y, moved: false, cam: { ...this.cam } };
        if (this.tool !== 'look') {
          this.onTool(this.tool, ...this.toWorld(x, y));
          lastTool = performance.now();
        }
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
        drag = null;
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, pos(e));
      if (pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        this.cam.x -= (mx - pinch.mx) / this.cam.z;
        this.cam.y -= (my - pinch.my) / this.cam.z;
        if (pinch.d > 0) this.zoomBy(d / pinch.d, mx, my);
        pinch = { d, mx, my };
        return;
      }
      if (!drag) return;
      const [x, y] = pos(e);
      if (Math.hypot(x - drag.sx, y - drag.sy) > 6 * this.dpr) drag.moved = true;
      if (this.tool === 'look') {
        this.cam.x = drag.cam.x - (x - drag.sx) / this.cam.z;
        this.cam.y = drag.cam.y - (y - drag.sy) / this.cam.z;
        this.fitted = false;
        this.onCamera?.();
      } else if (performance.now() - lastTool > 70) {
        this.onTool(this.tool, ...this.toWorld(x, y));
        lastTool = performance.now();
      }
    });
    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) pinch = null;
      if (drag && !drag.moved && this.tool === 'look' && e.type === 'pointerup') {
        const [x, y] = pos(e);
        this.onTap(...this.toWorld(x, y));
      }
      if (this.pointers.size === 0) drag = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [x, y] = pos(e);
        this.zoomBy(Math.exp(-e.deltaY * 0.0015), x, y);
      },
      { passive: false },
    );
  }

  setFrame(f) {
    if (f.W !== this.W || f.H !== this.H) {
      this.W = f.W;
      this.H = f.H;
      this.fit();
    }
    this.frame = f;
    if (f.image) {
      if (this.src.width !== f.W) {
        this.src.width = f.W;
        this.src.height = f.H;
      }
      const sctx = this.src.getContext('2d');
      sctx.putImageData(new ImageData(f.image, f.W, f.H), 0, 0);
      const g = this.glow.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.clearRect(0, 0, this.glow.width, this.glow.height);
      g.drawImage(this.src, 0, 0, this.glow.width, this.glow.height);
    }
    if (f.region) this.region = f.region;
    else if (!this.visibleRegion()) this.region = null;
  }

  draw() {
    const { ctx, canvas } = this;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#03070a';
    ctx.fillRect(0, 0, cw, ch);
    const f = this.frame;
    if (!f) return;
    if (f.kind === 'surface') this.drawSurface(f);
    else this.drawVesicles(f);
    // The microscope's own vignette.
    const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.min(cw, ch) * 0.52);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }

  // Draw something once for every copy of the (wrapping) world in view.
  tiles(fn) {
    const { W, H, cam, canvas } = this;
    const x0 = cam.x - canvas.width / 2 / cam.z;
    const x1 = cam.x + canvas.width / 2 / cam.z;
    const y0 = cam.y - canvas.height / 2 / cam.z;
    const y1 = cam.y + canvas.height / 2 / cam.z;
    for (let ty = Math.floor(y0 / H); ty <= Math.floor(y1 / H); ty++) {
      for (let tx = Math.floor(x0 / W); tx <= Math.floor(x1 / W); tx++) fn(tx * W, ty * H);
    }
  }

  drawSurface(f) {
    const { ctx, cam, W, H } = this;
    const z = cam.z;
    const close = z >= GLYPH_AT * this.dpr && this.region;
    ctx.imageSmoothingEnabled = z < 3 * this.dpr;
    this.tiles((ox, oy) => {
      const [sx, sy] = this.toScreen(ox, oy);
      ctx.globalAlpha = close ? 0.28 : 1;
      ctx.drawImage(this.src, sx, sy, W * z, H * z);
    });
    // Bloom: a blurred copy added on top.
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = close ? 0.25 : 0.55;
    this.tiles((ox, oy) => {
      const [sx, sy] = this.toScreen(ox - 0.5, oy - 0.5);
      ctx.drawImage(this.glow, sx, sy, (W + 1) * z, (H + 1) * z);
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (close) this.drawStrands();
    // Spiral cores, faintly, in the role view.
    if (f.cores?.length && this.mode === 'role' && !close) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.2 * this.dpr;
      for (const c of f.cores) {
        this.tiles((ox, oy) => {
          const [sx, sy] = this.toScreen(ox + c.x, oy + c.y);
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(5 * this.dpr, 2.5 * z), 0, 2 * Math.PI);
          ctx.stroke();
        });
      }
    }
    if (this.selected && f.kind === 'surface') {
      const [sx, sy] = this.toScreen(this.selected[0], this.selected[1]);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5 * this.dpr;
      const pad = Math.max(2, z * 0.08);
      ctx.strokeRect(sx - pad, sy - pad, z + 2 * pad, z + 2 * pad);
    }
  }

  drawStrands() {
    const { ctx, cam } = this;
    const z = cam.z;
    const full = z >= FOLD_AT * this.dpr;
    for (const s of this.region) {
      const [sx, sy] = this.toScreen(s.x, s.y);
      const col = this.mode === 'role' ? ROLE_COLOR[s.role] : hueColor(s.hue, s.role);
      if (s.dup) {
        ctx.fillStyle = 'rgba(220,240,255,0.10)';
        ctx.beginPath();
        ctx.arc(sx + z / 2, sy + z / 2, z * 0.48, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.shadowColor = col;
      ctx.shadowBlur = full ? 8 * this.dpr : 4 * this.dpr;
      drawFold(ctx, s.db, sx + z * 0.06, sy + z * 0.06, z * 0.88, z * 0.88, {
        color: col,
        seq: full && z >= 60 * this.dpr ? s.seq : null,
        letters: false,
      });
      ctx.shadowBlur = 0;
      if (s.busy) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.setLineDash([2 * this.dpr, 3 * this.dpr]);
        ctx.lineWidth = this.dpr;
        ctx.beginPath();
        ctx.arc(sx + z / 2, sy + z / 2, z * 0.46, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  drawVesicles(f) {
    const { ctx, cam } = this;
    const z = cam.z;
    for (const v of f.vesicles) {
      this.tiles((ox, oy) => {
        const [sx, sy] = this.toScreen(ox + v.x, oy + v.y);
        const r = v.r * z;
        if (sx + r < 0 || sy + r < 0 || sx - r > this.canvas.width || sy - r > this.canvas.height) return;
        // Membrane and contents.
        const g = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r);
        g.addColorStop(0, `rgba(40,90,100,${0.1 + 0.25 * Math.min(1, v.food)})`);
        g.addColorStop(1, 'rgba(120,200,220,0.08)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = 'rgba(170,225,240,0.45)';
        ctx.lineWidth = Math.max(1, z * 0.25);
        ctx.shadowColor = 'rgba(170,225,240,0.6)';
        ctx.shadowBlur = 6 * this.dpr;
        ctx.stroke();
        ctx.shadowBlur = 0;
        const n = v.strands.length / 4;
        const dot = Math.max(1.2 * this.dpr, Math.min(r * 0.12, z * 0.5));
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < n; k++) {
          const role = v.strands[k * 4];
          const hue = v.strands[k * 4 + 1];
          const L = v.strands[k * 4 + 2];
          // Sunflower packing keeps the dots evenly spread.
          const a = k * 2.39996 + v.id;
          const rr = Math.sqrt((k + 0.5) / n) * r * 0.82;
          ctx.fillStyle = role === 0 ? 'rgba(120,140,165,0.6)' : hueColor(this.mode === 'role' ? -1 : hue, role, 0.95);
          if (this.mode === 'role' && role !== 0) ctx.fillStyle = ROLE_COLOR[role];
          ctx.beginPath();
          ctx.arc(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr, dot * (0.6 + Math.min(1, L / 60) * 0.6), 0, 2 * Math.PI);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      });
    }
  }
}
