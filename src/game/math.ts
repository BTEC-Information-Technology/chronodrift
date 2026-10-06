export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate-stable exponential approach (independent of dt). */
export const damp = (a: number, b: number, rate: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-rate * dt));

/** Do the intervals [a0,a1] and [b0,b1] overlap? */
export const rangesOverlap = (a0: number, a1: number, b0: number, b1: number): boolean =>
  a0 < b1 && b0 < a1;
