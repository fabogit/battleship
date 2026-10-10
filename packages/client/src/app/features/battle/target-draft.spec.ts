import { SHOT_OUTCOMES, TARGET_VIOLATIONS, type ShotResult } from '@battleship/core';
import { describe, expect, it } from 'vitest';

import { isSameTargets, toggleTarget } from './target-draft';

const B7 = { x: 6, y: 1 };
const C3 = { x: 2, y: 2 };
const J10 = { x: 9, y: 9 };
const SHOTS: readonly ShotResult[] = [{ coordinate: J10, outcome: SHOT_OUTCOMES.MISS }];

describe('toggleTarget', () => {
  it('adds a cell to an empty draft', () => {
    expect(toggleTarget([], B7, SHOTS, 1)).toEqual({ ok: true, draft: [B7], isTargeted: true });
  });

  it('takes a target out of the draft', () => {
    expect(toggleTarget([B7], { ...B7 }, SHOTS, 1)).toEqual({ ok: true, draft: [], isTargeted: false });
  });

  it('moves the single target of a standard turn to the tapped cell', () => {
    expect(toggleTarget([B7], C3, SHOTS, 1)).toEqual({ ok: true, draft: [C3], isTargeted: true });
  });

  it('refuses a cell shot in an earlier turn', () => {
    expect(toggleTarget([B7], J10, SHOTS, 1)).toEqual({ ok: false, reason: TARGET_VIOLATIONS.ALREADY_TARGETED });
  });

  it('fills a salvo draft up to the allowance, then refuses another cell', () => {
    expect(toggleTarget([B7], C3, SHOTS, 2)).toEqual({ ok: true, draft: [B7, C3], isTargeted: true });
    expect(toggleTarget([B7, C3], { x: 0, y: 0 }, SHOTS, 2)).toEqual({
      ok: false,
      reason: TARGET_VIOLATIONS.WRONG_TARGET_COUNT,
    });
  });
});

describe('isSameTargets', () => {
  it('compares the cells in order', () => {
    expect(isSameTargets([B7, C3], [{ ...B7 }, { ...C3 }])).toBe(true);
    expect(isSameTargets([B7, C3], [C3, B7])).toBe(false);
    expect(isSameTargets([B7], [B7, C3])).toBe(false);
    expect(isSameTargets([], [])).toBe(true);
  });
});
