// Shot engine: shot allowance, target validation, turn resolution and auto shots (docs/domain.md#shot-engine,
// ADR-0033, ADR-0034).

import { BOARD_SIZE } from './constants.js';
import { isOnBoard, toCellIndex } from './grid.js';
import type { Rng } from './random.js';
import { SEATS, SHOT_OUTCOMES } from './types.js';
import type { Coordinate, GameRules, PlacedShip, Seat, ShotResult } from './types.js';

/** One player's side of a match: their fleet and every shot the opponent has fired at it (ADR-0034). */
export interface Board {
  /** The fleet as placed; the engine never changes it. */
  readonly ships: readonly PlacedShip[];
  /**
   * Every shot fired at this board, oldest first, each cell at most once. The board's owner sees it as
   * `incomingShots`, the opponent as `outgoingShots`. Hits and sinks are derived from the coordinates, not read from
   * the stored outcomes.
   */
  readonly shots: readonly ShotResult[];
}

/** What the shot engine reads and returns during `IN_PROGRESS`: both boards and whose turn it is. */
export interface Battle {
  /** Each seat's own board: its fleet and the shots the other seat fired at it. */
  readonly boards: Readonly<Record<Seat, Board>>;
  /** The seat that fires next. */
  readonly currentTurn: Seat;
}

/**
 * Constraints a turn's targets can break, checked in this order: `WRONG_TARGET_COUNT` for the whole list, then per
 * target in input order `OUT_OF_BOUNDS`, `DUPLICATE_TARGET` and `ALREADY_TARGETED`.
 */
export const TARGET_VIOLATIONS = {
  /** Not exactly the allowed count. */
  WRONG_TARGET_COUNT: 'WRONG_TARGET_COUNT',
  /** A target lies off the board. */
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
  /** The same cell twice in the turn. */
  DUPLICATE_TARGET: 'DUPLICATE_TARGET',
  /** A cell shot in an earlier turn. */
  ALREADY_TARGETED: 'ALREADY_TARGETED',
} as const;

/** One of the `TARGET_VIOLATIONS`. */
export type TargetViolation = (typeof TARGET_VIOLATIONS)[keyof typeof TARGET_VIOLATIONS];

/** A turn whose targets were valid and have been fired. */
export interface ResolvedTurn {
  /** Discriminant: the targets were valid. */
  readonly ok: true;
  /** One result per target, in firing order: the `results` of `SHOT_RESOLVED`. */
  readonly results: readonly ShotResult[];
  /**
   * The battle after the turn: `results` appended to the opponent's board and `currentTurn` set to the seat that fires
   * next. When `winner` is set there is no next turn and `currentTurn` stays the shooter's.
   */
  readonly battle: Battle;
  /** The shooter when this turn sank the opponent's last ship (`FLEET_DESTROYED`); `null` while the match goes on. */
  readonly winner: Seat | null;
}

/** Targets that may be fired as they are. */
export interface ValidTargets {
  /** Discriminant: every constraint holds. */
  readonly ok: true;
}

/** Targets the server rejects with `INVALID_TARGETS`, battle unchanged; the details are for tests and logs. */
export interface InvalidTargets {
  /** Discriminant: at least one constraint is broken. */
  readonly ok: false;
  /** The first constraint broken. */
  readonly reason: TargetViolation;
  /**
   * Input index of the first target that breaks `reason`; for `DUPLICATE_TARGET` the later of the two. `null` for
   * `WRONG_TARGET_COUNT`, which no single target causes.
   */
  readonly targetIndex: number | null;
}

/** Outcome of `validateTargets`. */
export type TargetValidation = ValidTargets | InvalidTargets;

/** Outcome of `resolveTurn`: the fired turn, or why its targets were refused. */
export type TurnResolution = ResolvedTurn | InvalidTargets;

/** Targets a standard-mode turn fires. */
const STANDARD_SHOTS_PER_TURN = 1;

