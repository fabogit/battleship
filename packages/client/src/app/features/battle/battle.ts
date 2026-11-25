import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { MAX_CONSECUTIVE_AFK_TURNS, ROOM_PHASES, SERVER_EVENTS, TIMEOUT_ACTIONS } from '@battleship/core';

import { GameSocketService } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { MS_PER_SECOND } from '../../core/time-units';
import { BoardGrid } from '../../shared/board-grid/board-grid';
import { formatCoordinate } from '../../shared/board-grid/coordinates';
import { formatCountdown, isLowTime } from '../../shared/countdown';
import { Die } from '../../shared/die/die';
import { BattleStore, SURRENDER_PROMPTS, type SurrenderPrompt } from './battle-store';
import { RematchControls } from './rematch-controls';
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
  /** Whether this round decides who starts; the rounds before it are ties. */
  readonly isLast: boolean;
}

/**
 * A board a narrow screen brings forward. Each turn step and each landed shot has its own object: a new one brings its
 * board forward even when that board is in front already, over a board the player picked by hand.
 */
interface BoardFocus {
  /** The board to show. */
  readonly board: BattleBoard;
}

/** The board a turn brings forward, with the turn it belongs to. */
interface TurnFocus extends BoardFocus {
  /**
   * Identifies the turn: changes when the turn passes, a shot lands (an extra turn after a hit is a new turn, as the
   * server restarts its timer) or the match ends.
   */
  readonly turn: string;
}

/**
 * The `IN_PROGRESS` and `GAME_OVER` view (docs/client.md#board--interaction, docs/client.md#layout). The player taps a
 * cell of "Enemy waters" to aim and "Fire" to shoot; whose turn it is heads the page, with the turn's time left beside
 * it, warning when it runs low (ADR-0108), and with the dice that pick who starts while they roll (ADR-0107). Turns run
 * out in a row are counted for both players (ADR-0109). On a narrow screen a toggle shows one board at a time and
 * brings forward the one the turn needs, after showing where the last shot landed; a wide screen shows both side by
 * side. At game over the page names the winner and the reason, "Enemy waters" reveals the opponent's whole fleet, and
 * the game-over controls offer a rematch or leaving the room (ADR-0126). While the match is on, "Surrender" at the foot of the page asks in a dialog before giving it up (ADR-0116); the same
 * dialog asks before the room page is left during the match (ADR-0117).
 */
