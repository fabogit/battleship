import { Component, afterRenderEffect, computed, inject, viewChildren, type ElementRef } from '@angular/core';
import { NEGOTIATION_TTL_MS, TIMEOUT_ACTIONS, type GameRules } from '@battleship/core';

import { GameStateService } from '../../core/game-state';
import { wholeMinutes } from '../../shared/countdown';
import { RulesStore, TURN_TIME_LIMIT_OPTIONS } from './rules-store';
import { RULES_TEXT, rulesErrorMessage, rulesNoticeMessage } from './rules.text';

/**
 * The `RULES_NEGOTIATION` view (docs/client.md#rules-screen): both players edit one set of rules and confirm it. The
 * controls are native inputs in a fieldset, and every change is sent at once (ADR-0086, ADR-0087); "Confirm rules"
 * accepts the version on screen. Both confirmations are listed, and a polite live region says who changed what and
 * whose confirmation it cleared (ADR-0088). The intro says how long the room waits for both confirmations
 * (ADR-0102). Salvo is not offered until its engine lands (#32, #34). Its content goes
 * beside the heading: the room page's "Leave room" (ADR-0080).
 */
@Component({
  selector: 'app-rules',
  providers: [RulesStore],
  templateUrl: './rules.html',
  styleUrl: './rules.css',
})
export class Rules {
  /** The rules on screen, the confirmations and the commands. */
  protected readonly store = inject(RulesStore);
  /** The snapshot's opponent, who is not part of the rules. */
  private readonly gameState = inject(GameStateService);

  /** The words of the screen. */
  protected readonly text = RULES_TEXT;
  /** The turn time limit options, shortest first. */
  protected readonly turnTimeLimits = TURN_TIME_LIMIT_OPTIONS;
  /** The timeout action options, in the order of `TIMEOUT_ACTIONS`. */
  protected readonly timeoutActions = Object.values(TIMEOUT_ACTIONS);
  /** How long the room waits for both confirmations before it closes (ADR-0102). */
  protected readonly negotiationMinutes = wholeMinutes(NEGOTIATION_TTL_MS);

  /** The opponent's nickname; empty in the moment the seat is freed. */
  protected readonly opponentNickname = computed(() => this.gameState.snapshot()?.opponent?.nickname ?? '');

  /** The confirm button's label: what it does, what it is doing, or that it is done. */
  protected readonly confirmLabel = computed(() => {
    if (this.store.isConfirmPending()) {
      return this.text.confirming;
    }
    return this.store.hasConfirmed().me ? this.text.confirmed : this.text.confirm;
  });

  /** What the latest snapshot changed, for the live region; empty when nothing is worth announcing. */
  protected readonly noticeMessage = computed(() => {
    const notice = this.store.notice();
    return notice === null ? '' : rulesNoticeMessage(notice, this.opponentNickname(), this.text);
  });

  /** Why the last command failed, or `null`. */
  protected readonly errorMessage = computed(() => {
    const error = this.store.error();
    return error === null ? null : rulesErrorMessage(error, this.text);
  });

  /** Every input of the screen; each one's `name` is the rule it sets. */
  private readonly inputs = viewChildren<ElementRef<HTMLInputElement>>('ruleInput');

  /**
   * Puts the rules on screen into every input after each render. A native input changes itself before the store hears
   * of it, and an edit that fails at once (`NOT_CONNECTED`) puts the rules back before the next render: the `[checked]`
   * bindings then see no change and would leave the input as the player left it.
   */
  constructor() {
    afterRenderEffect({
      write: () => {
        const rules = this.store.rules();
        for (const { nativeElement: input } of this.inputs()) {
          const value = rules[input.name as keyof GameRules];
          input.checked = input.type === 'checkbox' ? value === true : String(value) === input.value;
        }
      },
    });
  }

  /**
   * Reads a switch.
   * @param event The `change` event of a checkbox.
   * @returns Whether the checkbox is now checked.
   */
  protected isChecked(event: Event): boolean {
    return event.target instanceof HTMLInputElement && event.target.checked;
  }
}
