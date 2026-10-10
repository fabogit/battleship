// Registry of the open rooms: ids, secrets, the room cap, and the stored state each transition replaces (ADR-0039).

import { randomUUID } from 'node:crypto';

import {
  CLIENT_EVENTS,
  createCryptoRng,
  ERROR_CODES,
  MAX_ROOMS,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type Rng,
} from '@battleship/core';

import {
  applyCommand,
  createRoom,
  type RejectedTransition,
  type RoomState,
  type SeatCommand,
  type TransitionResult,
} from './room.js';

/** What a `RoomManager` draws its randomness from; production uses the defaults, tests inject both. */
export interface RoomManagerOptions {
  /** Source of room ids; `createCryptoRng()` by default (ADR-0030). */
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
  /** The room after the join, already stored. */
  readonly state: RoomState;
}

/**
 * Generates a player secret (docs/server.md#sessions--reconnection): a lowercase `crypto.randomUUID()`, which the
 * handshake's `parseSessionCredentials` accepts.
 * @returns A new secret, never sent to the other player.
 */
export function createPlayerSecret(): string {
  return randomUUID();
}

/**
 * Draws a room id: `ROOM_ID_LENGTH` characters of `ROOM_ID_ALPHABET`, each picked uniformly. It may collide with an
 * open room; `RoomManager` draws again when it does (ADR-0039).
 * @param rng Source of the characters.
 * @returns A well-formed id, accepted by the `JOIN_ROOM` guard.
 */
export function generateRoomId(rng: Rng): string {
  return Array.from({ length: ROOM_ID_LENGTH }, () =>
    ROOM_ID_ALPHABET.charAt(rng.nextInt(ROOM_ID_ALPHABET.length)),
  ).join('');
}

/**
 * Keeps every open room in memory, by id (docs/server.md#room-lifecycle), and runs commands against them through
 * `applyCommand`, storing the state an accepted command returns. Rooms are not removed yet: TTL sweeps land with #24.
 */
export class RoomManager {
  /** The open rooms, by id. */
  readonly #rooms = new Map<string, RoomState>();
  /** Source of room ids. */
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
    this.#rooms.set(payload.roomId, result.state);
    return { ok: true, playerSecret, state: result.state };
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
}
