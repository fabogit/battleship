import { BOARD_SIZE, type Coordinate } from '@battleship/core';

/** Character code of `A`, the letter of the top row. */
const FIRST_ROW_CODE = 'A'.charCodeAt(0);

/**
 * Names a row the way players read it (ADR-0040).
 * @param y Row, from 0 at the top.
 * @returns `A` for the top row, up to `J` for the bottom one.
 */
export function rowLetter(y: number): string {
  return String.fromCharCode(FIRST_ROW_CODE + y);
}

/**
 * Names a cell the way players read it: the row letter, then the column number counted from 1 (ADR-0040).
 * @param coordinate A cell on the board.
 * @returns E.g. `B7` for `{ x: 6, y: 1 }`.
 */
export function formatCoordinate({ x, y }: Coordinate): string {
  return rowLetter(y) + String(x + 1);
}

/** Row letters, top to bottom: the left axis of a board. */
export const ROW_LETTERS: readonly string[] = Array.from({ length: BOARD_SIZE }, (_, y) => rowLetter(y));

/** Column numbers, left to right: the top axis of a board. */
export const COLUMN_NUMBERS: readonly string[] = Array.from({ length: BOARD_SIZE }, (_, x) => String(x + 1));
