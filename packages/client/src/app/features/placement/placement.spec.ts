import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  CLIENT_EVENTS,
  ERROR_CODES,
  FLEET,
  ORIENTATIONS,
  SERVER_EVENTS,
  SHIP_TYPES,
  toPlacedShip,
  type PlacementSnapshot,
  type ShipType,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGameSocket, placementSnapshot, provideFakeGameSocket } from '../../../testing/fake-game-socket';
import { GameStateService } from '../../core/game-state';
import { CELL_STATES } from '../../shared/board-grid/board-cells';
import { Placement } from './placement';
import { PLACEMENT_TEXT } from './placement.text';

const ROOM_ID = 'ab23cd45';

/** A complete valid fleet, one ship every other row from A1. */
const FULL_FLEET = FLEET.map((type, index) =>
  toPlacedShip({ type, start: { x: 0, y: index * 2 }, orientation: ORIENTATIONS.HORIZONTAL }),
);

let socket: FakeGameSocket;
let fixture: ComponentFixture<Placement>;

/** @returns The rendered view. */
function view(): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/**
 * Delivers a placement snapshot and lets the view render it.
 * @param placement Fields of the `PLACEMENT` part to override.
 */
async function receive(placement: Partial<PlacementSnapshot> = {}): Promise<void> {
  socket.fire(SERVER_EVENTS.STATE, placementSnapshot(ROOM_ID, placement));
  await fixture.whenStable();
}

/**
 * Finds a button by its visible text.
 * @param label The button's text.
 * @returns The button, or `undefined`.
 */
function button(label: string): HTMLButtonElement | undefined {
  return Array.from(view().querySelectorAll('button')).find((candidate) => candidate.textContent.trim() === label);
}

/**
 * Finds a ship's button in the dock.
 * @param type The ship.
 * @returns Its button.
 */
function dockButton(type: ShipType): HTMLButtonElement {
  const found = Array.from(view().querySelectorAll<HTMLButtonElement>('.dock button')).find(
    (candidate) => candidate.querySelector('.name')?.textContent === PLACEMENT_TEXT.shipNames[type],
  );
  if (found === undefined) {
    throw new Error(`No dock button for ${type}`);
  }
  return found;
}

/**
 * Finds a board cell by its name.
 * @param name The cell's name, e.g. `B7`.
 * @returns Its button.
 */
function cell(name: string): HTMLButtonElement {
  const found = Array.from(view().querySelectorAll<HTMLButtonElement>('[role="grid"] button')).find(
    (candidate) => candidate.getAttribute('aria-label')?.split(',')[0] === name,
  );
  if (found === undefined) {
    throw new Error(`No cell ${name}`);
  }
  return found;
}

/**
 * Taps a button and lets the view render the outcome.
 * @param target The button.
 */
async function tap(target: HTMLButtonElement | undefined): Promise<void> {
  target?.click();
  await fixture.whenStable();
}

/** @returns The live region announcing what the last action did. */
function feedback(): string | undefined {
  return view().querySelector('.feedback')?.textContent.trim();
}

/** @returns How many board cells show a ship. */
function shipCellCount(): number {
  return view().querySelectorAll(`[role="grid"] button[data-state="${CELL_STATES.SHIP}"]`).length;
}

beforeEach(async () => {
  socket = new FakeGameSocket();
  socket.emitWithAck.mockResolvedValue({ ok: true });
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket)] });
  TestBed.inject(GameStateService);
  socket.fire(SERVER_EVENTS.STATE, placementSnapshot(ROOM_ID));
  fixture = TestBed.createComponent(Placement);
  await fixture.whenStable();
});

afterEach(() => {
  TestBed.inject(GameStateService).clear();
});

