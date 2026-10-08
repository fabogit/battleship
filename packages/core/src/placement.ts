// Fleet placement rules: derivation, validation, random generation and completion (docs/domain.md#placement, ADR-0032).

import { BOARD_SIZE } from './constants.js';
import { CELL_COUNT, isOnBoard, toCellIndex } from './grid.js';
import type { Rng } from './random.js';
import { FLEET, ORIENTATIONS, SHIP_LENGTH } from './types.js';
import type { Coordinate, GameRules, Orientation, PlacedShip, ShipPlacement, ShipType } from './types.js';

/**
 * Game rules a layout can break, checked per ship in this order: `OUT_OF_BOUNDS`, `DUPLICATE_TYPE`, `OVERLAP`,
 * `ADJACENT_SHIPS`. `INCOMPLETE_FLEET` is reported only by `validateFleet`, once every ship has passed.
 */
export const PLACEMENT_VIOLATIONS = {
  /** A cell of the ship lies off the board. */
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
  /** A ship type appears twice. */
  DUPLICATE_TYPE: 'DUPLICATE_TYPE',
  /** Two ships share a cell. */
  OVERLAP: 'OVERLAP',
  /** Two ships touch, diagonals included; only when `areAdjacentShipsAllowed` is false. */
  ADJACENT_SHIPS: 'ADJACENT_SHIPS',
  /** A valid draft lacks a ship type. */
  INCOMPLETE_FLEET: 'INCOMPLETE_FLEET',
} as const;

/** One of the `PLACEMENT_VIOLATIONS`. */
export type PlacementViolation = (typeof PLACEMENT_VIOLATIONS)[keyof typeof PLACEMENT_VIOLATIONS];

/** A layout that satisfies the placement rules. */
export interface ValidPlacement {
  /** Discriminant: every ship passed. */
  readonly ok: true;
  /** The ships with coordinates derived by core, in input order. */
  readonly ships: readonly PlacedShip[];
}

/** A layout the server rejects with `INVALID_PLACEMENT`; the details are for tests and the server log. */
export interface InvalidPlacement {
  /** Discriminant: at least one rule is broken. */
  readonly ok: false;
  /** The first rule broken. */
  readonly reason: PlacementViolation;
  /**
   * Input index of the first ship that breaks `reason`; for `OVERLAP` and `ADJACENT_SHIPS` it is the later of the two
   * ships involved. `null` for `INCOMPLETE_FLEET`, which no single ship causes.
   */
  readonly shipIndex: number | null;
}

/** Outcome of `validateDraft` and `validateFleet`: the derived ships, or why the layout was refused. */
export type PlacementValidation = ValidPlacement | InvalidPlacement;

/**
 * Both directions a ship can extend in, in the order candidate placements are listed before shuffling; spelled out so
 * that seeded fleets never depend on the key order of `ORIENTATIONS`.
 */
const ORIENTATION_ORDER: readonly Orientation[] = [ORIENTATIONS.HORIZONTAL, ORIENTATIONS.VERTICAL];

/**
 * Ships `completeFleet` may place, backtracked ones included, while keeping a draft before it gives up and generates a
 * whole fleet instead (ADR-0032). Measured over 200,000 random valid drafts with adjacency forbidden, completion never
 * needed more than 6; the limit only bounds the time a pathological draft could take, to a few milliseconds.
 */
const COMPLETION_STEP_LIMIT = 1_000;

/**
 * Derives the cells a ship occupies from its type, start and orientation, ignoring any coordinates the input carries,
 * since the server never trusts client-computed cells. Does not check the board bounds.
 * @param placement The ship as the client sends it.
 * @returns A new ship holding only `type`, `start`, `orientation` and the `SHIP_LENGTH[type]` derived coordinates,
 * from `start` towards larger x (`HORIZONTAL`) or larger y (`VERTICAL`).
 * @example
 * toPlacedShip({ type: SHIP_TYPES.DESTROYER, start: { x: 3, y: 5 }, orientation: ORIENTATIONS.VERTICAL }).coordinates;
 * // [{ x: 3, y: 5 }, { x: 3, y: 6 }]
 */
export function toPlacedShip(placement: ShipPlacement): PlacedShip {
  const { type, orientation } = placement;
  const start = { x: placement.start.x, y: placement.start.y };
  const coordinates: Coordinate[] = [];
  for (let offset = 0; offset < SHIP_LENGTH[type]; offset++) {
    coordinates.push(
      orientation === ORIENTATIONS.HORIZONTAL
        ? { x: start.x + offset, y: start.y }
        : { x: start.x, y: start.y + offset },
    );
  }
  return { type, start, orientation, coordinates };
}

