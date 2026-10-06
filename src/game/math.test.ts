import { describe, expect, it } from 'vitest';
import { clamp, lerp, rangesOverlap } from './math';

describe('clamp', () => {
  it('limits to the range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});

describe('rangesOverlap', () => {
  it('detects overlap', () => {
    expect(rangesOverlap(0, 2, 1, 3)).toBe(true);
    expect(rangesOverlap(0, 1, 2, 3)).toBe(false);
    expect(rangesOverlap(0, 1, 1, 2)).toBe(false); // touching, not overlapping
  });
});
