import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCryptoRng, createSeededRng, type Rng } from '../src/index.js';

const UINT32_RANGE = 2 ** 32;

function draw(rng: Rng, maxExclusive: number, count: number): number[] {
  return Array.from({ length: count }, () => rng.nextInt(maxExclusive));
}

/** Stubs `globalThis.crypto` with a source that hands out `words` in order. */
function stubCryptoWords(words: readonly number[]): void {
  const queue = [...words];
  vi.stubGlobal('crypto', {
    getRandomValues(array: Uint32Array): Uint32Array {
      const word = queue.shift();
      if (word === undefined) throw new Error('stub ran out of words');
      array[0] = word;
      return array;
    },
  });
}

describe('createSeededRng', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draw(createSeededRng(42), 100, 50)).toEqual(draw(createSeededRng(42), 100, 50));
  });

  it('gives different sequences for different seeds', () => {
    const sequences = [0, 1, 2, 42, 2 ** 32 - 1].map((seed) => draw(createSeededRng(seed), 100, 20).join());
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it('matches the reference sfc32 output, so seeded tests are stable across platforms and refactors', () => {
    // Computed independently with PractRand's seeding: a = 0, b = seed, c = 0, counter = 1, 12 outputs discarded.
    expect(draw(createSeededRng(42), UINT32_RANGE, 5)).toEqual([
      1264412219, 1947509147, 3919439299, 1251167922, 656401615,
    ]);
    expect(draw(createSeededRng(0), UINT32_RANGE, 5)).toEqual([
      1363572419, 145230303, 808754475, 4216505632, 947923937,
    ]);
  });

  it.each([-1, 1.5, 2 ** 32, Number.NaN, Number.POSITIVE_INFINITY])('rejects the seed %s', (seed) => {
    expect(() => createSeededRng(seed)).toThrow(RangeError);
  });
});

describe.each([
  ['seeded', () => createSeededRng(7)],
  ['crypto', () => createCryptoRng()],
])('%s Rng', (_name, create) => {
  it.each([1, 2, 3, 10, 100, 2 ** 31 + 1, UINT32_RANGE])('keeps nextInt(%s) in range', (maxExclusive) => {
    const rng = create();
    for (const value of draw(rng, maxExclusive, 500)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(maxExclusive);
    }
  });

  it.each([0, -1, 1.5, UINT32_RANGE + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects nextInt(%s)',
    (maxExclusive) => {
      expect(() => create().nextInt(maxExclusive)).toThrow(RangeError);
    },
  );

  it('picks an element of the array', () => {
    const rng = create();
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
  });

  it('refuses to pick from an empty array', () => {
    expect(() => create().pick([])).toThrow(RangeError);
  });

  it('shuffles into a new permutation without mutating the input', () => {
    const items = Object.freeze(Array.from({ length: 52 }, (_, index) => index));
    const shuffled = create().shuffle(items);
    expect(shuffled).not.toBe(items);
    expect(items).toEqual(Array.from({ length: 52 }, (_, index) => index));
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
  });

  it('shuffles empty and single-element arrays', () => {
    const rng = create();
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['only'])).toEqual(['only']);
  });
});

describe('uniformity (seeded, so deterministic)', () => {
  it('spreads nextInt(6) evenly', () => {
    const rng = createSeededRng(2026);
    const counts = new Array<number>(6).fill(0);
    for (const value of draw(rng, 6, 60_000)) counts[value] = (counts[value] ?? 0) + 1;
    for (const count of counts) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });

  it('puts every element first about equally often when shuffling', () => {
    const rng = createSeededRng(2026);
    const counts = new Array<number>(4).fill(0);
    for (let i = 0; i < 40_000; i++) {
      const first = rng.shuffle([0, 1, 2, 3])[0] ?? 0;
      counts[first] = (counts[first] ?? 0) + 1;
    }
    for (const count of counts) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });
});

describe('createCryptoRng', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redraws words that would bias the result (rejection sampling)', () => {
    // For maxExclusive 3, 2^32 mod 3 = 1, so only the top word (2^32 - 1) is rejected.
    stubCryptoWords([UINT32_RANGE - 1, 5]);
    expect(createCryptoRng().nextInt(3)).toBe(2);
  });

  it('accepts the largest unbiased word', () => {
    stubCryptoWords([UINT32_RANGE - 2]);
    expect(createCryptoRng().nextInt(3)).toBe((UINT32_RANGE - 2) % 3);
  });

  it('fails fast when the platform has no Web Crypto', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => createCryptoRng()).toThrow(/globalThis\.crypto/);
  });
});