/**
 * Checks a placement draft of 0 to 5 ships against the game rules: bounds, one ship per type, no overlap and, when
 * `rules.areAdjacentShipsAllowed` is false, no ships touching, diagonally included. Lengths are right by construction,
 * because coordinates are derived. The payload shape (exact properties, known enums, an on-board integer `start`, at
 * most 5 entries) is the job of the `UPDATE_PLACEMENT` guard, which runs first (ADR-0031); this function repeats none
 * of it but still handles any `ShipPlacement`, so the client can call it too.
 * @param ships The draft, in any order.
 * @param rules The room's rules; only `areAdjacentShipsAllowed` matters.
 * @returns The derived ships in input order, or the first rule broken and the ship that broke it.
 * @example
 * const result = validateDraft(
 *   [
 *     { type: SHIP_TYPES.DESTROYER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.HORIZONTAL },
 *     { type: SHIP_TYPES.CRUISER, start: { x: 2, y: 1 }, orientation: ORIENTATIONS.VERTICAL },
 *   ],
 *   DEFAULT_RULES,
 * );
 * // { ok: false, reason: 'ADJACENT_SHIPS', shipIndex: 1 }: (1, 0) and (2, 1) touch diagonally
 */
export function validateDraft(ships: readonly ShipPlacement[], rules: GameRules): PlacementValidation {
  const occupancy = new Occupancy();
  const seenTypes = new Set<ShipType>();
  const placed: PlacedShip[] = [];
  for (const [shipIndex, placement] of ships.entries()) {
    const ship = toPlacedShip(placement);
    const reason = findViolation(ship, seenTypes, occupancy, rules);
    if (reason !== null) {
      return { ok: false, reason, shipIndex };
    }
    seenTypes.add(ship.type);
    occupancy.add(ship);
    placed.push(ship);
  }
  return { ok: true, ships: placed };
}

/**
 * Checks a fleet to confirm or to start the match with: a valid draft (see `validateDraft`) holding every ship type.
 * @param ships The fleet, in any order.
 * @param rules The room's rules; only `areAdjacentShipsAllowed` matters.
 * @returns The derived ships in input order, or the first rule broken; `INCOMPLETE_FLEET` when a valid draft lacks
 * a ship.
 */
export function validateFleet(ships: readonly ShipPlacement[], rules: GameRules): PlacementValidation {
  const result = validateDraft(ships, rules);
  if (result.ok && result.ships.length !== FLEET.length) {
    return { ok: false, reason: PLACEMENT_VIOLATIONS.INCOMPLETE_FLEET, shipIndex: null };
  }
  return result;
}

/**
 * Generates a complete valid fleet by backtracking (ADR-0032): ships are placed in `FLEET` order, largest first, each
 * trying every position that still fits in an order shuffled by `rng`. The search is exhaustive, so it always
 * terminates, and a complete fleet always fits a 10×10 board, so it always succeeds, usually without backtracking.
 * @param rules The room's rules; only `areAdjacentShipsAllowed` matters.
 * @param rng Source of every random choice; the same seed gives the same fleet.
 * @returns The five ships in `FLEET` order.
 * @example
 * const fleet = generateRandomFleet(DEFAULT_RULES, createSeededRng(42));
 * validateFleet(fleet, DEFAULT_RULES).ok; // true
 */
export function generateRandomFleet(rules: GameRules, rng: Rng): PlacedShip[] {
  const fleet = placeMissingShips([], rules, rng, Number.POSITIVE_INFINITY);
  if (fleet === null) {
    // Unreachable: an exhaustive search on an empty board finds a fleet under either adjacency setting.
    throw new Error('No fleet fits the board');
  }
  return fleet;
}

/**
 * Completes a draft for auto-completion at the placement deadline: keeps the draft's ships and places the missing
 * ones by the same backtracking as `generateRandomFleet`. Falls back to a whole random fleet, discarding the draft,
 * when the draft is invalid, when the missing ships cannot fit (possible when adjacency is forbidden), or when the
 * search exceeds its step budget (ADR-0032). Never throws, so the deadline always produces a fleet.
 * @param draft The player's current draft, normally already accepted by `validateDraft`; coordinates are re-derived.
 * @param rules The room's rules; only `areAdjacentShipsAllowed` matters.
 * @param rng Source of every random choice; the same draft and seed give the same fleet.
 * @returns The five ships in `FLEET` order; a complete valid draft comes back unchanged apart from the order.
 * @example
 * const fleet = completeFleet(
 *   [{ type: SHIP_TYPES.CARRIER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.HORIZONTAL }],
 *   DEFAULT_RULES,
 *   createSeededRng(42),
 * );
 * // the carrier stays at (0, 0)–(4, 0); the other four ships are placed around it
 */
