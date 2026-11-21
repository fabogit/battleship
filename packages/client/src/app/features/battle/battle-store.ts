import { DestroyRef, Service, computed, inject, signal } from '@angular/core';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type Coordinate,
  type ErrorCode,
  type Seat,
  type ShotResult,
} from '@battleship/core';

import { GameSocketService, type TransportError } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { createSyncedDraft } from '../../core/synced-draft';
import { DiceAnimation } from './dice-animation';
import { isSameTargets, toggleTarget, type TargetDraft, type TargetRefusal } from './target-draft';

/** What the last battle action or fired turn was, announced to the player (ADR-0043). */
export const BATTLE_FEEDBACK = {
  /** A cell joined the draft. */
  TARGETED: 'targeted',
  /** A cell left the draft. */
  UNTARGETED: 'untargeted',
  /** A tap the draft refuses; nothing changed. */
  REFUSED: 'refused',
  /** A turn was fired, by either player: the results of `SHOT_RESOLVED`, set once the `STATE` after it arrives. */
  FIRED: 'fired',
} as const;

/** One of the `BATTLE_FEEDBACK` kinds. */
export type BattleFeedbackKind = (typeof BATTLE_FEEDBACK)[keyof typeof BATTLE_FEEDBACK];

/** How full a salvo draft is, for the counter near "Fire" and the tap's message (ADR-0121). */
export interface TargetCount {
  /** The targets in the draft. */
  readonly picked: number;
  /** The turn's shot allowance. */
  readonly allowed: number;
}

/** What the last battle action or fired turn was, with what its message needs. */
export type BattleFeedback =
  | {
      /** A cell joined or left the draft. */
      readonly kind: typeof BATTLE_FEEDBACK.TARGETED | typeof BATTLE_FEEDBACK.UNTARGETED;
      /** The cell. */
      readonly coordinate: Coordinate;
      /** How full the draft is after the tap, in salvo mode; `null` in standard mode, which has no counter. */
      readonly count: TargetCount | null;
    }
  | {
      /** A tap was refused. */
      readonly kind: typeof BATTLE_FEEDBACK.REFUSED;
      /** The cell tapped. */
      readonly coordinate: Coordinate;
      /** Why, as `toggleTarget` reports it. */
      readonly reason: TargetRefusal;
      /** The turn's shot allowance, which a full salvo draft has reached. */
      readonly shotsAllowed: number;
    }
  | {
      /** A turn was fired. */
      readonly kind: typeof BATTLE_FEEDBACK.FIRED;
      /** Whether the receiver fired it. */
      readonly isMine: boolean;
      /** One result per target, in firing order. */
      readonly results: readonly ShotResult[];
      /**
       * Whether the server fired it because the shooter's time ran out (ADR-0109): decided once, by the first `STATE`
       * after `SHOT_RESOLVED`, which then counts one more timeout for the shooter, and kept from there.
       */
      readonly isAutomatic: boolean;
      /**
       * Whether the shooter fires again: an extra turn on a hit (ADR-0121). Decided by the same `STATE`, which names
       * the shooter as `currentTurn` again, the turn #139's board hold follows; `false` at game over.
       */
      readonly keepsTurn: boolean;
      /**
       * In salvo mode, the next shooter's allowance from the same `STATE`: after a salvo the turn always passes, so it
       * is the allowance of the player whose fleet the turn fired at (ADR-0112, ADR-0121). `null` in standard mode and
       * at game over.
       */
      readonly nextShotsAllowed: number | null;
    };

/** A fired turn between its `SHOT_RESOLVED` and the `STATE` that tells whether it was automatic (ADR-0109). */
interface PendingShot {
  /** Who fired it. */
  readonly shooter: Seat;
  /** Whether the receiver fired it. */
  readonly isMine: boolean;
  /** One result per target, in firing order. */
  readonly results: readonly ShotResult[];
  /** The shooter's `afkCount` when `SHOT_RESOLVED` arrived, to compare with the `STATE` that follows it. */
  readonly afkCountBefore: number;
}

/** What opened the surrender dialog, which words it (ADR-0116, ADR-0117). */
export const SURRENDER_PROMPTS = {
  /** The "Surrender" button: the player stays in the room and sees the game over. */
  SURRENDER: 'surrender',
  /** Leaving the room during the match, through the router's leave guard: the page goes on once it is answered. */
  LEAVE: 'leave',
} as const;

/** One of the `SURRENDER_PROMPTS`. */
export type SurrenderPrompt = (typeof SURRENDER_PROMPTS)[keyof typeof SURRENDER_PROMPTS];

