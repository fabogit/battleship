import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  GAME_OVER_TTL_MS,
  NEGOTIATION_TTL_MS,
  ROOM_PHASES,
  WAITING_TTL_MS,
  isRoomId,
} from '@battleship/core';

import { CONNECTION_STATUSES, GameSocketService } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { RoomEntryService, type RoomEntryError } from '../../core/room-entry';
import { roomEntryErrorMessage } from '../../core/room-entry.text';
import { ServerWakeService } from '../../core/server-wake';
import { SessionStore } from '../../core/session-store';
import { wholeMinutes } from '../../shared/countdown';
import { NicknameForm } from '../../shared/nickname-form/nickname-form';
import { Battle } from '../battle/battle';
import { Lobby } from '../lobby/lobby';
import { Placement } from '../placement/placement';
import { Presence } from '../presence/presence';
import { Rules } from '../rules/rules';
import { ROOM_TEXT } from './room.text';
import { SEAT_LOSSES, classifySeatLoss, type SeatLoss } from './seat-loss';

/** What the room page shows, as `Room.view` picks it (docs/client.md#routes--lobby-flow). */
export const ROOM_VIEWS = {
  /** No seat in this room yet: the nickname form and "Join room". */
  JOIN: 'join',
  /** Seated, waiting for the room's first `STATE`. */
  ENTERING: 'entering',
  /** Seated once, but the tab has entered another room since, so this one sends it nothing more. */
  LEFT: 'left',
  /** `WAITING_FOR_OPPONENT`: the waiting screen. */
  LOBBY: 'lobby',
  /** `RULES_NEGOTIATION`: the rules screen. */
  RULES: 'rules',
  /** `PLACEMENT`: the fleet placement view. */
  PLACEMENT: 'placement',
  /** `IN_PROGRESS` and `GAME_OVER`: the battle view, which turns into the game-over screen (ADR-0058). */
  BATTLE: 'battle',
  /** A malformed link, or `ROOM_NOT_FOUND` after a join attempt. */
  NOT_FOUND: 'not-found',
  /** Stored credentials the server refused (`SESSION_INVALID`), explained by `SeatLoss` (ADR-0076). */
  SEAT_LOST: 'seat-lost',
  /** The server closed the room with this tab's seat in it (`ROOM_CLOSED`), explained by its reason (ADR-0098). */
  CLOSED: 'closed',
  /** `ROOM_FULL`: both seats were taken when the player tried to join. */
  FULL: 'full',
} as const;

/** One of the `ROOM_VIEWS`. */
export type RoomView = (typeof ROOM_VIEWS)[keyof typeof ROOM_VIEWS];

/** The views of a room the player sits in with its snapshot: the opponent's presence shows above them. */
const SEATED_VIEWS: ReadonlySet<RoomView> = new Set([
  ROOM_VIEWS.LOBBY,
  ROOM_VIEWS.RULES,
  ROOM_VIEWS.PLACEMENT,
  ROOM_VIEWS.BATTLE,
]);

/** The views a rematch resolves into, or the one left behind waits in, whose heading takes focus then (ADR-0126). */
const AFTER_GAME_OVER_VIEWS: ReadonlySet<RoomView> = new Set([
  ROOM_VIEWS.LOBBY,
  ROOM_VIEWS.RULES,
  ROOM_VIEWS.PLACEMENT,
]);

/** The seat losses after which the room may still wait for a player, so the page offers to join it again. */
const REJOINABLE_LOSSES: ReadonlySet<SeatLoss> = new Set([SEAT_LOSSES.GIVEN_UP, SEAT_LOSSES.UNKNOWN]);

/**
 * The page of one room, `/r/<roomId>`, for both players (ADR-0049). The creator lands here after "Create room" and
 * shares the page's own address; the joiner opens it, picks a nickname and takes the free seat. Which view it shows
 * follows from the snapshot, the stored session and the last join attempt. Before the match, "Leave room" sits beside
 * the heading of the waiting screen, the rules screen and placement, which project it (ADR-0080). When the room leaves
 * game over, for a rematch or because the opponent left, the new view's heading takes focus (ADR-0126).
 */