/**
 * Counts the targets the current turn must fire (docs/domain.md#shot-engine): 1 in standard mode. Salvo mode,
 * `min(shooter's surviving ships, opponent's unshot cells)`, lands with #32; the signature already takes the battle it
 * needs.
 * @param _battle The battle before the turn; only salvo mode will read it, hence the underscore until #32.
 * @param rules The room's rules; `isSalvoModeEnabled` picks the mode.
 * @returns The exact number of targets `resolveTurn` accepts, also sent as `shotsAllowed` in the snapshot.
 * @throws When `rules.isSalvoModeEnabled` is true, until salvo mode is implemented (#32).
 */
export function shotsAllowed(_battle: Battle, rules: GameRules): number {
  if (rules.isSalvoModeEnabled) {
    throw new Error('Salvo mode is not implemented yet (#32)');
  }
  return STANDARD_SHOTS_PER_TURN;
}

/**
 * Checks a turn's targets against the shot engine's constraints, in the order `TargetViolation` lists: exactly `count`
 * of them, each a cell of the board, distinct, and never shot before. The payload guard of `FIRE` checks only their
 * shape (ADR-0031); these constraints depend on the turn, and the server maps a failure to `INVALID_TARGETS`. Needs no
 * ships, so the client can run it on its `outgoingShots` before firing.
 * @param targets The cells to fire at, in firing order.
 * @param shots The shots already fired at the target board, in any order.
 * @param count The exact number of targets the turn fires, normally `shotsAllowed(battle, rules)`.
 * @returns `ok: true`, or the first constraint broken and the target that broke it.
 * @example
 * validateTargets([{ x: 3, y: 3 }, { x: 3, y: 3 }], [], 2);
 * // { ok: false, reason: 'DUPLICATE_TARGET', targetIndex: 1 }
 */
export function validateTargets(
  targets: readonly Coordinate[],
  shots: readonly ShotResult[],
  count: number,
): TargetValidation {
  if (targets.length !== count) {
    return { ok: false, reason: TARGET_VIOLATIONS.WRONG_TARGET_COUNT, targetIndex: null };
  }
  const shotCells = new Set(shots.map((shot) => toCellIndex(shot.coordinate)));
  const turnCells = new Set<number>();
  for (const [targetIndex, target] of targets.entries()) {
    if (!isOnBoard(target)) {
      return { ok: false, reason: TARGET_VIOLATIONS.OUT_OF_BOUNDS, targetIndex };
    }
    const index = toCellIndex(target);
    if (turnCells.has(index)) {
      return { ok: false, reason: TARGET_VIOLATIONS.DUPLICATE_TARGET, targetIndex };
    }
    if (shotCells.has(index)) {
      return { ok: false, reason: TARGET_VIOLATIONS.ALREADY_TARGETED, targetIndex };
    }
    turnCells.add(index);
  }
  return { ok: true };
}

/**
 * Fires one turn for `battle.currentTurn` at the opponent's board (ADR-0033), after `validateTargets` with
 * `shotsAllowed` as the count. Valid targets resolve in input order, each one seeing the hits of the targets before
 * it: a hit that leaves a ship with no intact cell is `SUNK` and carries the whole ship. Victory is checked once, after
 * the last target. The shooter fires again when `isExtraTurnOnHitEnabled` is on in standard mode and any target hit;
 * otherwise the turn passes to the opponent. Pure: the input is never mutated, and the new battle shares the parts the
 * turn left unchanged.
 * @param battle The battle before the turn; `currentTurn` is the shooter.
 * @param targets The cells to fire at, in firing order.
 * @param rules The room's rules; `isSalvoModeEnabled` and `isExtraTurnOnHitEnabled` matter.
 * @returns The results, the battle after the turn and the winner, or the first constraint broken and the target that
 * broke it.
 * @throws When `rules.isSalvoModeEnabled` is true, until salvo mode is implemented (#32).
 * @example
 * const turn = resolveTurn(battle, [{ x: 4, y: 0 }], DEFAULT_RULES);
 * // { ok: true, results: [{ coordinate: { x: 4, y: 0 }, outcome: 'MISS' }], battle: { …, currentTurn: 'P2' },
 * //   winner: null } when P1 fires at an empty cell
 */
