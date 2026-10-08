import { Service, inject } from '@angular/core';
import { CLIENT_EVENTS, type ErrorCode } from '@battleship/core';

import { GameSocketService, type TransportError } from './game-socket';
import { SessionStore } from './session-store';

/** Why creating or joining a room failed: the server's refusal, or no reply at all (ADR-0035). */
export type RoomEntryError = ErrorCode | TransportError;

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
 * Takes a seat: `CREATE_ROOM` from the home screen, `JOIN_ROOM` from a room link (docs/protocol.md#client--server). The
 * credentials of an accepted command go to `SessionStore`; the room itself arrives as `STATE` in `GameStateService`.
 */
@Service()
export class RoomEntryService {
  private readonly socket = inject(GameSocketService);
  private readonly sessions = inject(SessionStore);

  /**
   * Opens a new room with the sender as `P1`.
   * @param nickname The player's nickname, already trimmed and checked with core's `parseNickname`.
   * @returns The new room's id, or why it was not created (`SERVER_FULL` above `MAX_ROOMS`).
   */
  async create(nickname: string): Promise<RoomEntryResult> {
    const response = await this.socket.emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname });
    if (!response.ok) {
      return { ok: false, error: response.error };
    }
    this.sessions.save({ roomId: response.roomId, playerSecret: response.playerSecret });
    return { ok: true, roomId: response.roomId };
  }

  /**
   * Takes the free seat of a waiting room as `P2`.
   * @param roomId The id from the room link, already checked with core's `isRoomId`.
   * @param nickname The player's nickname, already trimmed and checked with core's `parseNickname`.
   * @returns The room's id, or why the seat was refused (`ROOM_NOT_FOUND`, `ROOM_FULL`).
   */
  async join(roomId: string, nickname: string): Promise<RoomEntryResult> {
    const response = await this.socket.emitWithAck(CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname });
    if (!response.ok) {
      return { ok: false, error: response.error };
    }
    this.sessions.save({ roomId, playerSecret: response.playerSecret });
    return { ok: true, roomId };
  }
}