@Component({
  selector: 'app-room',
  imports: [Battle, Lobby, NgTemplateOutlet, NicknameForm, Placement, Presence, RouterLink, Rules],
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
  /** The battle view, shown in `IN_PROGRESS` and `GAME_OVER`; it asks before the page is left during the match. */
  private readonly battle = viewChild(Battle);
  /** The page's element, where the heading of the view shown after game over is found. */
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Runs the focus move after the new view has rendered. */
  private readonly injector = inject(Injector);

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
   * What the page shows: a room the server closed under this tab says why, a room whose stored seat the server refused
   * explains why, until a join attempt says more, and a room the tab has left stays left; otherwise the snapshot
   * decides once it arrives, then the stored session, then the join attempt.
   */
  protected readonly view = computed<RoomView>(() => {
    const roomId = this.roomId();
    if (!isRoomId(roomId)) {
      return ROOM_VIEWS.NOT_FOUND;
    }
    // A closed room holds no credentials either, unless a later room drew the same id and this tab sits in it.
    if (this.sessions.closure(roomId) !== null && this.sessions.get(roomId) === null) {
      return ROOM_VIEWS.CLOSED;
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
          return ROOM_VIEWS.LOBBY;
        case ROOM_PHASES.RULES_NEGOTIATION:
          return ROOM_VIEWS.RULES;
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

  /** The match an opponent left at game over, with their nickname, for the waiting screen (ADR-0126); else `null`. */
  protected readonly departedMatch = computed(() => {
    const match = this.gameState.departedMatch();
    const nickname = this.gameState.opponentDeparted();
    return match === null || nickname === null ? null : { match, nickname };
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
      reason: text.reason(wholeMinutes(DISCONNECT_FORFEIT_MS), wholeMinutes(GAME_OVER_TTL_MS)),
    };
  });

  /** Why the server closed the room, in words; empty unless it did (ADR-0098). */
  protected readonly closedReason = computed(() => {
    const reason = this.sessions.closure(this.roomId());
    return reason === null
      ? ''
      : this.text.closedReasons[reason](
          wholeMinutes(WAITING_TTL_MS),
          wholeMinutes(GAME_OVER_TTL_MS),
          wholeMinutes(NEGOTIATION_TTL_MS),
        );
  });

  /** Whether the refused room may still wait for a player, so the page offers the join form again. */
  protected readonly canRejoin = computed(() => REJOINABLE_LOSSES.has(this.seatLoss()));

  /** Whether `LEAVE_ROOM` waits for its ack, from "Leave room" or from the leave guard. */
  protected readonly isLeaving = this.roomEntry.isLeaving;

  /** Why the last "Leave room" failed; reset when the address names another room. */
  private readonly leaveError = linkedSignal<string, RoomEntryError | null>({
    source: this.roomId,
    computation: () => null,
  });

  /**
   * The message for a failed "Leave room", or `null`: the room-entry messages. `NOT_ALLOWED` has none of its own since
   * `LEAVE_ROOM` frees the seat in every phase but the match, which it surrenders (ADR-0116, ADR-0123): only a socket
   * without a seat still gets it.
   */
  protected readonly leaveErrorMessage = computed(() => {
    const error = this.leaveError();
    return error === null ? null : roomEntryErrorMessage(error);
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
   * message. Ignored while a leave is under way. Sent from placement just as the match starts, it reaches the server in
   * `IN_PROGRESS` and surrenders the match (ADR-0116): the ack is the same, and the page goes home all the same, the
   * guard letting it through since the snapshot is gone.
   */
  protected async leave(): Promise<void> {
    if (this.isLeaving()) {
      return;
    }
    this.leaveError.set(null);
    const result = await this.roomEntry.leave(this.roomId());
    if (result.ok) {
      await this.router.navigateByUrl('/');
    } else {
      this.leaveError.set(result.error);
    }
  }

  /**
   * Runs before the router leaves the page, for `confirmSurrenderOnLeave`. While this room's last snapshot is in
   * `IN_PROGRESS`, the battle view's surrender dialog asks (ADR-0117); its confirmation sends `SURRENDER`, then
   * `LEAVE_ROOM`. In `GAME_OVER` it sends `LEAVE_ROOM` without asking: leaving the page is the `LEAVE` rematch choice
   * (ADR-0126). Either way the seat is freed, so the opponent waits for someone new instead of the game-over TTL.
   * @returns Whether to leave: `true` at once in any other phase, without a snapshot of this room, and when the page
   * shows another view (a refused seat); `true` once `LEAVE_ROOM` is answered, refused or timed out after
   * `ACK_TIMEOUT_MS` in `GAME_OVER`; the dialog's answer during the match.
   */
  confirmLeave(): Promise<boolean> | boolean {
    switch (this.snapshot()?.phase) {
      case ROOM_PHASES.IN_PROGRESS:
        return this.surrenderAndLeave();
      case ROOM_PHASES.GAME_OVER:
        return this.roomEntry.leave(this.roomId()).then(() => true);
      default:
        return true;
    }
  }

  /**
   * Asks in the battle view's surrender dialog, and frees the seat after a confirmed surrender, which leaves the room
   * in `GAME_OVER` (ADR-0126). The `LEAVE_ROOM` goes even when the surrender was refused (the match ended first) or not
   * answered: the room is then over or unknown, and its answer, whatever it is, lets the navigation through.
   * @returns The dialog's answer, once the `LEAVE_ROOM` that follows a confirmation is answered or timed out.
   */
  private async surrenderAndLeave(): Promise<boolean> {
    const battle = this.battle();
    if (battle === undefined) {
      return true;
    }
    const isConfirmed = await battle.confirmLeave();
    if (isConfirmed) {
      await this.roomEntry.leave(this.roomId());
    }
    return isConfirmed;
  }

  /**
   * Moves focus to the heading of the view shown after game over, once it has rendered: the game-over controls the
   * player may have used are gone with the battle view (ADR-0126).
   */
  private focusHeadingAfterGameOver(): void {
    afterNextRender(
      {
        write: () => {
          this.host.nativeElement.querySelector<HTMLHeadingElement>('h1')?.focus();
        },
      },
      { injector: this.injector },
    );
  }

  /**
   * Takes back the stored seat of every room the page opens in a tab that is in no room yet, such as a new tab on the
   * room link (ADR-0069), and moves focus to the new view's heading when the battle view gives way to another view the
   * player stays seated in: a resolved rematch, or the waiting screen after the opponent left (ADR-0126).
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
    let previous: RoomView | null = null;
    effect(() => {
      const view = this.view();
      if (previous === ROOM_VIEWS.BATTLE && AFTER_GAME_OVER_VIEWS.has(view)) {
        untracked(() => {
          this.focusHeadingAfterGameOver();
        });
      }
      previous = view;
    });
  }
}
