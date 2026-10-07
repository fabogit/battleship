import { describe, expect, it } from 'vitest';

import {
  BOARD_SIZE,
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  EMPTY_ROOM_TTL_MS,
  FLEET,
  SHIP_LENGTH,
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
  it('keeps an empty room at least as long as a disconnected seat, and below Render spin-down', () => {
    expect(EMPTY_ROOM_TTL_MS).toBeGreaterThanOrEqual(DISCONNECT_FORFEIT_MS);
    expect(EMPTY_ROOM_TTL_MS).toBeLessThan(15 * 60_000);
  });
});

describe('DEFAULT_RULES', () => {
  it('matches docs/domain.md#rules', () => {
    expect(DEFAULT_RULES).toEqual({
      isExtraTurnOnHitEnabled: false,
      areAdjacentShipsAllowed: false,
      turnTimeLimitSeconds: 30,
      isSalvoModeEnabled: false,
      timeoutAction: 'AUTO_RANDOM_SHOT',
    });
  });

  it('respects the salvo / extra-turn exclusivity', () => {
    expect(DEFAULT_RULES.isSalvoModeEnabled && DEFAULT_RULES.isExtraTurnOnHitEnabled).toBe(false);
  });
});
