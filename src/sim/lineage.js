// Lineages: families of strands descended by copying. A copy stays in its
// template's lineage unless a mutation changes what it is (its role, its
// recognition loop or its tag); then it founds a daughter lineage. Strands
// that were never copied (made on the mineral, joined or broken) belong to
// no lineage. Hues drift a little from parent to daughter, so families keep
// related colours.

export const ROLE = { none: 0, replicase: 1, parasite: 2, ligase: 3 };

export function roleOf(p) {
  if (p.rep) return ROLE.replicase;
  if (p.lig > 0.15) return ROLE.ligase;
  return ROLE.parasite;
}

export function classKey(p) {
  return p.rep ? `R${p.rep.loop}${p.tag}` : `${roleOf(p) === ROLE.ligase ? 'L' : 'P'}${p.tag}`;
}

export class Lineages {
  constructor(rng) {
    this.rng = rng;
    this.byId = new Map();
    this.nextId = 1;
  }

  found(parentId, p, step) {
    const parent = this.byId.get(parentId);
    const hue = parent ? (parent.hue + (this.rng.float() - 0.5) * 50 + 360) % 360 : this.rng.float() * 360;
    const lin = {
      id: this.nextId++,
      parent: parent ? parent.id : 0,
      born: step,
      died: -1,
      count: 0,
      peak: 0,
      key: classKey(p),
      role: roleOf(p),
      loop: p.rep ? p.rep.loop : null,
      tag: p.tag,
      len: p.L,
      hue,
    };
    this.byId.set(lin.id, lin);
    return lin.id;
  }

  // Lineage for a fresh copy of a template in lineage `templLin` (0 = no
  // lineage; negative = debris of lineage −templLin).
  forCopy(templLin, copyPheno, step) {
    if (templLin > 0) {
      const t = this.byId.get(templLin);
      if (t && t.key === classKey(copyPheno)) return templLin;
    }
    return this.found(Math.abs(templLin), copyPheno, step);
  }

  add(id, step) {
    if (id <= 0) return;
    const l = this.byId.get(id);
    if (!l) return;
    l.count++;
    if (l.count > l.peak) l.peak = l.count;
    l.died = -1;
    l.lastSeen = step;
  }

  drop(id, step) {
    if (id <= 0) return;
    const l = this.byId.get(id);
    if (!l) return;
    l.count--;
    if (l.count <= 0) {
      l.count = 0;
      l.died = step;
    }
  }

  get(id) {
    return this.byId.get(id);
  }

  hue(id) {
    const l = this.byId.get(Math.abs(id));
    return l ? l.hue : 210;
  }

  // Forget small extinct lineages so the table stays bounded. Daughters of
  // a forgotten lineage are re-attached to its parent.
  prune(step, keepPeak = 8) {
    const gone = [];
    for (const l of this.byId.values()) {
      if (l.count === 0 && l.died >= 0 && step - l.died > 50 && l.peak < keepPeak) gone.push(l);
    }
    if (!gone.length) return;
    const parentOf = new Map(gone.map((l) => [l.id, l.parent]));
    const resolve = (id) => {
      let k = 0;
      while (parentOf.has(id) && k++ < 1000) id = parentOf.get(id);
      return id;
    };
    for (const l of gone) this.byId.delete(l.id);
    for (const l of this.byId.values()) if (parentOf.has(l.parent)) l.parent = resolve(l.parent);
    // A very long run could still pile up big extinct lineages; keep the
    // most recent 600 of those.
    const dead = [...this.byId.values()].filter((l) => l.count === 0);
    if (dead.length > 600) {
      dead.sort((a, b) => a.died - b.died);
      const drop = new Map(dead.slice(0, dead.length - 600).map((l) => [l.id, l.parent]));
      for (const id of drop.keys()) this.byId.delete(id);
      const res2 = (id) => {
        let k = 0;
        while (drop.has(id) && k++ < 1000) id = drop.get(id);
        return id;
      };
      for (const l of this.byId.values()) if (drop.has(l.parent)) l.parent = res2(l.parent);
    }
  }

  // The family tree: lineages that ever reached `minPeak` strands.
  tree(minPeak = 12) {
    const out = [];
    for (const l of this.byId.values()) {
      if (l.peak >= minPeak) out.push({ id: l.id, parent: l.parent, born: l.born, died: l.died, count: l.count, peak: l.peak, role: l.role, hue: l.hue, key: l.key });
    }
    return out;
  }
}