export function resolveTurn(battle: Battle, targets: readonly Coordinate[], rules: GameRules): TurnResolution {
  const shooter = battle.currentTurn;
  const opponent = otherSeat(shooter);
  const board = battle.boards[opponent];
  const validation = validateTargets(targets, board.shots, shotsAllowed(battle, rules));
  if (!validation.ok) {
    return validation;
  }

  const shotCells = new Set(board.shots.map((shot) => toCellIndex(shot.coordinate)));
  const shipAtCell = new Map<number, PlacedShip>();
  for (const ship of board.ships) {
    for (const cell of ship.coordinates) {
      shipAtCell.set(toCellIndex(cell), ship);
    }
  }
  const isSunk = (ship: PlacedShip): boolean => ship.coordinates.every((cell) => shotCells.has(toCellIndex(cell)));

  const results = targets.map(({ x, y }): ShotResult => {
    const coordinate = { x, y };
    const index = toCellIndex(coordinate);
    shotCells.add(index);
    const ship = shipAtCell.get(index);
    if (ship === undefined) {
      return { coordinate, outcome: SHOT_OUTCOMES.MISS };
    }
    return isSunk(ship)
      ? { coordinate, outcome: SHOT_OUTCOMES.SUNK, sunkShip: ship }
      : { coordinate, outcome: SHOT_OUTCOMES.HIT };
  });

  const winner = board.ships.every(isSunk) ? shooter : null;
  const isExtraTurnEarned =
    rules.isExtraTurnOnHitEnabled &&
    !rules.isSalvoModeEnabled &&
    results.some((result) => result.outcome !== SHOT_OUTCOMES.MISS);
  const nextBoard: Board = { ships: board.ships, shots: [...board.shots, ...results] };
  return {
    ok: true,
    results,
    battle: {
      boards: { ...battle.boards, [opponent]: nextBoard },
      currentTurn: winner !== null || isExtraTurnEarned ? shooter : opponent,
    },
    winner,
  };
}

/**
 * Picks auto-shot targets for `battle.currentTurn`: distinct cells of the opponent's board never shot before, uniformly
 * at random (every set of `count` cells, in every order, is equally likely). No hunting: earlier hits do not steer the
 * choice. The result passes `resolveTurn` when `count` is `shotsAllowed`.
 * @param battle The battle before the turn; `currentTurn` is the shooter.
 * @param count How many targets to pick, normally `shotsAllowed(battle, rules)`.
 * @param rng Source of the draw; the same battle and seed give the same targets.
 * @returns `count` new coordinates, in firing order.
 * @throws `RangeError` when `count` is not an integer from 0 to the number of unshot cells.
 * @example
 * resolveTurn(battle, randomTargets(battle, shotsAllowed(battle, rules), rng), rules);
 */
export function randomTargets(battle: Battle, count: number, rng: Rng): Coordinate[] {
  const board = battle.boards[otherSeat(battle.currentTurn)];
  const shotCells = new Set(board.shots.map((shot) => toCellIndex(shot.coordinate)));
  const unshotCells: Coordinate[] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (!shotCells.has(toCellIndex({ x, y }))) {
        unshotCells.push({ x, y });
      }
    }
  }
  if (!Number.isInteger(count) || count < 0 || count > unshotCells.length) {
    throw new RangeError(
      `Invalid target count: ${String(count)} (expected an integer from 0 to ${String(unshotCells.length)})`,
    );
  }
  return rng.shuffle(unshotCells).slice(0, count);
}

/**
 * Names the seat across the board.
 * @param seat Either seat.
 * @returns `P2` for `P1` and `P1` for `P2`.
 */
function otherSeat(seat: Seat): Seat {
  return seat === SEATS.P1 ? SEATS.P2 : SEATS.P1;
}
