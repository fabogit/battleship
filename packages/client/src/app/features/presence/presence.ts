import { Component, computed, inject, signal } from '@angular/core';
import { CLIENT_EVENTS, ROOM_PHASES, type ErrorCode } from '@battleship/core';

import { GameSocketService, type TransportError } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { formatCountdown } from '../../shared/countdown';
import { PRESENCE_TEXT, pauseErrorMessage } from './presence.text';

/** Why `SET_PAUSED` failed: the server's refusal, or no reply at all (ADR-0035). */
export type PauseCommandError = ErrorCode | TransportError;

/**
 * The opponent's connection as the room page shows it in every phase with a snapshot (docs/client.md#connection-states,
 * ADR-0075): whether they are disconnected or back, their forfeit countdown, the pause control and the paused state
 * during the match, and who left when a seat was freed before the match. The room page keeps it across its views, so
 * its live region announces a change that also switches the view, such as a freed seat sending the player back to the
 * waiting screen.
 */
@Component({
  selector: 'app-presence',
  templateUrl: './presence.html',
  styleUrl: './presence.css',
})
export class Presence {
  /** Sends `SET_PAUSED`. */
  private readonly socket = inject(GameSocketService);
  /** The snapshot, the forfeit countdown and whether a pause would be accepted. */
  protected readonly gameState = inject(GameStateService);

  /** The words of the banner. */
  protected readonly text = PRESENCE_TEXT;

  /** The opponent's nickname; empty while the seat is free. */
  protected readonly nickname = computed(() => this.gameState.snapshot()?.opponent?.nickname ?? '');

  /** Whether the opponent holds a seat without a socket: the server detects a drop after a few seconds (ADR-0075). */
  protected readonly isOpponentAway = computed(() => this.gameState.snapshot()?.opponent?.isConnected === false);

  /** The opponent's forfeit countdown as `m:ss`, worded for the phase; `null` while it does not run. */
  protected readonly forfeitMessage = computed(() => {
    const remainingMs = this.gameState.opponentForfeitRemainingMs();
    if (remainingMs === null) {
      return null;
    }
    const time = formatCountdown(remainingMs);
    return this.gameState.phase() === ROOM_PHASES.IN_PROGRESS
      ? this.text.forfeitsMatch(this.nickname(), time)
      : this.text.freesSeat(this.nickname(), time);
  });

  /** Whether the match is paused (`battle.isPaused`); `null` outside the match. */
  protected readonly isPaused = computed(() => this.gameState.snapshot()?.battle?.isPaused ?? null);

  /** Written by `setPaused` only; read through `pending`. */
  private readonly pendingSignal = signal<boolean | null>(null);
  /** The `isPaused` of the `SET_PAUSED` waiting for its ack; `null` when none does. */
  protected readonly pending = this.pendingSignal.asReadonly();

  /** Why the last `SET_PAUSED` failed; cleared by the next one. */
  private readonly errorSignal = signal<PauseCommandError | null>(null);
  /** The message for the last failed `SET_PAUSED`, or `null`. */
  protected readonly errorMessage = computed(() => {
    const error = this.errorSignal();
    return error === null ? null : pauseErrorMessage(error, this.text);
  });

  /**
   * Pauses or resumes the match with `SET_PAUSED` (ADR-0074); the next `STATE` shows the result. Ignored while one is
   * waiting for its ack.
   * @param isPaused `true` to pause, `false` to resume.
   */
  protected async setPaused(isPaused: boolean): Promise<void> {
    if (this.pendingSignal() !== null) {
      return;
    }
    this.pendingSignal.set(isPaused);
    this.errorSignal.set(null);
    const response = await this.socket.emitWithAck(CLIENT_EVENTS.SET_PAUSED, { isPaused });
    this.pendingSignal.set(null);
    if (!response.ok) {
      this.errorSignal.set(response.error);
    }
  }
}
