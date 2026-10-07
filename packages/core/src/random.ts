// Injectable randomness for placement, dice and auto shots (docs/domain.md#randomness, ADR-0030).

/**
 * Source of every random choice in the game. Inject `createSeededRng` in tests for repeatable sequences and
 * `createCryptoRng` in production.
 */
export interface Rng {
  /**
   * Draws a uniform integer without modulo bias (rejection sampling over 32-bit words).
   * @param maxExclusive Upper bound, an integer from 1 to 2^32.
   * @returns An integer in `[0, maxExclusive)`.
   * @throws `RangeError` when `maxExclusive` is not an integer between 1 and 2^32.
   */
  nextInt(maxExclusive: number): number;

  /**
   * Draws one element, each with the same probability.
   * @param items The candidates; read only, never mutated.
   * @returns One of `items`.
   * @throws `RangeError` when `items` is empty.
   */
  pick<T>(items: readonly T[]): T;

  /**
   * Shuffles a copy with Fisher–Yates, so every permutation is equally likely.
   * @param items The elements to shuffle; read only, never mutated.
   * @returns A new array holding the same elements in random order; empty for an empty input.
   */
  shuffle<T>(items: readonly T[]): T[];
}

/** Number of distinct 32-bit words, and so the largest `maxExclusive` a single word can serve. */
const UINT32_RANGE = 2 ** 32;

/** Outputs discarded after seeding, so that close seeds no longer give close states (PractRand's sfc32 seeding). */
const SFC32_WARM_UP_ROUNDS = 12;

/**
 * The one Web Crypto method the production generator needs. Core compiles without DOM or Node types, so it declares
 * the shape it relies on instead of a global (ADR-0030).
 */
interface RandomValuesSource {
  /**
   * Fills `array` in place with cryptographically strong random values.
   * @param array The buffer to fill.
   * @returns The same buffer.
   */
  getRandomValues(array: Uint32Array): Uint32Array;
}

/**
 * Creates a repeatable generator for tests: the same seed always yields the same sequence, on every platform.
 * The algorithm is sfc32 (128-bit state); changing it or its seeding changes every seeded expectation (ADR-0030).
 * @param seed An integer from 0 to 2^32 − 1.
 * @returns A generator whose sequence depends only on `seed`.
 * @throws `RangeError` when `seed` is not an integer in that range.
 */
export function createSeededRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
    throw new RangeError(`Invalid seed: ${String(seed)} (expected an integer from 0 to 2^32 - 1)`);
  }
  // State words, kept as signed 32-bit integers by the `| 0` coercions; `d` is the counter that guarantees a period
  // of at least 2^32.
  let a = 0;
  let b = seed | 0;
  let c = 0;
  let d = 1;
  const nextUint32 = (): number => {
    const result = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (((c << 21) | (c >>> 11)) + result) | 0;
    return result >>> 0;
  };
  for (let round = 0; round < SFC32_WARM_UP_ROUNDS; round++) {
    nextUint32();
  }
  return createRngFromWords(nextUint32);
}

/**
 * Creates the production generator over `globalThis.crypto.getRandomValues`, available in browsers and in Node,
 * so core needs no runtime dependency. Reads one 32-bit word per draw.
 * @returns A generator backed by the platform's cryptographically strong source.
 * @throws When the platform has no `globalThis.crypto`.
 */
export function createCryptoRng(): Rng {
  // Not `typeof globalThis & …`: where Node or DOM types are loaded (server, client, core's own tests) they declare
  // `crypto` as always present, and the check below must still compile everywhere.
  const { crypto } = globalThis as { readonly crypto?: RandomValuesSource };
  if (crypto === undefined) {
    throw new Error('globalThis.crypto.getRandomValues is not available');
  }
  const word = new Uint32Array(1);
  return createRngFromWords(() => {
    crypto.getRandomValues(word);
    return word[0] ?? 0;
  });
}

/**
 * Builds the `Rng` methods on top of a source of 32-bit words, so both generators share the same unbiased sampling.
 * @param nextUint32 Returns the next uniform integer in `[0, 2^32)`; called once or more per draw.
 * @returns A generator that consumes words only from `nextUint32`.
 */
function createRngFromWords(nextUint32: () => number): Rng {
  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new RangeError(`Invalid maxExclusive: ${String(maxExclusive)} (expected an integer from 1 to 2^32)`);
    }
    // Words at or above `limit` would favour the smallest results; they are redrawn. Fewer than half are rejected in
    // the worst case, so the loop ends quickly.
    const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    let word = nextUint32();
    while (word >= limit) {
      word = nextUint32();
    }
    return word % maxExclusive;
  };

  return {
    nextInt,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError('Cannot pick from an empty array');
      }
      // The index is in bounds, so the element exists even though the index signature says `T | undefined`.
      return items[nextInt(items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i--) {
        const j = nextInt(i + 1);
        [result[i], result[j]] = [result[j] as T, result[i] as T];
      }
      return result;
    },
  };
}
