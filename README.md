# RNA World

A browser simulation of life's first replicators. A warm mineral surface is
seeded with random RNA strands. No strand is told to copy itself: a strand
copies others only if its fold happens to make it a replicase, and it gets
copied only if its tail happens to be read by one. Replicases, parasites,
hypercycles, spiral waves and vesicle-borne cooperation all come out of
those two rules.

Open `dist/index.html` in a browser, or play it as a claude.ai Artifact
(`dist/rna-world.html` is the Artifact body). It runs on a phone.

## Playing

- **Start from** a primordial soup (nothing designed), a replicase colony
  with a few parasites, a five-member hypercycle, or vesicles.
- **Zoom** with the buttons, the mouse wheel or a pinch. Past about 9 pixels
  per site every strand is drawn as its own fold; further in, with its bases.
- **Tap a strand** (Look tool) to see its hairpin diagram, its 3′ tag and
  recognition loop, its family and what it does.
- **Pour food** adds activated nucleotides; **Stir** shuffles a patch.
- **Conditions**: copying error rate, the warm spell's height and the day
  length, food supply, mixing, breakdown, and a Well mixed switch that
  stirs the whole surface every step. Switch the world between the clay
  surface and vesicles at any time.
- **Life** shows the population (log scale, with the temperature cycle under
  it) and the family tree. **Log** keeps the event cards: first replicase,
  first parasite takeover, first hypercycle, spiral waves, first vesicle
  division.
- **Checks** runs the five validation experiments in the background.
- The same seed and settings give the same run, step for step.

## Learning as you watch

The **Learn** tab is a short course in nine chapters, from the bare clay to
the validation checks: what a fold is, how a replicase reads a tag, why
copying waits for the cool spell, how a family takes off, where parasites
come from, why space protects cooperation, the error threshold, vesicles,
and how the model is checked. Each chapter has buttons that set the scene
(“Show me a replicase” flies the microscope to one and opens its fold), a
question to answer before trying it, and something to watch for that ticks
itself off when it happens.

Above the field, a two-line narrator says what the surface is doing right
now (warm or cool spell, what that allows) and what the population is doing
(lift-off, spreading, parasite takeover, collapse). Event cards have Show
me and Explain buttons, the numbers on the Life tab explain themselves when
tapped, and the fold diagram labels the recognition loop and the 3′ tag.
A glossary sits at the bottom of the Learn tab.

## The model

| Piece | What the simulation does |
|---|---|
| Strands | A/C/G/U strings, 4 to 200 bases, one per site on a 128 × 128 wrapping grid, plus at most one paired copy. |
| Folding | A simplified Zuker minimum-free-energy fold: nearest-neighbour stacking energies, hairpin, bulge and interior loops up to 6 unpaired bases, a linear multiloop penalty and a GNRA tetraloop bonus. Results are cached. |
| Replicase | A fold with two or more strong hairpins (stems of 4+ pairs). The loop of its 5′-most hairpin is its recognition loop. Fold quality (how many pairs it holds) sets its speed and its error rate. |
| Template | A replicase docks on a neighbour whose last 4 bases (the 3′ tag) pair with its recognition loop. A tag tucked into the fold is hard to read; an open tag right after a hairpin (a promoter) is read well. Longer templates grip better but take longer to copy. |
| Copying | Base by base after a docking delay, with substitutions, small insertions and deletions and occasional template jumps that drop a stretch. The copy stays paired to its template. |
| Temperature | A day–night cycle, 25 °C up to 25 + the warm spell. Folds and ribozymes work only below 50 °C. A double strand melts apart once the surface passes its melting point, and the copy moves to an empty neighbouring site. |
| Food | Activated nucleotides as a diffusing field, used up by copying and by the mineral's own slow synthesis of 10–50-mers. |
| Chemistry | Slow, sloppy non-enzymatic copying; spontaneous joining of touching strands (faster next to a ligase fold); whole-strand loss and bond hydrolysis, both faster when warm and slower for paired strands. |
| Movement | Strands swap with a neighbour at the Mixing rate; Well mixed shuffles everything every step. |
| Families | A copy belongs to its template's family. When an error changes what it is (role, recognition loop or tag), it founds a daughter family with a nearby hue. Strands nobody copied belong to no family. |
| Vesicles | Fatty-acid vesicles, well mixed inside. They grow by taking up lipid, faster with more RNA inside (Chen, Roberts & Szostak 2004), and split at twice their size with each strand going to either daughter at random. When the dish is full, a division washes out another vesicle. |

