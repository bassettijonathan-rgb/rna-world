// Spiral-wave detector. Waves of replicase-parasite chemistry run through a
// cycle: bare surface is colonised by replicases, parasites follow and kill
// them, then the parasites decay and leave bare surface again. Give each of
// the three states a phase a third of a turn apart, average over blocks of
// the grid, and the local phase winds once around the centre of every
// spiral. Counting places where it winds (phase singularities) counts the
// spiral cores.

import { ROLE, roleOf } from './lineage.js';

const TAU = Math.PI * 2;

function wrap(a) {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}

// Returns the block phases and the list of cores. `block` is the block size
// in sites; blocks with too little going on have no defined phase.
export function spiralCores(world, block = 4) {
  const { W, H, ph, lin } = world;
  const bw = Math.floor(W / block);
  const bh = Math.floor(H / block);
  const phase = new Float32Array(bw * bh).fill(NaN);
  const angR = 0;
  const angP = TAU / 3;
  const angE = (2 * TAU) / 3;
  const n = block * block;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let r = 0;
      let p = 0;
      let e = 0;
      for (let y = by * block; y < (by + 1) * block; y++) {
        for (let x = bx * block; x < (bx + 1) * block; x++) {
          const i = y * W + x;
          const P = ph[i];
          if (!P) e++;
          else if (roleOf(P) === ROLE.replicase) r++;
          else if (lin[i] > 0) p++;
          else e += 0.5; // junk counts as half-empty: it fills space but does nothing
        }
      }
      const cx = (r * Math.cos(angR) + p * Math.cos(angP) + e * Math.cos(angE)) / n;
      const cy = (r * Math.sin(angR) + p * Math.sin(angP) + e * Math.sin(angE)) / n;
      if (Math.hypot(cx, cy) > 0.12) phase[by * bw + bx] = Math.atan2(cy, cx);
    }
  }
  const cores = [];
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const a = phase[by * bw + bx];
      const b = phase[by * bw + ((bx + 1) % bw)];
      const c = phase[((by + 1) % bh) * bw + ((bx + 1) % bw)];
      const d = phase[((by + 1) % bh) * bw + bx];
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue;
      const w = wrap(b - a) + wrap(c - b) + wrap(d - c) + wrap(a - d);
      const k = Math.round(w / TAU);
      if (k !== 0) cores.push({ x: (bx + 1) * block, y: (by + 1) * block, sign: k });
    }
  }
  return { cores, phase, bw, bh };
}
