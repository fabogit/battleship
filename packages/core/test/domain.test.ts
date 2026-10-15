import { describe, expect, it } from 'vitest';

import {
  BOARD_SIZE,
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  FLEET,
  GAME_OVER_TTL_MS,
  SHIP_LENGTH,
  TIMEOUT_ACTIONS,
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
