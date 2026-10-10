import { Component, DestroyRef, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ROOM_PHASES, SERVER_EVENTS } from '@battleship/core';

import { GameSocketService } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { BoardGrid } from '../../shared/board-grid/board-grid';
import { formatCoordinate } from '../../shared/board-grid/coordinates';
import { formatCountdown } from '../../shared/countdown';
import { BattleStore } from './battle-store';
import { BATTLE_TEXT, battleErrorMessage, battleFeedbackMessage } from './battle.text';

/** The boards of the battle view; on a narrow screen one of them is shown at a time (ADR-0057). */
export const BATTLE_BOARDS = {
  /** The player's own board. */
  MY_FLEET: 'my-fleet',
  /** The tracking board. */
  ENEMY_WATERS: 'enemy-waters',
} as const;

/** One of the `BATTLE_BOARDS`. */
export type BattleBoard = (typeof BATTLE_BOARDS)[keyof typeof BATTLE_BOARDS];

/**
 * How long a narrow screen keeps showing the board a shot just landed on before it brings forward the board of the
 * next turn, in ms (ADR-0057).
 */
export const SHOT_HOLD_MS = 1_500;

/** The board a turn brings forward, with the turn it belongs to. */
interface TurnFocus {
  /** Identifies the turn: changes when the turn passes, a shot lands or the match ends. */
  readonly turn: string;
  /** The board the turn shows first. */
  readonly board: BattleBoard;
}

/**
 * The `IN_PROGRESS` and `GAME_OVER` view (docs/client.md#board--interaction, docs/client.md#layout). The player taps a
 * cell of "Enemy waters" to aim and "Fire" to shoot; whose turn it is heads the page. On a narrow screen a toggle shows
 * one board at a time and brings forward the one the turn needs, after showing where the last shot landed; a wide
 * screen shows both side by side. At game over
 * the page names the winner and the reason, and "Enemy waters" reveals the opponent's whole fleet.
 */
@Component({
  selector: 'app-battle',
  imports: [BoardGrid, RouterLink],
  providers: [BattleStore],
  templateUrl: './battle.html',
  styleUrl: './battle.css',
})
export class Battle {
  /** The draft, the fired turns and the commands. */
  protected readonly store = inject(BattleStore);
  /** The boards and the turn, from the snapshot. */
  protected readonly gameState = inject(GameStateService);

  /** The words of the view. */
  protected readonly text = BATTLE_TEXT;
  /** The boards, for the template. */
  protected readonly boards = BATTLE_BOARDS;

  /** The opponent's nickname; empty in the moment the seat is freed. */
  protected readonly opponentNickname = computed(() => this.gameState.snapshot()?.opponent?.nickname ?? '');
  /** Whether the opponent's socket is gone during the match. */
  protected readonly isOpponentAway = computed(
    () =>
      this.gameState.phase() === ROOM_PHASES.IN_PROGRESS && this.gameState.snapshot()?.opponent?.isConnected === false,
  );

  /** The `GAME_OVER` part of the snapshot; `null` while the match goes on. */
  protected readonly gameOver = computed(() => this.gameState.snapshot()?.gameOver ?? null);

  /** The heading: whose turn it is, or how the match ended. */
  protected readonly heading = computed(() => {
    const gameOver = this.gameOver();
    if (gameOver !== null) {
      if (gameOver.winner === null) {
        return this.text.abandonedHeading;
      }
      return this.gameState.hasWon() === true ? this.text.wonHeading : this.text.lostHeading;
    }
    return this.gameState.isMyTurn() ? this.text.myTurn : this.text.opponentTurn(this.opponentNickname());
  });

  /** Under the heading: what to do this turn, or why the match ended. */
  protected readonly subheading = computed(() => {
    const gameOver = this.gameOver();
    if (gameOver !== null) {
      return this.text.reasons[gameOver.reason](this.opponentNickname(), this.gameState.hasWon() === true);
    }
    return this.gameState.isMyTurn() ? this.text.myTurnHint : this.text.opponentTurnHint(this.opponentNickname());
  });

