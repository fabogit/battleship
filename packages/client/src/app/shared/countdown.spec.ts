import { PLACEMENT_TIME_LIMIT_MS } from '@battleship/core';
import { describe, expect, it } from 'vitest';

import { formatCountdown, isLowTime, remainingSeconds, wholeMinutes } from './countdown';

describe('remainingSeconds', () => {
  it('rounds up, so zero shows only once the time is over', () => {
    expect(remainingSeconds(4_001)).toBe(5);
    expect(remainingSeconds(4_000)).toBe(4);
    expect(remainingSeconds(1)).toBe(1);
    expect(remainingSeconds(0)).toBe(0);
    expect(remainingSeconds(-250)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('shows minutes and two-digit seconds', () => {
    expect(formatCountdown(60_000)).toBe('1:00');
    expect(formatCountdown(59_200)).toBe('1:00');
    expect(formatCountdown(9_000)).toBe('0:09');
    expect(formatCountdown(125_000)).toBe('2:05');
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('wholeMinutes', () => {
  it('counts the whole minutes in a duration, rounded down', () => {
    expect(wholeMinutes(180_000)).toBe(3);
    expect(wholeMinutes(120_000)).toBe(2);
    expect(wholeMinutes(119_999)).toBe(1);
    expect(wholeMinutes(59_999)).toBe(0);
    expect(wholeMinutes(0)).toBe(0);
  });
});

describe('isLowTime', () => {
  it('warns over the last 10 seconds of a countdown of 30 seconds or more', () => {
    expect(isLowTime(10_001, 30_000)).toBe(false);
    expect(isLowTime(10_000, 30_000)).toBe(true);
    expect(isLowTime(10_000, PLACEMENT_TIME_LIMIT_MS)).toBe(true);
    expect(isLowTime(10_001, 120_000)).toBe(false);
    expect(isLowTime(0, 120_000)).toBe(true);
  });

  it('warns over the last third of a shorter one: 5 seconds of a 15-second turn', () => {
    expect(isLowTime(5_001, 15_000)).toBe(false);
    expect(isLowTime(5_000, 15_000)).toBe(true);
  });
});
