import { TARGET_VIOLATIONS, validateTargets, type Coordinate, type ShotResult } from '@battleship/core';

import { toCellIndex } from '../../shared/board-grid/board-cells';

/** The targets of the current turn as `UPDATE_TARGETS` and `FIRE` send them, in the order they were picked. */
export type TargetDraft = readonly Coordinate[];

/**
 * Why a tap leaves the draft as it was: `ALREADY_TARGETED` for a cell shot in an earlier turn, `WRONG_TARGET_COUNT` for
 * a full salvo draft, which a target must leave before another one joins.
 */
export type TargetRefusal = typeof TARGET_VIOLATIONS.ALREADY_TARGETED | typeof TARGET_VIOLATIONS.WRONG_TARGET_COUNT;

/** The outcome of a tap on "Enemy waters" during the player's turn (ADR-0056). */
export type TargetChange =
  | {
      /** Discriminant: the draft changed. */
      readonly ok: true;
      /** The new draft. */
      readonly draft: TargetDraft;
      /** Whether the tapped cell is now a target; `false` when the tap took it out of the draft. */
      readonly isTargeted: boolean;
    }
  | {
      /** Discriminant: the tap changed nothing. */
      readonly ok: false;
      /** Why: a cell shot in an earlier turn, or a full salvo draft. */
      readonly reason: TargetRefusal;
    };

/**
 * Tells whether two drafts hold the same cells in the same order.
 * @param a One draft.
 * @param b The other.
 * @returns Whether they are equal.
 */
export function isSameTargets(a: TargetDraft, b: TargetDraft): boolean {
  return a.length === b.length && a.every((target, index) => toCellIndex(target) === toCellIndex(b[index] ?? target));
}

/**
 * Applies a tap on the tracking board to the turn's draft: a target is taken out; a cell shot in an earlier turn is
 * refused, checked with core's `validateTargets`; any other cell joins the draft. With one shot allowed (standard
 * mode) the new cell replaces the old target, so aiming elsewhere is a single tap; a full salvo draft refuses it.
 * @param draft The current draft.
 * @param coordinate The cell tapped.
 * @param shots The player's shots on the opponent's board, from earlier turns.
 * @param shotsAllowed The turn's shot allowance.
 * @returns The new draft, or why it stays as it was.
 */
export function toggleTarget(
  draft: TargetDraft,
  coordinate: Coordinate,
  shots: readonly ShotResult[],
  shotsAllowed: number,
): TargetChange {
  const index = toCellIndex(coordinate);
  if (draft.some((target) => toCellIndex(target) === index)) {
    return { ok: true, draft: draft.filter((target) => toCellIndex(target) !== index), isTargeted: false };
  }
  // A single tapped cell is on the board and not repeated, so the only rule it can break is ALREADY_TARGETED.
  if (!validateTargets([coordinate], shots, 1).ok) {
    return { ok: false, reason: TARGET_VIOLATIONS.ALREADY_TARGETED };
  }
  if (draft.length < shotsAllowed) {
    return { ok: true, draft: [...draft, coordinate], isTargeted: true };
  }
  if (shotsAllowed === 1) {
    return { ok: true, draft: [coordinate], isTargeted: true };
  }
  return { ok: false, reason: TARGET_VIOLATIONS.WRONG_TARGET_COUNT };
}
