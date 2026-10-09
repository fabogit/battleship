import { TestBed } from '@angular/core/testing';
import {
  CLIENT_EVENTS,
  ERROR_CODES,
  FLEET,
  ORIENTATIONS,
  PLACEMENT_VIOLATIONS,
  SERVER_EVENTS,
  SHIP_TYPES,
  toPlacedShip,
  validateFleet,
  type PlacementSnapshot,
  type ShipPlacement,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeGameSocket, placementSnapshot, provideFakeGameSocket } from '../../../testing/fake-game-socket';
import { TRANSPORT_ERRORS, type CommandResult } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { PLACEMENT_FEEDBACK, PlacementStore } from './placement-store';

const ROOM_ID = 'ab23cd45';

/** A carrier on A1–A5. */
const CARRIER: ShipPlacement = {
  type: SHIP_TYPES.CARRIER,
  start: { x: 0, y: 0 },
  orientation: ORIENTATIONS.HORIZONTAL,
};
/** A destroyer on J9–J10. */
const DESTROYER: ShipPlacement = {
  type: SHIP_TYPES.DESTROYER,
  start: { x: 8, y: 9 },
  orientation: ORIENTATIONS.HORIZONTAL,
};
/** A complete valid fleet, one ship every other row. */
const FULL_FLEET: readonly ShipPlacement[] = FLEET.map((type, index) => ({
  type,
  start: { x: 0, y: index * 2 },
  orientation: ORIENTATIONS.HORIZONTAL,
}));

let socket: FakeGameSocket;
let store: PlacementStore;

/**
 * Delivers a placement snapshot, as the server sends it after every change.
 * @param placement Fields of the `PLACEMENT` part to override.
 */
function receive(placement: Partial<PlacementSnapshot> = {}): void {
  socket.fire(SERVER_EVENTS.STATE, placementSnapshot(ROOM_ID, placement));
}

/**
 * Makes the next command wait until the test answers it.
 * @returns Resolves the command with its reply.
 */
function holdNextReply(): (result: CommandResult<typeof CLIENT_EVENTS.UPDATE_PLACEMENT>) => void {
  let answer: (result: CommandResult<typeof CLIENT_EVENTS.UPDATE_PLACEMENT>) => void = () => undefined;
  socket.emitWithAck.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  return answer;
}

/** @returns The ships of every `UPDATE_PLACEMENT` sent so far, oldest first. */
function sentDrafts(): unknown[] {
  return socket.emitWithAck.mock.calls
    .filter(([event]) => event === CLIENT_EVENTS.UPDATE_PLACEMENT)
    .map(([, payload]) => (payload as { ships: unknown }).ships);
}

/** Lets pending acks resolve. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Creates the store once the room is in placement, as the view does.
 * @param placement Fields of the first snapshot's `PLACEMENT` part.
 */
function createStore(placement: Partial<PlacementSnapshot> = {}): void {
  TestBed.inject(GameStateService);
  receive(placement);
  store = TestBed.inject(PlacementStore);
}

beforeEach(() => {
  socket = new FakeGameSocket();
  socket.emitWithAck.mockResolvedValue({ ok: true });
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket), PlacementStore] });
});

afterEach(() => {
  TestBed.inject(GameStateService).clear();
});

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('PLACEMENT_FEEDBACK', () => {
  it('pins the values', () => {
    expect(Object.values(PLACEMENT_FEEDBACK)).toEqual([
      'selected',
      'placed',
      'rotated',
      'removed',
      'refused',
      'randomized',
      'no-ship-selected',
    ]);
  });
});

