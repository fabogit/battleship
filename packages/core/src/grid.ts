// Board geometry shared by placement, the shot engine and the client's board grid. `CELL_COUNT`, `toCellIndex` and
// `toCoordinate` are exported from the package, so the row-major cell order is defined once; `isOnBoard` stays internal.

import { BOARD_SIZE } from './constants.js';
import type { Coordinate } from './types.js';

/** Number of cells on the board, and so the length of every per-cell grid. */
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/**
 * Tells whether a coordinate is a cell of the board. Payload guards already refuse anything else on the server; the
 * integer check keeps core safe for any caller.
 * @param coordinate Any coordinate, possibly off the board or fractional.
 * @returns True when `x` and `y` are integers with `0 ≤ x < BOARD_SIZE` and `0 ≤ y < BOARD_SIZE`.
 */
export function isOnBoard({ x, y }: Coordinate): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

/**
 * Maps a cell to its index in a per-cell grid, row by row.
 * @param coordinate A cell on the board.
 * @returns `y × BOARD_SIZE + x`, from 0 to `CELL_COUNT − 1`.
 */
export function toCellIndex({ x, y }: Coordinate): number {
  return y * BOARD_SIZE + x;
}

/**
 * Maps an index in a per-cell grid back to its cell: the inverse of `toCellIndex`.
 * @param index A position from 0 to `CELL_COUNT − 1`.
 * @returns The cell at that position.
 */
export function toCoordinate(index: number): Coordinate {
  return { x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) };
}
