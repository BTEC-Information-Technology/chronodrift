import { describe, it, expect } from 'vitest';
import { sampleDifficulty, DIFFICULTY } from './difficulty';

describe('sampleDifficulty', () => {
  it('returns the first keyframe at score 0', () => {
    const s = sampleDifficulty(0);
    expect(s.speed).toBe(DIFFICULTY.stops[0].speed);
    expect(s.density).toBeCloseTo(DIFFICULTY.stops[0].density);
  });

  it('interpolates between two keyframes', () => {
    const a = DIFFICULTY.stops[0];
    const b = DIFFICULTY.stops[1];
    const mid = (a.score + b.score) / 2;
    const s = sampleDifficulty(mid);
    expect(s.density).toBeGreaterThan(a.density);
    expect(s.density).toBeLessThan(b.density);
  });

  it('density increases on average with score', () => {
    expect(sampleDifficulty(20000).density).toBeGreaterThan(sampleDifficulty(500).density);
  });

  it('clamps past the last keyframe', () => {
    const last = DIFFICULTY.stops[DIFFICULTY.stops.length - 1];
    expect(sampleDifficulty(999999).speed).toBeCloseTo(last.speed);
  });

  it('weights are non-empty and positive', () => {
    const s = sampleDifficulty(8000);
    expect(s.weights.length).toBeGreaterThan(0);
    for (const w of s.weights) expect(w.w).toBeGreaterThan(0);
  });
});
