import { DestroyRef, inject, signal, type Signal, type WritableSignal } from '@angular/core';
import { SERVER_EVENTS, type CommandEvent, type ErrorCode, type PlayerStateSnapshot } from '@battleship/core';

import { GameSocketService, type CommandResult, type TransportError } from './game-socket';
import { GameStateService } from './game-state';

/**
 * What `createSyncedDraft` needs from the store that owns a draft.
 * @template T The draft, sent whole by its update command.
 * @template F The store's feedback for the live region.
 */
export interface SyncedDraftOptions<T, F> {
  /** Reads the server's draft from a snapshot; `null` when the snapshot's phase has none, so its `STATE` is ignored. */
  readonly read: (snapshot: PlayerStateSnapshot) => T | null;
  /** The draft shown while the latest snapshot holds none, e.g. before the first `STATE` or after the phase ends. */
  readonly empty: T;
  /** Tells whether two drafts hold the same content, so a `STATE` that changes nothing does not notify the readers. */
  readonly equal: (a: T, b: T) => boolean;
  /** Sends the whole draft with its update command (ADR-0005); never rejects, like `emitWithAck`. */
  readonly send: (draft: T) => Promise<CommandResult<CommandEvent>>;
  /**
   * The store's live-region feedback: set by an update with its draft, cleared when a failed update is rolled back
   * while it still holds the latest update's feedback.
   */
  readonly feedback: WritableSignal<F | null>;
  /** The store's command error, shared with its other commands: every update's ack sets it, to `null` on success. */
  readonly error: WritableSignal<ErrorCode | TransportError | null>;
}

/**
 * A draft kept on the client and synced with the server (ADR-0054), as `createSyncedDraft` returns it.
 * @template T The draft's type: the fleet layout or the turn's targets.
 * @template F The store's feedback for the live region.
 */
export interface SyncedDraft<T, F> {
  /** The draft the view draws; ahead of the snapshot while updates wait for their ack. */
  readonly draft: Signal<T>;
  /**
   * Shows a new draft at once, with the feedback describing it, and sends it whole. A failed update sets the error;
   * once no other update is in flight it also puts back the server's draft and clears the feedback, which described a
   * change just dropped. It clears it only while it is still the one the latest update passed, compared by identity:
   * a feedback another action set since, such as a refused tap, stays.
   * @param draft The new draft, valid for the store's rules.
   * @param feedback What the change did, for the live region; the feedback is left as it is when omitted.
   */
  update(draft: T, feedback?: F): void;
}

/**
 * Keeps a draft on the client and syncs it with the server (ADR-0054), for `PlacementStore` and `BattleStore`
 * (ADR-0056). Every change shows at once and is sent whole without waiting for the ack. `STATE` replaces the draft only
 * while no update waits for its ack, so a snapshot sent before the latest update cannot undo it. Must run in an
 * injection context: it listens to `STATE` until the injector is destroyed.
 * @template T The draft's type: the fleet layout or the turn's targets.
 * @template F The store's feedback for the live region.
 * @param options How to read, compare and send the draft, and the store's feedback and error signals.
 * @returns The draft as a read-only signal, and `update` to change it.
 */
export function createSyncedDraft<T, F>(options: SyncedDraftOptions<T, F>): SyncedDraft<T, F> {
  const { read, empty, equal, send, feedback, error } = options;
  const socket = inject(GameSocketService);
  const gameState = inject(GameStateService);

  /**
   * Reads the draft the server holds.
   * @returns The draft of the latest snapshot, or `empty` when there is none.
   */
  const serverDraft = (): T => {
    const snapshot = gameState.snapshot();
    return (snapshot === null ? null : read(snapshot)) ?? empty;
  };

  const draft = signal<T>(serverDraft(), { equal });
  // Updates sent and not yet answered; while there is one, `STATE` does not replace the draft.
  let updatesInFlight = 0;
  // The feedback of the latest update that passed one; a rollback clears the store's feedback only while it holds it.
  let updateFeedback: F | null = null;

  const stopListening = socket.on(SERVER_EVENTS.STATE, (snapshot) => {
    if (updatesInFlight !== 0) {
      return;
    }
    const serverCopy = read(snapshot);
    if (serverCopy !== null) {
      draft.set(serverCopy);
    }
  });
  inject(DestroyRef).onDestroy(stopListening);

  return {
    draft: draft.asReadonly(),
    update(next, shown) {
      if (shown !== undefined) {
        feedback.set(shown);
        updateFeedback = shown;
      }
      draft.set(next);
      updatesInFlight++;
      void send(next).then((result) => {
        updatesInFlight--;
        if (result.ok) {
          error.set(null);
          return;
        }
        error.set(result.error);
        if (updatesInFlight === 0) {
          draft.set(serverDraft());
          if (feedback() === updateFeedback) {
            feedback.set(null);
          }
        }
      });
    },
  };
}
