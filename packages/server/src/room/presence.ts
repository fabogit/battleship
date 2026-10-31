// Seat presence as pure transitions (docs/server.md#seat-presence, ADR-0072): a seat losing or getting back its sockets,
// the disconnect forfeit and `LEAVE_ROOM`. Room logic never sees sockets; the socket layer reports what they did.

import {
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  GAME_OVER_REASONS,
  otherSeat,
  ROOM_PHASES,
  SEATS,
  type Seat,
} from '@battleship/core';

import {
  endMatch,
  pauseTurnTimer,
  resumeTurnTimer,
  type NegotiationRoom,
  type PlacementRoom,
  type RejectedTransition,
  type RoomState,
  type WaitingRoom,
} from './room.js';

/** A room before its match starts, where freeing a seat sends the other player back to `WAITING_FOR_OPPONENT`. */
type PreGameRoom = WaitingRoom | NegotiationRoom | PlacementRoom;

/** The forfeit a room is waiting for: the seat that has been away longest, and when it runs out. */
export interface PendingForfeit {
  /** The seat that will be forfeited first. */
  readonly seat: Seat;
  /** Its deadline in epoch ms: `DISCONNECT_FORFEIT_MS` after the seat lost its last socket. */
  readonly at: number;
}

/** An accepted `LEAVE_ROOM`. */
export interface LeftRoom {
  /** Discriminant: the ack reports success. */
  readonly ok: true;
  /** The room after the seat was freed, or `null` when nobody is left in it and it closes (ADR-0073). */
  readonly state: RoomState | null;
}

/**
 * Records that a seat lost its last socket (ADR-0072): its forfeit clock starts, and a match in progress pauses, which
 * freezes the turn timer (ADR-0008, ADR-0074). A seat already away, or an empty one, is left as it is.
 * @param state The room, in any phase.
 * @param seat The seat no socket is bound to any more.
 * @param now Current time in epoch ms; the forfeit clock counts from it, and the turn timer freezes at it.
 * @returns The room after the drop; the same object when nothing changed.
 */
export function disconnectSeat(state: RoomState, seat: Seat, now: number): RoomState {
  if (state.players[seat] === null || state.disconnectedAt[seat] !== null) {
    return state;
  }
  const disconnectedAt = { ...state.disconnectedAt, [seat]: now };
  return state.phase === ROOM_PHASES.IN_PROGRESS
    ? pauseTurnTimer({ ...state, disconnectedAt }, now)
    : { ...state, disconnectedAt };
}

/**
 * Records that a socket is bound to a seat again (ADR-0072): its forfeit clock stops, and a paused match resumes once
 * both seats are connected, its turn timer running again with the time it had left (ADR-0074). A connected seat is
 * left as it is.
 * @param state The room, in any phase.
 * @param seat The seat a socket came back to.
 * @param now Current time in epoch ms; a resumed turn timer runs from it.
 * @returns The room after the return; the same object when nothing changed.
 */
export function reconnectSeat(state: RoomState, seat: Seat, now: number): RoomState {
  if (state.disconnectedAt[seat] === null) {
    return state;
  }
  const disconnectedAt = { ...state.disconnectedAt, [seat]: null };
  if (state.phase === ROOM_PHASES.IN_PROGRESS) {
    // The opponent may still be away: the match stays paused, and the returning player may resume it with SET_PAUSED.
    const returned = { ...state, disconnectedAt };
    return disconnectedAt[otherSeat(seat)] === null ? resumeTurnTimer(returned, now) : returned;
  }
  return { ...state, disconnectedAt };
}

/**
 * When a seat will be forfeited, if it is away.
 * @param state The room, in any phase.
 * @param seat The seat to look at.
 * @returns The deadline in epoch ms, or `null` while the seat is connected or empty, and in `GAME_OVER`, where the
 * match is decided and the room lives by its TTL (docs/server.md#room-lifecycle).
 */
