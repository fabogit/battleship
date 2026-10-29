import { describe, expect, it } from 'vitest';

import {
  BOARD_SIZE,
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  FLEET,
  GAME_OVER_TTL_MS,
  RULES_VIOLATIONS,
  SHIP_LENGTH,
  TIMEOUT_ACTIONS,
  validateRules,
} from '../src/index.js';

describe('fleet', () => {
  it('lists every ship type exactly once', () => {
    expect(new Set(FLEET).size).toBe(FLEET.length);
    expect([...FLEET].sort()).toEqual(Object.keys(SHIP_LENGTH).sort());
  });

  it('occupies 17 cells, each ship fitting on the board', () => {
    const lengths = FLEET.map((type) => SHIP_LENGTH[type]);
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBe(17);
    for (const length of lengths) expect(length).toBeLessThanOrEqual(BOARD_SIZE);
  });
});

describe('timeouts', () => {
  // A room nobody sits in lasts at most a forfeit, then the game-over TTL of the match the forfeit ended (ADR-0073).
  it('closes a room nobody sits in before Render spin-down', () => {
    expect(DISCONNECT_FORFEIT_MS + GAME_OVER_TTL_MS).toBeLessThan(15 * 60_000);
  });
});

describe('DEFAULT_RULES', () => {
  it('matches docs/domain.md#rules', () => {
    expect(DEFAULT_RULES).toEqual({
      isExtraTurnOnHitEnabled: false,
      areAdjacentShipsAllowed: false,
      turnTimeLimitSeconds: 30,
      isSalvoModeEnabled: false,
      timeoutAction: TIMEOUT_ACTIONS.AUTO_RANDOM_SHOT,
    });
  });

  it('respects the salvo / extra-turn exclusivity', () => {
    expect(DEFAULT_RULES.isSalvoModeEnabled && DEFAULT_RULES.isExtraTurnOnHitEnabled).toBe(false);
  });
});

describe('validateRules', () => {
  it('accepts DEFAULT_RULES', () => {
    expect(validateRules(DEFAULT_RULES)).toEqual({ ok: true });
  });

  // ADR-0010: the exclusive pair.
  it.each([
    [false, false],
    [false, true],
  ])('accepts salvo %s with extra turn %s', (isSalvoModeEnabled, isExtraTurnOnHitEnabled) => {
    expect(validateRules({ ...DEFAULT_RULES, isSalvoModeEnabled, isExtraTurnOnHitEnabled })).toEqual({ ok: true });
  });

  // ADR-0085: the shot engine throws on salvo until #32, which drops this test with the violation.
  it('refuses salvo alone until the shot engine supports it, whatever the other fields', () => {
    for (const rules of [
      { ...DEFAULT_RULES, isSalvoModeEnabled: true },
      {
        isSalvoModeEnabled: true,
        isExtraTurnOnHitEnabled: false,
        areAdjacentShipsAllowed: true,
        turnTimeLimitSeconds: 120,
        timeoutAction: TIMEOUT_ACTIONS.PASS_TURN,
      } as const,
    ]) {
      expect(validateRules(rules)).toEqual({ ok: false, reason: RULES_VIOLATIONS.SALVO_NOT_IMPLEMENTED });
    }
  });

  it('refuses salvo with extra turn on hit, whatever the other fields', () => {
    for (const rules of [
      { ...DEFAULT_RULES, isSalvoModeEnabled: true, isExtraTurnOnHitEnabled: true },
      {
        isSalvoModeEnabled: true,
        isExtraTurnOnHitEnabled: true,
        areAdjacentShipsAllowed: true,
        turnTimeLimitSeconds: 120,
        timeoutAction: TIMEOUT_ACTIONS.PASS_TURN,
      } as const,
    ]) {
      expect(validateRules(rules)).toEqual({ ok: false, reason: RULES_VIOLATIONS.SALVO_WITH_EXTRA_TURN });
    }
  });
});
