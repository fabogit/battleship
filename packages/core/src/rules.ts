// Game rules defaults (docs/domain.md#rules). `validateRules` lands with rules negotiation (issue #26).

import type { GameRules } from './types.js';

/** Rules a new room starts with: no extra turn on hit, adjacency not allowed, 30 s turns, no salvo, auto random shot. */
export const DEFAULT_RULES: GameRules = {
  isExtraTurnOnHitEnabled: false,
  areAdjacentShipsAllowed: false,
  turnTimeLimitSeconds: 30,
  isSalvoModeEnabled: false,
  timeoutAction: 'AUTO_RANDOM_SHOT',
};
