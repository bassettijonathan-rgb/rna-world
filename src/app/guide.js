// The learning layer: a short guided course in chapters, each with things
// to try and something to watch for that ticks itself off; a narrator that
// says in plain words what the surface is doing right now; and a glossary.

import { K } from '../sim/params.js';

// Each chapter: what to read, buttons that set the scene, and a goal the
// page checks against what it sees (g = goal tracker, ctx = page state).
export const CHAPTERS = [
  {
    id: 'clay',
    title: 'A warm, wet mineral',
    body: [
      'Before there were cells, short strands of RNA could form on clay and in the pores of rock. RNA is the cousin of DNA that your cells still use as working copies of genes.',
      'This surface is 128 × 128 spots of clay, each holding at most one strand. The faint grey dots are strands the clay made at random. Nothing here is alive yet, and nothing is designed to be.',
    ],
    tries: [
      { label: 'Start a fresh soup', act: (a) => a.restart('soup') },
      { label: 'Zoom in close', act: (a) => a.zoomClose() },
    ],
    goal: { text: 'Zoom in and tap a strand to see how it folds.', done: (g) => g.inspected },
  },
  {
    id: 'fold',
    title: 'The fold is the job',
    body: [
      'A strand is a string of four bases: A, C, G and U. G pairs with C and A with U, so a strand folds back on itself into hairpins. The fold decides what the strand does.',
      'Here, a strand that folds into two or more strong hairpins is a replicase: a molecule that copies other strands. The loop of its first hairpin is its reading head, the recognition loop. The last four bases at its 3′ end are its tag, which other replicases read. Real ribozymes are subtler, but the principle is the same: shape is function.',
    ],
    tries: [{ label: 'Show me a replicase', act: (a) => a.showMe('replicase') }],
    goal: { text: 'Look at a replicase and find its loop (mint) and tag (gold).', done: (g) => g.inspectedReplicase },
  },
  {
    id: 'cycle',
    title: 'Copying needs a cool spell',
    body: [
      'The surface warms and cools in a cycle, like day and night on a tidal pool. Watch the thermometer at the top.',
      'Below 50 °C strands keep their folds and replicases work. A replicase docks on a neighbour whose tag pairs with its reading head and copies it base by base. The copy stays stuck to its template as a double strand, drawn paler.',
      'In the warm spell the folds melt, nothing is copied, and the double strands come apart. The new copy moves to an empty spot next door. So a strand can be copied at most once per cycle.',
    ],
    tries: [
      { label: 'Slow it down', act: (a) => a.setRate(15) },
      { label: 'Show me a copy being made', act: (a) => a.showMe('busy') },
    ],
    goal: { text: 'Watch one warm spell come and go.', done: (g) => g.sawCycle },
  },
  {
    id: 'liftoff',
    title: 'Lift-off',
    body: [
      'Most random replicases cannot read their own tag. Nothing copies them, and they break down and vanish.',
      'Sooner or later one appears whose reading head happens to pair with its own tag. It copies its own kind, the copies copy more, and a family takes off. That is the start of heredity: information that makes copies of itself, with no one designing it.',
      'Colour by Family gives every family its own hue; daughter families get nearby hues.',
    ],
    predict: {
      q: 'Which random replicase will take off?',
      options: ['The longest one', 'The fastest copier', 'One that can read its own tag'],
      answer: 2,
      why: 'A replicase that cannot read its own tag copies others but is never copied itself, however good it is. Only one whose loop pairs with its own tag starts a family.',
    },
    tries: [
      { label: 'Start a fresh soup', act: (a) => a.restart('soup') },
      { label: 'Colour by family', act: (a) => a.setMode('lineage') },
      { label: 'Run fast', act: (a) => a.setRate(240) },
    ],
    goal: { text: 'Wait for the first replicase family to take off in the soup.', done: (g, ctx) => ctx.preset() === 'soup' && ctx.hasEvent('replicase') },
  },
  {
    id: 'cheats',
    title: 'The first cheats',
    body: [
      'Copying is not perfect. An error, or a strand snapping in two, can leave a piece that still carries the family tag but lost the folds that make it a replicase.',
      'Replicases copy it anyway. It is often short, so it is copied fast, and it copies nothing in return. That is a parasite, drawn coral in the Role colours. Parasites appear in every model of early replication, and in real test tubes too.',
    ],
    predict: {
      q: 'Parasites copy nothing. Will they spread slower or faster than replicases?',
      options: ['Slower: they are useless', 'Faster: they get copied without doing the work'],
      answer: 1,
      why: 'Faster. A replicase spends much of its time busy copying others. A parasite is short and never busy, so it is always ready to be copied, and copied quickly.',
    },
    tries: [
      { label: 'Colour by role', act: (a) => a.setMode('role') },
      { label: 'Show me a parasite', act: (a) => a.showMe('parasite') },
    ],
    goal: { text: 'Wait until parasites outnumber replicases.', done: (g, ctx) => ctx.hasEvent('parasite') },
  },
  {
    id: 'space',
    title: 'Space protects cooperation',
    body: [
      'Strands on clay only meet their neighbours. When parasites overrun a patch, its replicases die, then the parasites decay with nothing left to copy them, and replicases from next door move back into the empty clay.',
      'So waves roll across the surface: replicases, then parasites, then bare clay, sometimes curling into spirals. Stir everything together and that protection is gone.',
    ],
    predict: {
      q: 'You stir the whole surface every step. What happens to the replicases?',
      options: ['They do better: food and partners reach them', 'They crash'],
      answer: 1,
      why: 'They crash. Stirred, every replicase ends up next to parasites, which get copied in its place. Nothing keeps the cheats away any more.',
    },
    tries: [
      { label: 'Start “Replicase vs parasite”', act: (a) => a.restart('duel') },
      { label: 'Colour by role', act: (a) => a.setMode('role') },
      { label: 'Turn on Well mixed', act: (a) => a.setParam('wellMixed', true) },
      { label: 'Turn it off', act: (a) => a.setParam('wellMixed', false) },
    ],
    goal: {
      text: 'With Well mixed on, watch the replicases crash. Then switch it off and restart.',
      done: (g) => g.mixedCrash,
    },
  },
  {
    id: 'errors',
    title: 'Too many mistakes',
    body: [
      'Every copy carries a few errors. A replicase needs most of its bases right to keep working, so a family can only stay ahead of its mistakes if the errors per copy stay small.',
      'Past a limit, roughly the natural log of the family’s advantage, the family dissolves into a cloud of broken mutants. Manfred Eigen called this the error threshold. It is why the first replicators had to be short, or accurate, or both.',
    ],
    predict: {
      q: 'You make copying 25 times sloppier. What happens?',
      options: ['Evolution speeds up and replicases get better', 'The replicase family falls apart'],
      answer: 1,
      why: 'It falls apart. Most errors break the fold. With a few errors in every copy, broken copies are made faster than selection can weed them out.',
    },
    tries: [
      { label: 'Start “Replicase vs parasite”', act: (a) => a.restart('duel') },
      { label: 'Raise errors to 50 per 1,000', act: (a) => a.setParam('errorRate', 0.05) },
      { label: 'Put errors back', act: (a) => a.setParam('errorRate', 0.002) },
    ],
    goal: { text: 'Raise the error rate and watch the replicases fade.', done: (g) => g.errorCrash },
  },
  {
    id: 'vesicles',
    title: 'Bubbles',
    body: [
      'Fatty acids in water form vesicles: hollow bubbles with a skin one molecule thick. Strands inside cannot get out.',
      'A vesicle whose replicases work makes more RNA, swells, takes up more fatty acid and splits in two, each daughter getting a random share of the strands. One overrun by parasites stops growing and is washed away. Now selection acts on whole bubbles, which is a first step toward cells.',
    ],
    predict: {
      q: 'Parasites take over one vesicle. What happens to it?',
      options: ['It grows fastest, it has the most RNA', 'It stops growing and is washed out'],
      answer: 1,
      why: 'Without working replicases no new RNA is made, so it stops growing and dividing while its neighbours keep splitting. The parasites go down with it.',
    },
    tries: [
      { label: 'Start “Vesicles”', act: (a) => a.restart('vesicles') },
      { label: 'Colour by role', act: (a) => a.setMode('role') },
    ],
    goal: { text: 'Watch a vesicle divide.', done: (g, ctx) => ctx.hasEvent('vesicle') },
  },
  {
    id: 'checks',
    title: 'Does it match the real thing?',
    body: [
      'A model is only worth something if it reproduces what is known. The Checks tab reruns five classic results with this world’s own rules: Eigen’s error threshold, Spiegelman’s shrinking RNA, parasites in a pot versus on a surface, vesicles, and Lincoln and Joyce’s self-sustaining ligase pair from 2009.',
      'They take a few minutes in the background while you keep playing.',
    ],
    tries: [{ label: 'Open the checks', act: (a) => a.openTab('checks') }],
    goal: { text: 'Run the checks.', done: (g) => g.ranChecks },
  },
];

