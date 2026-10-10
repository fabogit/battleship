import { DestroyRef, Service, computed, inject, signal } from '@angular/core';
import { CLIENT_EVENTS, SERVER_EVENTS, type Coordinate, type ErrorCode, type ShotResult } from '@battleship/core';

import { GameSocketService, type TransportError } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
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
  private readonly socket = inject(GameSocketService);
  private readonly gameState = inject(GameStateService);

  /** The `IN_PROGRESS` part of the latest snapshot; `null` outside battle. */
  private readonly battle = computed(() => this.gameState.snapshot()?.battle ?? null);

  /** Whether the current turn is the player's. */
  readonly isMyTurn = this.gameState.isMyTurn;
  /** How many targets the turn fires; 1 until salvo mode lands (#32), 0 outside battle. */
  readonly shotsAllowed = computed(() => this.battle()?.shotsAllowed ?? 0);

  private readonly draftSignal = signal<TargetDraft>(this.serverDraft(), { equal: isSameTargets });
  /** The turn's targets as the player sees them; ahead of the snapshot while updates wait for their ack. */
  readonly draftTargets = computed<TargetDraft>(() => (this.isMyTurn() ? this.draftSignal() : []));

  private readonly isFiringSignal = signal(false);
  /** Whether a `FIRE` waits for its ack. */
  readonly isFiring = this.isFiringSignal.asReadonly();
  /** Whether a tap on "Enemy waters" changes the draft: the player's turn, with no shot on its way. */
  readonly canTarget = computed(() => this.isMyTurn() && !this.isFiring());
  /** Whether "Fire" would send the turn: the draft holds exactly the allowed number of targets. */
  readonly canFire = computed(() => this.canTarget() && this.draftTargets().length === this.shotsAllowed());

  private readonly feedbackSignal = signal<BattleFeedback | null>(null);
  /** The last tap's outcome or the last fired turn; `null` before the first one. */
  readonly feedback = this.feedbackSignal.asReadonly();

  private readonly errorSignal = signal<BattleCommandError | null>(null);
  /** Why the last command failed; cleared by the next one that succeeds. */
  readonly error = this.errorSignal.asReadonly();

  /** `UPDATE_TARGETS` sent and not yet answered; while there is one, `STATE` does not replace the draft. */
  private updatesInFlight = 0;

  /** Follows `STATE` while no update is in flight, and announces every fired turn; stops with the view. */
  constructor() {
    const stopListening = [
      this.socket.on(SERVER_EVENTS.STATE, (snapshot) => {
        if (this.updatesInFlight === 0 && snapshot.battle !== null) {
          this.draftSignal.set(snapshot.battle.myDraftTargets);
        }
      }),
      this.socket.on(SERVER_EVENTS.SHOT_RESOLVED, ({ shooter, results }) => {
        const isMine = shooter === this.gameState.snapshot()?.me.seat;
        this.feedbackSignal.set({ kind: BATTLE_FEEDBACK.FIRED, isMine, results });
      }),
    ];
    inject(DestroyRef).onDestroy(() => {
      for (const stop of stopListening) {
        stop();
      }
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
    this.feedbackSignal.set({ kind, coordinate });
    this.update(change.draft);
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

  /**
   * Shows a new draft at once and sends it whole with `UPDATE_TARGETS`. A failed update puts back the server's draft,
   * once no other update is in flight (ADR-0054).
   * @param draft The new draft, valid for this turn.
   */
  private update(draft: TargetDraft): void {
    this.draftSignal.set(draft);
    this.updatesInFlight++;
    void this.socket.emitWithAck(CLIENT_EVENTS.UPDATE_TARGETS, { targets: draft }).then((result) => {
      this.updatesInFlight--;
      if (result.ok) {
        this.errorSignal.set(null);
        return;
      }
      this.errorSignal.set(result.error);
      if (this.updatesInFlight === 0) {
        this.draftSignal.set(this.serverDraft());
      }
    });
  }

  /**
   * Reads the draft the server holds.
   * @returns The draft targets of the latest snapshot; empty outside the player's turn.
   */
  private serverDraft(): TargetDraft {
    return this.battle()?.myDraftTargets ?? [];
  }
}
