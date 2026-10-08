import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ORIENTATIONS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  toPlacedShip,
  type Coordinate,
  type ShotResult,
} from '@battleship/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CELL_STATES } from './board-cells';
import { BoardGrid } from './board-grid';
import { formatCoordinate } from './coordinates';

/** A destroyer on B2–B3. */
const DESTROYER = toPlacedShip({
  type: SHIP_TYPES.DESTROYER,
  start: { x: 1, y: 1 },
  orientation: ORIENTATIONS.HORIZONTAL,
});
/** A cruiser on D5–F5. */
const CRUISER = toPlacedShip({ type: SHIP_TYPES.CRUISER, start: { x: 4, y: 3 }, orientation: ORIENTATIONS.VERTICAL });

/** Both destroyer cells hit, the second one sinking it; one cruiser hit; one miss. */
const SHOTS: readonly ShotResult[] = [
  { coordinate: { x: 1, y: 1 }, outcome: SHOT_OUTCOMES.HIT },
  { coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.MISS },
  { coordinate: { x: 2, y: 1 }, outcome: SHOT_OUTCOMES.SUNK, sunkShip: DESTROYER },
  { coordinate: { x: 4, y: 4 }, outcome: SHOT_OUTCOMES.HIT },
];

let fixture: ComponentFixture<BoardGrid>;

beforeEach(async () => {
  fixture = TestBed.createComponent(BoardGrid);
  fixture.componentRef.setInput('label', 'My fleet');
  await fixture.whenStable();
});

/**
 * Sets inputs and waits for the grid to render them.
 * @param inputs Input values by name.
 */
async function setInputs(inputs: Readonly<Record<string, unknown>>): Promise<void> {
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  await fixture.whenStable();
}

/** @returns The grid element. */
function grid(): HTMLElement {
  const element = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="grid"]');
  if (element === null) {
    throw new Error('No grid rendered');
  }
  return element;
}

/** @returns Every cell button, row by row. */
function buttons(): HTMLButtonElement[] {
  return Array.from(grid().querySelectorAll('button'));
}

/**
 * Finds the button of a cell.
 * @param name The cell's coordinate, e.g. `B7`.
 * @returns Its button.
 */
function cell(name: string): HTMLButtonElement {
  const button = buttons().find((candidate) => candidate.getAttribute('aria-label')?.split(',')[0] === name);
  if (button === undefined) {
    throw new Error(`No cell ${name}`);
  }
  return button;
}

/**
 * Presses a key on the focused element, as a browser would dispatch it.
 * @param key The `KeyboardEvent.key` value.
 * @param modifiers Modifier flags.
 * @returns The dispatched event, to check whether its default was prevented.
 */