export const GLOSSARY = [
  ['RNA', 'A chain of four kinds of bases (A, C, G, U). It can carry information like DNA and fold into working shapes like a protein.'],
  ['Fold', 'The shape a strand takes when its bases pair up with each other (G with C, A with U). Drawn as a hairpin diagram.'],
  ['Replicase', 'A strand whose fold lets it copy other strands. Drawn mint in the Role colours.'],
  ['Recognition loop', 'The four unpaired bases at the tip of a replicase’s first hairpin. It decides which strands the replicase will copy.'],
  ['Tag', 'The last four bases at a strand’s 3′ end. A replicase copies a strand when its recognition loop pairs with the tag.'],
  ['Promoter', 'A hairpin right before an open tag. It makes a strand much easier to copy.'],
  ['Template', 'The strand being copied.'],
  ['Double strand', 'A template with its fresh copy still paired to it. It melts apart in the warm spell.'],
  ['Parasite', 'A strand that gets copied but copies nothing. Drawn coral.'],
  ['Family', 'All the copies descended from one strand. A copying error that changes what a strand does starts a new family.'],
  ['Hypercycle', 'Families that copy each other in a ring, A copying B, B copying C, C copying A.'],
  ['Error threshold', 'The error rate above which a family can no longer keep its sequence and dissolves into mutants.'],
  ['Vesicle', 'A hollow bubble of fatty acids. Strands inside it stay together and share its fate.'],
  ['Ligase', 'A strand whose fold helps join two strands end to end. Drawn gold.'],
];

