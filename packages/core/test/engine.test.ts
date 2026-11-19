import { describe, expect, it } from 'vitest';

import {
  BOARD_SIZE,
  createSeededRng,
  DEFAULT_RULES,
  ORIENTATIONS,
  autoShotTargets,
  countSurvivingShips,
  otherSeat,
  randomTargets,
  resolveTurn,
  rollDice,
  SEATS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  shotsAllowed,
  TARGET_VIOLATIONS,
  toCellIndex,
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
/** Refused by `validateRules` (ADR-0010), but `resolveTurn` must still never grant the extra turn in salvo mode. */
const SALVO_WITH_EXTRA_TURN: GameRules = { ...SALVO, isExtraTurnOnHitEnabled: true };
const SEED_COUNT = 200;

function ship(type: ShipType, x: number, y: number, orientation: Orientation = ORIENTATIONS.HORIZONTAL): PlacedShip {
  return toPlacedShip({ type, start: { x, y }, orientation });
}

function cell(x: number, y: number): Coordinate {
  return { x, y };
}

function miss(x: number, y: number): ShotResult {
  return { coordinate: cell(x, y), outcome: SHOT_OUTCOMES.MISS };
}

function hit(x: number, y: number): ShotResult {
  return { coordinate: cell(x, y), outcome: SHOT_OUTCOMES.HIT };
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
  ship(SHIP_TYPES.CARRIER, 0, 0),
  ship(SHIP_TYPES.BATTLESHIP, 0, 2),
  ship(SHIP_TYPES.CRUISER, 0, 4),
  ship(SHIP_TYPES.SUBMARINE, 0, 6),
  ship(SHIP_TYPES.DESTROYER, 0, 8),
];

/** P1's fleet; P1 always shoots first in these tests, so it is only there to make the battle complete. */
const SHOOTER_FLEET: readonly PlacedShip[] = [
  ship(SHIP_TYPES.CARRIER, 5, 0, ORIENTATIONS.VERTICAL),
  ship(SHIP_TYPES.BATTLESHIP, 7, 0, ORIENTATIONS.VERTICAL),
  ship(SHIP_TYPES.CRUISER, 9, 0, ORIENTATIONS.VERTICAL),
  ship(SHIP_TYPES.SUBMARINE, 5, 7),
  ship(SHIP_TYPES.DESTROYER, 9, 5, ORIENTATIONS.VERTICAL),
];

/** Shots that hit every cell of `TARGET_FLEET` but the last cell of the destroyer at (1, 8). */
const ALL_BUT_ONE_HIT: readonly ShotResult[] = TARGET_FLEET.flatMap((placed) => placed.coordinates)
  .filter(({ x, y }) => !(x === 1 && y === 8))
  .map(({ x, y }) => hit(x, y));

/** Shots at P1's board that sink the first `count` ships of `SHOOTER_FLEET`, the carrier first, and nothing else. */
function sinkingShooterShips(count: number): ShotResult[] {
  return SHOOTER_FLEET.slice(0, count)
    .flatMap((placed) => placed.coordinates)
    .map(({ x, y }) => hit(x, y));
}

/** Shots at every cell of P2's board but `unshot`: hits on `TARGET_FLEET`, misses elsewhere, row by row. */
function everyCellBut(...unshot: readonly Coordinate[]): ShotResult[] {
  const shipCells = new Set(TARGET_FLEET.flatMap((placed) => placed.coordinates).map(toCellIndex));
  const unshotCells = new Set(unshot.map(toCellIndex));
  const shots: ShotResult[] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const index = toCellIndex(cell(x, y));
      if (!unshotCells.has(index)) {
        shots.push(shipCells.has(index) ? hit(x, y) : miss(x, y));
      }
    }
  }
  return shots;
}