/** Why a battle command failed: the server's refusal, or no reply at all (ADR-0035). */
export type BattleCommandError = ErrorCode | TransportError;

/**
 * The state and actions of the battle view (docs/client.md#board--interaction), one per view: provided by `Battle`.
 * The turn's draft targets are kept here and sent whole with `UPDATE_TARGETS` on every change; the latest `STATE`
 * replaces them only while no update is waiting for its ack, as for the placement draft (ADR-0054, ADR-0056).
 */
@Service({ autoProvided: false })
export class BattleStore {
  /** Sends `UPDATE_TARGETS` and `FIRE`, and delivers `STATE` and `SHOT_RESOLVED`. */
  private readonly socket = inject(GameSocketService);
  /** The latest snapshot: the turn, the allowance and the server's draft. */
  private readonly gameState = inject(GameStateService);
  /** Holds aiming while the dice roll for the first turn (ADR-0107). */
  private readonly dice = inject(DiceAnimation);

  /** The `IN_PROGRESS` part of the latest snapshot; `null` outside battle. */
  private readonly battle = computed(() => this.gameState.snapshot()?.battle ?? null);

  /** Whether the current turn is the player's. */
  readonly isMyTurn = this.gameState.isMyTurn;
  /**
   * How many targets the turn fires, for the shooter of the turn as both seats see it: 1 in standard mode, one per
   * surviving ship of the shooter's in salvo mode (ADR-0112); 0 outside battle.
   */
  readonly shotsAllowed = computed(() => this.battle()?.shotsAllowed ?? 0);
  /** Whether the agreed rules play salvo mode, which shows a target counter (ADR-0121). */
  readonly isSalvo = computed(() => this.gameState.snapshot()?.rules.isSalvoModeEnabled === true);

  /**
   * Set by every tap and by the first `STATE` after a `SHOT_RESOLVED`, cleared by `SHOT_RESOLVED`, for the live
   * region; read through `feedback`.
   */
  private readonly feedbackSignal = signal<BattleFeedback | null>(null);
  /**
   * The last tap's outcome or the last fired turn; `null` before the first one, after a failed update, and while a
   * fired turn waits for the `STATE` that words it (ADR-0109), unless a tap made meanwhile set it.
   */
  readonly feedback = this.feedbackSignal.asReadonly();
  /**
   * The fired turn still waiting for the `STATE` that tells whether it was automatic; `null` otherwise. Kept apart from
   * the feedback, so a tap made meanwhile cannot drop it.
   */
  private pendingShot: PendingShot | null = null;

  /** Set by every ack: the error of a refusal, `null` for a success; read through `error`. */
  private readonly errorSignal = signal<BattleCommandError | null>(null);
  /** Why the last command failed; cleared by the next one that succeeds. */
  readonly error = this.errorSignal.asReadonly();

  /**
   * The draft, set by every tap at once and by `STATE` while no `UPDATE_TARGETS` is in flight (ADR-0054, ADR-0056);
   * read through `draftTargets`.
   */
  private readonly sync = createSyncedDraft<TargetDraft, BattleFeedback>({
    read: (snapshot) => snapshot.battle?.myDraftTargets ?? null,
    empty: [],
    equal: isSameTargets,
    send: (targets) => this.socket.emitWithAck(CLIENT_EVENTS.UPDATE_TARGETS, { targets }),
    feedback: this.feedbackSignal,
    error: this.errorSignal,
  });
  /** The turn's targets as the player sees them; ahead of the snapshot while updates wait for their ack. */
  readonly draftTargets = computed<TargetDraft>(() => (this.isMyTurn() ? this.sync.draft() : []));

  /** True from sending `FIRE` until its ack; read through `isFiring`. */
  private readonly isFiringSignal = signal(false);
  /** Whether a `FIRE` waits for its ack. */
  readonly isFiring = this.isFiringSignal.asReadonly();
  /**
   * Whether a tap on "Enemy waters" changes the draft: the player's turn, with no shot on its way, once the dice
   * animation has shown who starts (ADR-0107).
   */
  readonly canTarget = computed(() => this.isMyTurn() && !this.isFiring() && !this.dice.isPlaying());
  /** Whether "Fire" would send the turn: the draft holds exactly the allowed number of targets. */
  readonly canFire = computed(() => this.canTarget() && this.draftTargets().length === this.shotsAllowed());