export const STAT_HELP = {
  Replicases: 'Replicases in a family, so copied at least once. A replicase the clay made at random only counts here once something copies it.',
  Parasites: 'Strands in a family that get copied but cannot copy. Most are broken-off pieces or mutants of replicases.',
  'Other strands': 'Strands nobody has copied yet: made by the clay, joined together, or broken off.',
  'Double strands': 'Templates with a fresh copy still paired to them. They come apart in the warm spell.',
  'Copying now': 'Replicases docked on a template and copying it. Only in the cool part of the cycle.',
  'Families of 12+': 'Families that have reached at least 12 strands. The family tree shows them.',
  Vesicles: 'Vesicles in the dish. When it is full, each division washes another one out.',
};

// Goal tracker: fed with frames and with what the person does.
export function makeGoals() {
  return {
    inspected: false,
    inspectedReplicase: false,
    sawCycle: false,
    hotSeen: false,
    mixedCrash: false,
    mixedFrom: 0,
    errorCrash: false,
    errorFrom: 0,
    ranChecks: false,
  };
}

// `current` is the id of the chapter open in the guide; the cycle only
// counts once the person is reading about it.
export function trackGoals(g, f, params, current) {
  if (current === 'cycle') {
    if (f.T > K.activeBelow) g.hotSeen = true;
    else if (g.hotSeen && f.T < K.activeBelow - 8) g.sawCycle = true;
  }
  const live = f.census?.live ?? 0;
  if (params.wellMixed && f.kind === 'surface') {
    if (!g.mixedFrom && live > 0) g.mixedFrom = live;
    if (g.mixedFrom >= 40 && live <= g.mixedFrom * 0.3) g.mixedCrash = true;
  } else g.mixedFrom = 0;
  if (params.errorRate >= 0.02) {
    if (!g.errorFrom && live > 0) g.errorFrom = live;
    if (g.errorFrom >= 40 && live <= g.errorFrom * 0.3) g.errorCrash = true;
  } else g.errorFrom = 0;
  if (f.inspect?.strand) {
    g.inspected = true;
    if (f.inspect.strand.role === 'replicase') g.inspectedReplicase = true;
  }
}

