import { Component, computed, inject } from '@angular/core';
import { FLEET, SHIP_LENGTH, type ShipType } from '@battleship/core';

import { GameStateService } from '../../core/game-state';
import { BoardGrid } from '../../shared/board-grid/board-grid';
import { formatCountdown, remainingSeconds } from '../../shared/countdown';
import { findShip } from './fleet-draft';
import { PlacementStore } from './placement-store';
import { PLACEMENT_TEXT, placementErrorMessage, placementFeedbackMessage } from './placement.text';

/** One ship of the dock, as the template renders it. */
interface DockEntry {
  /** The ship a tap on the entry selects. */
  readonly type: ShipType;
  /** Its name in `PLACEMENT_TEXT.shipNames`, shown on the entry. */
  readonly name: string;
  /** One entry per cell, to draw its size. */
  readonly cells: readonly number[];
  /** Read after the name: its size and, once on the board, "placed". */
  readonly details: string;
  /** Whether it is on the board. */
  readonly isPlaced: boolean;
  /** Whether it is the selected ship. */
  readonly isSelected: boolean;
}

/**
 * The `PLACEMENT` view, touch-first (docs/client.md#board--interaction, ADR-0053): tap a ship in the dock, then a
 * cell to place it; tap a placed ship to move, rotate or remove it. "Randomize" fills the board, "Confirm fleet" and
 * "Unlock fleet" toggle the lock, and the opponent's lock is shown as it changes. Everything works with the keyboard
 * too: the dock and the actions are buttons, and the board is a grid of buttons.
 */
@Component({
  selector: 'app-placement',
  imports: [BoardGrid],
  providers: [PlacementStore],
  templateUrl: './placement.html',
  styleUrl: './placement.css',
})
export class Placement {
  /** The draft, the selection and the commands. */
  protected readonly store = inject(PlacementStore);
  /** The snapshot's opponent and countdowns, which are not part of the draft. */
  private readonly gameState = inject(GameStateService);

  /** The words of the view. */
  protected readonly text = PLACEMENT_TEXT;

  /** The opponent's nickname; empty in the moment the seat is freed. */
  protected readonly opponentNickname = computed(() => this.gameState.snapshot()?.opponent?.nickname ?? '');

  /** The placement deadline as `m:ss`; `null` outside placement. */
  protected readonly timeLeft = computed(() => {
    const remainingMs = this.gameState.placementRemainingMs();
    return remainingMs === null ? null : formatCountdown(remainingMs);
  });

  /** Whole seconds before the match starts, while both fleets are locked; `null` otherwise. */
  protected readonly startsInSeconds = computed(() => {
    const remainingMs = this.gameState.startCountdownMs();
    return remainingMs === null ? null : remainingSeconds(remainingMs);
  });

  /** Every ship of the fleet, largest first, with whether it is placed and selected. */
  protected readonly dock = computed<readonly DockEntry[]>(() => {
    const draft = this.store.draft();
    const selectedType = this.store.selected()?.type ?? null;
    return FLEET.map((type) => {
      const length = SHIP_LENGTH[type];
      const isPlaced = findShip(draft, type) !== undefined;
      const details = [this.text.shipCells(length), ...(isPlaced ? [this.text.placed] : [])];
      return {
        type,
        name: this.text.shipNames[type],
        cells: Array.from({ length }, (_, index) => index),
        details: `, ${details.join(', ')}`,
        isPlaced,
        isSelected: type === selectedType,
      };
    });
  });

  /** The name of the selected ship; `null` when none is. */
  protected readonly selectedName = computed(() => {
    const selected = this.store.selected();
    return selected === null ? null : this.text.shipNames[selected.type];
  });

  /** What the last action did, for the live region; empty before the first one. */
  protected readonly feedbackMessage = computed(() => {
    const feedback = this.store.feedback();
    return feedback === null ? '' : placementFeedbackMessage(feedback, this.text);
  });

  /** Why the last command failed, or `null`. */
  protected readonly errorMessage = computed(() => {
    const error = this.store.error();
    return error === null ? null : placementErrorMessage(error, this.text);
  });

  /** Under the fleet actions: why "Confirm fleet" is not available yet, or that the fleet is locked. */
  protected readonly lockHint = computed(() => {
    if (this.store.isConfirmed()) {
      return this.text.lockedHint;
    }
    const violation = this.store.fleetViolation();
    return violation === null ? null : this.text.confirmHints[violation];
  });
}
