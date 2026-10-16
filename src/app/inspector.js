// The Strand tab: one strand's fold as a hairpin diagram, its sequence with
// the tag and recognition loop marked, and what it does.

import { drawFold } from './foldview.js';
import { prepCanvas } from './charts.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ROLE_TEXT = {
  replicase: 'Folds into a replicase: it docks on neighbours whose 3′ tag pairs with its recognition loop and copies them.',
  parasite: 'Gets copied but copies nothing. It keeps a tag a replicase recognises.',
  ligase: 'Folds into a ligase: it speeds up the joining of strands that touch it.',
  unreplicated: 'Made by the mineral, by joining or by breakage. Nothing has copied it yet.',
};

export function renderInspector(root, info) {
  if (!info || info.empty) {
    root.innerHTML = `<p class="empty">${info ? 'Bare clay here' + (info.food !== undefined ? `, with ${Math.round(info.food)} activated nucleotides waiting.` : '.') : 'Zoom in and tap a strand to see how it folds.'}</p>`;
    return;
  }
  const s = info.strand;
  if (!s) {
    root.innerHTML = '<p class="empty">An empty vesicle.</p>';
    return;
  }
  const L = s.L;
  const tagFrom = L - 4;
  const loopFrom = s.rep ? s.rep.loopAt : -1;
  let seqHtml = '';
  for (let k = 0; k < L; k++) {
    const cls = k >= tagFrom ? 'tag' : loopFrom >= 0 && k >= loopFrom && k < loopFrom + 4 ? 'loop' : '';
    seqHtml += cls ? `<span class="${cls}">${s.seq[k]}</span>` : s.seq[k];
  }
  const facts = [];
  facts.push(['Length', `${L} bases`]);
  facts.push(['Fold energy', `${s.energy.toFixed(1)} kcal/mol`]);
  facts.push(['Melts at', `${Math.round(s.tm)} °C as a double strand`]);
  facts.push(['3′ tag', `${s.tag} ${s.tagOpen ? '(open)' : '(tucked into the fold)'}`]);
  facts.push(['Promoter', s.promoter ? 'yes: a hairpin right before an open tag' : 'no']);
  if (s.rep) {
    facts.push(['Recognition loop', s.rep.loop]);
    facts.push(['Fold quality', `${Math.round(s.rep.q * 100)}%`]);
    facts.push(['Speed', `${s.rep.speed.toFixed(1)} bases per step`]);
    facts.push(['Errors', `${(s.rep.err * 1000).toFixed(1)} per 1,000 bases`]);
    facts.push(['Copies its own kind', s.rep.selfCopy >= 0.6 ? 'yes' : s.rep.selfCopy > 0.05 ? 'weakly' : 'no']);
  }
  if (s.lig > 0.05) facts.push(['Ligase activity', `${Math.round(s.lig * 100)}%`]);
  if (s.lineage?.id) facts.push(['Family', `#${s.lineage.id}, ${s.lineage.count.toLocaleString('en')} strands now, ${s.lineage.peak.toLocaleString('en')} at most, since step ${s.lineage.born.toLocaleString('en')}`]);
  else if (s.lineage?.debrisOf) facts.push(['Family', `a broken piece of family #${s.lineage.debrisOf}`]);
  if (s.duplex) facts.push(['Paired with', `a fresh ${s.duplex.L}-base copy, until the next warm spell melts them apart`]);
  if (info.busy) facts.push(['Now', 'copying a neighbour']);
  const ves = info.vesicle
    ? `<p class="note">Vesicle #${info.vesicle.id}, generation ${info.vesicle.gen}, holding ${info.vesicle.count} strands: ${summarise(info.contents)}. Showing its most capable strand.</p>`
    : '';
  root.innerHTML = `
    <div class="group">
      <div class="row"><span class="pill ${s.role}">${s.role}</span><span class="note">${ROLE_TEXT[s.role] ?? ''}</span></div>
      ${ves}
      <canvas class="foldbox" id="foldbox"></canvas>
      <dl class="facts">${facts.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
      <div class="group" style="gap:4px">
        <h2>Sequence, 5′ to 3′</h2>
        <p class="seq">${seqHtml}</p>
        <p class="seq db">${esc(s.db)}</p>
        <p class="note">Gold: the 3′ tag a replicase reads. Mint: this replicase's recognition loop, which pairs with tags it will copy.</p>
      </div>
    </div>`;
  const cv = root.querySelector('#foldbox');
  requestAnimationFrame(() => {
    const { ctx, w, h } = prepCanvas(cv, cv.clientHeight || 260);
    const marks = [{ from: tagFrom, to: L - 1, color: '#ffcd6e' }];
    if (loopFrom >= 0) marks.push({ from: loopFrom, to: loopFrom + 3, color: '#78ffd6' });
    drawFold(ctx, s.db, 8, 8, w - 16, h - 16, { seq: s.seq, letters: true, marks, ends: true, color: 'rgba(200,235,255,0.75)' });
  });
}

function summarise(list) {
  const c = { replicase: 0, parasite: 0, unreplicated: 0 };
  for (const x of list ?? []) c[x.role] = (c[x.role] ?? 0) + 1;
  return `${c.replicase} replicases, ${c.parasite} parasites, ${c.unreplicated} others among the first ${list.length}`;
}