// ---------------------------------------------------------------- narrator

const pct = (a, b) => Math.round(((a - b) / Math.max(1, b)) * 100);

// Two sentences: what the temperature lets happen right now, and what the
// population is doing.
export function narrate({ last, history, params, events }) {
  if (!last?.census) return { now: '', trend: '' };
  const c = last.census;
  const meltsEver = 25 + params.tempAmp > K.activeBelow;
  let now;
  if (last.kind === 'vesicles') {
    now =
      last.T > K.activeBelow
        ? `Warm spell, above ${K.activeBelow} °C. Inside each vesicle the double strands come apart; nothing is copied.`
        : `Cool spell, below ${K.activeBelow} °C. Inside each vesicle replicases copy whatever strands they can read. Vesicles with more RNA grow faster and split.`;
  } else if (last.T > K.activeBelow) {
    now = `Warm spell, above ${K.activeBelow} °C. Folds have melted, so nothing is copied. Double strands come apart and each new copy moves to an empty spot next door.`;
  } else if (!meltsEver) {
    now = `No warm spell: at most ${Math.round(25 + params.tempAmp)} °C. Double strands never melt apart, so copies stay stuck to their templates.`;
  } else {
    now = `Cool spell, below ${K.activeBelow} °C. Strands are folded; ${c.busy ? `${c.busy.toLocaleString('en')} replicases are copying a neighbour right now` : 'replicases look for a neighbour whose tag they can read'}.`;
  }

  // Compare with about 500 steps ago.
  let past = null;
  for (let k = history.length - 1; k >= 0; k--) {
    if (history[k].step <= last.step - 500) {
      past = history[k];
      break;
    }
  }
  const had = (id) => events.some((e) => e.id === id);
  let trend;
  if (params.wellMixed && last.kind === 'surface') {
    trend = 'Well mixed is on: every strand is shuffled each step, so parasites reach every replicase and nothing is protected by distance.';
  } else if (!had('replicase') && c.live < 25) {
    trend = c.replicase
      ? `${c.replicase.toLocaleString('en')} strands happen to fold as replicases, but none has been copied much yet. The one to watch is a replicase that can read its own tag.`
      : 'The clay keeps making random strands and they keep breaking down. Nothing copies itself yet.';
  } else if (c.live === 0) {
    trend = 'Every replicase family is gone. Without them nothing gets copied, and the surface is back to random chemistry.';
  } else if (past && past.live > 20 && c.live < past.live * 0.7) {
    trend = `Replicases are falling: ${c.live.toLocaleString('en')}, down ${-pct(c.live, past.live)}% in the last 500 steps${c.parasite > c.live ? ', with parasites outnumbering them' : ''}.`;
  } else if (past && c.live > past.live * 1.3 && c.live > 20) {
    trend = `Replicases are spreading: ${c.live.toLocaleString('en')}, up ${pct(c.live, Math.max(1, past.live))}% in the last 500 steps.`;
  } else if (c.parasite > c.live) {
    trend = `Parasites outnumber replicases, ${c.parasite.toLocaleString('en')} to ${c.live.toLocaleString('en')}. They live off the replicases nearby.`;
  } else if (last.kind === 'vesicles') {
    trend = `${c.withReplicase ?? 0} of ${c.vesicles} vesicles still hold replicases.`;
  } else {
    trend = `Replicases and parasites are holding: ${c.live.toLocaleString('en')} and ${c.parasite.toLocaleString('en')}. On the clay they chase each other in patches.`;
  }
  return { now, trend };
}
