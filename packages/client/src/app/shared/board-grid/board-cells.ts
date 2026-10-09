import {
  BOARD_SIZE,
  SHOT_OUTCOMES,
  type Coordinate,
  type PlacedShip,
  type ShotOutcome,
  type ShotResult,
} from '@battleship/core';

/** Number of cells on a board. */
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/**
 * What can be known about a cell, also rendered as its `data-state` attribute for the styles (ADR-0043). Draft targets,
 * the invalid preview and the selected ship are overlays on top of a state.
 */
export const CELL_STATES = {
  /** No shot, and no ship drawn. */
  EMPTY: 'empty',
  /** A ship drawn, not shot. */
  SHIP: 'ship',
  /** A shot that found no ship. */
  MISS: 'miss',
  /** A shot on a ship not yet sunk. */
  HIT: 'hit',
  /** Every cell of a sunk ship, not only the one whose shot sank it. */
  SUNK: 'sunk',
} as const;

/** One of the `CELL_STATES`. */
export type CellState = (typeof CELL_STATES)[keyof typeof CELL_STATES];

/** What the board grid draws on top of its ships and shots. */
export interface BoardContent {
  /** Ships drawn on the board. */
  readonly ships: readonly PlacedShip[];
  /** Shots fired at the board. */
  readonly shots: readonly ShotResult[];
  /** Cells the player picked for the current turn. */
  readonly draftTargets: readonly Coordinate[];
  /** Cells of a ship position the placement rules refuse. */
  readonly invalidPreview: readonly Coordinate[];
  /** Cells of the ship selected during placement. */
  readonly selectedCells: readonly Coordinate[];
}

/** One cell as the board grid renders it. */
export interface BoardCell {
  /** The cell on the board. */
  readonly coordinate: Coordinate;
  /** Position counted row by row from the top-left cell, 0 to `CELL_COUNT − 1`: the cell's identity in the grid. */
  readonly index: number;
  /** What is known about the cell. */
  readonly state: CellState;
  /** Whether the cell is one of the turn's draft targets. */
  readonly isDraftTarget: boolean;
  /** Whether the cell belongs to an invalid placement preview. */
  readonly isInvalidPreview: boolean;
  /** Whether the cell belongs to the ship selected during placement. */
  readonly isSelected: boolean;
}

/**
 * Maps a cell to its position in the grid, row by row.
 * @param coordinate A cell on the board.
 * @returns `y × BOARD_SIZE + x`.
 */
export function toCellIndex({ x, y }: Coordinate): number {
  return y * BOARD_SIZE + x;
}

/**
 * Maps a grid position back to its cell.
 * @param index A position from 0 to `CELL_COUNT − 1`.
 * @returns The cell at that position.
 */
export function toCoordinate(index: number): Coordinate {
  return { x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) };
}

/**
 * Derives every cell of a board from its content. A hit cell is `sunk` when its shot sank a ship or when every cell of
 * the ship drawn there was hit, so the earlier hits of a sunk ship show as sunk too.
 * @param content The ships, shots and overlays of the board.
 * @returns `CELL_COUNT` cells, row by row from the top-left one.
 */
export function toBoardCells(content: BoardContent): BoardCell[] {
  const shipAt = new Map<number, PlacedShip>();
  for (const ship of content.ships) {
    for (const coordinate of ship.coordinates) {
      shipAt.set(toCellIndex(coordinate), ship);
    }
  }
  const outcomeAt = new Map<number, ShotOutcome>(
    content.shots.map((shot) => [toCellIndex(shot.coordinate), shot.outcome]),
  );
  const isHit = (coordinate: Coordinate): boolean => {
    const outcome = outcomeAt.get(toCellIndex(coordinate));
    return outcome === SHOT_OUTCOMES.HIT || outcome === SHOT_OUTCOMES.SUNK;
  };
  const sunkShips = new Set(content.ships.filter((ship) => ship.coordinates.every(isHit)));
  const draftTargets = new Set(content.draftTargets.map(toCellIndex));
  const invalidPreview = new Set(content.invalidPreview.map(toCellIndex));
  const selectedCells = new Set(content.selectedCells.map(toCellIndex));

  const stateAt = (index: number): CellState => {
    const outcome = outcomeAt.get(index);
    const ship = shipAt.get(index);
    if (outcome === SHOT_OUTCOMES.MISS) {
      return CELL_STATES.MISS;
    }
    if (
      outcome === SHOT_OUTCOMES.SUNK ||
      (outcome === SHOT_OUTCOMES.HIT && ship !== undefined && sunkShips.has(ship))
    ) {
      return CELL_STATES.SUNK;
    }
    if (outcome === SHOT_OUTCOMES.HIT) {
      return CELL_STATES.HIT;
    }
    return ship === undefined ? CELL_STATES.EMPTY : CELL_STATES.SHIP;
  };

  return Array.from({ length: CELL_COUNT }, (_, index) => ({
    coordinate: toCoordinate(index),
    index,
    state: stateAt(index),
    isDraftTarget: draftTargets.has(index),
    isInvalidPreview: invalidPreview.has(index),
    isSelected: selectedCells.has(index),
  }));
}
