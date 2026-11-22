import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CLIENT_EVENTS,
  GAME_OVER_TTL_MS,
  REMATCH_CHOICES,
  type ErrorCode,
  type RecordedRematchChoice,
} from '@battleship/core';

import { GameSocketService, type TransportError } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { RoomEntryService } from '../../core/room-entry';
import { wholeMinutes } from '../../shared/countdown';
import { BATTLE_TEXT, rematchErrorMessage } from './battle.text';

/** Why `REMATCH_CHOICE` failed: the server's refusal, or no reply at all (ADR-0035). */
export type RematchCommandError = ErrorCode | TransportError;

/**
 * The game-over controls (docs/client.md#board--interaction, ADR-0126): "Play again" and "Change rules", toggles that
 * send `REMATCH_CHOICE` and show the choice the snapshot holds, both players' choices in words, and "Leave room", a link
 * home that the room page's leave guard turns into `LEAVE_ROOM`. The choice lives in the snapshot, not in
 * `BattleStore`: the server keeps it, and a reload shows it again. The controls stay the same elements whatever is
 * chosen, so focus stays on the toggle the player pressed.
 */
@Component({
  selector: 'app-rematch-controls',
  imports: [RouterLink],
  templateUrl: './rematch-controls.html',
  styleUrl: './rematch-controls.css',
})
export class RematchControls {
  /** Sends `REMATCH_CHOICE`. */
  private readonly socket = inject(GameSocketService);
  /** The game-over snapshot, with both choices and the opponent's presence. */
  private readonly gameState = inject(GameStateService);
  /** Whether "Leave room" waits for the ack of its `LEAVE_ROOM`. */
  private readonly roomEntry = inject(RoomEntryService);

  /** The words of the controls. */
  protected readonly text = BATTLE_TEXT.rematch;
  /** The choices, for the template. */
  protected readonly choices = REMATCH_CHOICES;
  /** How long the room waits for a rematch, in minutes. */
  protected readonly expiryMinutes = wholeMinutes(GAME_OVER_TTL_MS);
  /** Whether `LEAVE_ROOM` waits for its ack, after "Leave room", Back or any other way off the page. */
  protected readonly isLeaving = this.roomEntry.isLeaving;

  /** Both players' choices as the latest snapshot holds them. */
  private readonly rematch = computed(
    () => this.gameState.snapshot()?.gameOver?.rematch ?? { me: null, opponent: null },
  );

  /** The opponent's nickname. */
  protected readonly nickname = computed(() => this.gameState.snapshot()?.opponent?.nickname ?? '');

  /** Whether the opponent's seat has no socket, so a rematch waits for them (ADR-0124). */
  protected readonly isOpponentAway = computed(() => this.gameState.snapshot()?.opponent?.isConnected === false);

  /** Written by `choose` only; read through `pending`. */
  private readonly pendingSignal = signal<RecordedRematchChoice | null>(null);
  /** The choice waiting for its ack; `null` when none does. */
  protected readonly pending = this.pendingSignal.asReadonly();

  /** The choice the toggles show as pressed: the one on its way, else the one the server holds. */
  protected readonly selected = computed(() => this.pending() ?? this.rematch().me);

  /** The player's own choice, in words. */
  protected readonly mine = computed(() => this.text.mine(this.selected()));

  /** The opponent's choice, in words. */
  protected readonly theirs = computed(() => this.text.theirs(this.nickname(), this.rematch().opponent));

  /**
   * Why the last `REMATCH_CHOICE` failed; cleared by the next one, and when the opponent's choice changes, which makes
   * the old failure moot.
   */
  private readonly errorSignal = linkedSignal<RecordedRematchChoice | null, RematchCommandError | null>({
    source: () => this.rematch().opponent,
    computation: () => null,
  });

  /** The message for the last failed choice, or `null`. */
  protected readonly errorMessage = computed(() => {
    const error = this.errorSignal();
    return error === null ? null : rematchErrorMessage(error, this.text);
  });

  /**
   * Sends a choice to play again; the next `STATE` shows it, or the phase it resolved into. Ignored while a choice waits
   * for its ack, and for the choice already held: there is no taking a choice back, only changing it or leaving.
   * @param choice `SAME_RULES` or `CHANGE_RULES`.
   */
  protected async choose(choice: RecordedRematchChoice): Promise<void> {
    if (this.pendingSignal() !== null || this.rematch().me === choice) {
      return;
    }
    this.pendingSignal.set(choice);
    this.errorSignal.set(null);
    const response = await this.socket.emitWithAck(CLIENT_EVENTS.REMATCH_CHOICE, { choice });
    this.pendingSignal.set(null);
    if (!response.ok) {
      this.errorSignal.set(response.error);
    }
  }
}
