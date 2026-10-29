// Registry of the open rooms: ids, secrets, the room cap, and the stored state each transition replaces (ADR-0039).
// It has no timers: the socket handlers run the transitions their room timers call for (ADR-0065).

import {
  CLIENT_EVENTS,
  createCryptoRng,
  createPlayerSecret,
  ERROR_CODES,
  generateRoomId,
  MAX_ROOMS,
  ROOM_PHASES,
  SEATS,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type Rng,
  type Seat,
  type SessionCredentials,
} from '@battleship/core';

import {
  disconnectSeat,
  forfeitSeat,
  leaveRoom,
  nextForfeit,
  reconnectSeat,
  type LeftRoom,
  type PendingForfeit,
} from './presence.js';
import {
  applyCommand,
  createRoom,
  endPlacement,
  placementEndsAt,
  type EndedPlacement,
  type RejectedTransition,
  type RoomPlayer,
  type RoomState,
  type SeatCommand,
  type TransitionResult,
} from './room.js';

/** What a `RoomManager` draws its randomness from; production uses the defaults, tests inject both. */
export interface RoomManagerOptions {
  /** Source of room ids and of the fleets completed at the placement deadline; `createCryptoRng()` by default (ADR-0030). */
  readonly rng?: Rng;
  /** Source of player secrets; `createPlayerSecret` by default. */
  readonly createSecret?: () => string;
}

/** An accepted `CREATE_ROOM`. */
export interface CreatedRoom {
  /** Discriminant: the ack reports success. */
  readonly ok: true;
  /** The new room's id, for the ack and the share link. */
  readonly roomId: string;
  /** The creator's secret, for the ack only. */
  readonly playerSecret: string;
  /** The new room, already registered. */
  readonly state: RoomState;
}

/** An accepted `JOIN_ROOM`. */
export interface JoinedRoom {
  /** Discriminant: the ack reports success. */
  readonly ok: true;
  /** The joiner's secret, for the ack only. */
  readonly playerSecret: string;
  /** The seat the joiner took: `P2`, or `P1` when the creator left before (ADR-0073). */
  readonly seat: Seat;
  /** The room after the join, already stored. */
  readonly state: RoomState;
}

/** A forfeit that ran: which seat lost it, and the room after it. */
export interface ForfeitedSeat {
  /** The seat that stayed away for `DISCONNECT_FORFEIT_MS`. */
  readonly seat: Seat;
  /** The room after the forfeit, already stored, or `null` when nobody was left and the room was removed. */
  readonly state: RoomState | null;
}

/**
 * Keeps every open room in memory, by id (docs/server.md#room-lifecycle), and runs commands against them through
 * `applyCommand`, storing the state an accepted command returns. A room stays until a forfeit or `LEAVE_ROOM` leaves
 * nobody in it (`forfeitDue`, `leave`; ADR-0073), or until `remove`, which the socket handlers call when its game-over
 * TTL runs out (ADR-0065).
 */
export class RoomManager {
  /** The open rooms, by id. */
  readonly #rooms = new Map<string, RoomState>();
  /** Source of room ids and of completed fleets (ADR-0091). */
  readonly #rng: Rng;
  /** Source of player secrets. */
  readonly #createSecret: () => string;

  /**
   * Starts with no rooms. Production draws ids and secrets from crypto sources; tests inject seeded ones (ADR-0030).
   * @param options Randomness sources; production leaves them out.
   */
  constructor(options: RoomManagerOptions = {}) {
    this.#rng = options.rng ?? createCryptoRng();
    this.#createSecret = options.createSecret ?? createPlayerSecret;
  }

  /** How many rooms are open; at most `MAX_ROOMS`. */
  get size(): number {
    return this.#rooms.size;
  }

  /**
   * Looks up a room.
   * @param roomId An id from a payload or a socket binding; any string is safe to look up.
   * @returns The room's current state, or `undefined` when no open room has that id.
   */
  get(roomId: string): RoomState | undefined {
    return this.#rooms.get(roomId);
  }

