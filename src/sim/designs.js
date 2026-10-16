// Hand-picked sequences for the presets and the validation runs, found by
// tools/design.mjs. The tests check that each still folds into what it is
// meant to be.

// A replicase whose recognition loop (CUCG) matches its own tag (CGAG), so
// it copies its own kind, and a short parasite carrying the same tag.
export const SELF_REPLICASE = 'GUGCAUCCUCGCCGAUGUAUGGUGGGUAGUAAUUCUUAAAUCGCCGCCCGAG';
export const SELF_PARASITE = 'GCCGUGUCCCGGCGCGAG';

// Five replicases in a ring: each one's loop matches only the next one's
// tag, so each copies the next and none copies itself (a hypercycle).
export const HYPERCYCLE = [
  'UGCGGGAGGGAAUUAUUAUUUCGCAAAAUAUCUCAACCUGGUGAUUCACUGAUAAA',
  'UUAUCCCUGUCGUGUUCCUUACCGGGGUCAUCUCGCUGCGGCCCAGCUGUACCUUCCC',
  'CGGCAAACGGUUUAUAUAGACAGCAGGCCGAUCGUCAAAUGGCUCAACUGGCGUACGA',
  'GUGCUGUAGUUCUGUGAUGAUGUAAUCACUCUAUUGUUUAGACAAUAGUCAUAU',
  'AUGAGCGAUUUUACUUUAUCGUUAAGCCGAAGUAUAGUCGGCACAUC',
];
// A parasite with the tag of the first member: whichever member copies the
// first one also copies it.
export const HYPER_PARASITE = 'UGGUCCGCUGGCUAUAAA';