describe('PlacementStore', () => {
  it("starts from the server's draft, without the derived coordinates", () => {
    createStore({ myShips: [toPlacedShip(CARRIER)] });

    expect(store.draft()).toStrictEqual([CARRIER]);
    expect(store.ships()).toEqual([toPlacedShip(CARRIER)]);
  });

  describe('tap a ship, tap a cell', () => {
    beforeEach(() => {
      createStore();
    });

    it('places the ship from the dock with the tapped cell as its start, and sends the whole draft', () => {
      store.selectShip(SHIP_TYPES.CARRIER);
      store.activateCell({ x: 0, y: 0 });

      expect(store.draft()).toEqual([CARRIER]);
      expect(sentDrafts()).toStrictEqual([[CARRIER]]);
      expect(store.feedback()).toEqual({ kind: PLACEMENT_FEEDBACK.PLACED, placement: CARRIER });
    });

    it('keeps the ship selected, so the next tap on water moves it', () => {
      store.selectShip(SHIP_TYPES.CARRIER);
      store.activateCell({ x: 0, y: 0 });
      store.activateCell({ x: 2, y: 4 });

      const moved = { ...CARRIER, start: { x: 2, y: 4 } };
      expect(store.draft()).toEqual([moved]);
      expect(store.selectedCells()).toEqual(toPlacedShip(moved).coordinates);
      expect(sentDrafts()).toStrictEqual([[CARRIER], [moved]]);
    });

    it('fits a ship tapped too close to the edge onto the board', () => {
      store.selectShip(SHIP_TYPES.CARRIER);
      store.activateCell({ x: 8, y: 9 });

      expect(store.draft()).toEqual([{ ...CARRIER, start: { x: 5, y: 9 } }]);
    });

    it('says to pick a ship first when water is tapped with none selected, and sends nothing', () => {
      store.activateCell({ x: 3, y: 3 });

      expect(store.feedback()).toEqual({ kind: PLACEMENT_FEEDBACK.NO_SHIP_SELECTED });
      expect(socket.emitWithAck).not.toHaveBeenCalled();
    });

    it('selects a placed ship when one of its cells is tapped', () => {
      store.selectShip(SHIP_TYPES.CARRIER);
      store.activateCell({ x: 0, y: 0 });
      store.selectShip(SHIP_TYPES.DESTROYER);
      store.activateCell({ x: 3, y: 0 });

      expect(store.selected()).toEqual({
        type: SHIP_TYPES.CARRIER,
        placement: CARRIER,
        orientation: CARRIER.orientation,
      });
      expect(store.feedback()).toMatchObject({ kind: PLACEMENT_FEEDBACK.SELECTED, isPlaced: true });
      expect(sentDrafts()).toHaveLength(1);
    });

    it('clears the selection when the selected ship is tapped in the dock again', () => {
      store.selectShip(SHIP_TYPES.CRUISER);
      store.selectShip(SHIP_TYPES.CRUISER);

      expect(store.selected()).toBeNull();
    });

    it('previews a refused position with its reason, sending nothing and keeping the draft', () => {
      store.selectShip(SHIP_TYPES.CARRIER);
      store.activateCell({ x: 0, y: 0 });
      store.selectShip(SHIP_TYPES.DESTROYER);
      store.activateCell({ x: 5, y: 1 });

      expect(store.draft()).toEqual([CARRIER]);
      expect(store.invalidPreview()).toEqual([
        { x: 5, y: 1 },
        { x: 6, y: 1 },
      ]);
      expect(store.feedback()).toEqual({
        kind: PLACEMENT_FEEDBACK.REFUSED,
        ship: SHIP_TYPES.DESTROYER,
        reason: PLACEMENT_VIOLATIONS.ADJACENT_SHIPS,
      });
      expect(sentDrafts()).toHaveLength(1);

      store.activateCell({ x: 7, y: 7 });

      expect(store.invalidPreview()).toEqual([]);
      expect(store.draft()).toHaveLength(2);
    });
  });

  describe('rotate and remove', () => {
    beforeEach(() => {
      createStore({ myShips: [toPlacedShip(CARRIER), toPlacedShip(DESTROYER)] });
    });

    it('turns the direction a ship from the dock will be placed in', () => {
      store.selectShip(SHIP_TYPES.CRUISER);
      store.rotate();
      store.activateCell({ x: 9, y: 2 });

      expect(store.draft()).toContainEqual({
        type: SHIP_TYPES.CRUISER,
        start: { x: 9, y: 2 },
        orientation: ORIENTATIONS.VERTICAL,
      });
    });

    it('turns a placed ship about its start and sends the draft', () => {
      store.activateCell({ x: 0, y: 0 });
      store.rotate();

      const turned = { ...CARRIER, orientation: ORIENTATIONS.VERTICAL };
      expect(store.draft()).toEqual([turned, DESTROYER]);
      expect(store.feedback()).toEqual({ kind: PLACEMENT_FEEDBACK.ROTATED, placement: turned });
      expect(sentDrafts()).toStrictEqual([[turned, DESTROYER]]);
    });

    it('previews a refused turn and keeps the ship as it was', () => {
      // A cruiser on H7–H9, one row above the destroyer: turned up from J9, the destroyer would touch it.
      store.selectShip(SHIP_TYPES.CRUISER);
      store.activateCell({ x: 6, y: 7 });
      const draft = store.draft();
      store.activateCell({ x: 8, y: 9 });
      store.rotate();

      expect(store.draft()).toEqual(draft);
      expect(store.feedback()).toEqual({
        kind: PLACEMENT_FEEDBACK.REFUSED,
        ship: SHIP_TYPES.DESTROYER,
        reason: PLACEMENT_VIOLATIONS.ADJACENT_SHIPS,
      });
      expect(store.invalidPreview()).toEqual([
        { x: 8, y: 8 },
        { x: 8, y: 9 },
      ]);
      expect(sentDrafts()).toHaveLength(1);
    });

    it('puts a placed ship back in the dock, still selected', () => {
      store.activateCell({ x: 4, y: 0 });
      store.remove();

      expect(store.draft()).toEqual([DESTROYER]);
      expect(store.selected()).toEqual({ type: SHIP_TYPES.CARRIER, placement: null, orientation: CARRIER.orientation });
      expect(sentDrafts()).toStrictEqual([[DESTROYER]]);
    });
  });

  it('randomizes a complete valid fleet and sends it without coordinates', () => {
    createStore({ myShips: [toPlacedShip(CARRIER)] });
    store.selectShip(SHIP_TYPES.CARRIER);

    store.randomize();

    expect(validateFleet(store.draft(), store.rules()).ok).toBe(true);
    expect(store.selected()).toBeNull();
    expect(store.feedback()).toEqual({ kind: PLACEMENT_FEEDBACK.RANDOMIZED });
    const [sent] = sentDrafts();
    expect(sent).toStrictEqual(store.draft());
    expect(Object.keys((sent as object[])[0] ?? {})).toEqual(['type', 'start', 'orientation']);
  });

  describe('confirm and unlock', () => {
    it('cannot confirm an incomplete fleet', async () => {
      createStore({ myShips: [toPlacedShip(CARRIER)] });

      expect(store.canConfirm()).toBe(false);
      expect(store.fleetViolation()).toBe(PLACEMENT_VIOLATIONS.INCOMPLETE_FLEET);
      await store.confirm();

      expect(socket.emitWithAck).not.toHaveBeenCalled();
    });

    it('locks a complete fleet, then follows the snapshot', async () => {
      createStore({ myShips: FULL_FLEET.map(toPlacedShip) });
      store.selectShip(SHIP_TYPES.CARRIER);
      const answer = holdNextReply();

      const confirming = store.confirm();

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
      expect(store.isLockPending()).toBe(true);
      expect(store.isEditable()).toBe(false);
      expect(store.selected()).toBeNull();

      answer({ ok: true });
      await confirming;
      receive({ myShips: FULL_FLEET.map(toPlacedShip), hasConfirmed: { me: true, opponent: false } });

      expect(store.isConfirmed()).toBe(true);
      expect(store.isEditable()).toBe(false);
      store.selectShip(SHIP_TYPES.DESTROYER);
      store.activateCell({ x: 9, y: 9 });
      store.randomize();
      expect(store.selected()).toBeNull();
      expect(socket.emitWithAck).toHaveBeenCalledOnce();
    });

    it('unlocks a locked fleet', async () => {
      createStore({ myShips: FULL_FLEET.map(toPlacedShip), hasConfirmed: { me: true, opponent: true } });

      await store.unlock();

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.UNLOCK_PLACEMENT, {});
      receive({ myShips: FULL_FLEET.map(toPlacedShip), hasConfirmed: { me: false, opponent: true } });
      expect(store.isEditable()).toBe(true);
      expect(store.isOpponentConfirmed()).toBe(true);
    });

    it('reports a refused lock change', async () => {
      createStore({ myShips: FULL_FLEET.map(toPlacedShip) });
      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: ERROR_CODES.INVALID_PLACEMENT });

      await store.confirm();

      expect(store.error()).toBe(ERROR_CODES.INVALID_PLACEMENT);
      expect(store.isLockPending()).toBe(false);
    });
  });

  describe('sync with the server (ADR-0054)', () => {
    beforeEach(() => {
      createStore();
    });

    it('keeps the local draft while an update waits for its ack', async () => {
      const answer = holdNextReply();
      store.selectShip(SHIP_TYPES.CARRIER);
      store.activateCell({ x: 0, y: 0 });

      // The opponent's change, sent before the server handled the update.
      receive({ hasConfirmed: { me: false, opponent: true } });

      expect(store.draft()).toEqual([CARRIER]);
      answer({ ok: true });
      await settle();
      receive({ myShips: [toPlacedShip(CARRIER)] });
      expect(store.draft()).toEqual([CARRIER]);
    });

    it("takes the server's draft from a snapshot while no update is in flight", () => {
      receive({ myShips: [toPlacedShip(DESTROYER)] });

      expect(store.draft()).toEqual([DESTROYER]);
    });

    it("puts back the server's draft and reports a failed update", async () => {
      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: TRANSPORT_ERRORS.NOT_CONNECTED });
      store.selectShip(SHIP_TYPES.CARRIER);
      store.activateCell({ x: 0, y: 0 });
      await settle();

      expect(store.draft()).toEqual([]);
      expect(store.error()).toBe(TRANSPORT_ERRORS.NOT_CONNECTED);

      store.activateCell({ x: 0, y: 0 });
      await settle();
      expect(store.error()).toBeNull();
    });
  });
});
