import { Service, computed, effect, inject, signal } from '@angular/core';
import { DICE_ANIMATION_MS, type DiceRoll } from '@battleship/core';

import { GameStateService } from '../../core/game-state';
import { PREFERS_REDUCED_MOTION } from '../../shared/reduced-motion';

/** One step of the dice animation (ADR-0107). */
export interface DiceFrame {
  /** The round shown, from 0: every round but the last is a tie. */
  readonly round: number;
  /** The faces of that round, by seat. */
  readonly roll: DiceRoll;
  /** Whether the dice are still tumbling, their faces not shown yet. */
  readonly isRolling: boolean;
  /** Whether this is the round that decides who starts. */
  readonly isLast: boolean;
}

/** A frame of the animation with the time it starts at. */
export interface TimedDiceFrame extends DiceFrame {
  /** When the frame starts, in ms after `DICE_ROLLED` arrived. */
  readonly startsAtMs: number;
}

/**
 * Lays the rounds of a dice roll out over the animation (ADR-0107): every round gets an equal share of the time, the
 * dice tumbling for its first half and showing their faces for the second. A tie is shown before its re-roll, and
 * the last round's faces stay until the end.
 * @param rolls The rounds of `DICE_ROLLED`, ties first; at least one.
 * @param durationMs The whole animation, `DICE_ANIMATION_MS`.
 * @returns Two frames per round, in order, the first at 0 ms.
 */
export function diceFrames(rolls: readonly DiceRoll[], durationMs: number): TimedDiceFrame[] {
  const frameMs = durationMs / (rolls.length * 2);
  return rolls.flatMap((roll, round) => {
    const isLast = round === rolls.length - 1;
    return [true, false].map((isRolling, half) => ({
      round,
      roll,
      isRolling,
      isLast,
      startsAtMs: (round * 2 + half) * frameMs,
    }));
  });
}

/** Where the animation is: which frame shows, and whether it has played to the end. */
interface DiceProgress {
  /** The frames played, as `diceFrames` laid them out, or the last round alone when motion is reduced. */
  readonly frames: readonly TimedDiceFrame[];
  /** The frame shown. */
  readonly index: number;
  /** Whether `DICE_ANIMATION_MS` has passed since the roll arrived, or motion is reduced. */
  readonly isOver: boolean;
}

/**
 * Plays the dice roll that started the match (ADR-0107), one per battle view: provided by `Battle`. It follows
 * `GameStateService.diceRoll` from the time `DICE_ROLLED` arrived, so a view created a moment later, by the `STATE`
 * that starts the match, joins the animation where it is. Each frame is set by a timer at its start.
 */
@Service({ autoProvided: false })
export class DiceAnimation {
  /** The roll, the battle and its first turn's timer. */
  private readonly gameState = inject(GameStateService);
  /** Whether the player asked for reduced motion: the result is then shown still, from the start. */
  private readonly prefersReducedMotion = inject(PREFERS_REDUCED_MOTION);

  /** Set by the timers of the effect below; `null` without a roll. */
  private readonly progress = signal<DiceProgress | null>(null);

  /**
   * The frame to draw: while the animation plays, then its last frame until the first turn's timer starts (the
   * snapshot's `turnRemainingMs` is no longer `null`); `null` without a roll this client received, and once a shot has
   * been fired.
   */
  readonly frame = computed<DiceFrame | null>(() => {
    const progress = this.progress();
    const battle = this.gameState.snapshot()?.battle;
    if (progress === null || !battle || battle.incomingShots.length + battle.outgoingShots.length > 0) {
      return null;
    }
    if (progress.isOver && battle.turnRemainingMs !== null) {
      return null;
    }
    return progress.frames[progress.index] ?? null;
  });

  /**
   * Whether the animation is playing: the view holds the turn's heading and aiming until it ends on who starts. Never
   * with reduced motion, where the result shows at once.
   */
  readonly isPlaying = computed(() => this.frame() !== null && this.progress()?.isOver === false);

  /** Restarts the timers whenever the roll, or the reduced-motion setting, changes. */
  constructor() {
    effect((onCleanup) => {
      const roll = this.gameState.diceRoll();
      if (roll === null || roll.rolls.length === 0) {
        this.progress.set(null);
        return;
      }
      if (this.prefersReducedMotion()) {
        const last = diceFrames(roll.rolls, DICE_ANIMATION_MS).at(-1);
        this.progress.set(last === undefined ? null : { frames: [last], index: 0, isOver: true });
        return;
      }
      const frames = diceFrames(roll.rolls, DICE_ANIMATION_MS);
      const elapsedMs = performance.now() - roll.receivedAt;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const show = (index: number): void => {
        this.progress.set({ frames, index, isOver: false });
      };
      show(
        Math.max(
          0,
          frames.findLastIndex((frame) => frame.startsAtMs <= elapsedMs),
        ),
      );
      frames.forEach((frame, index) => {
        if (frame.startsAtMs > elapsedMs) {
          timers.push(
            setTimeout(() => {
              show(index);
            }, frame.startsAtMs - elapsedMs),
          );
        }
      });
      const end = (): void => {
        this.progress.set({ frames, index: frames.length - 1, isOver: true });
      };
      if (elapsedMs >= DICE_ANIMATION_MS) {
        end();
      } else {
        timers.push(setTimeout(end, DICE_ANIMATION_MS - elapsedMs));
      }
      onCleanup(() => {
        timers.forEach(clearTimeout);
      });
    });
  }
}