  /**
   * Announces every fired turn once the `STATE` after it has told whether it was automatic, and nothing before it
   * (ADR-0109); stops with the view.
   */
  constructor() {
    const stopListening = this.socket.on(SERVER_EVENTS.SHOT_RESOLVED, ({ shooter, results }) => {
      const isMine = shooter === this.gameState.snapshot()?.me.seat;
      const afkCount = this.battle()?.afkCount;
      const afkCountBefore = afkCount === undefined ? 0 : isMine ? afkCount.me : afkCount.opponent;
      this.pendingShot = { shooter, isMine, results, afkCountBefore };
      // Zoneless change detection renders between the two packets: worded now, a timed-out shot would first read as
      // fired by hand.
      this.feedbackSignal.set(null);
    });
    // Only the first STATE after the shot decides: a later timeout under "Pass the turn" sends no SHOT_RESOLVED, and
    // must not turn the shot already announced into an automatic one. A GAME_OVER STATE has no count, so the shot
    // that ends the match reads as fired by hand. The same STATE tells whether the shooter fires again, and the next
    // salvo allowance.
    const stopDeciding = this.socket.on(SERVER_EVENTS.STATE, (snapshot) => {
      const shot = this.pendingShot;
      if (shot === null) {
        return;
      }
      this.pendingShot = null;
      const battle = snapshot.battle;
      const afkCountAfter = battle === null ? 0 : shot.isMine ? battle.afkCount.me : battle.afkCount.opponent;
      this.feedbackSignal.set({
        kind: BATTLE_FEEDBACK.FIRED,
        isMine: shot.isMine,
        results: shot.results,
        isAutomatic: afkCountAfter > shot.afkCountBefore,
        keepsTurn: battle?.currentTurn === shot.shooter,
        nextShotsAllowed: battle !== null && snapshot.rules.isSalvoModeEnabled ? battle.shotsAllowed : null,
      });
    });
    inject(DestroyRef).onDestroy(() => {
      stopListening();
      stopDeciding();
    });
  }

  /**
   * Handles a tapped cell of "Enemy waters" (ADR-0056): toggles it in the draft and sends the draft, or says why the
   * tap changes nothing.
   * @param coordinate The cell activated on the board.
   */
  activateCell(coordinate: Coordinate): void {
    const battle = this.battle();
    if (battle === null || !this.canTarget()) {
      return;
    }
    const change = toggleTarget(this.draftTargets(), coordinate, battle.outgoingShots, battle.shotsAllowed);
    if (!change.ok) {
      this.feedbackSignal.set({
        kind: BATTLE_FEEDBACK.REFUSED,
        coordinate,
        reason: change.reason,
        shotsAllowed: battle.shotsAllowed,
      });
      return;
    }
    const kind = change.isTargeted ? BATTLE_FEEDBACK.TARGETED : BATTLE_FEEDBACK.UNTARGETED;
    const count = this.isSalvo() ? { picked: change.draft.length, allowed: battle.shotsAllowed } : null;
    this.sync.update(change.draft, { kind, coordinate, count });
  }

  /** True from sending `SURRENDER` until its ack; read through `isSurrendering`. */
  private readonly isSurrenderingSignal = signal(false);
  /** Whether a `SURRENDER` waits for its ack. */
  readonly isSurrendering = this.isSurrenderingSignal.asReadonly();

  /**
   * Gives up the match with `SURRENDER` (ADR-0116): the opponent wins, and the game-over `STATE` follows the ack. A
   * second call while one waits for its ack sends nothing, so a double click surrenders once. A refusal is kept in
   * `error`: `WRONG_PHASE` when the match ended first.
   * @returns Whether the ack accepted it, or `null` when a surrender was already on its way. Resolves within
   * `ACK_TIMEOUT_MS`, at once when the socket is not connected.
   */
  async surrender(): Promise<boolean | null> {
    if (this.isSurrenderingSignal()) {
      return null;
    }
    this.isSurrenderingSignal.set(true);
    const result = await this.socket.emitWithAck(CLIENT_EVENTS.SURRENDER, {});
    this.isSurrenderingSignal.set(false);
    this.errorSignal.set(result.ok ? null : result.error);
    return result.ok;
  }

  /** Fires the draft with `FIRE`; does nothing until it holds the allowed number of targets. */
  async fire(): Promise<void> {
    if (!this.canFire()) {
      return;
    }
    this.isFiringSignal.set(true);
    const result = await this.socket.emitWithAck(CLIENT_EVENTS.FIRE, { targets: this.draftTargets() });
    this.isFiringSignal.set(false);
    this.errorSignal.set(result.ok ? null : result.error);
  }
}