/** A battle where P1 fires at `TARGET_FLEET` with the given shots already on it. */
function battle(targetShots: readonly ShotResult[] = [], shooterShots: readonly ShotResult[] = []): Battle {
  return {
    boards: {
      P1: { ships: SHOOTER_FLEET, shots: shooterShots },
      P2: { ships: TARGET_FLEET, shots: targetShots },
    },
    currentTurn: SEATS.P1,
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

  it('allows one target in standard mode whatever the shooter has lost', () => {
    expect(shotsAllowed(battle([], sinkingShooterShips(4)), STANDARD)).toBe(1);
  });

  describe('salvo mode (ADR-0112)', () => {
    it.each([0, 1, 2, 3, 4])(
      "allows one target per surviving ship of the shooter, with %i of the shooter's ships sunk",
      (sunkCount) => {
        expect(shotsAllowed(battle([], sinkingShooterShips(sunkCount)), SALVO)).toBe(5 - sunkCount);
      },
    );

    it('counts a ship hit but not sunk as surviving', () => {
      const allButLastCell = SHOOTER_FLEET.flatMap((placed) => placed.coordinates.slice(0, -1)).map(({ x, y }) =>
        hit(x, y),
      );
      expect(shotsAllowed(battle([], allButLastCell), SALVO)).toBe(5);
    });

    it("reads the fleet of the seat whose turn it is, not P1's", () => {
      const p2Turn: Battle = { ...battle(ALL_BUT_ONE_HIT.slice(5)), currentTurn: SEATS.P2 };
      // P2's own fleet keeps the carrier (its 5 cells are left out) and the destroyer; P1's fleet is whole.
      expect(shotsAllowed(p2Turn, SALVO)).toBe(2);
      expect(shotsAllowed({ ...p2Turn, currentTurn: SEATS.P1 }, SALVO)).toBe(5);
    });

    it("caps the allowance by the opponent's unshot cells", () => {
      // P1 has 3 ships left; P2's board has 2 unshot cells, one of them the destroyer's last.
      const nearlyFull = battle(everyCellBut(cell(1, 8), cell(9, 9)), sinkingShooterShips(2));
      expect(shotsAllowed(nearlyFull, SALVO)).toBe(2);
      expect(shotsAllowed(battle(everyCellBut(cell(1, 8)), sinkingShooterShips(2)), SALVO)).toBe(1);
    });

    it('is not capped while the unshot cells outnumber the surviving ships', () => {
      const cells = [cell(1, 8), cell(9, 9), cell(8, 9), cell(7, 9)];
      expect(shotsAllowed(battle(everyCellBut(...cells), sinkingShooterShips(2)), SALVO)).toBe(3);
    });

    it('derives the sunk ships from the coordinates, not from the stored outcomes', () => {
      const recordedAsMisses = SHOOTER_FLEET.slice(0, 2)
        .flatMap((placed) => placed.coordinates)
        .map(({ x, y }) => miss(x, y));
      expect(shotsAllowed(battle([], recordedAsMisses), SALVO)).toBe(3);
    });

    it('never mutates the battle', () => {
      const before = deepFreeze(battle([hit(0, 0)], sinkingShooterShips(1)));
      expect(shotsAllowed(before, SALVO)).toBe(4);
      expect(before).toEqual(battle([hit(0, 0)], sinkingShooterShips(1)));
    });
  });
});

