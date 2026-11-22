// Seat presence as pure transitions (docs/server.md#seat-presence, ADR-0072): a seat losing or getting back its sockets,
// the disconnect forfeit and `LEAVE_ROOM`. Room logic never sees sockets; the socket layer reports what they did.

import { DISCONNECT_FORFEIT_MS, GAME_OVER_REASONS, otherSeat, ROOM_PHASES, SEATS, type Seat } from '@battleship/core';

import {
  endMatch,
  pauseTurnTimer,
  resolveRematch,
  resumeTurnTimer,
  surrender,
  type GameOverRoom,
  type NegotiationRoom,
  type PlacementRoom,
  type RoomPlayer,
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

/**
 * An accepted `LEAVE_ROOM` (docs/server.md#leaving). Before the match and at game over the seat is freed: the room
 * waits for a player again, or closes when nobody is left in it (ADR-0073, ADR-0123). During the match the seat stays,
 * and the match ends as a surrender (ADR-0116), so the room is in `GAME_OVER`.
 */
export interface LeftRoom {
  /** Discriminant: the ack reports success. */
  readonly ok: true;
  /**
   * The room after the leave: `WAITING_FOR_OPPONENT` or `null` when the seat was freed, `GAME_OVER` when the match
   * ended with the seat still taken.
   */
  readonly state: WaitingRoom | GameOverRoom | null;
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
 * both seats are connected, its turn timer running again with the time it had left (ADR-0074). At game over, a rematch
 * both seats chose resolves now that both are connected (ADR-0124). A connected seat is left as it is.
 * @param state The room, in any phase.
 * @param seat The seat a socket came back to.
 * @param now Current time in epoch ms; a resumed turn timer runs from it, and so does the deadline of a placement the
 * rematch starts.
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
  if (state.phase === ROOM_PHASES.GAME_OVER) {
    return resolveRematch({ ...state, disconnectedAt }, now);
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
 * Leaves the sender's room (`LEAVE_ROOM`, docs/server.md#leaving). Before the match it frees the seat, with the same
 * effect as a forfeit then. During the match it is a surrender (ADR-0116): the seat stays and the opponent wins. At
 * game over it is the `LEAVE` rematch choice, which frees the seat at once (ADR-0123).
 * @param state The sender's room.
 * @param seat The sender's seat.
 * @returns The waiting room after the seat was freed, `null` when the room closes, or the room in `GAME_OVER` after a
 * surrender.
 */
export function leaveRoom(state: RoomState, seat: Seat): LeftRoom {
  switch (state.phase) {
    case ROOM_PHASES.WAITING_FOR_OPPONENT:
    case ROOM_PHASES.RULES_NEGOTIATION:
    case ROOM_PHASES.PLACEMENT:
      return { ok: true, state: freeSeat(state, seat) };
    case ROOM_PHASES.IN_PROGRESS:
      return { ok: true, state: surrender(state, seat) };
    case ROOM_PHASES.GAME_OVER:
      return { ok: true, state: leaveGameOver(state, seat) };
  }
}

/**
 * Removes a player at game over, the `LEAVE` rematch choice (ADR-0123): the other player goes to
 * `WAITING_FOR_OPPONENT` in the seat they had, with the rules and their version kept and their rematch choice dropped.
 * Both seats are taken in `GAME_OVER`, so the room never closes here. A player left behind who is away keeps the time
 * they dropped, so their forfeit clock, stopped at game over, runs again from it (docs/roadmap.md, the forfeit bound).
 * @param state The room in `GAME_OVER`.
 * @param seat The seat to free.
 * @returns The waiting room.
 */
export function leaveGameOver(state: GameOverRoom, seat: Seat): WaitingRoom {
  return waitingFor(state, seat, state.players[otherSeat(seat)]);
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
  const remaining = state.players[otherSeat(seat)];
  return remaining === null ? null : waitingFor(state, seat, remaining);
}

/**
 * Builds the room the player left behind waits in: their seat, the room's rules and version, the freed seat empty and
 * connected, their own drop time kept.
 * @param state The room the seat is freed from.
 * @param seat The seat to free.
 * @param remaining The player in the other seat.
 * @returns The waiting room.
 */
function waitingFor(state: RoomState, seat: Seat, remaining: RoomPlayer): WaitingRoom {
  return {
    phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
    roomId: state.roomId,
    rules: state.rules,
    rulesVersion: state.rulesVersion,
    players: seat === SEATS.P2 ? { P1: remaining, P2: null } : { P1: null, P2: remaining },
    disconnectedAt: { ...state.disconnectedAt, [seat]: null },
  };
}