  /**
   * Finds the seat a handshake `session` reopens (docs/server.md#sessions--reconnection, ADR-0063).
   * @param credentials The guard's copy of the session: a well-formed room id and secret.
   * @returns The open room with the seat whose secret matches, or `undefined` for an unknown room or secret, which the
   * handshake refuses as `SESSION_INVALID`.
   */
  findSeat(credentials: SessionCredentials): { readonly state: RoomState; readonly seat: Seat } | undefined {
    const state = this.#rooms.get(credentials.roomId);
    if (state === undefined) {
      return undefined;
    }
    const seat = seatOf(state, credentials.playerSecret);
    return seat === undefined ? undefined : { state, seat };
  }

  /**
   * Forgets a room, freeing its place under `MAX_ROOMS`; its id may be drawn again for a later room.
   * @param roomId The room to remove; an unknown id is ignored.
   * @returns Whether a room was removed.
   */
  remove(roomId: string): boolean {
    return this.#rooms.delete(roomId);
  }

  /**
   * Opens a room and seats the creator as `P1` (`CREATE_ROOM`), under a fresh id that no open room uses.
   * @param payload The guard's copy of the payload.
   * @returns The new room with its id and the creator's secret, or `SERVER_FULL` when `MAX_ROOMS` rooms are open.
   */
  createRoom(payload: CreateRoomPayload): CreatedRoom | RejectedTransition {
    if (this.#rooms.size >= MAX_ROOMS) {
      return { ok: false, error: ERROR_CODES.SERVER_FULL };
    }
    let roomId = generateRoomId(this.#rng);
    while (this.#rooms.has(roomId)) {
      roomId = generateRoomId(this.#rng);
    }
    const playerSecret = this.#createSecret();
    const state = createRoom(roomId, { nickname: payload.nickname, playerSecret });
    this.#rooms.set(roomId, state);
    return { ok: true, roomId, playerSecret, state };
  }

  /**
   * Seats the sender as `P2` of the room the payload names (`JOIN_ROOM`).
   * @param payload The guard's copy of the payload.
   * @param now Current time in epoch ms.
   * @returns The room after the join with the joiner's secret, or `ROOM_NOT_FOUND` / `ROOM_FULL`.
   */
  joinRoom(payload: JoinRoomPayload, now: number): JoinedRoom | RejectedTransition {
    const room = this.#rooms.get(payload.roomId);
    if (room === undefined) {
      return { ok: false, error: ERROR_CODES.ROOM_NOT_FOUND };
    }
    const playerSecret = this.#createSecret();
    const result = applyCommand(room, { type: CLIENT_EVENTS.JOIN_ROOM, payload, playerSecret }, now);
    if (!result.ok) {
      return result;
    }
    const seat = seatOf(result.state, playerSecret);
    if (seat === undefined) {
      throw new Error(`The joiner of room ${payload.roomId} has no seat`);
    }
    this.#rooms.set(payload.roomId, result.state);
    return { ok: true, playerSecret, seat, state: result.state };
  }

  /**
   * Runs a seated player's command against their room and stores the result.
   * @param roomId The sender's room, as the caller bound it to the socket.
   * @param command The command, with a payload that already passed its guard.
   * @param now Current time in epoch ms.
   * @returns The transition result, or `ROOM_NOT_FOUND` when the room is gone; a refused command leaves the room as
   * it was.
   */
  dispatch(roomId: string, command: SeatCommand, now: number): TransitionResult {
    const room = this.#rooms.get(roomId);
    if (room === undefined) {
      return { ok: false, error: ERROR_CODES.ROOM_NOT_FOUND };
    }
    const result = applyCommand(room, command, now);
    if (result.ok) {
      this.#rooms.set(roomId, result.state);
    }
    return result;
  }

  /**
   * Records whether a seat has a socket bound to it, as the socket layer counts them (ADR-0072).
   * @param roomId The seat's room.
   * @param seat The seat whose sockets changed.
   * @param isConnected Whether at least one socket is bound to the seat now.
   * @param now Current time in epoch ms; a drop starts the forfeit clock from it.
   * @returns The stored room after the change, or `undefined` when the room is gone or its presence did not change.
   */
  setPresence(roomId: string, seat: Seat, isConnected: boolean, now: number): RoomState | undefined {
    const room = this.#rooms.get(roomId);
    if (room === undefined) {
      return undefined;
    }
    const next = isConnected ? reconnectSeat(room, seat) : disconnectSeat(room, seat, now);
    if (next === room) {
      return undefined;
    }
    this.#rooms.set(roomId, next);
    return next;
  }

  /**
   * The forfeit a room waits for, which the socket layer schedules as a room timer (ADR-0072).
   * @param roomId The room to look at; an unknown id has none.
   * @returns The seat away longest with its deadline, or `undefined` when no forfeit clock runs.
   */
  nextForfeit(roomId: string): PendingForfeit | undefined {
    const room = this.#rooms.get(roomId);
    return (room === undefined ? null : nextForfeit(room)) ?? undefined;
  }

  /**
   * When a room's placement ends, which the socket layer schedules as the `PLACEMENT` room timer (ADR-0090).
   * @param roomId The room to look at; an unknown id has none.
   * @returns The end of the start countdown while both fleets are confirmed, else the deadline, in epoch ms;
   * `undefined` when the room is gone or not in `PLACEMENT`.
   */
  placementEndsAt(roomId: string): number | undefined {
    const room = this.#rooms.get(roomId);
    return room?.phase === ROOM_PHASES.PLACEMENT ? placementEndsAt(room) : undefined;
  }

  /**
   * Ends a room's placement if it is due, completing the unconfirmed fleets with the registry's `Rng` (ADR-0091), and
   * stores the room in battle.
   * @param roomId The room whose `PLACEMENT` timer ran out.
   * @param now Current time in epoch ms.
   * @returns The room in battle and the seats whose fleets were completed, or `undefined` when the room is gone, out of
   * `PLACEMENT`, or not due yet.
   */
  endPlacementDue(roomId: string, now: number): EndedPlacement | undefined {
    const room = this.#rooms.get(roomId);
    const ended = room?.phase === ROOM_PHASES.PLACEMENT ? endPlacement(room, now, this.#rng) : null;
    if (ended === null) {
      return undefined;
    }
    this.#rooms.set(roomId, ended.state);
    return ended;
  }

  /**
   * Runs a room's next forfeit if it is due, storing the room after it or removing a room nobody is left in.
   * @param roomId The room whose forfeit timer ran out.
   * @param now Current time in epoch ms.
   * @returns The forfeited seat and the room after it, or `undefined` when the room is gone or nothing is due.
   */
  forfeitDue(roomId: string, now: number): ForfeitedSeat | undefined {
    const room = this.#rooms.get(roomId);
    const due = room === undefined ? null : nextForfeit(room);
    if (room === undefined || due === null || due.at > now) {
      return undefined;
    }
    const state = forfeitSeat(room, due.seat);
    this.#store(roomId, state);
    return { seat: due.seat, state };
  }

  /**
   * Frees a seated player's seat (`LEAVE_ROOM`), removing the room when nobody is left in it.
   * @param roomId The sender's room, as the caller bound it to the socket.
   * @param seat The sender's seat.
   * @returns The room after the seat was freed (`null` once removed), `NOT_ALLOWED` once the match has started, or
   * `ROOM_NOT_FOUND` when the room is gone.
   */
  leave(roomId: string, seat: Seat): LeftRoom | RejectedTransition {
    const room = this.#rooms.get(roomId);
    if (room === undefined) {
      return { ok: false, error: ERROR_CODES.ROOM_NOT_FOUND };
    }
    const result = leaveRoom(room, seat);
    if (result.ok) {
      this.#store(roomId, result.state);
    }
    return result;
  }

  /**
   * Stores a room's new state, or removes the room when a transition left nobody in it.
   * @param roomId The room that changed.
   * @param state Its new state, or `null` to remove it.
   */
  #store(roomId: string, state: RoomState | null): void {
    if (state === null) {
      this.#rooms.delete(roomId);
    } else {
      this.#rooms.set(roomId, state);
    }
  }
}

/**
 * Finds the seat holding a secret.
 * @param state The room, in any phase.
 * @param playerSecret The secret to look for.
 * @returns The seat, or `undefined` when no seated player holds it.
 */
function seatOf(state: RoomState, playerSecret: string): Seat | undefined {
  const players: Readonly<Record<Seat, RoomPlayer | null>> = state.players;
  return Object.values(SEATS).find((candidate) => players[candidate]?.playerSecret === playerSecret);
}