@Component({
  selector: 'app-battle',
  imports: [BoardGrid, Die, RematchControls],
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
  /** Renders the dialog's words before it opens, so it is announced with them. */
  private readonly changeDetector = inject(ChangeDetectorRef);

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
   * waits for the animation; a warning once the turn's time runs low; or what to do this turn, with how many cells to
   * pick when the turn fires more than one (ADR-0121).
   */
  protected readonly subheading = computed(() => {
    const nickname = this.opponentNickname();
    const gameOver = this.gameOver();
    if (gameOver !== null) {
      return this.text.reasons[gameOver.reason](nickname, this.gameState.hasWon() === true);
    }
    const isMyTurn = this.gameState.isMyTurn();
    const dice = this.diceView();
    if (dice !== null) {
      if (dice.isRolling) {
        return this.text.diceRolling;
      }
      return dice.isLast
        ? this.text.diceResult(dice.myFace, dice.theirFace, nickname, isMyTurn)
        : this.text.diceTie(dice.myFace, nickname);
    }
    const battle = this.battle();
    if (battle !== null && battle.turnRemainingMs === null && this.gameState.shotCount() === 0) {
      return this.text.diceStarter(nickname, isMyTurn);
    }
    const shotsAllowed = battle?.shotsAllowed ?? 1;
    if (this.timer()?.isLow === true && battle?.isPaused === false) {
      const timeoutAction = this.gameState.snapshot()?.rules.timeoutAction;
      if (isMyTurn && timeoutAction !== undefined) {
        return timeoutAction === TIMEOUT_ACTIONS.AUTO_RANDOM_SHOT && shotsAllowed > 1
          ? this.text.mySalvoTimeLow
          : this.text.myTimeLow[timeoutAction];
      }
      if (!isMyTurn) {
        return this.text.opponentTimeLow(nickname);
      }
    }
    if (shotsAllowed > 1) {
      return isMyTurn
        ? this.text.mySalvoTurnHint(shotsAllowed)
        : this.text.opponentSalvoTurnHint(nickname, shotsAllowed);
    }
    return isMyTurn ? this.text.myTurnHint : this.text.opponentTurnHint(nickname);
  });

  /** The dice beside the heading and the words under it while they show, by player; `null` otherwise. */
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
      isLast: frame.isLast,
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

  /** Under "Fire": the picked targets, or what to do before firing; in salvo mode after the target counter (ADR-0121). */
  protected readonly fireHint = computed(() => {
    if (this.dice.isPlaying()) {
      return this.text.waitForDice;
    }
    if (!this.store.isMyTurn()) {
      return this.text.waitForTurn;
    }
    const targets = this.store.draftTargets();
    const cells = targets.map(formatCoordinate).join(', ');
    if (this.store.isSalvo()) {
      const count = this.text.targetCount({ picked: targets.length, allowed: this.store.shotsAllowed() });
      return this.text.salvoAiming(count, cells);
    }
    return targets.length === 0 ? this.text.pickTarget : this.text.aimingAt(cells);
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
   * during the opponent's. It notifies only when the turn changes, an extra turn included, so a `STATE` within the same
   * turn keeps the board the player picked.
   */
  private readonly turnFocus = computed<TurnFocus>(
    () => {
      const snapshot = this.gameState.snapshot();
      if (snapshot?.gameOver) {
        return { turn: ROOM_PHASES.GAME_OVER, board: BATTLE_BOARDS.ENEMY_WATERS };
      }
      return {
        turn: `${snapshot?.battle?.currentTurn ?? ''}/${String(this.gameState.shotCount())}`,
        board: this.gameState.isMyTurn() ? BATTLE_BOARDS.ENEMY_WATERS : BATTLE_BOARDS.MY_FLEET,
      };
    },
    { equal: (a, b) => a.turn === b.turn },
  );

  /**
   * The board the latest shot landed on, for `SHOT_HOLD_MS` after its `SHOT_RESOLVED`; `null` otherwise. A new object
   * for every shot, so two shots on the same board each bring it forward.
   */
  private readonly landedOn = signal<BoardFocus | null>(null);
  /** Clears `landedOn`; set while a shot is held. */
  private holdTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The board a narrow screen shows by itself: where the latest shot landed while it is held, then the turn's. It
   * notifies at every landed shot, at the end of its hold and at every turn step, compared by identity, even when the
   * board stays the same; the player's own pick stays until then (ADR-0057).
   */
  private readonly focusedBoard = computed<BoardFocus>(() => this.landedOn() ?? this.turnFocus());

  /** The board shown on a narrow screen: the focused one, until the player toggles to the other one. */
  protected readonly shownBoard = linkedSignal<BattleBoard>(() => this.focusedBoard().board);

  /** The heading, which takes focus when the match ends under the surrender control. */
  private readonly headingElement = viewChild.required<ElementRef<HTMLHeadingElement>>('headingElement');
  /** "Surrender", which gets focus back when its dialog closes during the match; absent at game over. */
  private readonly surrenderButton = viewChild<ElementRef<HTMLButtonElement>>('surrenderButton');
  /** The dialog that asks before a surrender, from "Surrender" or from the leave guard. */
  private readonly surrenderDialog = viewChild.required<ElementRef<HTMLDialogElement>>('surrenderDialog');
  /** What opened the surrender dialog, which picks its words; kept after it closes, so they do not change as it goes. */
  private readonly surrenderPrompt = signal<SurrenderPrompt>(SURRENDER_PROMPTS.SURRENDER);
  /** The words of the surrender dialog. */
  protected readonly surrenderText = computed(() => this.text.surrenderPrompts[this.surrenderPrompt()]);
  /** Settles the open dialog's `askToSurrender`; set while the dialog is open. */
  private settleSurrender: ((isConfirmed: boolean) => void) | undefined;
  /** Whether the player confirmed in the open dialog; what `askToSurrender` resolves with. */
  private isSurrenderConfirmed = false;

  /**
   * Holds the board each fired turn lands on; stops with the view. When the match ends, the surrender dialog closes by
   * itself, and focus on "Surrender" or in the dialog moves to the heading, which names the result: the button goes.
   */
  constructor() {
    effect(() => {
      if (this.gameOver() === null) {
        return;
      }
      untracked(() => {
        const dialog = this.surrenderDialog().nativeElement;
        const button = this.surrenderButton()?.nativeElement;
        const hadFocus = dialog.open || (button !== undefined && button === document.activeElement);
        if (dialog.open) {
          dialog.close();
        }
        if (hadFocus) {
          this.headingElement().nativeElement.focus();
        }
      });
    });
    const stopListening = inject(GameSocketService).on(SERVER_EVENTS.SHOT_RESOLVED, ({ shooter }) => {
      const isMine = shooter === this.gameState.snapshot()?.me.seat;
      clearTimeout(this.holdTimer);
      this.landedOn.set({ board: isMine ? BATTLE_BOARDS.ENEMY_WATERS : BATTLE_BOARDS.MY_FLEET });
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
   * Asks before the room page is left during the match (ADR-0117), for the router's leave guard: the dialog says that
   * leaving surrenders, and its confirm button sends `SURRENDER`.
   * @returns Whether the player confirmed, so the page may be left: once the ack of `SURRENDER` arrives, at once when
   * the socket is not connected, and after `ACK_TIMEOUT_MS` without an ack. `false` when the player keeps playing, when
   * the match ends while the dialog is open before a confirmation, and while the dialog is open already.
   */
  confirmLeave(): Promise<boolean> {
    return this.askToSurrender(SURRENDER_PROMPTS.LEAVE);
  }

  /** "Surrender": asks in the dialog, which sends `SURRENDER` on confirm; the game-over view follows. */
  protected async openSurrender(): Promise<void> {
    await this.askToSurrender(SURRENDER_PROMPTS.SURRENDER);
  }

  /**
   * The dialog's confirm button: sends `SURRENDER` once, then closes the dialog when its ack arrives, or after
   * `ACK_TIMEOUT_MS` without one. A refusal shows on the page (`WRONG_PHASE`: the match ended first).
   */
  protected async confirmSurrender(): Promise<void> {
    this.isSurrenderConfirmed = true;
    if ((await this.store.surrender()) === null) {
      return;
    }
    const dialog = this.surrenderDialog().nativeElement;
    if (dialog.open) {
      dialog.close();
    }
  }

  /** The dialog's "Keep playing", as Esc does. */
  protected closeSurrenderDialog(): void {
    this.surrenderDialog().nativeElement.close();
  }

  /**
   * Keeps the dialog open while `SURRENDER` waits for its ack, so Esc cannot hide a surrender on its way.
   * @param event The dialog's `cancel` event, from Esc.
   */
  protected onSurrenderCancel(event: Event): void {
    if (this.store.isSurrendering()) {
      event.preventDefault();
    }
  }

  /**
   * Runs whenever the surrender dialog closes, by Esc included: settles `askToSurrender`, and gives focus back to
   * "Surrender" while the match goes on (the game-over effect moves it to the heading otherwise).
   */
  protected onSurrenderDialogClosed(): void {
    const settle = this.settleSurrender;
    const isConfirmed = this.isSurrenderConfirmed;
    this.settleSurrender = undefined;
    this.isSurrenderConfirmed = false;
    settle?.(isConfirmed);
    if (this.gameOver() === null) {
      this.surrenderButton()?.nativeElement.focus();
    }
  }

  /**
   * Opens the surrender dialog, modal, with focus on "Keep playing".
   * @param prompt What opens it, which picks its words.
   * @returns Whether the player confirmed before the dialog closed; `false` at once while it is open already, or once the
   * match is over.
   */
  private askToSurrender(prompt: SurrenderPrompt): Promise<boolean> {
    const dialog = this.surrenderDialog().nativeElement;
    if (dialog.open || this.gameOver() !== null) {
      return Promise.resolve(false);
    }
    this.surrenderPrompt.set(prompt);
    this.changeDetector.detectChanges();
    dialog.showModal();
    return new Promise((resolve) => {
      this.settleSurrender = resolve;
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