export function completeFleet(draft: readonly ShipPlacement[], rules: GameRules, rng: Rng): PlacedShip[] {
  const validation = validateDraft(draft, rules);
  if (validation.ok) {
    const completed = placeMissingShips(validation.ships, rules, rng, COMPLETION_STEP_LIMIT);
    if (completed !== null) {
      return completed;
    }
  }
  return generateRandomFleet(rules, rng);
}

/**
 * Checks one ship of a draft against the ships accepted before it, in the order `PlacementViolation` lists.
 * @param ship The ship, with derived coordinates.
 * @param seenTypes Types of the ships accepted so far.
 * @param occupancy Cells of the ships accepted so far.
 * @param rules The room's rules; only `areAdjacentShipsAllowed` matters.
 * @returns The first rule the ship breaks, or `null` when it can join the draft.
 */
function findViolation(
  ship: PlacedShip,
  seenTypes: ReadonlySet<ShipType>,
  occupancy: Occupancy,
  rules: GameRules,
): Exclude<PlacementViolation, typeof PLACEMENT_VIOLATIONS.INCOMPLETE_FLEET> | null {
  if (!ship.coordinates.every(isOnBoard)) {
    return PLACEMENT_VIOLATIONS.OUT_OF_BOUNDS;
  }
  if (seenTypes.has(ship.type)) {
    return PLACEMENT_VIOLATIONS.DUPLICATE_TYPE;
  }
  if (occupancy.overlaps(ship)) {
    return PLACEMENT_VIOLATIONS.OVERLAP;
  }
  if (!rules.areAdjacentShipsAllowed && occupancy.touches(ship)) {
    return PLACEMENT_VIOLATIONS.ADJACENT_SHIPS;
  }
  return null;
}

/**
 * Backtracking search shared by `generateRandomFleet` and `completeFleet`. Missing types are placed in `FLEET` order;
 * for each one the positions that fit the ships placed so far are shuffled and tried in turn, undoing the choice when
 * the remaining ships cannot follow. Every random draw comes from `rng`, so the result depends only on its seed.
 * @param fixed A valid set of ships to keep, at most one per type.
 * @param rules The room's rules; only `areAdjacentShipsAllowed` matters.
 * @param rng Source of the shuffles.
 * @param stepLimit Maximum number of ships the search may place, backtracked ones included; `Infinity` for none.
 * @returns The complete fleet in `FLEET` order, or `null` when it cannot be completed within `stepLimit` steps.
 */
function placeMissingShips(
  fixed: readonly PlacedShip[],
  rules: GameRules,
  rng: Rng,
  stepLimit: number,
): PlacedShip[] | null {
  const occupancy = new Occupancy();
  for (const ship of fixed) {
    occupancy.add(ship);
  }
  const fixedTypes = new Set(fixed.map((ship) => ship.type));
  const candidatesPerShip = FLEET.filter((type) => !fixedTypes.has(type)).map(listOnBoardPlacements);
  const placed: PlacedShip[] = [];
  let stepsLeft = stepLimit;

  // Places the missing ship at `depth` and every one after it; true when all of them fit.
  const placeFrom = (depth: number): boolean => {
    const candidates = candidatesPerShip[depth];
    if (candidates === undefined) {
      return true;
    }
    const fitting = candidates.filter((ship) => occupancy.fits(ship, rules));
    for (const ship of rng.shuffle(fitting)) {
      if (stepsLeft <= 0) {
        return false;
      }
      stepsLeft--;
      occupancy.add(ship);
      placed.push(ship);
      if (placeFrom(depth + 1)) {
        return true;
      }
      occupancy.remove(ship);
      placed.pop();
    }
    return false;
  };

  if (!placeFrom(0)) {
    return null;
  }
  return [...fixed, ...placed].sort((a, b) => FLEET.indexOf(a.type) - FLEET.indexOf(b.type));
}

/**
 * Lists every position of a ship that lies entirely on the board, ignoring other ships.
 * @param type The ship to place.
 * @returns `2 × BOARD_SIZE × (BOARD_SIZE − length + 1)` ships: horizontal ones row by row, then vertical ones.
 */