  /** The turn's deadline as `m:ss`; `null` while the snapshot carries none (until the turn timer, #30). */
  protected readonly timeLeft = computed(() => {
    const remainingMs = this.gameState.turnRemainingMs();
    return remainingMs === null ? null : formatCountdown(remainingMs);
  });

  /** Under "Fire": the picked targets, or what to do before firing. */
  protected readonly fireHint = computed(() => {
    if (!this.store.isMyTurn()) {
      return this.text.waitForTurn;
    }
    const targets = this.store.draftTargets();
    return targets.length === 0 ? this.text.pickTarget : this.text.aimingAt(targets.map(formatCoordinate).join(', '));
  });

  /** What the last tap or fired turn did, for the live region; empty before the first one. */
  protected readonly feedbackMessage = computed(() => {
    const feedback = this.store.feedback();
    return feedback === null ? '' : battleFeedbackMessage(feedback, this.opponentNickname(), this.text);
  });

  /** Why the last command failed, or `null`. */
  protected readonly errorMessage = computed(() => {
    const error = this.store.error();
    return error === null ? null : battleErrorMessage(error, this.text);
  });

  /**
   * The board each turn brings forward (ADR-0057): "Enemy waters" during the player's turn and at game over, "My fleet"
   * during the opponent's. It notifies only when the turn changes, so a `STATE` within the same turn keeps the board
   * the player picked.
   */
  private readonly turnFocus = computed<TurnFocus>(
    () => {
      const snapshot = this.gameState.snapshot();
      if (snapshot?.gameOver) {
        return { turn: ROOM_PHASES.GAME_OVER, board: BATTLE_BOARDS.ENEMY_WATERS };
      }
      const battle = snapshot?.battle;
      const shotCount = (battle?.incomingShots.length ?? 0) + (battle?.outgoingShots.length ?? 0);
      return {
        turn: `${battle?.currentTurn ?? ''}/${String(shotCount)}`,
        board: this.gameState.isMyTurn() ? BATTLE_BOARDS.ENEMY_WATERS : BATTLE_BOARDS.MY_FLEET,
      };
    },
    { equal: (a, b) => a.turn === b.turn },
  );

  /** The board the latest shot landed on, for `SHOT_HOLD_MS` after its `SHOT_RESOLVED`; `null` otherwise. */
  private readonly landedOn = signal<BattleBoard | null>(null);
  /** Clears `landedOn`; set while a shot is held. */
  private holdTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The board a narrow screen shows by itself: where the latest shot landed while it is held, then the turn's. It
   * notifies only when that board changes, so the player's own pick stays until then.
   */
  private readonly focusedBoard = computed(() => this.landedOn() ?? this.turnFocus().board);

  /** The board shown on a narrow screen: the focused one, until the player toggles to the other one. */
  protected readonly shownBoard = linkedSignal<BattleBoard>(() => this.focusedBoard());

  /** Whether the toggle is offered: at game over the player's board exists only if this client saw the battle. */
  protected readonly hasBothBoards = computed(() => this.gameState.myFleet() !== null);

  /** Holds the board each fired turn lands on; stops with the view. */
  constructor() {
    const stopListening = inject(GameSocketService).on(SERVER_EVENTS.SHOT_RESOLVED, ({ shooter }) => {
      const isMine = shooter === this.gameState.snapshot()?.me.seat;
      clearTimeout(this.holdTimer);
      this.landedOn.set(isMine ? BATTLE_BOARDS.ENEMY_WATERS : BATTLE_BOARDS.MY_FLEET);
      this.holdTimer = setTimeout(() => {
        this.landedOn.set(null);
      }, SHOT_HOLD_MS);
    });
    inject(DestroyRef).onDestroy(() => {
      stopListening();
      clearTimeout(this.holdTimer);
    });
  }

  /**
   * Shows one board on a narrow screen.
   * @param board The board picked in the toggle.
   */
  protected show(board: BattleBoard): void {
    this.shownBoard.set(board);
  }
}
