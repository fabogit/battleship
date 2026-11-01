import { Component, computed, effect, input, signal } from '@angular/core';

/** How often a tumbling die changes the face it shows, in ms. */
export const DIE_FLICKER_MS = 100;

/** The pips of each face, as cells of a 3 × 3 grid numbered 0 to 8 row by row, as on a real die. */
export const DIE_PIPS: Readonly<Record<number, readonly number[]>> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** The nine cells of the grid, for the template. */
const CELLS: readonly number[] = Array.from({ length: 9 }, (_, cell) => cell);

/**
 * One six-sided die, drawn with CSS (ADR-0107): its face as pips, or, while it tumbles, a wobble with the face changing
 * every `DIE_FLICKER_MS`. It is decoration only (`aria-hidden`): the view says the faces in words.
 */
@Component({
  selector: 'app-die',
  templateUrl: './die.html',
  styleUrl: './die.css',
  host: { 'aria-hidden': 'true', '[class.is-rolling]': 'isRolling()' },
})
export class Die {
  /** The face to show once the die stops, 1 to 6. */
  readonly face = input.required<number>();
  /** Whether the die is tumbling. */
  readonly isRolling = input(false);

  /** How many faces the die has flicked through while tumbling; 0 when it stops. */
  private readonly flicks = signal(0);

  /** The face drawn: `face`, or while tumbling the one the flicker has reached, never two alike in a row. */
  protected readonly shownFace = computed(() => ((this.face() - 1 + this.flicks()) % 6) + 1);

  /** The grid cells with whether each holds a pip of the shown face. */
  protected readonly cells = computed(() => {
    const pips = DIE_PIPS[this.shownFace()] ?? [];
    return CELLS.map((cell) => ({ cell, hasPip: pips.includes(cell) }));
  });

  /** Flickers while tumbling, and stops on `face`. */
  constructor() {
    effect((onCleanup) => {
      this.flicks.set(0);
      if (!this.isRolling()) {
        return;
      }
      const flicker = setInterval(() => {
        this.flicks.update((flicks) => flicks + 1);
      }, DIE_FLICKER_MS);
      onCleanup(() => {
        clearInterval(flicker);
      });
    });
  }
}
