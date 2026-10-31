import { DestroyRef, Service, inject } from '@angular/core';
import { CLIENT_EVENTS, SERVER_EVENTS, type ErrorCode } from '@battleship/core';

import { GameSocketService, TRANSPORT_ERRORS, type TransportError } from './game-socket';
import { GameStateService } from './game-state';
import { SessionStore } from './session-store';

/** Why creating or joining a room failed: the server's refusal, or no reply at all (ADR-0035). */
export type RoomEntryError = ErrorCode | TransportError;

/** The outcome of `RoomEntryService.leave`. */
export type RoomLeaveResult =
  | {
      /** The seat is free and the tab is in no room. */
      readonly ok: true;
    }
  | {
      /** The player still holds the seat, or may: after `NO_ACK` the next `STATE` or handshake tells. */
      readonly ok: false;
      /** Why; `NOT_ALLOWED` once the match has started (docs/server.md#leaving). */
      readonly error: RoomEntryError;
    };

/** The outcome of `RoomEntryService.create` or `join`. */
export type RoomEntryResult =
  | {
      /** The player holds a seat in the room. */
      readonly ok: true;
      /** The room's id, as in its `/r/<roomId>` link. */
      readonly roomId: string;
    }
  | {
      /** The player has no seat. */
      readonly ok: false;
      /** Why; `ROOM_NOT_FOUND` and `ROOM_FULL` have their own screens (docs/client.md#routes--lobby-flow). */
      readonly error: RoomEntryError;
    };

/**
 * Takes a seat: `CREATE_ROOM` from the home screen, `JOIN_ROOM` from a room link (docs/protocol.md#client--server), or
 * the stored seat of a room link opened in a new tab; and gives it up before the match with `LEAVE_ROOM`. The
 * credentials of an accepted command go to `SessionStore`; the room itself arrives as `STATE` in `GameStateService`.
 * A room the server closes (`ROOM_CLOSED`) loses its seat the same way.
 */
@Service()
export class RoomEntryService {
  /** Sends `CREATE_ROOM` and `JOIN_ROOM`, and waits for their acks. */
  private readonly socket = inject(GameSocketService);
  /** Where an accepted command's credentials go, for the reconnection that restores the seat. */
  private readonly sessions = inject(SessionStore);
  /** Forgets the room's snapshot once the seat is given up: the server sends the leaver nothing more. */
  private readonly gameState = inject(GameStateService);

  /**
   * Drops the seat and the snapshot of a room the server closes (`ROOM_CLOSED`, ADR-0097): the server sends nothing
   * more for it, and the room page explains why it closed. Stops listening with the injector.
   */
  constructor() {
    const stopListening = this.socket.on(SERVER_EVENTS.ROOM_CLOSED, ({ roomId, reason }) => {
      this.sessions.close(roomId, reason);
      if (this.gameState.snapshot()?.roomId === roomId) {
        this.gameState.clear();
      }
    });
    inject(DestroyRef).onDestroy(stopListening);
  }

  /**
   * Opens a new room with the sender as `P1`.
   * @param nickname The player's nickname, already trimmed and checked with core's `parseNickname`.
   * @returns The new room's id, or why it was not created (`SERVER_FULL` above `MAX_ROOMS`).
   */
  async create(nickname: string): Promise<RoomEntryResult> {
    const response = await this.socket.emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname });
    if (!response.ok) {
      return this.failure(response.error);
    }
    this.sessions.save({ roomId: response.roomId, playerSecret: response.playerSecret });
    return { ok: true, roomId: response.roomId };
  }

  /**
   * Takes the free seat of a waiting room: `P2`, or `P1` when the creator left before the match (ADR-0073). Forgets a
   * snapshot of the same room first: it belongs to a seat the server no longer knows (ADR-0076).
   * @param roomId The id from the room link, already checked with core's `isRoomId`.
   * @param nickname The player's nickname, already trimmed and checked with core's `parseNickname`.
   * @returns The room's id, or why the seat was refused (`ROOM_NOT_FOUND`, `ROOM_FULL`).
   */
  async join(roomId: string, nickname: string): Promise<RoomEntryResult> {
    // A snapshot of this room from a seat the server refused is stale: the new seat's `STATE` follows the ack.
    if (this.gameState.snapshot()?.roomId === roomId) {
      this.gameState.clear();
    }
    const response = await this.socket.emitWithAck(CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname });
    if (!response.ok) {
      return this.failure(response.error);
    }
    this.sessions.save({ roomId, playerSecret: response.playerSecret });
    return { ok: true, roomId };
  }

  /**
   * Takes back the stored seat of a room opened in a tab that is in no room yet, such as a new tab on the room link:
   * the room becomes the tab's current one, and the handshake sends its credentials (ADR-0069). Does nothing in a tab
   * that is already in a room, or without stored credentials for this one.
   * @param roomId The id from the room link, already checked with core's `isRoomId`.
   */
  reopen(roomId: string): void {
    if (this.sessions.enter(roomId)) {
      this.socket.reconnect();
    }
  }

  /**
   * Gives up the seat before the match (`LEAVE_ROOM`, docs/server.md#leaving, ADR-0078): the opponent, if any, goes
   * back to waiting, and the stored credentials and the room's snapshot are dropped, so the room link shows the join
   * form.
   * @param roomId The room the tab is in, from the address.
   * @returns Whether the seat was given up, or why not; a refusal keeps the credentials and the snapshot.
   */
  async leave(roomId: string): Promise<RoomLeaveResult> {
    const response = await this.socket.emitWithAck(CLIENT_EVENTS.LEAVE_ROOM, {});
    if (!response.ok) {
      return this.failure(response.error);
    }
    this.sessions.forget(roomId);
    this.gameState.clear();
    return { ok: true };
  }

  /**
   * Turns a failed command into its result. Without an ack the server may have seated the socket in a room the client
   * does not know, or freed its seat, while the client still follows the room it was in: the socket reconnects, and
   * the handshake binds it to that room again, or to none (ADR-0070, #52 F1).
   * @param error Why the command failed.
   * @returns The failed result.
   */
  private failure(error: RoomEntryError): { readonly ok: false; readonly error: RoomEntryError } {
    if (error === TRANSPORT_ERRORS.NO_ACK) {
      this.socket.reconnect();
    }
    return { ok: false, error };
  }
}
