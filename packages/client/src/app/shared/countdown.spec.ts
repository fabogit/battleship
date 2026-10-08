import { describe, expect, it } from 'vitest';

import { formatCountdown, remainingSeconds } from './countdown';

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
