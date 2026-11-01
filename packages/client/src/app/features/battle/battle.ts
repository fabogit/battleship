import { Component, DestroyRef, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MAX_CONSECUTIVE_AFK_TURNS, ROOM_PHASES, SERVER_EVENTS } from '@battleship/core';

import { GameSocketService } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { BoardGrid } from '../../shared/board-grid/board-grid';
import { formatCoordinate } from '../../shared/board-grid/coordinates';
import { formatCountdown, isLowTime } from '../../shared/countdown';
import { Die } from '../../shared/die/die';
import { BattleStore } from './battle-store';
import { BATTLE_TEXT, battleErrorMessage, battleFeedbackMessage } from './battle.text';
import { DiceAnimation } from './dice-animation';

/** The boards of the battle view; on a narrow screen one of them is shown at a time (ADR-0057). */
export const BATTLE_BOARDS = {
  /** The player's own board: their fleet under the opponent's shots. */
  MY_FLEET: 'my-fleet',
  /** The tracking board: the player's shots at the opponent's fleet, and the turn's targets. */
  ENEMY_WATERS: 'enemy-waters',
} as const;

/** One of the `BATTLE_BOARDS`. */
export type BattleBoard = (typeof BATTLE_BOARDS)[keyof typeof BATTLE_BOARDS];

/**
 * How long a narrow screen keeps showing the board a shot just landed on before it brings forward the board of the
 * next turn, in ms (ADR-0057).
 */
export const SHOT_HOLD_MS = 1_500;

/** Milliseconds in a second, for `turnTimeLimitSeconds`. */
const MS_PER_SECOND = 1_000;

/** The turn's deadline as the heading row shows it. */
interface TurnTimer {
  /** The sentence, e.g. "Time left: 0:25". */
  readonly label: string;
  /** Whether the time left is in its low-time warning (ADR-0108). */
  readonly isLow: boolean;
}

/** The dice beside the heading while they roll for the first turn (ADR-0107). */
interface DiceView {
  /** The player's face. */
  readonly myFace: number;
  /** The opponent's face. */
  readonly theirFace: number;
  /** Whether they are tumbling. */
  readonly isRolling: boolean;
}

/** The board a turn brings forward, with the turn it belongs to. */
interface TurnFocus {
  /** Identifies the turn: changes when the turn passes, a shot lands or the match ends. */
  readonly turn: string;
  /** The board the turn shows first. */
  readonly board: BattleBoard;
}

/**
 * The `IN_PROGRESS` and `GAME_OVER` view (docs/client.md#board--interaction, docs/client.md#layout). The player taps a
 * cell of "Enemy waters" to aim and "Fire" to shoot; whose turn it is heads the page, with the turn's time left beside
 * it, warning when it runs low (ADR-0108), and with the dice that pick who starts while they roll (ADR-0107). Turns run
 * out in a row are counted for both players (ADR-0109). On a narrow screen a toggle shows one board at a time and
 * brings forward the one the turn needs, after showing where the last shot landed; a wide screen shows both side by
 * side. At game over the page names the winner and the reason, and "Enemy waters" reveals the opponent's whole fleet.
 */
@Component({
  selector: 'app-battle',
  imports: [BoardGrid, Die, RouterLink],
  providers: [BattleStore, DiceAnimation],
  templateUrl: './battle.html',
  styleUrl: './battle.css',
})
export class Battle {
  /** The draft, the fired turns and the commands. */
  protected readonly store = inject(BattleStore);
  /** The boards and the turn, from the snapshot. */
  protected readonly gameState = inject(GameStateService);
  /** The dice roll for the first turn, as it plays. */
  private readonly dice = inject(DiceAnimation);

  /** The words of the view. */
  protected readonly text = BATTLE_TEXT;
  /** The boards, for the template. */
  protected readonly boards = BATTLE_BOARDS;

  /** The opponent's nickname; empty in the moment the seat is freed. */
  protected readonly opponentNickname = computed(() => this.gameState.snapshot()?.opponent?.nickname ?? '');
  /** The `GAME_OVER` part of the snapshot; `null` while the match goes on. */
  protected readonly gameOver = computed(() => this.gameState.snapshot()?.gameOver ?? null);
  /** The `IN_PROGRESS` part of the snapshot; `null` outside the match. */
  private readonly battle = computed(() => this.gameState.snapshot()?.battle ?? null);

