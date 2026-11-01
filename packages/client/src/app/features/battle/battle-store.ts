import { DestroyRef, Service, computed, inject, signal } from '@angular/core';
import { CLIENT_EVENTS, SERVER_EVENTS, type Coordinate, type ErrorCode, type ShotResult } from '@battleship/core';

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
  /** A turn was fired, by either player: the results of `SHOT_RESOLVED`. */
  FIRED: 'fired',
} as const;

/** One of the `BATTLE_FEEDBACK` kinds. */
export type BattleFeedbackKind = (typeof BATTLE_FEEDBACK)[keyof typeof BATTLE_FEEDBACK];

/** What the last battle action or fired turn was, with what its message needs. */
export type BattleFeedback =
  | {
      /** A cell joined or left the draft. */
      readonly kind: typeof BATTLE_FEEDBACK.TARGETED | typeof BATTLE_FEEDBACK.UNTARGETED;
      /** The cell. */
      readonly coordinate: Coordinate;
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
      /** The shooter's `afkCount` when `SHOT_RESOLVED` arrived, before the `STATE` that follows it. */
      readonly afkCountBefore: number;
      /**
       * Whether the server fired it because the shooter's time ran out (ADR-0109): the `STATE` after it counts one
       * more timeout for the shooter than `afkCountBefore`. `false` until that `STATE` arrives.
       */
      readonly isAutomatic: boolean;
    };

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
  /** How many targets the turn fires; 1 until salvo mode lands (#32), 0 outside battle. */
  readonly shotsAllowed = computed(() => this.battle()?.shotsAllowed ?? 0);

  /** Set by every tap and every `SHOT_RESOLVED`, for the live region; read through `feedback`. */
  private readonly feedbackSignal = signal<BattleFeedback | null>(null);
  /**
   * The last tap's outcome or the last fired turn; `null` before the first one and after a failed update, unless a
   * later tap or turn set it. A fired turn says whether it was automatic once the `STATE` after it has arrived.
   */
  readonly feedback = computed<BattleFeedback | null>(() => {
    const feedback = this.feedbackSignal();
    if (feedback?.kind !== BATTLE_FEEDBACK.FIRED) {
      return feedback;
    }
    const afkCount = this.battle()?.afkCount;
    const afkCountNow = afkCount === undefined ? 0 : feedback.isMine ? afkCount.me : afkCount.opponent;
    return { ...feedback, isAutomatic: afkCountNow > feedback.afkCountBefore };
  });

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

  /** Announces every fired turn; stops with the view. */
  constructor() {
    const stopListening = this.socket.on(SERVER_EVENTS.SHOT_RESOLVED, ({ shooter, results }) => {
      const isMine = shooter === this.gameState.snapshot()?.me.seat;
      const afkCount = this.battle()?.afkCount;
      const afkCountBefore = afkCount === undefined ? 0 : isMine ? afkCount.me : afkCount.opponent;
      this.feedbackSignal.set({ kind: BATTLE_FEEDBACK.FIRED, isMine, results, afkCountBefore, isAutomatic: false });
    });
    inject(DestroyRef).onDestroy(stopListening);
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
    this.sync.update(change.draft, { kind, coordinate });
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