describe('countSurvivingShips', () => {
  it('counts a whole fleet', () => {
    expect(countSurvivingShips({ ships: TARGET_FLEET, shots: [] })).toBe(5);
  });

  it('leaves out each sunk ship, and only those', () => {
    expect(countSurvivingShips({ ships: TARGET_FLEET, shots: ALL_BUT_ONE_HIT })).toBe(1);
    expect(countSurvivingShips({ ships: SHOOTER_FLEET, shots: sinkingShooterShips(3) })).toBe(2);
  });

  it('reaches zero once the fleet is destroyed', () => {
    expect(countSurvivingShips({ ships: TARGET_FLEET, shots: [...ALL_BUT_ONE_HIT, hit(1, 8)] })).toBe(0);
  });

  it('ignores misses and shots at other cells', () => {
    expect(countSurvivingShips({ ships: TARGET_FLEET, shots: [miss(9, 9), hit(0, 0), hit(1, 0)] })).toBe(5);
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
      reason: TARGET_VIOLATIONS.WRONG_TARGET_COUNT,
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
      reason: TARGET_VIOLATIONS.OUT_OF_BOUNDS,
      targetIndex: 1,
    });
  });

  it('rejects a cell targeted twice in the same turn, pointing at the second', () => {
    expect(validateTargets([cell(3, 3), cell(4, 4), cell(3, 3)], [], 3)).toEqual({
      ok: false,
      reason: TARGET_VIOLATIONS.DUPLICATE_TARGET,
      targetIndex: 2,
    });
  });

  it.each([
    ['a miss', miss(6, 6)],
    ['a hit', hit(6, 6)],
  ])('rejects a cell shot in an earlier turn (%s)', (_name, earlier) => {
    expect(validateTargets([cell(0, 0), cell(6, 6)], [earlier], 2)).toEqual({
      ok: false,
      reason: TARGET_VIOLATIONS.ALREADY_TARGETED,
      targetIndex: 1,
    });
  });

  it('reports the first broken constraint in input order', () => {
    const targets = [cell(1, 1), cell(1, 1), cell(BOARD_SIZE, 0)];
    expect(validateTargets(targets, [miss(1, 1)], 3)).toEqual({
      ok: false,
      reason: TARGET_VIOLATIONS.ALREADY_TARGETED,
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
      expect(turn.battle.currentTurn).toBe(SEATS.P2);
    });

    it('hits a ship that still has intact cells', () => {
      const turn = fired(resolveTurn(battle(), [cell(2, 0)], STANDARD));
      expect(turn.results).toEqual([hit(2, 0)]);
      expect(turn.results[0]).not.toHaveProperty('sunkShip');
    });

    it('reports the whole ship when the shot sinks it', () => {
      const turn = fired(resolveTurn(battle([hit(0, 4), miss(3, 4), hit(2, 4)]), [cell(1, 4)], STANDARD));
      expect(turn.results).toEqual([
        { coordinate: cell(1, 4), outcome: SHOT_OUTCOMES.SUNK, sunkShip: TARGET_FLEET[2] },
      ]);
      expect(turn.winner).toBeNull();
      expect(turn.battle.currentTurn).toBe(SEATS.P2);
    });

    it('derives hits from the coordinates, not from the stored outcomes', () => {
      const turn = fired(resolveTurn(battle([miss(0, 8)]), [cell(1, 8)], STANDARD));
      expect(turn.results[0]?.outcome).toBe(SHOT_OUTCOMES.SUNK);
    });

    it('rejects a repeated shot and leaves the battle unchanged', () => {
      const before = deepFreeze(battle([miss(9, 9)]));
      expect(resolveTurn(before, [cell(9, 9)], STANDARD)).toEqual({
        ok: false,
        reason: TARGET_VIOLATIONS.ALREADY_TARGETED,
        targetIndex: 0,
      });
      expect(before).toEqual(battle([miss(9, 9)]));
    });

    it.each([
      ['no target', []],
      ['two targets', [cell(9, 9), cell(9, 8)]],
    ])('rejects %s in standard mode', (_name, targets) => {
      expect(resolveTurn(battle(), targets, STANDARD)).toMatchObject({
        ok: false,
        reason: TARGET_VIOLATIONS.WRONG_TARGET_COUNT,
      });
    });

    it('rejects a target off the board', () => {
      expect(resolveTurn(battle(), [cell(0, BOARD_SIZE)], STANDARD)).toEqual({
        ok: false,
        reason: TARGET_VIOLATIONS.OUT_OF_BOUNDS,
        targetIndex: 0,
      });
    });
  });

  describe('salvo mode', () => {
    /** A salvo of `count` targets for P1: `sinkingShooterShips` leaves P1 with that many ships afloat. */
    function salvoBattle(count: number, targetShots: readonly ShotResult[] = []): Battle {
      return battle(targetShots, sinkingShooterShips(5 - count));
    }

    it('fires a whole first salvo, one target per ship', () => {
      const targets = [cell(0, 0), cell(9, 9), cell(0, 8), cell(5, 5), cell(1, 8)];
      const turn = fired(resolveTurn(battle(), targets, SALVO));
      expect(turn.results).toEqual([
        hit(0, 0),
        miss(9, 9),
        hit(0, 8),
        miss(5, 5),
        { coordinate: cell(1, 8), outcome: SHOT_OUTCOMES.SUNK, sunkShip: TARGET_FLEET[4] },
      ]);
      expect(turn.battle.currentTurn).toBe(SEATS.P2);
      expect(turn.battle.boards.P2.shots).toEqual(turn.results);
      expect(turn.winner).toBeNull();
    });

    it.each([
      ['fewer', [cell(9, 9)]],
      ['more', [cell(9, 9), cell(8, 9), cell(7, 9), cell(6, 9), cell(5, 9), cell(4, 9)]],
    ])('rejects %s targets than the allowance with WRONG_TARGET_COUNT', (_name, targets) => {
      expect(resolveTurn(battle(), targets, SALVO)).toEqual({
        ok: false,
        reason: TARGET_VIOLATIONS.WRONG_TARGET_COUNT,
        targetIndex: null,
      });
    });

    it('fires as many targets as the shooter has ships left', () => {
      expect(resolveTurn(salvoBattle(2), [cell(9, 9), cell(8, 9)], SALVO).ok).toBe(true);
      expect(resolveTurn(salvoBattle(2), [cell(9, 9), cell(8, 9), cell(7, 9)], SALVO).ok).toBe(false);
    });

    it('rejects a cell twice in one salvo, pointing at the second', () => {
      expect(resolveTurn(salvoBattle(3), [cell(9, 9), cell(2, 2), cell(9, 9)], SALVO)).toEqual({
        ok: false,
        reason: TARGET_VIOLATIONS.DUPLICATE_TARGET,
        targetIndex: 2,
      });
    });

    it.each([
      ['in ship order', [cell(0, 8), cell(1, 8)]],
      ['in reverse order', [cell(1, 8), cell(0, 8)]],
    ])('hits then sinks a ship with two targets of the same salvo (%s)', (_name, targets) => {
      const turn = fired(resolveTurn(salvoBattle(2), targets, SALVO));
      const [first, second] = targets;
      expect(turn.results).toEqual([
        { coordinate: first, outcome: SHOT_OUTCOMES.HIT },
        { coordinate: second, outcome: SHOT_OUTCOMES.SUNK, sunkShip: TARGET_FLEET[4] },
      ]);
      expect(turn.winner).toBeNull();
    });

    it('sinks a ship hit in non-consecutive cells over earlier turns with a later salvo', () => {
      // P1 has 2 ships afloat, P2 all 5: the turns alternate a salvo of 2 and a salvo of 5.
      const p2Misses = (x: number) => [0, 1, 2, 3, 4].map((y) => cell(x, y));
      let turn = fired(resolveTurn(salvoBattle(2), [cell(0, 0), cell(2, 0)], SALVO));
      expect(turn.results).toEqual([hit(0, 0), hit(2, 0)]);
      expect(shotsAllowed(turn.battle, SALVO)).toBe(5);
      turn = fired(resolveTurn(turn.battle, p2Misses(0), SALVO));
      expect(shotsAllowed(turn.battle, SALVO)).toBe(2);
      turn = fired(resolveTurn(turn.battle, [cell(4, 0), cell(9, 9)], SALVO));
      expect(turn.results).toEqual([hit(4, 0), miss(9, 9)]);
      turn = fired(resolveTurn(turn.battle, p2Misses(1), SALVO));
      turn = fired(resolveTurn(turn.battle, [cell(3, 0), cell(1, 0)], SALVO));
      expect(turn.results).toEqual([
        hit(3, 0),
        { coordinate: cell(1, 0), outcome: SHOT_OUTCOMES.SUNK, sunkShip: TARGET_FLEET[0] },
      ]);
      expect(turn.battle.boards.P2.shots.map((shot) => shot.coordinate)).toEqual([
        cell(0, 0),
        cell(2, 0),
        cell(4, 0),
        cell(9, 9),
        cell(3, 0),
        cell(1, 0),
      ]);
    });

    it.each([
      ['first', [cell(1, 8), cell(9, 9), cell(8, 9)]],
      ['in the middle', [cell(9, 9), cell(1, 8), cell(8, 9)]],
      ['last', [cell(9, 9), cell(8, 9), cell(1, 8)]],
    ])('resolves every target when the last ship sinks %s, and the shooter wins (ADR-0113)', (_name, targets) => {
      const turn = fired(resolveTurn(salvoBattle(3, ALL_BUT_ONE_HIT), targets, SALVO));
      expect(turn.results).toHaveLength(3);
      expect(turn.results).toEqual(
        targets.map((target) =>
          target.x === 1 && target.y === 8
            ? { coordinate: target, outcome: SHOT_OUTCOMES.SUNK, sunkShip: TARGET_FLEET[4] }
            : { coordinate: target, outcome: SHOT_OUTCOMES.MISS },
        ),
      );
      expect(turn.winner).toBe(SEATS.P1);
      expect(turn.battle.currentTurn).toBe(SEATS.P1);
      expect(turn.battle.boards.P2.shots).toEqual([...ALL_BUT_ONE_HIT, ...turn.results]);
    });

    it('sinks two last ships in one salvo, winning once both are down', () => {
      // The cruiser and the destroyer are left, each one cell short.
      const twoLeft = ALL_BUT_ONE_HIT.filter(({ coordinate }) => !(coordinate.x === 2 && coordinate.y === 4));
      const turn = fired(resolveTurn(salvoBattle(2, twoLeft), [cell(2, 4), cell(1, 8)], SALVO));
      expect(turn.results.map((result) => result.sunkShip)).toEqual([TARGET_FLEET[2], TARGET_FLEET[4]]);
      expect(turn.winner).toBe(SEATS.P1);
    });

    it('goes on when a salvo sinks a ship but not the last', () => {
      const twoLeft = ALL_BUT_ONE_HIT.filter(({ coordinate }) => !(coordinate.x === 2 && coordinate.y === 4));
      const turn = fired(resolveTurn(salvoBattle(2, twoLeft), [cell(9, 9), cell(1, 8)], SALVO));
      expect(turn.results[1]?.outcome).toBe(SHOT_OUTCOMES.SUNK);
      expect(turn.winner).toBeNull();
      expect(turn.battle.currentTurn).toBe(SEATS.P2);
    });

    it('never gives an extra turn, even with extra turn on hit set', () => {
      const turn = fired(resolveTurn(salvoBattle(2), [cell(0, 0), cell(1, 0)], SALVO_WITH_EXTRA_TURN));
      expect(turn.results.every((result) => result.outcome === SHOT_OUTCOMES.HIT)).toBe(true);
      expect(turn.battle.currentTurn).toBe(SEATS.P2);
    });

    it("fires the opponent's last unshot cells when they are fewer than the shooter's ships", () => {
      const nearlyFull = battle(everyCellBut(cell(1, 8), cell(9, 9)), sinkingShooterShips(2));
      const turn = fired(resolveTurn(nearlyFull, [cell(9, 9), cell(1, 8)], SALVO));
      expect(turn.results.map((result) => result.outcome)).toEqual([SHOT_OUTCOMES.MISS, SHOT_OUTCOMES.SUNK]);
      expect(turn.winner).toBe(SEATS.P1);
    });
  });

  describe('victory', () => {
    it('ends the match when the last ship sinks', () => {
      const turn = fired(resolveTurn(battle(ALL_BUT_ONE_HIT), [cell(1, 8)], STANDARD));
      expect(turn.results).toEqual([
        { coordinate: cell(1, 8), outcome: SHOT_OUTCOMES.SUNK, sunkShip: TARGET_FLEET[4] },
      ]);
      expect(turn.winner).toBe(SEATS.P1);
      expect(turn.battle.currentTurn).toBe(SEATS.P1);
    });

    it('goes on while a ship is left', () => {
      const turn = fired(resolveTurn(battle(ALL_BUT_ONE_HIT.slice(1)), [cell(1, 8)], STANDARD));
      expect(turn.results[0]?.outcome).toBe(SHOT_OUTCOMES.SUNK);
      expect(turn.winner).toBeNull();
    });

    it('lets P2 win against P1', () => {
      const shooterHits = SHOOTER_FLEET.flatMap((placed) => placed.coordinates).map(({ x, y }) => hit(x, y));
      const [last, ...earlier] = shooterHits;
      const p2Turn: Battle = { ...battle([], earlier), currentTurn: SEATS.P2 };
      const turn = fired(resolveTurn(p2Turn, [last?.coordinate ?? cell(0, 0)], STANDARD));
      expect(turn.winner).toBe(SEATS.P2);
      expect(turn.battle.boards.P1.shots).toHaveLength(shooterHits.length);
    });
  });

  describe('next turn', () => {
    it.each([
      ['a hit', cell(2, 0)],
      ['a sink', cell(1, 8)],
    ])('gives the shooter another turn after %s with extra turn on', (_name, target) => {
      const turn = fired(resolveTurn(battle([hit(0, 8)]), [target], EXTRA_TURN));
      expect(turn.battle.currentTurn).toBe(SEATS.P1);
    });

    it('passes the turn after a miss with extra turn on', () => {
      expect(fired(resolveTurn(battle(), [cell(9, 9)], EXTRA_TURN)).battle.currentTurn).toBe(SEATS.P2);
    });

    it.each([
      ['a hit', cell(2, 0)],
      ['a miss', cell(9, 9)],
    ])('passes the turn after %s with extra turn off', (_name, target) => {
      expect(fired(resolveTurn(battle(), [target], STANDARD)).battle.currentTurn).toBe(SEATS.P2);
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

    it('plays a whole salvo match to the end, the allowance following the ships left', () => {
      for (let seed = 0; seed < SEED_COUNT; seed++) {
        const rng = createSeededRng(seed);
        let current: Battle = battle();
        let winner: Seat | null = null;
        while (winner === null) {
          const count = shotsAllowed(current, SALVO);
          const unshot = BOARD_SIZE * BOARD_SIZE - current.boards[otherSeat(current.currentTurn)].shots.length;
          expect(count).toBe(Math.min(countSurvivingShips(current.boards[current.currentTurn]), unshot));
          const turn = fired(resolveTurn(current, autoShotTargets(current, [], count, rng), SALVO));
          expect(turn.results).toHaveLength(count);
          current = turn.battle;
          winner = turn.winner;
        }
        const loser = winner === SEATS.P1 ? SEATS.P2 : SEATS.P1;
        expect(countSurvivingShips(current.boards[loser])).toBe(0);
        expect(countSurvivingShips(current.boards[winner])).toBeGreaterThan(0);
      }
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
      const loser = winner === SEATS.P1 ? SEATS.P2 : SEATS.P1;
      const sunk = current.boards[loser].shots.filter((shot) => shot.outcome === SHOT_OUTCOMES.SUNK);
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
    const p2Turn: Battle = { ...battle([], [miss(0, 0)]), currentTurn: SEATS.P2 };
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
  it('leaves out the excluded cells as well as the shot ones', () => {
    const earlier = Array.from({ length: BOARD_SIZE * BOARD_SIZE - 3 }, (_, index) =>
      miss(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE)),
    );
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      expect(randomTargets(battle(earlier), 1, createSeededRng(seed), [cell(7, 9), cell(8, 9)])).toEqual([cell(9, 9)]);
    }
    expect(() => randomTargets(battle(earlier), 2, createSeededRng(1), [cell(7, 9), cell(8, 9)])).toThrow(RangeError);
  });
});

describe('autoShotTargets', () => {
  it('fires a full draft as it is', () => {
    expect(autoShotTargets(battle(), [cell(3, 3)], 1, createSeededRng(1))).toEqual([cell(3, 3)]);
  });

  it('fills an empty draft with random unshot cells, as randomTargets picks them', () => {
    const before = battle([miss(4, 4)]);
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const targets = autoShotTargets(before, [], 1, createSeededRng(seed));
      expect(targets).toEqual(randomTargets(before, 1, createSeededRng(seed)));
      expect(validateTargets(targets, before.boards.P2.shots, 1)).toEqual({ ok: true });
    }
  });

  it('keeps a partial draft first and fills the rest with other unshot cells', () => {
    const before = battle([miss(4, 4)]);
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const targets = autoShotTargets(before, [cell(3, 3), cell(6, 1)], 5, createSeededRng(seed));
      expect(targets.slice(0, 2)).toEqual([cell(3, 3), cell(6, 1)]);
      expect(validateTargets(targets, before.boards.P2.shots, 5)).toEqual({ ok: true });
    }
  });

  it('drops the targets that broke a rule, and keeps the valid ones in draft order', () => {
    const before = battle([miss(4, 4)]);
    const draft = [cell(4, 4), cell(2, 2), cell(10, 0), cell(2, 2), cell(5, 5)];
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const targets = autoShotTargets(before, draft, 3, createSeededRng(seed));
      expect(targets.slice(0, 2)).toEqual([cell(2, 2), cell(5, 5)]);
      expect(validateTargets(targets, before.boards.P2.shots, 3)).toEqual({ ok: true });
    }
  });

  it('keeps no more draft targets than the turn fires', () => {
    expect(autoShotTargets(battle(), [cell(1, 1), cell(2, 2)], 1, createSeededRng(1))).toEqual([cell(1, 1)]);
  });

  it('fires the last unshot cell when the draft holds none', () => {
    const earlier = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) =>
      miss(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE)),
    ).filter(({ coordinate }) => !(coordinate.x === 4 && coordinate.y === 7));
    expect(autoShotTargets(battle(earlier), [cell(0, 0)], 1, createSeededRng(1))).toEqual([cell(4, 7)]);
  });

  it('gives targets resolveTurn accepts', () => {
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const targets = autoShotTargets(battle(ALL_BUT_ONE_HIT), [cell(0, 0)], 1, createSeededRng(seed));
      expect(resolveTurn(battle(ALL_BUT_ONE_HIT), targets, STANDARD).ok).toBe(true);
    }
  });

  it("fills a partial salvo draft up to the allowance, capped by the opponent's unshot cells", () => {
    const nearlyFull = battle(everyCellBut(cell(1, 8), cell(9, 9), cell(8, 9)), sinkingShooterShips(1));
    const count = shotsAllowed(nearlyFull, SALVO);
    expect(count).toBe(3);
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const targets = autoShotTargets(nearlyFull, [cell(8, 9)], count, createSeededRng(seed));
      expect(targets[0]).toEqual(cell(8, 9));
      expect(fired(resolveTurn(nearlyFull, targets, SALVO)).winner).toBe(SEATS.P1);
    }
  });

  it('never mutates the battle or the draft', () => {
    const before = deepFreeze(battle([miss(2, 2)]));
    const draft = deepFreeze([cell(3, 3)]);
    autoShotTargets(before, draft, 1, createSeededRng(3));
    expect(before).toEqual(battle([miss(2, 2)]));
    expect(draft).toEqual([cell(3, 3)]);
  });
});

