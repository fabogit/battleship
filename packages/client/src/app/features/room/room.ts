import { Component, computed, effect, inject, input, linkedSignal, resource, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DISCONNECT_FORFEIT_MS, ERROR_CODES, GAME_OVER_TTL_MS, ROOM_PHASES, isRoomId } from '@battleship/core';

import { CONNECTION_STATUSES, GameSocketService } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { RoomEntryService, type RoomEntryError } from '../../core/room-entry';
import { roomEntryErrorMessage } from '../../core/room-entry.text';
import { ServerWakeService } from '../../core/server-wake';
import { SessionStore } from '../../core/session-store';
import { NicknameForm } from '../../shared/nickname-form/nickname-form';
import { Battle } from '../battle/battle';
import { Lobby } from '../lobby/lobby';
import { Placement } from '../placement/placement';
import { Presence } from '../presence/presence';
import { ROOM_TEXT } from './room.text';
import { SEAT_LOSSES, classifySeatLoss, type SeatLoss } from './seat-loss';

/** Milliseconds in a minute, to word `DISCONNECT_FORFEIT_MS` and `GAME_OVER_TTL_MS`. */
const MS_PER_MINUTE = 60_000;

/** What the room page shows, as `Room.view` picks it (docs/client.md#routes--lobby-flow). */
export const ROOM_VIEWS = {
  /** No seat in this room yet: the nickname form and "Join room". */
  JOIN: 'join',
  /** Seated, waiting for the room's first `STATE`. */
  ENTERING: 'entering',
  /** Seated once, but the tab has entered another room since, so this one sends it nothing more. */
  LEFT: 'left',
  /** `WAITING_FOR_OPPONENT`, and `RULES_NEGOTIATION` until its rules part lands (#27): the waiting screen. */
  LOBBY: 'lobby',
  /** `PLACEMENT`: the fleet placement view. */
  PLACEMENT: 'placement',
  /** `IN_PROGRESS` and `GAME_OVER`: the battle view, which turns into the game-over screen (ADR-0058). */
  BATTLE: 'battle',
  /** A malformed link, or `ROOM_NOT_FOUND` after a join attempt. */
  NOT_FOUND: 'not-found',
  /** Stored credentials the server refused (`SESSION_INVALID`), explained by `SeatLoss` (ADR-0076). */
  SEAT_LOST: 'seat-lost',
  /** `ROOM_FULL`: both seats were taken when the player tried to join. */
  FULL: 'full',
} as const;

/** One of the `ROOM_VIEWS`. */
export type RoomView = (typeof ROOM_VIEWS)[keyof typeof ROOM_VIEWS];

/** The views of a room the player sits in with its snapshot: the opponent's presence shows above them. */
const SEATED_VIEWS: ReadonlySet<RoomView> = new Set([ROOM_VIEWS.LOBBY, ROOM_VIEWS.PLACEMENT, ROOM_VIEWS.BATTLE]);

/** The views before the match, where "Leave room" gives up the seat (docs/server.md#leaving). */
const LEAVABLE_VIEWS: ReadonlySet<RoomView> = new Set([ROOM_VIEWS.LOBBY, ROOM_VIEWS.PLACEMENT]);

/** The seat losses after which the room may still wait for a player, so the page offers to join it again. */
const REJOINABLE_LOSSES: ReadonlySet<SeatLoss> = new Set([SEAT_LOSSES.GIVEN_UP, SEAT_LOSSES.UNKNOWN]);

/**
 * The page of one room, `/r/<roomId>`, for both players (ADR-0049). The creator lands here after "Create room" and
 * shares the page's own address; the joiner opens it, picks a nickname and takes the free seat. Which view it shows
 * follows from the snapshot, the stored session and the last join attempt.
 */
