// Colours for the surface picture, one RGBA pixel per site. Computed next to
// the simulation (in the worker) so only the finished image crosses over.

import { ROLE, roleOf } from './lineage.js';
import { K } from './params.js';

export const ROLE_RGB = {
  [ROLE.replicase]: [120, 255, 214],
  [ROLE.parasite]: [255, 120, 140],
  [ROLE.ligase]: [255, 205, 110],
  junk: [96, 120, 150],
};

function hsl(h, s, l) {
  h /= 360;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const hueCache = new Map();
function hueRGB(h, light) {
  const key = (Math.round(h) << 8) | Math.round(light * 100);
  let c = hueCache.get(key);
  if (!c) {
    c = hsl(h, 0.72, light);
    hueCache.set(key, c);
  }
  return c;
}

// mode: 'lineage' | 'role' | 'food'
export function paintSurface(world, mode, out) {
  const { N, ph, lin, dph, food, lineages } = world;
  const img = out ?? new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    const P = ph[i];
    const f = Math.min(1, food[i] / K.foodCap);
    // The bare mineral glows faintly where food is plentiful.
    let r = 4 + 10 * f;
    let g = 12 + 26 * f;
    let b = 16 + 30 * f;
    if (mode === 'food') {
      r = 10 + 30 * f;
      g = 20 + 160 * f;
      b = 40 + 120 * f;
      if (P) {
        r += 40;
        g += 40;
        b += 40;
      }
    } else if (P) {
      const role = roleOf(P);
      const L = lin[i];
      let c;
      let bright = 0.35 + 0.65 * Math.min(1, P.L / 60);
      if (mode === 'role') {
        c = role === ROLE.replicase ? ROLE_RGB[role] : L > 0 ? ROLE_RGB[role] : ROLE_RGB.junk;
        if (L <= 0 && role !== ROLE.replicase) bright *= 0.45;
      } else if (L > 0) {
        c = hueRGB(lineages.hue(L), role === ROLE.replicase ? 0.62 : 0.42);
        if (role !== ROLE.replicase) bright *= 0.7;
      } else {
        c = role === ROLE.replicase ? [200, 210, 220] : ROLE_RGB.junk;
        bright *= role === ROLE.replicase ? 0.6 : 0.3;
      }
      r = c[0] * bright;
      g = c[1] * bright;
      b = c[2] * bright;
      if (dph[i]) {
        // A double strand: paler and brighter.
        r = r * 1.25 + 28;
        g = g * 1.25 + 28;
        b = b * 1.25 + 28;
      }
    }
    img[o] = r;
    img[o + 1] = g;
    img[o + 2] = b;
    img[o + 3] = 255;
  }
  return img;
}
