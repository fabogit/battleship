import { describe, expect, it } from 'vitest';

import {
  BOARD_SIZE,
  createSeededRng,
  DEFAULT_RULES,
  randomTargets,
  resolveTurn,
  shotsAllowed,
  toPlacedShip,
  validateTargets,
  type Battle,
  type Board,
  type Coordinate,
  type GameRules,
  type Orientation,
  type PlacedShip,
  type Seat,
  type ShipType,
  type ShotResult,
  type TurnResolution,
} from '../src/index.js';

const STANDARD: GameRules = { ...DEFAULT_RULES, isExtraTurnOnHitEnabled: false, isSalvoModeEnabled: false };
const EXTRA_TURN: GameRules = { ...STANDARD, isExtraTurnOnHitEnabled: true };
const SALVO: GameRules = { ...STANDARD, isSalvoModeEnabled: true };
const SEED_COUNT = 200;

function ship(type: ShipType, x: number, y: number, orientation: Orientation = 'HORIZONTAL'): PlacedShip {
  return toPlacedShip({ type, start: { x, y }, orientation });
}

function cell(x: number, y: number): Coordinate {
  return { x, y };
}

function miss(x: number, y: number): ShotResult {
  return { coordinate: cell(x, y), outcome: 'MISS' };
}

function hit(x: number, y: number): ShotResult {
  return { coordinate: cell(x, y), outcome: 'HIT' };
}

/**
 * P2's fleet, the one P1 fires at:
 *
 *     0123456789
 *   0 CCCCC.....
 *   1 ..........
 *   2 BBBB......
 *   3 ..........
 *   4 RRR.......
 *   5 ..........
 *   6 SSS.......
 *   7 ..........
 *   8 DD........
 */
const TARGET_FLEET: readonly PlacedShip[] = [
  ship('CARRIER', 0, 0),
  ship('BATTLESHIP', 0, 2),
  ship('CRUISER', 0, 4),
  ship('SUBMARINE', 0, 6),
  ship('DESTROYER', 0, 8),
];

/** P1's fleet; P1 always shoots first in these tests, so it is only there to make the battle complete. */
const SHOOTER_FLEET: readonly PlacedShip[] = [
  ship('CARRIER', 5, 0, 'VERTICAL'),
  ship('BATTLESHIP', 7, 0, 'VERTICAL'),
  ship('CRUISER', 9, 0, 'VERTICAL'),
  ship('SUBMARINE', 5, 7),
  ship('DESTROYER', 9, 5, 'VERTICAL'),
];

/** Shots that hit every cell of `TARGET_FLEET` but the last cell of the destroyer at (1, 8). */
const ALL_BUT_ONE_HIT: readonly ShotResult[] = TARGET_FLEET.flatMap((placed) => placed.coordinates)
  .filter(({ x, y }) => !(x === 1 && y === 8))
  .map(({ x, y }) => hit(x, y));

/** A battle where P1 fires at `TARGET_FLEET` with the given shots already on it. */
function battle(targetShots: readonly ShotResult[] = [], shooterShots: readonly ShotResult[] = []): Battle {
  return {
    boards: {
      P1: { ships: SHOOTER_FLEET, shots: shooterShots },
      P2: { ships: TARGET_FLEET, shots: targetShots },
    },
    currentTurn: 'P1',
  };
}

/** Freezes a value and everything it holds, so any mutation by the engine throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const property of Object.values(value)) {
      deepFreeze(property);
    }
  }
  return value;
}

/** Narrows a resolution to the fired turn, failing the test otherwise. */
function fired(resolution: TurnResolution) {
  if (!resolution.ok) {
    throw new Error(`expected a fired turn, got ${resolution.reason}`);
  }
  return resolution;
}

