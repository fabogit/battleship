import { Component, computed, input, output, signal, viewChildren, type ElementRef } from '@angular/core';
import { BOARD_SIZE, type Coordinate, type PlacedShip, type ShotResult } from '@battleship/core';

import { CELL_COUNT, toBoardCells, toCellIndex, toCoordinate, type BoardCell } from './board-cells';
import { BOARD_GRID_TEXT, type BoardGridText } from './board-grid.text';
import { COLUMN_NUMBERS, ROW_LETTERS, formatCoordinate } from './coordinates';

/** A cell with the accessible label it is rendered with. */
interface LabelledCell extends BoardCell {
  /** The cell's accessible name, e.g. "B7, hit". */
  readonly label: string;
}

/** One row of the grid. */
interface BoardRow {
  /** The row's letter, shown on the left axis. */
  readonly letter: string;
  /** The row's cells, left to right. */
  readonly cells: readonly LabelledCell[];
}

/** The parts of a key press that decide where focus moves. */
type NavigationKey = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

/**
 * Names a cell for assistive technologies: its coordinate, then its state and overlays, e.g. "B7, hit" or
 * "C3, ship, selected".
 * @param cell The cell to name.
 * @param text The words for states and overlays.
 * @returns The comma-separated label.
 */
export function cellLabel(cell: BoardCell, text: BoardGridText): string {
  const parts = [
    formatCoordinate(cell.coordinate),
    text.states[cell.state],
    cell.isDraftTarget ? text.draftTarget : null,
    cell.isInvalidPreview ? text.invalidPreview : null,
    cell.isSelected ? text.selected : null,
  ];
  return parts.filter((part) => part !== null).join(', ');
}

/**
 * Finds the cell a key moves focus to (ADR-0041): arrows move one cell and stop at the edges; Home / End go to the
 * first / last cell of the row, Ctrl (or ⌘) + Home / End to the first / last cell of the board; Page Up / Page Down
 * go to the top / bottom cell of the column.
 * @param index The focused cell's position.
 * @param key The key pressed, with its modifiers.
 * @returns The position to focus, the same one at an edge; `null` when the key does not navigate.
 */
export function navigationTarget(index: number, key: NavigationKey): number | null {
  const { x, y } = toCoordinate(index);
  const last = BOARD_SIZE - 1;
  if ((key.key === 'Home' || key.key === 'End') && (key.ctrlKey || key.metaKey) && !key.altKey && !key.shiftKey) {
    return key.key === 'Home' ? 0 : CELL_COUNT - 1;
  }
  if (key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) {
    return null;
  }
  switch (key.key) {
    case 'ArrowLeft':
      return toCellIndex({ x: Math.max(0, x - 1), y });
    case 'ArrowRight':
      return toCellIndex({ x: Math.min(last, x + 1), y });
    case 'ArrowUp':
      return toCellIndex({ x, y: Math.max(0, y - 1) });
    case 'ArrowDown':
      return toCellIndex({ x, y: Math.min(last, y + 1) });
    case 'Home':
      return toCellIndex({ x: 0, y });
    case 'End':
      return toCellIndex({ x: last, y });
    case 'PageUp':
      return toCellIndex({ x, y: 0 });
    case 'PageDown':
      return toCellIndex({ x, y: last });
    default:
      return null;
  }
}

/**
 * A 10×10 board of buttons, shared by placement and battle (docs/client.md#board--interaction). It only draws what
 * it is given and reports activated cells; the parent decides what an activation means.
 */
@Component({
  selector: 'app-board-grid',
  templateUrl: './board-grid.html',
  styleUrl: './board-grid.css',
})
export class BoardGrid {
  /** The board's accessible name, e.g. "My fleet" or "Enemy waters". */
  readonly label = input.required<string>();
  /** Ships drawn on the board. */
  readonly ships = input<readonly PlacedShip[]>([]);
  /** Shots fired at the board. */
  readonly shots = input<readonly ShotResult[]>([]);
  /** Cells picked as targets for the current turn. */
  readonly draftTargets = input<readonly Coordinate[]>([]);
  /** Cells of a ship position the placement rules refuse. */
  readonly invalidPreview = input<readonly Coordinate[]>([]);
  /** Cells of the ship selected during placement. */
  readonly selectedCells = input<readonly Coordinate[]>([]);
  /** Whether activating a cell does something; when false the cells stay focusable but report `aria-disabled`. */
  readonly isInteractive = input(true);

  /** The cell clicked, or activated with Enter or Space; emitted only while `isInteractive`. */
  readonly cellActivate = output<Coordinate>();

  /** Labels of the top axis. */
  protected readonly columnNumbers = COLUMN_NUMBERS;

  /** The cell in the tab sequence (roving tabindex): the last one focused or clicked, `A1` at first. */
  protected readonly activeIndex = signal(0);

  /** Every cell, row by row, with its accessible label. */
  protected readonly rows = computed<readonly BoardRow[]>(() => {
    const cells = toBoardCells({
      ships: this.ships(),
      shots: this.shots(),
      draftTargets: this.draftTargets(),
      invalidPreview: this.invalidPreview(),
      selectedCells: this.selectedCells(),
    }).map((cell) => ({ ...cell, label: cellLabel(cell, BOARD_GRID_TEXT) }));
    return ROW_LETTERS.map((letter, y) => ({
      letter,
      cells: cells.slice(y * BOARD_SIZE, (y + 1) * BOARD_SIZE),
    }));
  });

  /** The cell buttons, in the same order as the cells. */
  private readonly cellButtons = viewChildren<ElementRef<HTMLButtonElement>>('cellButton');

  /**
   * Makes a focused cell the one in the tab sequence, so Tab comes back to it.
   * @param cell The cell that received focus.
   */
  protected onCellFocus(cell: BoardCell): void {
    this.activeIndex.set(cell.index);
  }

  /**
   * Reports an activated cell, from a click or from Enter / Space on the focused button.
   * @param cell The cell activated.
   */
  protected onCellClick(cell: BoardCell): void {
    this.activeIndex.set(cell.index);
    if (this.isInteractive()) {
      this.cellActivate.emit(cell.coordinate);
    }
  }

  /**
   * Moves focus between cells on navigation keys and stops their default scrolling; other keys, Enter and Space
   * included, keep their native behaviour.
   * @param event A key pressed while a cell has focus.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const target = navigationTarget(this.activeIndex(), event);
    if (target === null) {
      return;
    }
    event.preventDefault();
    this.activeIndex.set(target);
    this.cellButtons()[target]?.nativeElement.focus();
  }
}
