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

Decision: [ADR-0032](adr/0032-fleet-placement.md).

```typescript
export type PlacementViolation = 'OUT_OF_BOUNDS' | 'DUPLICATE_TYPE' | 'OVERLAP' | 'ADJACENT_SHIPS' | 'INCOMPLETE_FLEET';
export type PlacementValidation =
  | { readonly ok: true; readonly ships: readonly PlacedShip[] } // derived, in input order
  | { readonly ok: false; readonly reason: PlacementViolation; readonly shipIndex: number | null };

export function toPlacedShip(placement: ShipPlacement): PlacedShip;
export function validateDraft(ships: readonly ShipPlacement[], rules: GameRules): PlacementValidation; // 0–5 ships
export function validateFleet(ships: readonly ShipPlacement[], rules: GameRules): PlacementValidation; // all 5
export function generateRandomFleet(rules: GameRules, rng: Rng): PlacedShip[]; // FLEET order
export function completeFleet(draft: readonly ShipPlacement[], rules: GameRules, rng: Rng): PlacedShip[]; // FLEET order
```

* **Board axes:** `(0, 0)` is the top-left cell; `x` is the column, `y` the row. A ship extends from `start` towards larger `x` (`HORIZONTAL`) or larger `y` (`VERTICAL`).
* **Derivation:** `toPlacedShip` computes the `SHIP_LENGTH[type]` cells from `start` + `orientation`, never from cells the client computed. The `UPDATE_PLACEMENT` guard already refuses a `coordinates` field; `toPlacedShip` ignores one anyway, so a `PlacedShip` passed back in is re-derived. Linearity and length are therefore right by construction.
* **Rules**, checked ship by ship in input order, in this order:
  * **Bounds** (`OUT_OF_BOUNDS`): every derived coordinate lies on the board. On the server `start` is already on the board, so this catches ships running off the right or bottom edge.
  * **Uniqueness** (`DUPLICATE_TYPE`): each `ShipType` appears at most once.
  * **Overlap** (`OVERLAP`): no cell shared between ships.
  * **Adjacency** (`ADJACENT_SHIPS`): when `areAdjacentShipsAllowed === false`, no two ships may touch horizontally, vertically or diagonally.
* **Partial layouts** (0–5 ships) are valid drafts if each ship satisfies the rules above (`validateDraft`). A fleet to confirm must also hold every ship type (`validateFleet`, otherwise `INCOMPLETE_FLEET`, checked last).
* **Validation result:** `ok: true` carries the derived ships, which the server stores and sends back in `placement.myShips`. `ok: false` names the first rule broken and the input index of the ship that broke it: for `OVERLAP` and `ADJACENT_SHIPS` the later of the two ships, `null` for `INCOMPLETE_FLEET`. The server answers `INVALID_PLACEMENT` and logs the reason; the client never sees it.
* **Boundary with the payload guards:** the `UPDATE_PLACEMENT` guard runs first and answers `INVALID_PAYLOAD` for whatever no room could accept: a malformed or extra property, an unknown `type` or `orientation`, a `start` off the board, more than 5 entries ([Payload validation](protocol.md#payload-validation), [ADR-0031](adr/0031-payload-guard-strictness.md)). `placement.ts` repeats none of that and checks only the rules above, which depend on the ship lengths, the other ships and `areAdjacentShipsAllowed`. It still handles any `ShipPlacement` (a negative `start` is `OUT_OF_BOUNDS`), so the client can call it before sending.
* **`generateRandomFleet(rules, rng)`:** backtracking search producing a complete valid fleet. Used by the client "Randomize" button and by the server as a fallback.
  * Ships are placed in `FLEET` order, largest first. For each ship, every on-board position that fits the ships already placed is listed, shuffled with `rng` and tried in turn; when the remaining ships cannot follow, the choice is undone and the next position is tried.
  * The search is exhaustive over a finite tree, so it always terminates, and a complete fleet fits a 10×10 board under either adjacency setting, so it always succeeds. In practice it never backtracks: over 100,000 seeds per setting it placed exactly 5 ships every time, in about 0.5 ms.
  * All draws come from `rng`, so the same seed gives the same fleet. Fleets are not uniformly distributed over all possible layouts; nothing in the game needs that.
* **`completeFleet(draft, rules, rng)`:** keeps the draft's ships and places the missing ones with the same search. It discards the draft and calls `generateRandomFleet` when:
  * the draft is invalid (the server never stores one, but the deadline must still produce a fleet);
  * the remaining ships cannot fit (possible when adjacency is forbidden, e.g. when the other four ships leave no 5 free cells in a row or column for the carrier);
  * the search places more than 1,000 ships, backtracked ones included. Over 200,000 random valid drafts with adjacency forbidden, completion never needed more than 6; the limit only bounds a pathological draft to a few milliseconds.
* **Return order:** `generateRandomFleet` and `completeFleet` return `PlacedShip[]` in `FLEET` order (`CARRIER` … `DESTROYER`), whatever the draft order, so equal fleets compare equal. Validation keeps input order, so `shipIndex` points into what the client sent.
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
