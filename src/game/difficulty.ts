// Data-driven difficulty: a curve of keyframes over score (per run), linearly interpolated.
// Principle: speed is quasi-constant; difficulty comes from the DENSITY and TYPE of obstacles.
import type { ObType } from './types';

export interface DifficultyStop {
  /** score threshold (per run) at which this keyframe applies */
  score: number;
  /** base world speed (almost flat — see §3.1) */
  speed: number;
  /** density 0..1 (how often/tightly obstacles appear) */
  density: number;
  /** amplitude of the density oscillation (tension/relaxation wave) */
  waveAmp: number;
  /** length in score of one wave period */
  wavePeriod: number;
  /** type weights (relative) — gradually introduce new types */
  weights: Partial<Record<ObType, number>>;
  /** how many lanes may be blocked at once in a row (1..2; never 3) */
  maxBlockedLanes: number;
}

export interface SpeedBurst {
  /** from which score the temporary speed bursts start */
  fromScore: number;
  /** every how much score a burst starts */
  everyScore: number;
  /** speed multiplier during the burst */
  mult: number;
  /** burst duration (seconds) */
  duration: number;
}

export const DIFFICULTY: { stops: DifficultyStop[]; bursts: SpeedBurst[] } = {
  stops: [
    { score: 0,      speed: 22, density: 0.40, waveAmp: 0.14, wavePeriod: 600,  weights: { block: 30, overhead: 18, wall: 14, core: 34 }, maxBlockedLanes: 1 },
    { score: 1500,   speed: 23, density: 0.55, waveAmp: 0.20, wavePeriod: 700,  weights: { block: 28, overhead: 22, wall: 22, core: 28 }, maxBlockedLanes: 1 },
    { score: 6000,   speed: 24, density: 0.68, waveAmp: 0.24, wavePeriod: 850,  weights: { block: 26, overhead: 24, wall: 26, core: 24 }, maxBlockedLanes: 2 },
    { score: 15000,  speed: 26, density: 0.80, waveAmp: 0.24, wavePeriod: 950,  weights: { block: 25, overhead: 25, wall: 28, core: 22 }, maxBlockedLanes: 2 },
    { score: 40000,  speed: 28, density: 0.86, waveAmp: 0.22, wavePeriod: 1000, weights: { block: 24, overhead: 24, wall: 30, core: 22 }, maxBlockedLanes: 2 },
    { score: 100000, speed: 31, density: 0.90, waveAmp: 0.20, wavePeriod: 1100, weights: { block: 24, overhead: 24, wall: 30, core: 22 }, maxBlockedLanes: 2 },
  ],
  // Temporary speed bursts above 10k (they revert on their own).
  bursts: [{ fromScore: 10000, everyScore: 4000, mult: 1.2, duration: 5 }],
};

export interface DiffSample {
  speed: number;
  density: number;
  waveAmp: number;
  wavePeriod: number;
  weights: { v: ObType; w: number }[];
  maxBlockedLanes: number;
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Samples the difficulty curve at a given score (linear interpolation between keyframes). */
export function sampleDifficulty(score: number): DiffSample {
  const stops = DIFFICULTY.stops;
  let lo = stops[0];
  let hi = stops[0];
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].score <= score) {
      lo = stops[i];
      hi = stops[i + 1] ?? stops[i];
    }
  }
  const span = hi.score - lo.score;
  const t = span > 0 ? Math.min(1, Math.max(0, (score - lo.score) / span)) : 0;

  // Weights: interpolate over the union of keys (missing = 0).
  const keys = new Set<ObType>([
    ...(Object.keys(lo.weights) as ObType[]),
    ...(Object.keys(hi.weights) as ObType[]),
  ]);
  const weights: { v: ObType; w: number }[] = [];
  for (const k of keys) {
    const w = lerpN(lo.weights[k] ?? 0, hi.weights[k] ?? 0, t);
    if (w > 0.01) weights.push({ v: k, w });
  }

  return {
    speed: lerpN(lo.speed, hi.speed, t),
    density: lerpN(lo.density, hi.density, t),
    waveAmp: lerpN(lo.waveAmp, hi.waveAmp, t),
    wavePeriod: lerpN(lo.wavePeriod, hi.wavePeriod, t),
    weights,
    maxBlockedLanes: Math.round(lerpN(lo.maxBlockedLanes, hi.maxBlockedLanes, t)),
  };
}