What emerges, with the default settings:

- **Replicases** lift off from the soup after a couple of thousand steps.
- **Parasites** follow at once: broken-off tails and mutants that keep a
  readable tag but copy nothing.
- **Spiral waves and travelling fronts** of replicases, parasites and bare
  clay on the surface, as in Boerlijst & Hogeweg (1991). The spiral detector
  counts phase singularities of a replicase → parasite → empty cycle on 4 × 4
  blocks.
- **Hypercycles**: families that copy each other in a ring are detected and
  reported; the hypercycle preset starts with one.
- **Vesicles** carry replicases through parasite outbreaks by dividing.

## Validation

The Checks tab runs these with the simulation's own copying, folding and
surface code. Measured on the current version (`node test/long-run.mjs`):

| Check | Measured | Expected | Compare |
|---|---|---|---|
| Eigen's error threshold | longest surviving master 544, 264, 130 at μ = 0.004, 0.008, 0.016 | ln σ / μ = 576, 288, 144 (σ = 10), within 20% | Eigen 1971 |
| Spiegelman's monster | median length 200 → 35 bases over 40 serial transfers, then flat | shrinks to under a quarter and levels off | Mills, Peterson & Spiegelman 1967 |
| Parasites: pot vs surface | replicases 1.2 in the well-mixed pot vs about 1,600 on the surface (last quarter of 12,000 steps) | near 0 in the pot, many on the surface | Boerlijst & Hogeweg 1991 |
| Vesicles rescue cooperation | 1.2 open vs about 190 in vesicles | near 0 open, many in vesicles | Szathmáry & Demeter 1987 |
| Joyce lab | 54× gain in ligase activity after selection; cross-replication fits an exponential with R² ≥ 0.99 in every serial transfer, at the same rate | exponential, sustained through transfers | Lincoln & Joyce 2009 |

## What is simplified

This is a toy chemistry tuned to be watchable, not a quantitative model.

- **Folding** uses a reduced energy model: no dangling ends, coaxial
  stacking, terminal mismatches or sequence-dependent loop energies,
  bulges and interior loops of at most 6 bases, and only one structure
  (no ensemble, no pseudoknots).
- **What a fold does is invented.** Real ribozyme activity cannot be read off
  a secondary structure. Here the rules (two strong hairpins make a
  replicase, the 3′ tag must pair with the recognition loop, one long
  hairpin makes a ligase) are stand-ins chosen so that function depends on
  sequence through folding, which is the point.
- **Copies are the same sense as the template**, not the complementary
  strand, so a family is one sequence rather than a plus/minus pair.
- **Time and space** are in steps and sites, not seconds and nanometres. A
  temperature cycle is tens of steps.
- **Food** is one pool of generic activated nucleotides, not four.
- **Vesicles** are disks that grow and split by rule; there is no membrane
  physics, and strands never cross a membrane.
- **The validation checks** reuse the simulation's error model, folding and
  surface, but Eigen's threshold and Spiegelman's experiment run in small
  well-mixed pots built for the check, and the Joyce-lab amplification is a
  rate-equation model of the evolved pair (with real selection on folds
  before it). Lincoln & Joyce's pair doubled about every hour; here the
  doubling time is in simulation steps.
- **Spiral detection** is a heuristic on coarse blocks. Travelling fronts,
  irregular waves and spirals all occur; not every counted core is a clean
  spiral.

## Developing

No bundler, no dependencies for the simulation. Node 20+.

```sh
python3 -m http.server   # then open http://localhost:8000/ (module worker)
npm test                 # unit tests: folding, phenotypes, determinism, checks
node test/long-run.mjs   # long headless run of every preset plus the five checks
npm run build            # dist/index.html and dist/rna-world.html
npm run check:browser    # needs Playwright: sandboxed frame, desktop and phone
```

`src/sim` is the simulation (it runs in a Web Worker, on the main thread or
in Node); `src/app` is the page. `tools/build-artifact.mjs` turns the ES
modules into one self-contained HTML file and carries the worker's code as
a string, started from a Blob URL. If a worker cannot start, the simulation
runs on the page's own thread.
