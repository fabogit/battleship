import { DestroyRef, Service, computed, inject, signal } from '@angular/core';
import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  ROOM_PHASES,
  SERVER_EVENTS,
  type ErrorCode,
  type GameRules,
  type PerPlayer,
  type PlayerStateSnapshot,
  type TurnTimeLimitSeconds,
} from '@battleship/core';

import { GameSocketService, type TransportError } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { createSyncedDraft } from '../../core/synced-draft';

/** Every turn time limit the `UPDATE_RULES` guard accepts, shortest first: the options of the rules screen. */
export const TURN_TIME_LIMIT_OPTIONS = [15, 30, 60, 120] as const satisfies readonly TurnTimeLimitSeconds[];

/** Who made the edit a rules notice reports, as far as the client can tell (ADR-0088). */
export const RULES_EDITORS = {
  /** The receiver: the new `rulesVersion` is one an `UPDATE_RULES` of theirs got in its ack. */
  ME: 'me',
  /** The opponent: any other new version. */
  OPPONENT: 'opponent',
} as const;

/** One of the `RULES_EDITORS`. */
export type RulesEditor = (typeof RULES_EDITORS)[keyof typeof RULES_EDITORS];

/** What a rules notice reports (ADR-0088). */
export const RULES_NOTICE_KINDS = {
  /** A new `rulesVersion`: the rules changed and both confirmations were cleared. */
  CHANGED: 'changed',
  /** The opponent confirmed the current version. */
  OPPONENT_CONFIRMED: 'opponent-confirmed',
} as const;

/** What changed in the room's rules, for the screen's live region (ADR-0088). */
export type RulesNotice =
  | {
      /** The rules changed. */
      readonly kind: typeof RULES_NOTICE_KINDS.CHANGED;
      /** Whose edit it was. */
      readonly editor: RulesEditor;
      /** The rules that differ from the version before, in `GameRules` order, with their new values. */
      readonly changes: Partial<GameRules>;
      /** Whose confirmation the edit cleared: the seats that had confirmed the version before. */
      readonly cleared: PerPlayer<boolean>;
    }
  | {
      /** The opponent confirmed. */
      readonly kind: typeof RULES_NOTICE_KINDS.OPPONENT_CONFIRMED;
    };

/** Why a rules command failed: the server's refusal, or no reply at all (ADR-0035). */
export type RulesCommandError = ErrorCode | TransportError;

/** What the store remembers of the last negotiation snapshot, to tell what the next one changed. */
interface SeenRules {
  /** The room the snapshot belongs to. */
  readonly roomId: string;
  /** Its rules. */
  readonly rules: GameRules;
  /** Its version. */
  readonly rulesVersion: number;
  /** Its confirmations. */
  readonly hasConfirmedRules: PerPlayer<boolean>;
}

/**
 * Tells whether two rules objects hold the same values, field by field.
 * @param left Well-formed rules.
 * @param right Well-formed rules.
 * @returns `true` when every field matches.
 */
export function areSameRules(left: GameRules, right: GameRules): boolean {
  return (Object.keys(left) as (keyof GameRules)[]).every((field) => left[field] === right[field]);
}

/**
 * Lists the rules that differ between two versions.
 * @param before The rules of the version before.
 * @param after The rules of the new version.
 * @returns The fields of `after` that differ from `before`, with their new values.
 */
function changedRules(before: GameRules, after: GameRules): Partial<GameRules> {
  return Object.fromEntries(
    (Object.keys(after) as (keyof GameRules)[])
      .filter((field) => before[field] !== after[field])
      .map((field) => [field, after[field]]),
  );
}

/**
 * The state and commands of the rules screen (docs/client.md#rules-screen), one per screen: provided by `Rules`. Every
 * change sends the whole rules with `UPDATE_RULES` at once (ADR-0086), through the same synced draft as placement
 * (ADR-0054): the controls show the change at once, and the server's rules after a failure. "Confirm rules" sends
 * `CONFIRM_RULES` with the version on screen, and waits while an edit of the player's has not reached the snapshot yet.
 */
@Service({ autoProvided: false })
export class RulesStore {
  /** Sends the rules commands and delivers `STATE`. */
  private readonly socket = inject(GameSocketService);
  /** The latest snapshot: the version, the confirmations and the opponent. */
  private readonly gameState = inject(GameStateService);

  /** The latest snapshot while the room negotiates its rules; `null` before and after. */
  private readonly negotiation = computed(() => {
    const snapshot = this.gameState.snapshot();
    return snapshot?.phase === ROOM_PHASES.RULES_NEGOTIATION ? snapshot : null;
  });

  /** The version on screen, which "Confirm rules" accepts; `0` outside negotiation. */
  readonly rulesVersion = computed(() => this.negotiation()?.rulesVersion ?? 0);
  /** Whether each player has confirmed `rulesVersion`. */
  readonly hasConfirmed = computed<PerPlayer<boolean>>(
    () => this.negotiation()?.hasConfirmedRules ?? { me: false, opponent: false },
  );

  /** Set by every ack: the error of a refusal, `null` for a success; read through `error`. */
  private readonly errorSignal = signal<RulesCommandError | null>(null);
  /** Why the last command failed; cleared by the next one that succeeds. */
  readonly error = this.errorSignal.asReadonly();

  /** Set when a `STATE` brings a new version or the opponent's confirmation; read through `notice`. */
  private readonly noticeSignal = signal<RulesNotice | null>(null);
  /** What the latest snapshot changed, for the live region; `null` when it changed nothing worth announcing. */
  readonly notice = this.noticeSignal.asReadonly();