function listOnBoardPlacements(type: ShipType): PlacedShip[] {
  const lastStart = BOARD_SIZE - SHIP_LENGTH[type];
  const placements: PlacedShip[] = [];
  for (const orientation of ORIENTATION_ORDER) {
    const lastX = orientation === ORIENTATIONS.HORIZONTAL ? lastStart : BOARD_SIZE - 1;
    const lastY = orientation === ORIENTATIONS.VERTICAL ? lastStart : BOARD_SIZE - 1;
    for (let y = 0; y <= lastY; y++) {
      for (let x = 0; x <= lastX; x++) {
        placements.push(toPlacedShip({ type, start: { x, y }, orientation }));
      }
    }
  }
  return placements;
}

/**
 * Lists a ship's cells together with their neighbours, diagonals included: the rectangle one cell larger than the ship
 * on every side, clipped to the board. Another ship touches or overlaps this one exactly when one of its cells is
 * in the list.
 * @param ship A ship lying entirely on the board.
 * @returns Grid indexes, each once.
 */
function listSurroundingCells(ship: PlacedShip): number[] {
  const { start } = ship;
  const length = SHIP_LENGTH[ship.type];
  const endX = ship.orientation === ORIENTATIONS.HORIZONTAL ? start.x + length - 1 : start.x;
  const endY = ship.orientation === ORIENTATIONS.VERTICAL ? start.y + length - 1 : start.y;
  const indexes: number[] = [];
  for (let y = Math.max(start.y - 1, 0); y <= Math.min(endY + 1, BOARD_SIZE - 1); y++) {
    for (let x = Math.max(start.x - 1, 0); x <= Math.min(endX + 1, BOARD_SIZE - 1); x++) {
      indexes.push(toCellIndex({ x, y }));
    }
  }
  return indexes;
}

/**
 * Tracks which cells the ships placed so far occupy and surround, with counters so that a ship can be removed again
 * while backtracking. Every ship added must lie entirely on the board.
 */
class Occupancy {
  /** Per cell, how many ships lie on it: 0 or 1 for a valid layout. */
  private readonly shipCounts = new Uint8Array(CELL_COUNT);

  /** Per cell, how many ships it lies on or next to (diagonals included): at most one per ship, so at most 5. */
  private readonly surroundingCounts = new Uint8Array(CELL_COUNT);

  /**
   * Tells whether a ship shares a cell with a ship already added.
   * @param ship A ship lying entirely on the board.
   * @returns True on any shared cell.
   */
  overlaps(ship: PlacedShip): boolean {
    return ship.coordinates.some((cell) => this.shipCounts[toCellIndex(cell)] !== 0);
  }

  /**
   * Tells whether a ship lies on or next to a ship already added, diagonals included.
   * @param ship A ship lying entirely on the board.
   * @returns True when any of its cells is a neighbour of, or the same as, a cell of another ship.
   */
  touches(ship: PlacedShip): boolean {
    return ship.coordinates.some((cell) => this.surroundingCounts[toCellIndex(cell)] !== 0);
  }

  /**
   * Tells whether a ship can join the ships already added under the room's adjacency rule.
   * @param ship A ship lying entirely on the board.
   * @param rules The room's rules; only `areAdjacentShipsAllowed` matters.
   * @returns True when it neither overlaps nor, with adjacency forbidden, touches another ship.
   */
  fits(ship: PlacedShip, rules: GameRules): boolean {
    return rules.areAdjacentShipsAllowed ? !this.overlaps(ship) : !this.touches(ship);
  }

  /**
   * Records a ship's cells and surroundings. Mutates the grids.
   * @param ship A ship lying entirely on the board.
   */
  add(ship: PlacedShip): void {
    this.update(ship, 1);
  }

  /**
   * Undoes `add` for the same ship. Mutates the grids.
   * @param ship A ship added earlier and not removed since.
   */
  remove(ship: PlacedShip): void {
    this.update(ship, -1);
  }

  /**
   * Adds `delta` to the counters of a ship's cells and surroundings.
   * @param ship A ship lying entirely on the board.
   * @param delta `1` to add the ship, `-1` to remove it.
   */
  private update(ship: PlacedShip, delta: 1 | -1): void {
    for (const cell of ship.coordinates) {
      const index = toCellIndex(cell);
      this.shipCounts[index] = (this.shipCounts[index] ?? 0) + delta;
    }
    for (const index of listSurroundingCells(ship)) {
      this.surroundingCounts[index] = (this.surroundingCounts[index] ?? 0) + delta;
    }
  }
}
