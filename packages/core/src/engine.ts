// Shot engine: the starting dice roll, shot allowance, target validation, turn resolution and auto shots
// (docs/domain.md#shot-engine, ADR-0002, ADR-0033, ADR-0034, ADR-0112, ADR-0113).

import { BOARD_SIZE } from './constants.js';
import { CELL_COUNT, isOnBoard, toCellIndex } from './grid.js';
import type { DiceRoll, DiceRolledPayload } from './protocol.js';
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

/** Faces of the starting die: each roll is 1 to 6 (ADR-0002). */
const DIE_FACES = 6;

/**
 * Rolls for the first turn (docs/domain.md#shot-engine, ADR-0002): a d6 per seat, `P1`'s first, rolled again as long as
 * both show the same face. Ends after one round five times in six; a generator that kept giving ties would never end,
 * which neither `createSeededRng` nor `createCryptoRng` does.
 * @param rng The source of every face; two draws per round, so the same seed gives the same rounds.
 * @returns Every round in order, the ties first, and the seat with the higher face in the last one, which fires first.
 * @example
 * const { rolls, starter } = rollDice(createSeededRng(1)); // [{ P1: 5, P2: 5 }, { P1: 6, P2: 4 }], 'P1'
 */
export function rollDice(rng: Rng): DiceRolledPayload {
  const rolls: DiceRoll[] = [];
  let roll: DiceRoll;
  do {
    roll = { P1: rng.nextInt(DIE_FACES) + 1, P2: rng.nextInt(DIE_FACES) + 1 };
    rolls.push(roll);
  } while (roll.P1 === roll.P2);
  return { rolls, starter: roll.P1 > roll.P2 ? SEATS.P1 : SEATS.P2 };
}

/**
 * Counts the targets the current turn must fire (docs/domain.md#shot-engine, ADR-0112): 1 in standard mode; in salvo
 * mode `min(shooter's surviving ships, opponent's unshot cells)`, for the shooter `battle.currentTurn` whoever asks. The
 * cap keeps the count within what `randomTargets` can pick, so an auto shot near the end of a match never throws. While
 * the match goes on both counts are at least 1: the shooter has a ship afloat, and that opponent ship has an unshot cell.
 * @param battle The battle before the turn; salvo mode reads the shooter's fleet and the shots on the opponent's board.
 * @param rules The room's rules; `isSalvoModeEnabled` picks the mode.
 * @returns The exact number of targets `resolveTurn` accepts, also sent as `shotsAllowed` in the snapshot to both seats.
 * @example
 * shotsAllowed(battle, { ...DEFAULT_RULES, isSalvoModeEnabled: true }); // 5 on the first turn, 3 once two of the
 * // shooter's ships are sunk, 2 when the opponent's board has only two unshot cells left
 */
export function shotsAllowed(battle: Battle, rules: GameRules): number {
  if (!rules.isSalvoModeEnabled) {
    return STANDARD_SHOTS_PER_TURN;
  }
  const shooter = battle.currentTurn;
  const unshotCells = CELL_COUNT - shotCellIndices(battle.boards[otherSeat(shooter)].shots).size;
  return Math.min(countSurvivingShips(battle.boards[shooter]), unshotCells);
}

/**
 * Counts the ships of a board's fleet that still have an intact cell (docs/domain.md#shot-engine): what salvo mode
 * allows its owner to fire, and zero once the fleet is destroyed (`FLEET_DESTROYED`). Sinks are derived from the shot
 * coordinates, never from the stored outcomes (ADR-0034).
 * @param board A fleet and the shots fired at it.
 * @returns From 0 to the number of ships in the fleet.
 * @example
 * countSurvivingShips({ ships: fleet, shots: [] }); // 5 for a whole fleet
 */
export function countSurvivingShips(board: Board): number {
  const shotCells = shotCellIndices(board.shots);
  return board.ships.filter((ship) => !isShipSunk(ship, shotCells)).length;
}

/**
 * Tells whether a ship has no intact cell: the one definition of a sunk ship, which `resolveTurn` (per target and for
 * the winner) and `shotsAllowed` (through `countSurvivingShips`) share.
 * @param ship A placed ship.
 * @param shotCells The `toCellIndex` of every cell shot on the ship's board.
 * @returns True when every cell of the ship is in `shotCells`.
 */
function isShipSunk(ship: PlacedShip, shotCells: ReadonlySet<number>): boolean {
  return ship.coordinates.every((cell) => shotCells.has(toCellIndex(cell)));
}

/**
 * Collects the cells a list of shots has hit or missed.
 * @param shots Shots fired at one board, in any order.
 * @returns The `toCellIndex` of each shot's cell, each once.
 */