@Component({
  selector: 'app-room',
  imports: [Battle, Lobby, NicknameForm, Placement, Presence, RouterLink],
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
  /** Sends `JOIN_ROOM` for the join form and `LEAVE_ROOM` for "Leave room", and takes back a stored seat. */
  private readonly roomEntry = inject(RoomEntryService);
  /** Asked when the server started, to explain a refused seat (ADR-0076). */
  private readonly wake = inject(ServerWakeService);
  /** Goes home after "Leave room". */
  private readonly router = inject(Router);

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

  /**
   * What the page shows: a room whose stored seat the server refused explains why, until a join attempt says more, and
   * a room the tab has left stays left; otherwise the snapshot decides once it arrives, then the stored session, then
   * the join attempt.
   */
  protected readonly view = computed<RoomView>(() => {
    const roomId = this.roomId();
    if (!isRoomId(roomId)) {
      return ROOM_VIEWS.NOT_FOUND;
    }
    const joinError = this.joinError();
    // A refused seat holds no credentials: they come back with a new seat, which `JOIN_ROOM` takes here.
    if (this.sessions.wasRefused(roomId) && this.sessions.get(roomId) === null) {
      switch (joinError) {
        case ERROR_CODES.ROOM_NOT_FOUND:
          return ROOM_VIEWS.NOT_FOUND;
        case ERROR_CODES.ROOM_FULL:
          return ROOM_VIEWS.FULL;
        default:
          return ROOM_VIEWS.SEAT_LOST;
      }
    }
    if (this.sessions.hasLeft(roomId)) {
      return ROOM_VIEWS.LEFT;
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
    switch (joinError) {
      case ERROR_CODES.ROOM_NOT_FOUND:
        return ROOM_VIEWS.NOT_FOUND;
      case ERROR_CODES.ROOM_FULL:
        return ROOM_VIEWS.FULL;
      default:
        return ROOM_VIEWS.JOIN;
    }
  });

  /** Whether the opponent's presence shows above the view: the player sits in the room and has its snapshot. */
  protected readonly hasPresence = computed(() => SEATED_VIEWS.has(this.view()));

  /** Whether this tab saw the room's match end: a refused seat then belongs to a room that expired. */
  private readonly hasSeenGameOver = computed(() => this.snapshot()?.phase === ROOM_PHASES.GAME_OVER);

  /** When the server started, asked once the page shows a refused seat; `undefined` until it answers (ADR-0076). */
  private readonly serverStartedAt = resource({
    params: () => (this.view() === ROOM_VIEWS.SEAT_LOST ? { roomId: this.roomId() } : undefined),
    loader: () => this.wake.startedAt(),
  });

  /** Why the seat was refused, as far as the page can tell; `UNKNOWN` until the server's start time arrives. */
  protected readonly seatLoss = computed(() =>
    classifySeatLoss({
      hasSeenGameOver: this.hasSeenGameOver(),
      seatTakenAt: this.sessions.refusal(this.roomId())?.seatTakenAt ?? null,
      serverStartedAt: this.serverStartedAt.hasValue() ? this.serverStartedAt.value() : null,
    }),
  );

  /** The words for the refused seat. */
  protected readonly seatLossText = computed(() => {
    const text = this.text.seatLosses[this.seatLoss()];
    return {
      heading: text.heading,
      reason: text.reason(DISCONNECT_FORFEIT_MS / MS_PER_MINUTE, GAME_OVER_TTL_MS / MS_PER_MINUTE),
    };
  });

  /** Whether the refused room may still wait for a player, so the page offers the join form again. */
  protected readonly canRejoin = computed(() => REJOINABLE_LOSSES.has(this.seatLoss()));

  /** Whether "Leave room" is offered: before the match, while the player sits in the room. */
  protected readonly canLeave = computed(() => LEAVABLE_VIEWS.has(this.view()));

  /** Written by `leave` only; read through `isLeaving`. */
  private readonly isLeavingSignal = signal(false);
  /** Whether `LEAVE_ROOM` waits for its ack. */
  protected readonly isLeaving = this.isLeavingSignal.asReadonly();

  /** Why the last "Leave room" failed; reset when the address names another room. */
  private readonly leaveError = linkedSignal<string, RoomEntryError | null>({
    source: this.roomId,
    computation: () => null,
  });

  /** The message for a failed "Leave room", or `null`. */
  protected readonly leaveErrorMessage = computed(() => {
    const error = this.leaveError();
    return error === null ? null : (this.text.leaveErrors[error] ?? roomEntryErrorMessage(error));
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

  /**
   * Gives up the seat before the match, then goes home (ADR-0078); a failure stays on the page with its
   * message. Ignored while a leave is under way.
   */
  protected async leave(): Promise<void> {
    if (this.isLeavingSignal()) {
      return;
    }
    this.isLeavingSignal.set(true);
    this.leaveError.set(null);
    const result = await this.roomEntry.leave(this.roomId());
    this.isLeavingSignal.set(false);
    if (result.ok) {
      await this.router.navigateByUrl('/');
    } else {
      this.leaveError.set(result.error);
    }
  }

  /**
   * Takes back the stored seat of every room the page opens in a tab that is in no room yet, such as a new tab on the
   * room link (ADR-0069).
   */
  constructor() {
    effect(() => {
      const roomId = this.roomId();
      if (isRoomId(roomId)) {
        untracked(() => {
          this.roomEntry.reopen(roomId);
        });
      }
    });
  }
}
