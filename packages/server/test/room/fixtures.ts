import {
  CLIENT_EVENTS,
  createSeededRng,
  DEFAULT_RULES,
  generateRandomFleet,
  ROOM_PHASES,
  SEATS,
  type PlacedShip,
  type Seat,
  type ShipPlacement,
} from '@battleship/core';
import { expect } from 'vitest';

import {
  applyCommand,
  createRoom,
  type AcceptedTransition,
  type BattleRoom,
  type PlacementRoom,
  type RoomCommand,
  type RoomState,
  type TransitionResult,
  type WaitingRoom,
} from '../../src/room/room.js';
import { createPlayerSecret, generateRoomId } from '../../src/room/room-manager.js';

export const NOW = 1_700_000_000_000;
export const ROOM_ID = generateRoomId(createSeededRng(0));
export const P1_SECRET = createPlayerSecret();
export const P2_SECRET = createPlayerSecret();

/** A complete random fleet as the client would send it: placements without derived coordinates. */
export function fleet(seed: number): ShipPlacement[] {
  return generateRandomFleet(DEFAULT_RULES, createSeededRng(seed)).map(({ type, start, orientation }) => ({
    type,
    start,
    orientation,
  }));
}

export function expectAccepted(result: TransitionResult): AcceptedTransition {
  if (!result.ok) {
    expect.fail(`Expected the command to be accepted, got ${result.error}`);
  }
  return result;
}

export function apply(state: RoomState, command: RoomCommand, now = NOW): RoomState {
  return expectAccepted(applyCommand(state, command, now)).state;
}

export function waitingRoom(): WaitingRoom {
  return createRoom(ROOM_ID, { nickname: 'Alice', playerSecret: P1_SECRET });
}

export function placementRoom(now = NOW): PlacementRoom {
  const state = apply(
    waitingRoom(),
    { type: CLIENT_EVENTS.JOIN_ROOM, payload: { roomId: ROOM_ID, nickname: 'Bob' }, playerSecret: P2_SECRET },
    now,
  );
  expect(state.phase).toBe(ROOM_PHASES.PLACEMENT);
  return state as PlacementRoom;
}

export function placeAndConfirm(state: RoomState, seat: Seat, ships: readonly ShipPlacement[]): RoomState {
  const placed = apply(state, { type: CLIENT_EVENTS.UPDATE_PLACEMENT, seat, payload: { ships } });
  return apply(placed, { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat, payload: {} });
}

/** A room in battle with fleets from seeds 1 (P1) and 2 (P2). */
export function battleRoom(): BattleRoom {
  const state = placeAndConfirm(placeAndConfirm(placementRoom(), SEATS.P1, fleet(1)), SEATS.P2, fleet(2));
  expect(state.phase).toBe(ROOM_PHASES.IN_PROGRESS);
  return state as BattleRoom;
}

/** Every cell of a fleet. */
export function cellsOf(ships: readonly PlacedShip[]): { x: number; y: number }[] {
  return ships.flatMap((ship) => ship.coordinates.map(({ x, y }) => ({ x, y })));
}

/** Freezes a value and everything reachable from it, so any mutation throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