function press(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

/** @returns The coordinate name of the focused cell. */
function focusedCell(): string | undefined {
  return document.activeElement?.getAttribute('aria-label')?.split(',')[0];
}

describe('formatCoordinate', () => {
  it('names a cell by row letter and column number', () => {
    expect(formatCoordinate({ x: 0, y: 0 })).toBe('A1');
    expect(formatCoordinate({ x: 6, y: 1 })).toBe('B7');
    expect(formatCoordinate({ x: 9, y: 9 })).toBe('J10');
  });
});

// Written out on purpose (ADR-0043): the `data-state` selectors in board-grid.css spell these values.
describe('CELL_STATES', () => {
  it('pins the values the styles select on', () => {
    expect(Object.values(CELL_STATES)).toEqual(['empty', 'ship', 'miss', 'hit', 'sunk']);
  });
});

describe('BoardGrid rendering', () => {
  it('renders a labelled grid of 10 rows of 10 buttons, with both axes', () => {
    expect(grid().getAttribute('aria-label')).toBe('My fleet');
    expect(grid().querySelectorAll('[role="row"]')).toHaveLength(10);
    expect(buttons()).toHaveLength(100);
    expect(buttons().every((button) => button.type === 'button')).toBe(true);

    const axes = Array.from(grid().querySelectorAll('.axis'), (axis) => axis.textContent.trim());
    expect(axes.slice(0, 11)).toEqual(['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(axes.slice(11)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  });

  it('renders every cell empty without content', () => {
    expect(buttons().every((button) => button.dataset['state'] === CELL_STATES.EMPTY)).toBe(true);
  });

  it('renders ships, misses, hits and sunk ships', async () => {
    await setInputs({ ships: [DESTROYER, CRUISER], shots: SHOTS });

    expect(cell('A1').dataset['state']).toBe(CELL_STATES.MISS);
    expect(cell('B2').dataset['state']).toBe(CELL_STATES.SUNK);
    expect(cell('B3').dataset['state']).toBe(CELL_STATES.SUNK);
    expect(cell('D5').dataset['state']).toBe(CELL_STATES.SHIP);
    expect(cell('E5').dataset['state']).toBe(CELL_STATES.HIT);
    expect(cell('F5').dataset['state']).toBe(CELL_STATES.SHIP);
    expect(cell('J10').dataset['state']).toBe(CELL_STATES.EMPTY);
  });

  it('marks every cell of a ship sunk once all of them are hit, whatever the outcomes say', async () => {
    const hits: ShotResult[] = DESTROYER.coordinates.map((coordinate) => ({ coordinate, outcome: SHOT_OUTCOMES.HIT }));
    await setInputs({ ships: [DESTROYER], shots: hits });

    expect(cell('B2').dataset['state']).toBe(CELL_STATES.SUNK);
    expect(cell('B3').dataset['state']).toBe(CELL_STATES.SUNK);
  });

  it('marks a sinking shot sunk even without the ship drawn', async () => {
    await setInputs({ shots: [{ coordinate: { x: 2, y: 1 }, outcome: SHOT_OUTCOMES.SUNK }] });

    expect(cell('B3').dataset['state']).toBe(CELL_STATES.SUNK);
  });

  it('overlays draft targets, the invalid preview and the selected ship on the cell state', async () => {
    const draftTargets: Coordinate[] = [{ x: 9, y: 9 }];
    await setInputs({
      ships: [DESTROYER, CRUISER],
      draftTargets,
      invalidPreview: [{ x: 4, y: 3 }],
      selectedCells: DESTROYER.coordinates,
    });

    expect(cell('J10').classList).toContain('is-draft-target');
    expect(cell('J10').dataset['state']).toBe(CELL_STATES.EMPTY);
    expect(cell('D5').classList).toContain('is-invalid-preview');
    expect(cell('D5').dataset['state']).toBe(CELL_STATES.SHIP);
    expect(cell('B2').classList).toContain('is-selected');
    expect(cell('B3').dataset['state']).toBe(CELL_STATES.SHIP);
    expect(cell('A1').classList).not.toContain('is-draft-target');
    expect(cell('A1').classList).not.toContain('is-invalid-preview');
    expect(cell('A1').classList).not.toContain('is-selected');
  });
});

describe('BoardGrid accessible labels', () => {
  it('names each cell by its coordinate, then its state and overlays', async () => {
    await setInputs({
      ships: [DESTROYER, CRUISER],
      shots: SHOTS,
      draftTargets: [{ x: 6, y: 1 }],
      invalidPreview: [
        { x: 4, y: 5 },
        { x: 4, y: 6 },
      ],
    });

    expect(buttons()[0]?.getAttribute('aria-label')).toBe('A1, miss');
    expect(buttons()[1]?.getAttribute('aria-label')).toBe('A2');
    expect(cell('B2').getAttribute('aria-label')).toBe('B2, sunk');
    expect(cell('B7').getAttribute('aria-label')).toBe('B7, target');
    expect(cell('D5').getAttribute('aria-label')).toBe('D5, ship');
    expect(cell('E5').getAttribute('aria-label')).toBe('E5, hit');
    expect(cell('F5').getAttribute('aria-label')).toBe('F5, ship, invalid position');
    expect(cell('G5').getAttribute('aria-label')).toBe('G5, invalid position');
  });

  it('adds "selected" to the cells of the selected ship', async () => {
    await setInputs({ ships: [DESTROYER], selectedCells: DESTROYER.coordinates, invalidPreview: [{ x: 2, y: 1 }] });

    expect(cell('B2').getAttribute('aria-label')).toBe('B2, ship, selected');
    expect(cell('B3').getAttribute('aria-label')).toBe('B3, ship, invalid position, selected');
  });

  it('labels the cells in row-letter, column-number order', () => {
    expect(buttons()[16]?.getAttribute('aria-label')).toBe('B7');
    expect(buttons()[99]?.getAttribute('aria-label')).toBe('J10');
  });

  it('hides the axes from assistive technologies', () => {
    const axes = Array.from(grid().querySelectorAll('.axis'));
    expect(axes.every((axis) => axis.closest('[aria-hidden="true"]') !== null)).toBe(true);
  });
});

describe('BoardGrid keyboard navigation', () => {
  it('puts only the first cell in the tab sequence', () => {
    expect(buttons().filter((button) => button.tabIndex === 0)).toEqual([cell('A1')]);
  });

  it('moves one cell with the arrows and stops at the edges', () => {
    cell('A1').focus();

    expect(press('ArrowLeft').defaultPrevented).toBe(true);
    expect(focusedCell()).toBe('A1');
    press('ArrowUp');
    expect(focusedCell()).toBe('A1');

    press('ArrowRight');
    expect(focusedCell()).toBe('A2');
    press('ArrowDown');
    expect(focusedCell()).toBe('B2');
    press('ArrowLeft');
    expect(focusedCell()).toBe('B1');
    press('ArrowUp');
    expect(focusedCell()).toBe('A1');

    cell('J10').focus();
    press('ArrowRight');
    expect(focusedCell()).toBe('J10');
    press('ArrowDown');
    expect(focusedCell()).toBe('J10');
  });

  it('jumps to the ends of the row with Home and End', () => {
    cell('C5').focus();

    press('End');
    expect(focusedCell()).toBe('C10');
    press('Home');
    expect(focusedCell()).toBe('C1');
  });

  it('jumps to the ends of the column with Page Up and Page Down', () => {
    cell('C5').focus();

    press('PageDown');
    expect(focusedCell()).toBe('J5');
    press('PageUp');
    expect(focusedCell()).toBe('A5');
  });

  it('jumps to the corners of the board with Ctrl or ⌘ + Home and End', () => {
    cell('C5').focus();

    press('End', { ctrlKey: true });
    expect(focusedCell()).toBe('J10');
    press('Home', { ctrlKey: true });
    expect(focusedCell()).toBe('A1');
    press('End', { metaKey: true });
    expect(focusedCell()).toBe('J10');
  });

  it('leaves other keys and modified arrows to the browser', () => {
    cell('C5').focus();

    for (const event of [press('Tab'), press('ArrowLeft', { altKey: true }), press('ArrowDown', { shiftKey: true })]) {
      expect(event.defaultPrevented).toBe(false);
    }
    expect(focusedCell()).toBe('C5');
  });

  it('keeps the last focused cell as the only one in the tab sequence', async () => {
    cell('A1').focus();
    press('ArrowDown');
    press('ArrowRight');
    await fixture.whenStable();

    expect(buttons().filter((button) => button.tabIndex === 0)).toEqual([cell('B2')]);
  });

  it('moves the tab stop to a clicked cell', async () => {
    cell('F6').click();
    await fixture.whenStable();

    expect(buttons().filter((button) => button.tabIndex === 0)).toEqual([cell('F6')]);
  });
});

describe('BoardGrid activation', () => {
  it('emits the coordinate of a clicked cell', () => {
    const activated = vi.fn<(coordinate: Coordinate) => void>();
    fixture.componentInstance.cellActivate.subscribe(activated);

    cell('B7').click();

    expect(activated).toHaveBeenCalledExactlyOnceWith({ x: 6, y: 1 });
  });

  it('leaves Enter and Space to the button, which activates it natively', () => {
    cell('B7').focus();

    expect(press('Enter').defaultPrevented).toBe(false);
    expect(press(' ').defaultPrevented).toBe(false);
    expect(focusedCell()).toBe('B7');
  });

  it('keeps a non-interactive board focusable but reports it disabled and emits nothing', async () => {
    const activated = vi.fn<(coordinate: Coordinate) => void>();
    fixture.componentInstance.cellActivate.subscribe(activated);
    await setInputs({ isInteractive: false });

    cell('B7').click();
    cell('B7').focus();
    press('ArrowRight');

    expect(activated).not.toHaveBeenCalled();
    expect(buttons().every((button) => button.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(buttons().some((button) => button.disabled)).toBe(false);
    expect(focusedCell()).toBe('B8');
  });

  it('reports no disabled state on an interactive board', () => {
    expect(buttons().some((button) => button.hasAttribute('aria-disabled'))).toBe(false);
  });
});
