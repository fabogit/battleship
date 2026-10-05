# Domain

The domain lives in `packages/core`; each section covers one of its modules: `constants.ts`, `types.ts`, `rules.ts`, `placement.ts` and `engine.ts`.

## Constants

| Constant | Value | Notes |
|---|---|---|
| `PROTOCOL_VERSION` | `1` | Bumped on any breaking protocol change |
| `BOARD_SIZE` | `10` | |
| `PLACEMENT_TIME_LIMIT_MS` | `60_000` | Re-evaluate after mobile playtesting |
| `START_COUNTDOWN_MS` | `5_000` | Capped by remaining placement time |
| `DICE_ANIMATION_MS` | `3_000` | Delay before the first turn timer starts |
| `MAX_CONSECUTIVE_AFK_TURNS` | `3` | Fixed, not negotiable |
| `DISCONNECT_FORFEIT_MS` | `300_000` | Max absence of a seated player, in any phase |
| `EMPTY_ROOM_TTL_MS` | `600_000` | Room with no connected player; must stay < Render's 15 min spin-down |
| `GAME_OVER_TTL_MS` | `600_000` | Room idle in `GAME_OVER` without a rematch agreement |
| `NICKNAME_MAX_LENGTH` | `20` | Trimmed, non-empty, rendered as text only |
| `MAX_ROOMS` | `500` | New rooms rejected with `SERVER_FULL` above this |
| `RATE_LIMIT_EVENTS_PER_SECOND` | `20` | Per socket |
| `SESSION_STORE_TTL_MS` | `86_400_000` | Client-side expiry of stored credentials |

## Domain types

```typescript
export type Coordinate = {
  readonly x: number; // integer, 0 ≤ x < BOARD_SIZE
  readonly y: number; // integer, 0 ≤ y < BOARD_SIZE
};

export type ShipType = 'CARRIER' | 'BATTLESHIP' | 'CRUISER' | 'SUBMARINE' | 'DESTROYER';

export const SHIP_LENGTH: Readonly<Record<ShipType, number>> = {
  CARRIER: 5,
  BATTLESHIP: 4,
  CRUISER: 3,
  SUBMARINE: 3,
  DESTROYER: 2,
};

export const FLEET: readonly ShipType[] = ['CARRIER', 'BATTLESHIP', 'CRUISER', 'SUBMARINE', 'DESTROYER'];

export type Orientation = 'HORIZONTAL' | 'VERTICAL';

/** What the client sends: the server never trusts client-computed coordinates. */
export interface ShipPlacement {
  readonly type: ShipType;
  readonly start: Coordinate;
  readonly orientation: Orientation;
}

/** Derived by core from a ShipPlacement. */
export interface PlacedShip extends ShipPlacement {
  readonly coordinates: readonly Coordinate[];
}

export type TurnTimeLimitSeconds = 15 | 30 | 60 | 120;
export type TimeoutAction = 'AUTO_RANDOM_SHOT' | 'PASS_TURN';

/** Invariant: salvoMode && consecutiveTurnOnHit is invalid. */
export interface GameRules {
  readonly consecutiveTurnOnHit: boolean;
  readonly allowAdjacentShips: boolean;
  readonly turnTimeLimitSeconds: TurnTimeLimitSeconds;
  readonly salvoMode: boolean;
  readonly timeoutAction: TimeoutAction;
}

export type ShotOutcome = 'MISS' | 'HIT' | 'SUNK';

export interface ShotResult {
  readonly coordinate: Coordinate;
  readonly outcome: ShotOutcome;
  readonly sunkShip?: PlacedShip; // present only when outcome === 'SUNK'
}

export type Seat = 'P1' | 'P2';

export type RoomPhase =
  | 'WAITING_FOR_OPPONENT'
  | 'RULES_NEGOTIATION'
  | 'PLACEMENT'
  | 'IN_PROGRESS'
  | 'GAME_OVER';

export type GameOverReason =
  | 'FLEET_DESTROYED'
  | 'SURRENDER'
  | 'AFK_FORFEIT'
  | 'DISCONNECT_FORFEIT'
  | 'ABANDONED'; // both players AFK — no winner

export type RematchChoice = 'SAME_RULES' | 'CHANGE_RULES' | 'LEAVE';
```

## Rules

* `DEFAULT_RULES`: no extra turn on hit, adjacency not allowed, 60 s turns, no salvo, `AUTO_RANDOM_SHOT`.
* `validateRules(rules)`: checks enum membership and the salvo/extra-turn exclusivity. The client UI disables the incompatible toggle; the server still rejects with `INVALID_RULES`.

## Placement

* **Bounds:** every derived coordinate lies on the board.
* **Linearity & length:** derived from `start` + `orientation` + `SHIP_LENGTH[type]`.
* **Uniqueness:** each `ShipType` appears at most once (exactly once for a complete fleet).
* **Overlap:** no cell shared between ships.
* **Adjacency:** when `allowAdjacentShips === false`, no two ships may touch horizontally, vertically or diagonally.
* **Partial layouts** (0–5 ships) are valid drafts if each ship satisfies the rules above.
* **`generateRandomFleet(rules, rng)`:** backtracking search producing a complete valid fleet. Used by the client "Randomize" button and by the server as a fallback.
* **`completeFleet(draft, rules, rng)`:** keeps the draft's ships and places the missing ones. If the remaining ships cannot fit (possible when adjacency is forbidden), it discards the draft and calls `generateRandomFleet`.
* All randomness goes through an injected `Rng` so tests are deterministic with a fixed seed.

## Shot engine

* **Unified model:** every turn fires a list of targets. Standard mode is a salvo of size 1.
* **Shots allowed per turn:** standard → `1`; salvo → `min(shooter's surviving ships, opponent's unshot cells)`.
* **Target constraints:** exact count, on-board, no duplicates within the turn, never previously targeted.
* **Resolution:** targets resolve in order; `SUNK` results carry the full sunk ship; victory is checked after the turn.
* **Next turn:**
  * `consecutiveTurnOnHit` (standard mode only): any `HIT`/`SUNK`, including from an auto shot, gives the same player another turn with a fresh timer.
  * Otherwise the turn passes to the opponent.
* **Auto shots:** uniformly random among unshot cells (no hunting AI).