export function forfeitDeadline(state: RoomState, seat: Seat): number | null {
  const since = state.disconnectedAt[seat];
  return since === null || state.phase === ROOM_PHASES.GAME_OVER ? null : since + DISCONNECT_FORFEIT_MS;
}

/**
 * The next forfeit of a room: the seat that has been away longest, `P1` first on a tie.
 * @param state The room, in any phase.
 * @returns The seat and its deadline, or `null` when no forfeit clock runs.
 */
export function nextForfeit(state: RoomState): PendingForfeit | null {
  let next: PendingForfeit | null = null;
  for (const seat of Object.values(SEATS)) {
    const at = forfeitDeadline(state, seat);
    if (at !== null && (next === null || at < next.at)) {
      next = { seat, at };
    }
  }
  return next;
}

/**
 * Forfeits a seat whose player stayed away for `DISCONNECT_FORFEIT_MS` (docs/server.md#disconnection-in-other-phases):
 * before the match the seat is freed; during it the opponent wins with `DISCONNECT_FORFEIT`, connected or not.
 * @param state The room, in a phase where `forfeitDeadline` is set for the seat.
 * @param seat The seat whose clock ran out.
 * @returns The room after the forfeit, or `null` when nobody is left in it and it closes.
 */
export function forfeitSeat(state: RoomState, seat: Seat): RoomState | null {
  switch (state.phase) {
    case ROOM_PHASES.WAITING_FOR_OPPONENT:
    case ROOM_PHASES.RULES_NEGOTIATION:
    case ROOM_PHASES.PLACEMENT:
      return freeSeat(state, seat);
    case ROOM_PHASES.IN_PROGRESS:
      return endMatch(state, state.battle, otherSeat(seat), GAME_OVER_REASONS.DISCONNECT_FORFEIT);
    case ROOM_PHASES.GAME_OVER:
      return state;
  }
}

/**
 * Frees the sender's seat (`LEAVE_ROOM`, docs/server.md#leaving), with the same effect as a forfeit before the match.
 * @param state The sender's room.
 * @param seat The sender's seat.
 * @returns The room after the seat was freed, `null` when the room closes, or `NOT_ALLOWED` in `IN_PROGRESS`, where
 * leaving is a surrender (#35), and in `GAME_OVER`, where it is a rematch choice (#36).
 */
export function leaveRoom(state: RoomState, seat: Seat): LeftRoom | RejectedTransition {
  if (
    state.phase === ROOM_PHASES.WAITING_FOR_OPPONENT ||
    state.phase === ROOM_PHASES.RULES_NEGOTIATION ||
    state.phase === ROOM_PHASES.PLACEMENT
  ) {
    return { ok: true, state: freeSeat(state, seat) };
  }
  return { ok: false, error: ERROR_CODES.NOT_ALLOWED };
}

/**
 * Removes a player before the match (ADR-0073): the other player, if any, goes back to `WAITING_FOR_OPPONENT` in the
 * seat they had, with the rules and their version kept, edits during negotiation included, and the confirmations and
 * fleets cleared (ADR-0083). Their own forfeit clock keeps running if they are away.
 * @param state The room in `WAITING_FOR_OPPONENT`, `RULES_NEGOTIATION` or `PLACEMENT`.
 * @param seat The seat to free.
 * @returns The waiting room, or `null` when the freed seat was the last one taken.
 */
function freeSeat(state: PreGameRoom, seat: Seat): WaitingRoom | null {
  const stayer = otherSeat(seat);
  const remaining = state.players[stayer];
  if (remaining === null) {
    return null;
  }
  return {
    phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
    roomId: state.roomId,
    rules: state.rules,
    rulesVersion: state.rulesVersion,
    players: stayer === SEATS.P1 ? { P1: remaining, P2: null } : { P1: null, P2: remaining },
    disconnectedAt: { ...state.disconnectedAt, [seat]: null },
  };
}
