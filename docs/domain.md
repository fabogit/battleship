# Domain

The domain lives in `packages/core`; each section covers one of its modules: `constants.ts`, `types.ts`, `rules.ts`, `random.ts`, `placement.ts` and `engine.ts`.

## Constants

| Constant | Value | Notes |
|---|---|---|
| `PROTOCOL_VERSION` | `1` | Bumped on any breaking protocol change |
| `BOARD_SIZE` | `10` | |
| `PLACEMENT_TIME_LIMIT_MS` | `60_000` | Re-evaluate after mobile playtesting |
| `START_COUNTDOWN_MS` | `5_000` | Capped by remaining placement time |
| `DICE_ANIMATION_MS` | `3_000` | Delay before the first turn timer starts |
| `MAX_CONSECUTIVE_AFK_TURNS` | `3` | Fixed, not negotiable |
| `DISCONNECT_FORFEIT_MS` | `180_000` | Max absence of a seated player, in any phase |
| `EMPTY_ROOM_TTL_MS` | `300_000` | Room with no connected player; must stay ≥ `DISCONNECT_FORFEIT_MS` (a lone creator sharing the link leaves the room empty) and < Render's 15 min spin-down |
| `GAME_OVER_TTL_MS` | `120_000` | Room idle in `GAME_OVER` without a rematch agreement |
| `NICKNAME_MAX_LENGTH` | `20` | Trimmed, non-empty, rendered as text only; counted in UTF-16 code units, like HTML `maxlength` |
| `ROOM_ID_LENGTH` | `8` | Characters in a room id |
| `ROOM_ID_ALPHABET` | `'23456789abcdefghjkmnpqrstuvwxyz'` | Digits and lowercase letters without `0`, `1`, `i`, `l`, `o` |
| `MAX_ROOMS` | `50` | New rooms rejected with `SERVER_FULL` above this |
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

/** Invariant: isSalvoModeEnabled && isExtraTurnOnHitEnabled is invalid. */
export interface GameRules {
  readonly isExtraTurnOnHitEnabled: boolean;
  readonly areAdjacentShipsAllowed: boolean;
  readonly turnTimeLimitSeconds: TurnTimeLimitSeconds;
  readonly isSalvoModeEnabled: boolean;
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

* `DEFAULT_RULES`: no extra turn on hit, adjacency not allowed, 30 s turns, no salvo, `AUTO_RANDOM_SHOT`.
* `validateRules(rules)`: checks the salvo/extra-turn exclusivity of a well-formed `GameRules`. The client UI disables the incompatible toggle; the server still rejects with `INVALID_RULES`. Field types and enum membership are checked earlier by the `UPDATE_RULES` guard (`INVALID_PAYLOAD`, [Payload validation](protocol.md#payload-validation)).

## Randomness

Decision: [ADR-0030](adr/0030-random-number-generation.md).

```typescript
export interface Rng {
  nextInt(maxExclusive: number): number; // uniform integer in [0, maxExclusive)
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[]; // new array, input untouched
}

export function createSeededRng(seed: number): Rng; // tests
export function createCryptoRng(): Rng; // production
```

* **Injection:** placement, dice and auto shots take an `Rng`; nothing in core or in the server's room logic calls `Math.random()`. The server and the client create one `createCryptoRng()` each; tests pass `createSeededRng(seed)`.
* **Seeded generator:** sfc32 (128-bit state, period ≥ 2^32). The seed is an integer from 0 to 2^32 − 1, used as in PractRand: `a = 0`, `b = seed`, `c = 0`, counter `1`, then 12 outputs discarded. The same seed gives the same sequence on every platform; a test pins the first outputs of seeds `0` and `42`. Any other seed (negative, fractional, too large, `NaN`) throws a `RangeError`.
* **Production generator:** `globalThis.crypto.getRandomValues`, one 32-bit word per draw, available in browsers and Node 24 without imports. `createCryptoRng()` throws if the platform lacks it. Core declares the one method it needs instead of loading DOM or Node types.
* **`nextInt(maxExclusive)`:** rejection sampling over 32-bit words. With `limit = 2^32 − (2^32 mod maxExclusive)`, words `≥ limit` are redrawn and the rest return `word mod maxExclusive`, so every result is equally likely. `maxExclusive` must be an integer from 1 to 2^32, otherwise `RangeError`.
* **`pick(items)`:** `items[nextInt(items.length)]`; throws a `RangeError` on an empty array.
* **`shuffle(items)`:** Fisher–Yates on a copy. Each permutation is equally likely and the input is never mutated.

## Placement

* **Board axes:** `(0, 0)` is the top-left cell; `x` is the column, `y` the row. A ship extends from `start` towards larger `x` (`HORIZONTAL`) or larger `y` (`VERTICAL`).
* **Bounds:** every derived coordinate lies on the board.
* **Linearity & length:** derived from `start` + `orientation` + `SHIP_LENGTH[type]`.
* **Uniqueness:** each `ShipType` appears at most once (exactly once for a complete fleet).
* **Overlap:** no cell shared between ships.
* **Adjacency:** when `areAdjacentShipsAllowed === false`, no two ships may touch horizontally, vertically or diagonally.
* **Partial layouts** (0–5 ships) are valid drafts if each ship satisfies the rules above.
* **`generateRandomFleet(rules, rng)`:** backtracking search producing a complete valid fleet. Used by the client "Randomize" button and by the server as a fallback.
* **`completeFleet(draft, rules, rng)`:** keeps the draft's ships and places the missing ones. If the remaining ships cannot fit (possible when adjacency is forbidden), it discards the draft and calls `generateRandomFleet`.
* All randomness goes through an injected `Rng` ([Randomness](#randomness)) so tests are deterministic with a fixed seed.

## Shot engine

* **Unified model:** every turn fires a list of targets. Standard mode is a salvo of size 1.
* **Shots allowed per turn:** standard → `1`; salvo → `min(shooter's surviving ships, opponent's unshot cells)`.
* **Target constraints:** exact count, on-board, no duplicates within the turn, never previously targeted.
* **Resolution:** targets resolve in order; `SUNK` results carry the full sunk ship; victory is checked after the turn.
* **Next turn:**
  * `isExtraTurnOnHitEnabled` (standard mode only): any `HIT`/`SUNK`, including from an auto shot, gives the same player another turn with a fresh timer.
  * Otherwise the turn passes to the opponent.
* **Auto shots:** uniformly random among unshot cells (no hunting AI).