function shotCellIndices(shots: readonly ShotResult[]): Set<number> {
  return new Set(shots.map((shot) => toCellIndex(shot.coordinate)));
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
  const shotCells = shotCellIndices(shots);
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
 * it: a hit that leaves a ship with no intact cell is `SUNK` and carries the whole ship. Every target resolves, even
 * after a salvo has sunk the last ship, and victory is checked once, after the last target (ADR-0113). The shooter
 * fires again when `isExtraTurnOnHitEnabled` is on in standard mode and any target hit; otherwise the turn passes to
 * the opponent. Pure: the input is never mutated, and the new battle shares the parts the turn left unchanged.
 * @param battle The battle before the turn; `currentTurn` is the shooter.
 * @param targets The cells to fire at, in firing order.
 * @param rules The room's rules; `isSalvoModeEnabled` and `isExtraTurnOnHitEnabled` matter.
 * @returns The results, one per target, the battle after the turn and the winner, or the first constraint broken and
 * the target that broke it.
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

  const shotCells = shotCellIndices(board.shots);
  const shipAtCell = new Map<number, PlacedShip>();
  for (const ship of board.ships) {
    for (const cell of ship.coordinates) {
      shipAtCell.set(toCellIndex(cell), ship);
    }
  }

  const results = targets.map(({ x, y }): ShotResult => {
    const coordinate = { x, y };
    const index = toCellIndex(coordinate);
    shotCells.add(index);
    const ship = shipAtCell.get(index);
    if (ship === undefined) {
      return { coordinate, outcome: SHOT_OUTCOMES.MISS };
    }
    return isShipSunk(ship, shotCells)
      ? { coordinate, outcome: SHOT_OUTCOMES.SUNK, sunkShip: ship }
      : { coordinate, outcome: SHOT_OUTCOMES.HIT };
  });

  const nextBoard: Board = { ships: board.ships, shots: [...board.shots, ...results] };
  const winner = countSurvivingShips(nextBoard) === 0 ? shooter : null;
  const isExtraTurnEarned =
    rules.isExtraTurnOnHitEnabled &&
    !rules.isSalvoModeEnabled &&
    results.some((result) => result.outcome !== SHOT_OUTCOMES.MISS);
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
 * @param excluded Cells to leave out besides those already shot, such as the draft targets an auto shot keeps
 * (`autoShotTargets`); none by default.
 * @returns `count` new coordinates, in firing order.
 * @throws `RangeError` when `count` is not an integer from 0 to the number of cells left to pick from.
 * @example
 * resolveTurn(battle, randomTargets(battle, shotsAllowed(battle, rules), rng), rules);
 */
export function randomTargets(
  battle: Battle,
  count: number,
  rng: Rng,
  excluded: readonly Coordinate[] = [],
): Coordinate[] {
  const board = battle.boards[otherSeat(battle.currentTurn)];
  const takenCells = new Set([...board.shots.map((shot) => shot.coordinate), ...excluded].map(toCellIndex));
  const freeCells: Coordinate[] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (!takenCells.has(toCellIndex({ x, y }))) {
        freeCells.push({ x, y });
      }
    }
  }
  if (!Number.isInteger(count) || count < 0 || count > freeCells.length) {
    throw new RangeError(
      `Invalid target count: ${String(count)} (expected an integer from 0 to ${String(freeCells.length)})`,
    );
  }
  return rng.shuffle(freeCells).slice(0, count);
}

/**
 * Picks the targets of a turn that ran out of time with the `AUTO_RANDOM_SHOT` timeout action
 * (docs/domain.md#shot-engine): the draft's targets that are still valid, in draft order, then random ones from
 * `randomTargets` for the rest. A target is kept when it is on the board, never shot and not already kept, up to
 * `count`; the others are dropped. The result passes `resolveTurn` when `count` is `shotsAllowed`.
 * @param battle The battle before the turn; `currentTurn` is the shooter.
 * @param draft The shooter's draft targets, as the room stored them; any list is safe.
 * @param count How many targets the turn fires, normally `shotsAllowed(battle, rules)`.
 * @param rng Source of the random targets; drawn from even when the draft fills the turn. The same draft and seed give
 * the same draws, after it too.
 * @returns `count` coordinates, the kept draft targets first.
 * @throws `RangeError` when `count` is not an integer from 0 to the number of unshot cells.
 * @example
 * autoShotTargets(battle, [{ x: 3, y: 3 }], 1, rng); // [{ x: 3, y: 3 }] when C4 was never shot
 */
export function autoShotTargets(battle: Battle, draft: readonly Coordinate[], count: number, rng: Rng): Coordinate[] {
  const shots = battle.boards[otherSeat(battle.currentTurn)].shots;
  const kept: Coordinate[] = [];
  for (const target of draft) {
    if (kept.length < count && validateTargets([...kept, target], shots, kept.length + 1).ok) {
      kept.push({ x: target.x, y: target.y });
    }
  }
  return [...kept, ...randomTargets(battle, count - kept.length, rng, kept)];
}

/**
 * Names the seat across the table, whose board and fleet the turn logic and the snapshot projection read.
 * @param seat Either seat.
 * @returns `P2` for `P1` and `P1` for `P2`.
 */
export function otherSeat(seat: Seat): Seat {
  return seat === SEATS.P1 ? SEATS.P2 : SEATS.P1;
}
