import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ERROR_CODES, ROOM_PHASES, isRoomId } from '@battleship/core';

import { CONNECTION_STATUSES, GameSocketService } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { RoomEntryService, type RoomEntryError } from '../../core/room-entry';
import { roomEntryErrorMessage } from '../../core/room-entry.text';
import { SessionStore } from '../../core/session-store';
import { NicknameForm } from '../../shared/nickname-form/nickname-form';
import { Battle } from '../battle/battle';
import { Lobby } from '../lobby/lobby';
import { Placement } from '../placement/placement';
import { ROOM_TEXT } from './room.text';

/** What the room page shows, as `Room.view` picks it (docs/client.md#routes--lobby-flow). */
export const ROOM_VIEWS = {
  /** No seat in this room yet: the nickname form and "Join room". */
  JOIN: 'join',
  /** Seated, waiting for the room's first `STATE`. */
  ENTERING: 'entering',
  /** `WAITING_FOR_OPPONENT`, and `RULES_NEGOTIATION` until its rules part lands (#27): the waiting screen. */
  LOBBY: 'lobby',
  /** `PLACEMENT`: the fleet placement view. */
  PLACEMENT: 'placement',
  /** `IN_PROGRESS` and `GAME_OVER`: the battle view, which turns into the game-over screen (ADR-0058). */
  BATTLE: 'battle',
  /** A malformed link, or `ROOM_NOT_FOUND`. */
  NOT_FOUND: 'not-found',
  /** `ROOM_FULL`: both seats were taken when the player tried to join. */
  FULL: 'full',
} as const;

/** One of the `ROOM_VIEWS`. */
export type RoomView = (typeof ROOM_VIEWS)[keyof typeof ROOM_VIEWS];

/**
 * The page of one room, `/r/<roomId>`, for both players (ADR-0049). The creator lands here after "Create room" and
 * shares the page's own address; the joiner opens it, picks a nickname and takes the free seat. Which view it shows
 * follows from the snapshot, the stored session and the last join attempt.
 */
@Component({
  selector: 'app-room',
  imports: [Battle, Lobby, NicknameForm, Placement, RouterLink],
  templateUrl: './room.html',
  styleUrl: './room.css',
})
export class Room {
  /** The id from the address, bound by the router; untrusted until `isRoomId` accepts it. */
  readonly roomId = input.required<string>();

  /** Read for its status only: the join form waits for the connection. */
  private readonly socket = inject(GameSocketService);
  /** The latest snapshot, which decides the view once it arrives. */
  private readonly gameState = inject(GameStateService);
  /** A stored seat for this room means the player is already in: no join form. */
  private readonly sessions = inject(SessionStore);
  /** Sends `JOIN_ROOM` for the join form. */
  private readonly roomEntry = inject(RoomEntryService);

  /** The words of the page. */
  protected readonly text = ROOM_TEXT;
  /** The views, for the template's `@switch`. */
  protected readonly views = ROOM_VIEWS;
  /** Whether commands can be sent, which the join form needs before it submits. */
  protected readonly isConnected = computed(() => this.socket.status() === CONNECTION_STATUSES.CONNECTED);

  /** Why the last join attempt failed; reset when the address names another room. */
  private readonly joinError = linkedSignal<string, RoomEntryError | null>({
    source: this.roomId,
    computation: () => null,
  });

  /** The latest snapshot when it belongs to this room, else `null` (it may still be another room's). */
  protected readonly snapshot = computed(() => {
    const snapshot = this.gameState.snapshot();
    return snapshot?.roomId === this.roomId() ? snapshot : null;
  });

  /** What the page shows: the snapshot decides once it arrives, then the stored session, then the join attempt. */
  protected readonly view = computed<RoomView>(() => {
    const roomId = this.roomId();
    if (!isRoomId(roomId)) {
      return ROOM_VIEWS.NOT_FOUND;
    }
    const snapshot = this.snapshot();
    if (snapshot !== null) {
      switch (snapshot.phase) {
        case ROOM_PHASES.WAITING_FOR_OPPONENT:
        case ROOM_PHASES.RULES_NEGOTIATION:
          return ROOM_VIEWS.LOBBY;
        case ROOM_PHASES.PLACEMENT:
          return ROOM_VIEWS.PLACEMENT;
        case ROOM_PHASES.IN_PROGRESS:
        case ROOM_PHASES.GAME_OVER:
          return ROOM_VIEWS.BATTLE;
      }
    }
    if (this.sessions.get(roomId) !== null) {
      return ROOM_VIEWS.ENTERING;
    }
    switch (this.joinError()) {
      case ERROR_CODES.ROOM_NOT_FOUND:
        return ROOM_VIEWS.NOT_FOUND;
      case ERROR_CODES.ROOM_FULL:
        return ROOM_VIEWS.FULL;
      default:
        return ROOM_VIEWS.JOIN;
    }
  });

  /** The message for a failed join that keeps the form, or `null`. */
  protected readonly joinErrorMessage = computed(() => {
    const error = this.joinError();
    return error === null ? null : roomEntryErrorMessage(error);
  });

  /**
   * Takes the free seat; the page then follows the snapshot. An arrow function, so the form can call it without losing
   * `this`.
   * @param nickname The trimmed nickname.
   */
  protected readonly join = async (nickname: string): Promise<void> => {
    this.joinError.set(null);
    const result = await this.roomEntry.join(this.roomId(), nickname);
    if (!result.ok) {
      this.joinError.set(result.error);
    }
  };
}
