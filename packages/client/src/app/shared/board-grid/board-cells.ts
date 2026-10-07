import { BOARD_SIZE, type Coordinate, type PlacedShip, type ShotOutcome, type ShotResult } from '@battleship/core';

/** Number of cells on a board. */
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/**
 * What is known about a cell. `sunk` marks every cell of a sunk ship, not only the one whose shot sank it; draft
 * targets and the invalid preview are overlays on top of a state.
 */
export type CellState = 'empty' | 'ship' | 'miss' | 'hit' | 'sunk';

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
    return outcome === 'HIT' || outcome === 'SUNK';
  };
  const sunkShips = new Set(content.ships.filter((ship) => ship.coordinates.every(isHit)));
  const draftTargets = new Set(content.draftTargets.map(toCellIndex));
  const invalidPreview = new Set(content.invalidPreview.map(toCellIndex));

  const stateAt = (index: number): CellState => {
    const outcome = outcomeAt.get(index);
    const ship = shipAt.get(index);
    if (outcome === 'MISS') {
      return 'miss';
    }
    if (outcome === 'SUNK' || (outcome === 'HIT' && ship !== undefined && sunkShips.has(ship))) {
      return 'sunk';
    }
    if (outcome === 'HIT') {
      return 'hit';
    }
    return ship === undefined ? 'empty' : 'ship';
  };

  return Array.from({ length: CELL_COUNT }, (_, index) => ({
    coordinate: toCoordinate(index),
    index,
    state: stateAt(index),
    isDraftTarget: draftTargets.has(index),
    isInvalidPreview: invalidPreview.has(index),
  }));
}
