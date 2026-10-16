// Slider-controlled parameters and the fixed rate constants behind them.

export const DEFAULTS = {
  errorRate: 0.002, // copying errors per base, for a perfect replicase
  tempAmp: 50, // °C the surface heats above 25 °C at the top of each cycle
  tempPeriod: 60, // steps per temperature cycle
  foodSupply: 0.02, // how fast activated nucleotides flow back in
  mixing: 0.003, // strand moves per site per step
  breakdown: 1, // how fast strands are lost, relative to the default
  wellMixed: false, // shuffle the whole surface every step
};

export const RANGES = {
  errorRate: { min: 0, max: 0.08, step: 0.001 },
  tempAmp: { min: 0, max: 70, step: 1 },
  tempPeriod: { min: 30, max: 400, step: 10 },
  foodSupply: { min: 0, max: 0.1, step: 0.001 },
  mixing: { min: 0, max: 0.1, step: 0.001 },
  breakdown: { min: 0.2, max: 4, step: 0.05 },
};

export const K = {
  foodCap: 60, // activated nucleotides a cell holds at saturation
  foodDiffusion: 0.2,
  decay: 0.0012, // whole-strand loss per step at 25 °C (times the breakdown slider)
  hydrolysis: 0.000001, // chance per bond per step that it breaks, at 25 °C
  heatScale: 35, // breakdown rises e-fold every 35 °C
  duplexShield: 0.4, // paired strands break down this much slower
  bind: 0.3, // chance per step that a replicase docks on a perfectly matched neighbour
  initiation: 6, // steps a replicase spends docking before it copies a base
  activeBelow: 50, // folds (and so ribozymes) melt above this temperature
  nonEnzymatic: 0.003, // template-directed copying with no replicase, per step
  nonEnzymaticError: 0.02,
  ligation: 0.0003, // spontaneous joining of two touching strands, per step
  ligaseBoost: 25,
  synthesis: 0.001, // mineral-made strands, per empty site per step
  synthMin: 10, // clay surfaces make oligomers up to about 50 bases
  synthMax: 50,
};

export function temperature(step, p) {
  return 25 + p.tempAmp * (0.5 - 0.5 * Math.cos((2 * Math.PI * step) / p.tempPeriod));
}
