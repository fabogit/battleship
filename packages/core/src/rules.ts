// Game rules: the defaults and the check of an edit during rules negotiation (docs/domain.md#rules).

import { TIMEOUT_ACTIONS } from './types.js';
import type { GameRules } from './types.js';

/** Rules a new room starts with: no extra turn on hit, adjacency not allowed, 30 s turns, no salvo, auto random shot. */
export const DEFAULT_RULES: GameRules = {
  isExtraTurnOnHitEnabled: false,
  areAdjacentShipsAllowed: false,
  turnTimeLimitSeconds: 30,
  isSalvoModeEnabled: false,
  timeoutAction: TIMEOUT_ACTIONS.AUTO_RANDOM_SHOT,
};

/**
 * What `validateRules` refuses in a well-formed `GameRules`, checked in this order; each field's own values are the
 * guard's job.
 */
export const RULES_VIOLATIONS = {
  /** Salvo and extra turn on hit both enabled (ADR-0010). */
  SALVO_WITH_EXTRA_TURN: 'SALVO_WITH_EXTRA_TURN',
  /** Salvo enabled before the shot engine supports it (ADR-0085); #32 drops this violation when it lands. */
  SALVO_NOT_IMPLEMENTED: 'SALVO_NOT_IMPLEMENTED',
} as const;

/** One of the `RULES_VIOLATIONS`. */
export type RulesViolation = (typeof RULES_VIOLATIONS)[keyof typeof RULES_VIOLATIONS];

/** Rules a match can be played with. */
export interface ValidRules {
  /** Discriminant: every constraint holds. */
  readonly ok: true;
}

/** Rules the server rejects with `INVALID_RULES`; the reason is for tests and the server log. */
export interface InvalidRules {
  /** Discriminant: a constraint is broken. */
  readonly ok: false;
  /** The constraint broken. */
  readonly reason: RulesViolation;
}

/** Outcome of `validateRules`. */
export type RulesValidation = ValidRules | InvalidRules;

/**
 * Checks whether a match can be played with a rules object (docs/domain.md#rules). Pure, so the client can run it
 * before sending `UPDATE_RULES`; the server runs it on every edit.
 * @param rules Well-formed rules, as the `UPDATE_RULES` guard returns them.
 * @returns `{ ok: true }`, or the first violation: salvo and extra turn on hit are exclusive (ADR-0010), and salvo is
 * refused until the shot engine supports it (ADR-0085, #32), since `shotsAllowed` and `resolveTurn` throw on it.
 * @example
 * validateRules(DEFAULT_RULES); // { ok: true }
 * validateRules({ ...DEFAULT_RULES, isSalvoModeEnabled: true, isExtraTurnOnHitEnabled: true });
 * // { ok: false, reason: 'SALVO_WITH_EXTRA_TURN' }
 * validateRules({ ...DEFAULT_RULES, isSalvoModeEnabled: true }); // { ok: false, reason: 'SALVO_NOT_IMPLEMENTED' }
 */
export function validateRules(rules: GameRules): RulesValidation {
  if (rules.isSalvoModeEnabled && rules.isExtraTurnOnHitEnabled) {
    return { ok: false, reason: RULES_VIOLATIONS.SALVO_WITH_EXTRA_TURN };
  }
  if (rules.isSalvoModeEnabled) {
    return { ok: false, reason: RULES_VIOLATIONS.SALVO_NOT_IMPLEMENTED };
  }
  return { ok: true };
}