describe('rollDice', () => {
  it('rolls again after a tie, and the higher face of the decisive round starts (seeded)', () => {
    expect(rollDice(createSeededRng(1))).toEqual({
      rolls: [
        { P1: 5, P2: 5 },
        { P1: 6, P2: 4 },
      ],
      starter: SEATS.P1,
    });
    expect(rollDice(createSeededRng(8))).toEqual({
      rolls: [
        { P1: 3, P2: 3 },
        { P1: 3, P2: 4 },
      ],
      starter: SEATS.P2,
    });
  });

  it('ends after one round without a tie, either seat starting', () => {
    expect(rollDice(createSeededRng(0))).toEqual({ rolls: [{ P1: 6, P2: 4 }], starter: SEATS.P1 });
    expect(rollDice(createSeededRng(5))).toEqual({ rolls: [{ P1: 1, P2: 3 }], starter: SEATS.P2 });
  });

  it("draws P1's face first, two draws a round", () => {
    const rng = createSeededRng(1);
    const faces = [rng.nextInt(6), rng.nextInt(6), rng.nextInt(6), rng.nextInt(6)].map((face) => face + 1);
    expect(rollDice(createSeededRng(1)).rolls).toEqual([
      { P1: faces[0], P2: faces[1] },
      { P1: faces[2], P2: faces[3] },
    ]);
  });

  it('keeps every face from 1 to 6, ties only before the last round, over many seeds', () => {
    const faces = new Set<number>();
    const starters = new Set<Seat>();
    let tieCount = 0;
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const { rolls, starter } = rollDice(createSeededRng(seed));
      const last = rolls.at(-1);
      expect(last?.P1).not.toBe(last?.P2);
      expect(starter).toBe((last?.P1 ?? 0) > (last?.P2 ?? 0) ? SEATS.P1 : SEATS.P2);
      for (const roll of rolls.slice(0, -1)) {
        expect(roll.P1).toBe(roll.P2);
        tieCount++;
      }
      for (const roll of rolls) {
        faces.add(roll.P1).add(roll.P2);
      }
      starters.add(starter);
    }
    expect([...faces].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(starters).toEqual(new Set([SEATS.P1, SEATS.P2]));
    expect(tieCount).toBeGreaterThan(0);
  });

  it('gives the same rounds for the same seed', () => {
    expect(rollDice(createSeededRng(42))).toEqual(rollDice(createSeededRng(42)));
  });
});
