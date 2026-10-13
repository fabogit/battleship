import { RATE_LIMIT_EVENTS_PER_SECOND } from '@battleship/core';
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../src/rate-limiter.js';

const START = 1_700_000_000_000;
const WINDOW_MS = 1_000;

/** Calls `tryAcquire` once per time and returns each answer. */
function attempts(times: readonly number[]): boolean[] {
  const limiter = createRateLimiter(3, WINDOW_MS);
  return times.map((time) => limiter.tryAcquire(time));
}

describe('createRateLimiter', () => {
  it('admits the limit at one instant and refuses the next event', () => {
    const limiter = createRateLimiter(RATE_LIMIT_EVENTS_PER_SECOND, WINDOW_MS);
    const admitted = Array.from({ length: RATE_LIMIT_EVENTS_PER_SECOND }, () => limiter.tryAcquire(START));
    expect(admitted.every(Boolean)).toBe(true);
    expect(limiter.tryAcquire(START)).toBe(false);
  });

  it('admits again once the oldest admitted event leaves the window', () => {
    expect(
      attempts([START, START + 100, START + 200, START + 999, START + 1_000, START + 1_099, START + 1_100]),
    ).toEqual([true, true, true, false, true, false, true]);
  });

  it('never admits more than the limit in any window, unlike a fixed one-second bucket', () => {
    // Three at the end of one second and three at the start of the next would pass a per-second counter.
    expect(attempts([START + 900, START + 950, START + 990, START + 1_000, START + 1_010, START + 1_900])).toEqual([
      true,
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it('does not count refused events', () => {
    const limiter = createRateLimiter(1, WINDOW_MS);
    expect(limiter.tryAcquire(START)).toBe(true);
    for (let offset = 1; offset < WINDOW_MS; offset += 100) {
      expect(limiter.tryAcquire(START + offset)).toBe(false);
    }
    expect(limiter.tryAcquire(START + WINDOW_MS)).toBe(true);
  });

  it('starts over when the clock goes back', () => {
    expect(attempts([START, START, START, START - 60_000, START - 60_000])).toEqual([true, true, true, true, true]);
  });
});