  /** The heading: who starts while the dice roll, then whose turn it is, or how the match ended. */
  protected readonly heading = computed(() => {
    const gameOver = this.gameOver();
    if (gameOver !== null) {
      if (gameOver.winner === null) {
        return this.text.abandonedHeading;
      }
      return this.gameState.hasWon() === true ? this.text.wonHeading : this.text.lostHeading;
    }
    if (this.dice.isPlaying()) {
      return this.text.diceHeading;
    }
    return this.gameState.isMyTurn() ? this.text.myTurn : this.text.opponentTurn(this.opponentNickname());
  });

  /**
   * Under the heading: why the match ended; the dice while they show; who the dice picked while the first turn's timer
   * waits for the animation; a warning once the turn's time runs low; or what to do this turn.
   */
  protected readonly subheading = computed(() => {
    const nickname = this.opponentNickname();
    const gameOver = this.gameOver();
    if (gameOver !== null) {
      return this.text.reasons[gameOver.reason](nickname, this.gameState.hasWon() === true);
    }
    const isMyTurn = this.gameState.isMyTurn();
    const frame = this.dice.frame();
    if (frame !== null) {
      const me = this.gameState.snapshot()?.me.seat;
      const opponent = this.gameState.snapshot()?.opponent?.seat;
      const myFace = me === undefined ? 0 : frame.roll[me];
      const theirFace = opponent === undefined ? 0 : frame.roll[opponent];
      if (frame.isRolling) {
        return this.text.diceRolling;
      }
      return frame.isLast
        ? this.text.diceResult(myFace, theirFace, nickname, isMyTurn)
        : this.text.diceTie(myFace, nickname);
    }
    const battle = this.battle();
    if (battle !== null && battle.turnRemainingMs === null && !this.hasShots()) {
      return this.text.diceStarter(nickname, isMyTurn);
    }
    if (this.timer()?.isLow === true && battle?.isPaused === false) {
      const timeoutAction = this.gameState.snapshot()?.rules.timeoutAction;
      if (isMyTurn && timeoutAction !== undefined) {
        return this.text.myTimeLow[timeoutAction];
      }
      if (!isMyTurn) {
        return this.text.opponentTimeLow(nickname);
      }
    }
    return isMyTurn ? this.text.myTurnHint : this.text.opponentTurnHint(nickname);
  });

  /** The dice beside the heading while they show; `null` otherwise. */
  protected readonly diceView = computed<DiceView | null>(() => {
    const frame = this.dice.frame();
    const snapshot = this.gameState.snapshot();
    if (frame === null || !snapshot?.opponent) {
      return null;
    }
    return {
      myFace: frame.roll[snapshot.me.seat],
      theirFace: frame.roll[snapshot.opponent.seat],
      isRolling: frame.isRolling,
    };
  });

  /**
   * The turn's deadline beside the heading; `null` while the snapshot carries none (during the dice animation) and
   * while the dice show. Frozen and said to be paused while the match is paused.
   */
  protected readonly timer = computed<TurnTimer | null>(() => {
    const remainingMs = this.gameState.turnRemainingMs();
    const snapshot = this.gameState.snapshot();
    if (remainingMs === null || snapshot?.battle == null || this.dice.frame() !== null) {
      return null;
    }
    const time = formatCountdown(remainingMs);
    return {
      label: snapshot.battle.isPaused ? this.text.timePaused(time) : this.text.timeLeft(time),
      isLow: isLowTime(remainingMs, snapshot.rules.turnTimeLimitSeconds * MS_PER_SECOND),
    };
  });

  /**
   * Turns run out in a row (ADR-0109): a warning for the player while they have let any run out, and one about the
   * opponent while they have; each until that player fires. Empty outside the match.
   */
  protected readonly afkWarnings = computed<readonly string[]>(() => {
    const afkCount = this.battle()?.afkCount;
    if (afkCount === undefined) {
      return [];
    }
    return [
      ...(afkCount.me > 0 ? [this.text.myAfk(MAX_CONSECUTIVE_AFK_TURNS - afkCount.me)] : []),
      ...(afkCount.opponent > 0
        ? [this.text.opponentAfk(this.opponentNickname(), MAX_CONSECUTIVE_AFK_TURNS - afkCount.opponent)]
        : []),
    ];
  });

  /** Under "Fire": the picked targets, or what to do before firing. */
  protected readonly fireHint = computed(() => {
    if (this.dice.isPlaying()) {
      return this.text.waitForDice;
    }
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
   * Tells whether any shot has been fired in the match.
   * @returns Whether either board has a shot.
   */
  private hasShots(): boolean {
    const battle = this.battle();
    return battle !== null && battle.incomingShots.length + battle.outgoingShots.length > 0;
  }

  /**
   * Shows one board on a narrow screen.
   * @param board The board picked in the toggle.
   */
  protected show(board: BattleBoard): void {
    this.shownBoard.set(board);
  }
}