  /** `UPDATE_RULES` sent and not answered yet; read through `isUpdatePending`. */
  private readonly updatesInFlight = signal(0);
  /** The highest version an accepted `UPDATE_RULES` of the player's got; `-1` before the first. */
  private readonly lastAckedVersion = signal(-1);
  /** Every version an accepted `UPDATE_RULES` of the player's got, to tell their edits from the opponent's. */
  private readonly ackedVersions = new Set<number>();

  /**
   * The rules on screen: the player's change at once, the snapshot's while no `UPDATE_RULES` waits for its ack
   * (ADR-0054). The notice is not passed as the draft's feedback: an edit says nothing until its `STATE` arrives.
   */
  private readonly sync = createSyncedDraft<GameRules, RulesNotice>({
    read: (snapshot) => (snapshot.phase === ROOM_PHASES.RULES_NEGOTIATION ? snapshot.rules : null),
    empty: DEFAULT_RULES,
    equal: areSameRules,
    send: async (rules) => {
      this.updatesInFlight.update((count) => count + 1);
      const result = await this.socket.emitWithAck(CLIENT_EVENTS.UPDATE_RULES, { rules });
      this.updatesInFlight.update((count) => count - 1);
      if (result.ok) {
        this.ackedVersions.add(result.rulesVersion);
        this.lastAckedVersion.update((version) => Math.max(version, result.rulesVersion));
      }
      return result;
    },
    feedback: this.noticeSignal,
    error: this.errorSignal,
  });
  /** The rules the controls show; ahead of the snapshot while an edit waits for its ack. */
  readonly rules = this.sync.draft;

  /**
   * Whether an edit of the player's has not reached the snapshot yet: sent and unanswered, or answered with a version
   * whose `STATE` has not arrived. Confirming then would accept the version before it.
   */
  readonly isUpdatePending = computed(
    () => this.updatesInFlight() > 0 || this.rulesVersion() < this.lastAckedVersion(),
  );

  /** True from sending `CONFIRM_RULES` until its ack; read through `isConfirmPending`. */
  private readonly isConfirmPendingSignal = signal(false);
  /** Whether a `CONFIRM_RULES` waits for its ack. */
  readonly isConfirmPending = this.isConfirmPendingSignal.asReadonly();

  /** Whether "Confirm rules" would send: not confirmed yet, and nothing of the player's on its way. */
  readonly canConfirm = computed(() => !this.hasConfirmed().me && !this.isConfirmPending() && !this.isUpdatePending());

  /** What the previous negotiation snapshot held; `null` before the first. */
  private seen: SeenRules | null = null;

  /** Remembers the snapshot on screen, and compares every later `STATE` with the one before it as it arrives. */
  constructor() {
    this.remember(this.gameState.snapshot());
    const stopListening = this.socket.on(SERVER_EVENTS.STATE, (snapshot) => {
      this.compare(snapshot);
    });
    inject(DestroyRef).onDestroy(stopListening);
  }

  /**
   * Changes one rule and sends the whole rules with `UPDATE_RULES` (ADR-0086). A value the rules already hold sends
   * nothing.
   * @param field The rule.
   * @param value Its new value.
   */
  change<K extends keyof GameRules>(field: K, value: GameRules[K]): void {
    const rules = this.rules();
    if (rules[field] === value) {
      return;
    }
    this.sync.update({ ...rules, [field]: value });
  }

  /** Confirms the version on screen with `CONFIRM_RULES`; ignored while `canConfirm` is false. */
  async confirm(): Promise<void> {
    if (!this.canConfirm()) {
      return;
    }
    this.isConfirmPendingSignal.set(true);
    const result = await this.socket.emitWithAck(CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: this.rulesVersion() });
    this.isConfirmPendingSignal.set(false);
    this.errorSignal.set(result.ok ? null : result.error);
  }

  /**
   * Sets the notice from what a new snapshot changed: a new version, or the opponent's confirmation. An edit of the
   * player's that cleared no confirmation says nothing: the control already shows it.
   * @param snapshot The `STATE` just received.
   */
  private compare(snapshot: PlayerStateSnapshot): void {
    const before = this.seen?.roomId === snapshot.roomId ? this.seen : null;
    this.remember(snapshot);
    if (before === null || snapshot.phase !== ROOM_PHASES.RULES_NEGOTIATION) {
      return;
    }
    if (snapshot.rulesVersion > before.rulesVersion) {
      const editor = this.ackedVersions.has(snapshot.rulesVersion) ? RULES_EDITORS.ME : RULES_EDITORS.OPPONENT;
      const cleared = before.hasConfirmedRules;
      const isSilent = editor === RULES_EDITORS.ME && !cleared.me && !cleared.opponent;
      this.noticeSignal.set(
        isSilent
          ? null
          : { kind: RULES_NOTICE_KINDS.CHANGED, editor, changes: changedRules(before.rules, snapshot.rules), cleared },
      );
    } else if (!before.hasConfirmedRules.opponent && snapshot.hasConfirmedRules.opponent) {
      this.noticeSignal.set({ kind: RULES_NOTICE_KINDS.OPPONENT_CONFIRMED });
    }
  }

  /**
   * Keeps what a negotiation snapshot holds, for the next comparison.
   * @param snapshot The snapshot; one from another phase, or none, leaves nothing to compare with.
   */
  private remember(snapshot: PlayerStateSnapshot | null): void {
    this.seen =
      snapshot?.phase === ROOM_PHASES.RULES_NEGOTIATION
        ? {
            roomId: snapshot.roomId,
            rules: snapshot.rules,
            rulesVersion: snapshot.rulesVersion,
            hasConfirmedRules: snapshot.hasConfirmedRules,
          }
        : null;
  }
}
