import {
  CLIENT_EVENTS,
  createPlayerSecret,
  createSeededRng,
  DEFAULT_RULES,
  generateRandomFleet,
  generateRoomId,
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
  endPlacement,
  placementEndsAt,
  type AcceptedTransition,
  type BattleRoom,
  type NegotiationRoom,
  type PlacementRoom,
  type RoomCommand,
  type RoomState,
  type TransitionResult,
  type WaitingRoom,
} from '../../src/room/room.js';

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

/** The room right after Bob joined Alice's: both seated, negotiating `DEFAULT_RULES` at version `0`. */
export function negotiationRoom(): NegotiationRoom {
  const state = apply(waitingRoom(), {
    type: CLIENT_EVENTS.JOIN_ROOM,
    payload: { roomId: ROOM_ID, nickname: 'Bob' },
    playerSecret: P2_SECRET,
  });
  expect(state.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
  return state as NegotiationRoom;
}

/**
 * Both players confirm the rules in place, `P1` first, which starts placement.
 * @param state A room in `RULES_NEGOTIATION`.
 * @param now When the second confirmation lands; the placement deadline counts from it.
 */
export function agreeOnRules(state: NegotiationRoom, now = NOW): PlacementRoom {
  const payload = { rulesVersion: state.rulesVersion };
  const confirmed = apply(state, { type: CLIENT_EVENTS.CONFIRM_RULES, seat: SEATS.P1, payload }, now);
  const placement = apply(confirmed, { type: CLIENT_EVENTS.CONFIRM_RULES, seat: SEATS.P2, payload }, now);
  expect(placement.phase).toBe(ROOM_PHASES.PLACEMENT);
  return placement as PlacementRoom;
}

/** A room in placement with `DEFAULT_RULES`, entered at `now`. */
export function placementRoom(now = NOW): PlacementRoom {
  return agreeOnRules(negotiationRoom(), now);
}

export function placeAndConfirm(state: RoomState, seat: Seat, ships: readonly ShipPlacement[]): RoomState {
  const placed = apply(state, { type: CLIENT_EVENTS.UPDATE_PLACEMENT, seat, payload: { ships } });
  return apply(placed, { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat, payload: {} });
}

/**
 * Ends placement as the `PLACEMENT` timer does, at its due time.
 * @param state A room in `PLACEMENT`.
 * @param seed Seed of the fleets completed at the deadline; unused after a countdown.
 */
export function endPlacementNow(state: RoomState, seed = 0): BattleRoom {
  expect(state.phase).toBe(ROOM_PHASES.PLACEMENT);
  const placement = state as PlacementRoom;
  const ended = endPlacement(placement, placementEndsAt(placement), createSeededRng(seed));
  if (ended === null) {
    expect.fail('Expected placement to end at its due time');
  }
  return ended.state;
}

/** A room in battle with fleets from seeds 1 (P1) and 2 (P2), started by the end of the start countdown. */
export function battleRoom(): BattleRoom {
  return endPlacementNow(placeAndConfirm(placeAndConfirm(placementRoom(), SEATS.P1, fleet(1)), SEATS.P2, fleet(2)));
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
