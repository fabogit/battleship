import type { CellState } from './board-cells';

/** The words of a cell's accessible label after its coordinate, e.g. "B7, hit". */
export interface BoardGridText {
  /** The word for each cell state; `null` adds none, so an untouched cell is named by its coordinate alone. */
  readonly states: Readonly<Record<CellState, string | null>>;
  /** Added to a draft target. */
  readonly draftTarget: string;
  /** Added to a cell of an invalid placement preview. */
  readonly invalidPreview: string;
  /** Added to a cell of the ship selected during placement. */
  readonly selected: string;
}

/**
 * English strings of the board grid, kept in one typed object so that `I18nService` (ADR-0018) can supply them per
 * locale later without touching the component's logic.
 */
export const BOARD_GRID_TEXT: BoardGridText = {
  states: {
    empty: null,
    ship: 'ship',
    miss: 'miss',
    hit: 'hit',
    sunk: 'sunk',
  },
  draftTarget: 'target',
  invalidPreview: 'invalid position',
  selected: 'selected',
};