describe('Placement', () => {
  it('shows the deadline, the opponent and every ship of the dock, with its size', () => {
    expect(view().querySelector('h1')?.textContent).toBe(PLACEMENT_TEXT.heading);
    expect(view().querySelector('[role="timer"]')?.textContent).toBe(PLACEMENT_TEXT.timeLeft('1:00'));
    expect(view().textContent).toContain(PLACEMENT_TEXT.opponentPlacing('Grace'));
    expect(view().querySelector('.dock')?.getAttribute('aria-label')).toBe(PLACEMENT_TEXT.dockLabel);

    const carrier = dockButton(SHIP_TYPES.CARRIER);
    expect(carrier.querySelector('.name')?.textContent).toBe('Carrier');
    expect(carrier.querySelector('.visually-hidden')?.textContent).toBe(', 5 cells');
    expect(carrier.getAttribute('aria-pressed')).toBe('false');
    expect(carrier.querySelectorAll('.cells span')).toHaveLength(5);
    expect(view().querySelector('[role="grid"]')?.getAttribute('aria-label')).toBe(PLACEMENT_TEXT.boardLabel);
  });

  it('places a ship with two taps, sends the draft and offers Rotate and Remove', async () => {
    await tap(dockButton(SHIP_TYPES.CRUISER));

    expect(dockButton(SHIP_TYPES.CRUISER).getAttribute('aria-pressed')).toBe('true');
    expect(feedback()).toBe(PLACEMENT_TEXT.selected('Cruiser', 'horizontal', false));
    expect(button(PLACEMENT_TEXT.remove)).toBeUndefined();

    await tap(cell('C4'));

    expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.UPDATE_PLACEMENT, {
      ships: [{ type: SHIP_TYPES.CRUISER, start: { x: 3, y: 2 }, orientation: ORIENTATIONS.HORIZONTAL }],
    });
    expect(cell('C4').getAttribute('aria-label')).toBe('C4, ship, selected');
    expect(cell('C6').dataset['state']).toBe(CELL_STATES.SHIP);
    expect(feedback()).toBe(PLACEMENT_TEXT.placedAt('Cruiser', 'C4', 'horizontal'));
    expect(dockButton(SHIP_TYPES.CRUISER).classList).toContain('is-placed');
    expect(view().querySelector('.ship-actions')?.textContent).toContain(PLACEMENT_TEXT.selectedShip('Cruiser'));

    await tap(button(PLACEMENT_TEXT.rotate));

    expect(cell('E4').dataset['state']).toBe(CELL_STATES.SHIP);
    expect(cell('C5').dataset['state']).toBe(CELL_STATES.EMPTY);

    await tap(button(PLACEMENT_TEXT.remove));

    expect(shipCellCount()).toBe(0);
    expect(dockButton(SHIP_TYPES.CRUISER).classList).not.toContain('is-placed');
    expect(socket.emitWithAck).toHaveBeenLastCalledWith(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: [] });
  });

  it('previews a refused position on the board and says why', async () => {
    await tap(dockButton(SHIP_TYPES.CARRIER));
    await tap(cell('A1'));
    await tap(dockButton(SHIP_TYPES.DESTROYER));
    await tap(cell('B6'));

    expect(cell('B6').classList).toContain('is-invalid-preview');
    expect(cell('B7').getAttribute('aria-label')).toBe('B7, invalid position');
    expect(feedback()).toBe(`${PLACEMENT_TEXT.refused('Destroyer')} ${PLACEMENT_TEXT.refusals.ADJACENT_SHIPS}`);
    expect(socket.emitWithAck).toHaveBeenCalledOnce();
  });

  it('asks for a ship first when water is tapped with none selected', async () => {
    await tap(cell('E5'));

    expect(feedback()).toBe(PLACEMENT_TEXT.noShipSelected);
    expect(socket.emitWithAck).not.toHaveBeenCalled();
  });

  it('keeps "Confirm fleet" inactive with a reason until the fleet is complete', async () => {
    const confirm = button(PLACEMENT_TEXT.confirm);

    expect(confirm?.getAttribute('aria-disabled')).toBe('true');
    expect(view().querySelector('#lock-hint')?.textContent).toBe(PLACEMENT_TEXT.confirmHints.INCOMPLETE_FLEET);
    await tap(confirm);
    expect(socket.emitWithAck).not.toHaveBeenCalled();
  });

  it('randomizes the whole fleet, then confirms, locks and unlocks it', async () => {
    await tap(button(PLACEMENT_TEXT.randomize));

    expect(shipCellCount()).toBe(17);
    expect(feedback()).toBe(PLACEMENT_TEXT.randomized);
    const confirm = button(PLACEMENT_TEXT.confirm);
    expect(confirm?.hasAttribute('aria-disabled')).toBe(false);
    expect(view().querySelector('#lock-hint')?.textContent).toBe('');

    await tap(confirm);

    expect(socket.emitWithAck).toHaveBeenLastCalledWith(CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
    const [, payload] = socket.emitWithAck.mock.calls[0] ?? [];
    await receive({
      myShips: (payload as { ships: Parameters<typeof toPlacedShip>[0][] }).ships.map(toPlacedShip),
      hasConfirmed: { me: true, opponent: false },
    });

    expect(view().querySelector('#lock-hint')?.textContent).toBe(PLACEMENT_TEXT.lockedHint);
    expect(cell('A1').getAttribute('aria-disabled')).toBe('true');
    expect(dockButton(SHIP_TYPES.CARRIER).getAttribute('aria-disabled')).toBe('true');
    expect(button(PLACEMENT_TEXT.randomize)?.getAttribute('aria-disabled')).toBe('true');

    await tap(button(PLACEMENT_TEXT.unlock));

    expect(socket.emitWithAck).toHaveBeenLastCalledWith(CLIENT_EVENTS.UNLOCK_PLACEMENT, {});
  });

  it("shows the opponent's confirmation as it changes", async () => {
    await receive({ hasConfirmed: { me: false, opponent: true } });

    expect(view().textContent).toContain(PLACEMENT_TEXT.opponentReady('Grace'));

    await receive({ hasConfirmed: { me: false, opponent: false } });

    expect(view().textContent).toContain(PLACEMENT_TEXT.opponentPlacing('Grace'));
  });

  it('counts down to the start once both fleets are confirmed', async () => {
    await receive({ myShips: FULL_FLEET, hasConfirmed: { me: true, opponent: true }, startCountdownMs: 4_200 });

    expect(view().textContent).toContain(PLACEMENT_TEXT.startsIn(5));
  });

  it('explains a refused command', async () => {
    await receive({ myShips: FULL_FLEET });
    socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: ERROR_CODES.WRONG_PHASE });

    await tap(button(PLACEMENT_TEXT.confirm));

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(view().querySelector('[role="alert"]')?.textContent).toBe(PLACEMENT_TEXT.errors.WRONG_PHASE);
    });
  });
});
