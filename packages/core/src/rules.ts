// Game rules defaults (docs/domain.md#rules). `validateRules` lands with rules negotiation (issue #26).

import type { GameRules } from './types.js';

/** Rules a new room starts with: no extra turn on hit, adjacency not allowed, 60 s turns, no salvo, auto random shot. */
export const DEFAULT_RULES: GameRules = {
  consecutiveTurnOnHit: false,
  allowAdjacentShips: false,
  turnTimeLimitSeconds: 60,
  salvoMode: false,
  timeoutAction: 'AUTO_RANDOM_SHOT',
};