describe('shotsAllowed', () => {
  it.each([
    ['without extra turn', STANDARD],
    ['with extra turn', EXTRA_TURN],
  ])('allows one target in standard mode (%s)', (_name, rules) => {
    expect(shotsAllowed(battle(), rules)).toBe(1);
  });

  it('refuses salvo mode until it is implemented', () => {
    expect(() => shotsAllowed(battle(), SALVO)).toThrow(/#32/);
  });
});

describe('validateTargets', () => {
  it('accepts distinct unshot cells in the exact count', () => {
    expect(validateTargets([cell(0, 0), cell(9, 9)], [miss(5, 5)], 2)).toEqual({ ok: true });
  });

  it.each([
    ['too few', [], 1],
    ['too many', [cell(1, 1), cell(2, 2)], 1],
    ['too many, even when duplicated', [cell(1, 1), cell(1, 1)], 1],
  ])('rejects %s targets', (_name, targets, count) => {
    expect(validateTargets(targets, [], count)).toEqual({
      ok: false,
      reason: 'WRONG_TARGET_COUNT',
      targetIndex: null,
    });
  });

  it.each([
    ['past the right edge', cell(BOARD_SIZE, 0)],
    ['past the bottom edge', cell(0, BOARD_SIZE)],
    ['with a negative x', cell(-1, 3)],
    ['with a negative y', cell(3, -1)],
    ['between cells', cell(2.5, 3)],
    ['NaN', cell(Number.NaN, 0)],
  ])('rejects a target %s', (_name, target) => {
    expect(validateTargets([cell(0, 0), target], [], 2)).toEqual({
      ok: false,
      reason: 'OUT_OF_BOUNDS',
      targetIndex: 1,
    });
  });

  it('rejects a cell targeted twice in the same turn, pointing at the second', () => {
    expect(validateTargets([cell(3, 3), cell(4, 4), cell(3, 3)], [], 3)).toEqual({
      ok: false,
      reason: 'DUPLICATE_TARGET',
      targetIndex: 2,
    });
  });

  it.each([
    ['a miss', miss(6, 6)],
    ['a hit', hit(6, 6)],
  ])('rejects a cell shot in an earlier turn (%s)', (_name, earlier) => {
    expect(validateTargets([cell(0, 0), cell(6, 6)], [earlier], 2)).toEqual({
      ok: false,
      reason: 'ALREADY_TARGETED',
      targetIndex: 1,
    });
  });

  it('reports the first broken constraint in input order', () => {
    const targets = [cell(1, 1), cell(1, 1), cell(BOARD_SIZE, 0)];
    expect(validateTargets(targets, [miss(1, 1)], 3)).toEqual({
      ok: false,
      reason: 'ALREADY_TARGETED',
      targetIndex: 0,
    });
  });
});

describe('resolveTurn', () => {
  describe('outcomes', () => {
    it('misses an empty cell and passes the turn', () => {
      const turn = fired(resolveTurn(battle(), [cell(9, 9)], STANDARD));
      expect(turn.results).toEqual([miss(9, 9)]);
      expect(turn.results[0]).not.toHaveProperty('sunkShip');
      expect(turn.winner).toBeNull();
      expect(turn.battle.currentTurn).toBe('P2');
    });

    it('hits a ship that still has intact cells', () => {
      const turn = fired(resolveTurn(battle(), [cell(2, 0)], STANDARD));
      expect(turn.results).toEqual([hit(2, 0)]);
      expect(turn.results[0]).not.toHaveProperty('sunkShip');
    });

    it('reports the whole ship when the shot sinks it', () => {
      const turn = fired(resolveTurn(battle([hit(0, 4), miss(3, 4), hit(2, 4)]), [cell(1, 4)], STANDARD));
      expect(turn.results).toEqual([{ coordinate: cell(1, 4), outcome: 'SUNK', sunkShip: TARGET_FLEET[2] }]);
      expect(turn.winner).toBeNull();
      expect(turn.battle.currentTurn).toBe('P2');
    });

    it('derives hits from the coordinates, not from the stored outcomes', () => {
      const turn = fired(resolveTurn(battle([miss(0, 8)]), [cell(1, 8)], STANDARD));
      expect(turn.results[0]?.outcome).toBe('SUNK');
    });

    it('rejects a repeated shot and leaves the battle unchanged', () => {
      const before = deepFreeze(battle([miss(9, 9)]));
      expect(resolveTurn(before, [cell(9, 9)], STANDARD)).toEqual({
        ok: false,
        reason: 'ALREADY_TARGETED',
        targetIndex: 0,
      });
      expect(before).toEqual(battle([miss(9, 9)]));
    });

    it.each([
      ['no target', []],
      ['two targets', [cell(9, 9), cell(9, 8)]],
    ])('rejects %s in standard mode', (_name, targets) => {
      expect(resolveTurn(battle(), targets, STANDARD)).toMatchObject({ ok: false, reason: 'WRONG_TARGET_COUNT' });
    });

    it('rejects a target off the board', () => {
      expect(resolveTurn(battle(), [cell(0, BOARD_SIZE)], STANDARD)).toEqual({
        ok: false,
        reason: 'OUT_OF_BOUNDS',
        targetIndex: 0,
      });
    });

    it('throws in salvo mode until it is implemented', () => {
      expect(() => resolveTurn(battle(), [cell(9, 9)], SALVO)).toThrow(/#32/);
    });
  });

  describe('victory', () => {
    it('ends the match when the last ship sinks', () => {
      const turn = fired(resolveTurn(battle(ALL_BUT_ONE_HIT), [cell(1, 8)], STANDARD));
      expect(turn.results).toEqual([{ coordinate: cell(1, 8), outcome: 'SUNK', sunkShip: TARGET_FLEET[4] }]);
      expect(turn.winner).toBe('P1');
      expect(turn.battle.currentTurn).toBe('P1');
    });

    it('goes on while a ship is left', () => {
      const turn = fired(resolveTurn(battle(ALL_BUT_ONE_HIT.slice(1)), [cell(1, 8)], STANDARD));
      expect(turn.results[0]?.outcome).toBe('SUNK');
      expect(turn.winner).toBeNull();
    });

    it('lets P2 win against P1', () => {
      const shooterHits = SHOOTER_FLEET.flatMap((placed) => placed.coordinates).map(({ x, y }) => hit(x, y));
      const [last, ...earlier] = shooterHits;
      const p2Turn: Battle = { ...battle([], earlier), currentTurn: 'P2' };
      const turn = fired(resolveTurn(p2Turn, [last?.coordinate ?? cell(0, 0)], STANDARD));
      expect(turn.winner).toBe('P2');
      expect(turn.battle.boards.P1.shots).toHaveLength(shooterHits.length);
    });
  });

  describe('next turn', () => {
    it.each([
      ['a hit', cell(2, 0)],
      ['a sink', cell(1, 8)],
    ])('gives the shooter another turn after %s with extra turn on', (_name, target) => {
      const turn = fired(resolveTurn(battle([hit(0, 8)]), [target], EXTRA_TURN));
      expect(turn.battle.currentTurn).toBe('P1');
    });

    it('passes the turn after a miss with extra turn on', () => {
      expect(fired(resolveTurn(battle(), [cell(9, 9)], EXTRA_TURN)).battle.currentTurn).toBe('P2');
    });

    it.each([
      ['a hit', cell(2, 0)],
      ['a miss', cell(9, 9)],
    ])('passes the turn after %s with extra turn off', (_name, target) => {
      expect(fired(resolveTurn(battle(), [target], STANDARD)).battle.currentTurn).toBe('P2');
    });
  });

  describe('state', () => {
    it('appends the results to the opponent board, oldest first', () => {
      const turn = fired(resolveTurn(battle([miss(9, 9)]), [cell(0, 0)], STANDARD));
      expect(turn.battle.boards.P2).toEqual<Board>({ ships: TARGET_FLEET, shots: [miss(9, 9), hit(0, 0)] });
    });

    it('never mutates its input and keeps the untouched board', () => {
      const before = deepFreeze(battle([hit(0, 0)], [miss(4, 4)]));
      const targets = deepFreeze([cell(1, 0)]);
      const turn = fired(resolveTurn(before, targets, EXTRA_TURN));
      expect(before).toEqual(battle([hit(0, 0)], [miss(4, 4)]));
      expect(turn.battle.boards.P1).toBe(before.boards.P1);
      expect(turn.results[0]?.coordinate).not.toBe(targets[0]);
    });

    it('plays a whole match to the end, one random shot per turn', () => {
      const rng = createSeededRng(7);
      let current: Battle = battle();
      let winner: Seat | null = null;
      let turns = 0;
      while (winner === null) {
        const turn = fired(resolveTurn(current, randomTargets(current, 1, rng), STANDARD));
        current = turn.battle;
        winner = turn.winner;
        turns++;
      }
      const loser = winner === 'P1' ? 'P2' : 'P1';
      const sunk = current.boards[loser].shots.filter((shot) => shot.outcome === 'SUNK');
      expect(sunk.map((shot) => shot.sunkShip?.type).sort()).toEqual(
        current.boards[loser].ships.map((placed) => placed.type).sort(),
      );
      expect(turns).toBe(current.boards.P1.shots.length + current.boards.P2.shots.length);
    });
  });
});

describe('randomTargets', () => {
  it('never picks a cell shot before, over many seeds', () => {
    const earlier = Array.from({ length: 60 }, (_, index) => miss(index % BOARD_SIZE, Math.floor(index / 10)));
    const before = battle(earlier);
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const targets = randomTargets(before, 5, createSeededRng(seed));
      expect(validateTargets(targets, earlier, 5)).toEqual({ ok: true });
    }
  });

  it('picks the last unshot cell when only one is left', () => {
    const earlier = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) =>
      miss(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE)),
    ).filter(({ coordinate }) => !(coordinate.x === 4 && coordinate.y === 7));
    expect(randomTargets(battle(earlier), 1, createSeededRng(1))).toEqual([cell(4, 7)]);
  });

  it('aims at the opponent of the current turn', () => {
    const p2Turn: Battle = { ...battle([], [miss(0, 0)]), currentTurn: 'P2' };
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      expect(randomTargets(p2Turn, 1, createSeededRng(seed))).not.toContainEqual(cell(0, 0));
    }
  });

  it('gives the same targets for the same seed', () => {
    expect(randomTargets(battle(), 3, createSeededRng(42))).toEqual(randomTargets(battle(), 3, createSeededRng(42)));
  });

  it('reaches every unshot cell', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 2_000; seed++) {
      const [target] = randomTargets(battle(), 1, createSeededRng(seed));
      seen.add(`${String(target?.x)},${String(target?.y)}`);
    }
    expect(seen.size).toBe(BOARD_SIZE * BOARD_SIZE);
  });

  it('returns nothing for a count of zero', () => {
    expect(randomTargets(battle(), 0, createSeededRng(1))).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN, 2])('throws a RangeError for a count of %s when one cell is left', (count) => {
    const earlier = Array.from({ length: BOARD_SIZE * BOARD_SIZE - 1 }, (_, index) =>
      miss(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE)),
    );
    expect(() => randomTargets(battle(earlier), count, createSeededRng(1))).toThrow(RangeError);
  });

  it('never mutates the battle', () => {
    const before = deepFreeze(battle([miss(2, 2)]));
    randomTargets(before, 4, createSeededRng(3));
    expect(before).toEqual(battle([miss(2, 2)]));
  });
});
