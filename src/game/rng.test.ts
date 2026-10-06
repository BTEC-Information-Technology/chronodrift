import { describe, expect, it } from 'vitest';
import { mulberry32, randInt, weighted } from './rng';

describe('mulberry32', () => {
  it('is deterministic (same seed → same sequence)', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });
  it('produces values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('different seeds → different sequences', () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });
});

describe('randInt', () => {
  it('stays within [0, n)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 200; i++) {
      const v = randInt(r, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
  });
});

describe('weighted', () => {
  it('only picks values with weight > 0', () => {
    const r = mulberry32(3);
    const items = [
      { v: 'a', w: 1 },
      { v: 'b', w: 0 },
      { v: 'c', w: 1 },
    ];
    for (let i = 0; i < 50; i++) {
      expect(weighted(r, items)).not.toBe('b');
    }
  });
});
