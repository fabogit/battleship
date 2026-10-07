# Protocol

The contract lives in `packages/core/src/protocol.ts`; the payload guards in `packages/core/src/validation.ts`. Decisions: [ADR-0015](adr/0015-protocol-shape.md), [ADR-0016](adr/0016-payload-validation.md), [ADR-0017](adr/0017-protocol-versioning.md), [ADR-0031](adr/0031-payload-guard-strictness.md).

## Handshake

The Socket.io client passes `auth` as a callback, re-evaluated on every reconnect attempt ([Sessions & reconnection](server.md#sessions--reconnection)):

```typescript
export interface HandshakeAuth {
  readonly protocolVersion: number;
  readonly session?: SessionCredentials; // absent when the client is not in a room
}

export interface SessionCredentials {
  readonly roomId: string; // ROOM_ID_LENGTH characters of ROOM_ID_ALPHABET
  readonly playerSecret: string; // lowercase crypto.randomUUID()
}
```

* `protocolVersion` is checked first, by strict equality with `PROTOCOL_VERSION`: any other value, a missing `auth` included, is `PROTOCOL_MISMATCH`.
* `session` then goes through `parseSessionCredentials`; a malformed session is `SESSION_INVALID`, like an unknown or expired one.

## Client → server

All commands use Socket.io acknowledgements: `ack({ ok: true, ...data } | { ok: false, error: ErrorCode })` (`AckResponse<T>`). Code names the events through `CLIENT_EVENTS` (`CLIENT_EVENTS.JOIN_ROOM`), which `satisfies` the `ClientToServerEvents` map ([ADR-0043](adr/0043-named-constants.md)).

| Event | Payload | Ack data | Phase |
|---|---|---|---|
| `CREATE_ROOM` | `{ nickname }` | `{ roomId, playerSecret }` | — |
| `JOIN_ROOM` | `{ roomId, nickname }` | `{ playerSecret }` | `WAITING_FOR_OPPONENT` |
| `UPDATE_RULES` | `{ rules: GameRules }` | `{ rulesVersion }` | `RULES_NEGOTIATION` |
| `CONFIRM_RULES` | `{ rulesVersion }` | — | `RULES_NEGOTIATION` |
| `UPDATE_PLACEMENT` | `{ ships: ShipPlacement[] }` | — | `PLACEMENT` |
| `CONFIRM_PLACEMENT` | `{}` | — | `PLACEMENT` |
| `UNLOCK_PLACEMENT` | `{}` | — | `PLACEMENT` |
| `UPDATE_TARGETS` | `{ targets: Coordinate[] }` | — | `IN_PROGRESS`, own turn |
| `FIRE` | `{ targets: Coordinate[] }` | — | `IN_PROGRESS`, own turn |
| `SET_PAUSED` | `{ isPaused: boolean }` | — | `IN_PROGRESS`, opponent disconnected |
| `SURRENDER` | `{}` | — | `IN_PROGRESS` |
| `REMATCH_CHOICE` | `{ choice: RematchChoice }` | — | `GAME_OVER` |
| `LEAVE_ROOM` | `{}` | — | any |
| `ECHO` | any | `{ payload, protocolVersion }` | Phase 0 connectivity check only; no guard, never fails |

## Payload validation

Every command payload passes its guard in `PAYLOAD_PARSERS` before reaching room logic; a guard returns a new, normalized copy or `null`, and `null` is `INVALID_PAYLOAD` ([ADR-0031](adr/0031-payload-guard-strictness.md)). Guards check only what no room state could make valid; everything that depends on the room is the job of the domain and has its own error code.

* **Objects:** plain objects only (as `JSON.parse` builds them), with exactly the listed properties. A missing or an extra property is refused, nested objects included.
* **Nickname:** a string, trimmed, then 1 to `NICKNAME_MAX_LENGTH` UTF-16 code units (what an HTML `maxlength` counts). The trimmed value is what the server stores.
* **Room id:** exactly `ROOM_ID_LENGTH` characters of `ROOM_ID_ALPHABET`.
* **Rules:** every `GameRules` field present, booleans as booleans, `turnTimeLimitSeconds` one of `15`, `30`, `60`, `120`, `timeoutAction` a known value. The salvo/extra-turn exclusivity is `validateRules` → `INVALID_RULES`.
* **`rulesVersion`:** a non-negative safe integer. A stale one is `STALE_RULES`.
* **Coordinates:** integers from `0` to `BOARD_SIZE − 1` on both axes; floats, `NaN`, strings and off-board values are refused.
* **Ships:** 0 to `FLEET.length` (5) entries, each with a known `type`, an on-board `start` and a known `orientation`. Repeated types, ships running off the board, overlaps and adjacency are placement validation → `INVALID_PLACEMENT`.
* **Targets:** at most one per surviving ship, so at most `FLEET.length` (5); `UPDATE_TARGETS` may send none, `FIRE` at least one. The exact count, repeated cells and cells already shot depend on the turn → `INVALID_TARGETS`.
* **Enums** (`orientation`, `timeoutAction`, `choice`): exact, case-sensitive members only.
* **Empty payloads** (`CONFIRM_PLACEMENT`, `UNLOCK_PLACEMENT`, `SURRENDER`, `LEAVE_ROOM`): exactly `{}`.

Lengths are checked before elements, so an oversized array is refused without being walked; Socket.io's `maxHttpBufferSize` bounds the raw message ([Hardening](server.md#hardening)).

## Server → client

Code names these events through `SERVER_EVENTS` (`SERVER_EVENTS.STATE`), which `satisfies` the `ServerToClientEvents` map.

| Event | Payload | Purpose |
|---|---|---|
| `STATE` | `PlayerStateSnapshot` | Source of truth; sent after every state change and on (re)connect |
| `SHOT_RESOLVED` | `{ shooter: Seat, results: ShotResult[] }` | Animation/sound only (also reflected in `STATE`) |
| `DICE_ROLLED` | `{ rolls: { P1: number, P2: number }[], starter: Seat }` | Dice animation, including re-rolls |
| `SESSION_REPLACED` | `{}` | This socket was superseded by a newer one |
| `SERVER_SHUTDOWN` | `{}` | Server restarting; the match is lost |

## Snapshot

```typescript
export interface PerPlayer<T> {
  readonly me: T;
  readonly opponent: T;
}

export interface PlayerView {
  readonly seat: Seat;
  readonly nickname: string;
  readonly isConnected: boolean;
  readonly forfeitRemainingMs: number | null; // set while disconnected
}

export interface PlacementSnapshot {
  readonly myShips: readonly PlacedShip[];
  readonly hasConfirmed: PerPlayer<boolean>;
  readonly remainingMs: number;
  readonly startCountdownMs: number | null; // set while both fleets are confirmed
}

export interface BattleSnapshot {
  readonly myShips: readonly PlacedShip[];
  readonly incomingShots: readonly ShotResult[]; // opponent's shots on my board
  readonly outgoingShots: readonly ShotResult[]; // my shots on opponent's board
  readonly currentTurn: Seat;
  readonly shotsAllowed: number;
  readonly myDraftTargets: readonly Coordinate[];
  readonly turnRemainingMs: number | null; // null before the first turn starts
  readonly isPaused: boolean;
  readonly afkCount: PerPlayer<number>;
}

export interface GameOverSnapshot {
  readonly winner: Seat | null; // null only for ABANDONED
  readonly reason: GameOverReason;
  readonly opponentShips: readonly PlacedShip[];
  readonly rematch: PerPlayer<RematchChoice | null>;
}

export interface PlayerStateSnapshot {
  readonly roomId: string;
  readonly phase: RoomPhase;
  readonly me: PlayerView;
  readonly opponent: PlayerView | null;
  readonly rules: GameRules;
  readonly rulesVersion: number;
  readonly hasConfirmedRules: PerPlayer<boolean>;
  readonly placement: PlacementSnapshot | null; // PLACEMENT only
  readonly battle: BattleSnapshot | null; // IN_PROGRESS only
  readonly gameOver: GameOverSnapshot | null; // GAME_OVER only
}
```

Timers are sent as **remaining milliseconds** (not absolute timestamps) to avoid client clock skew. The client counts down locally and re-syncs on every snapshot.

## Error codes

`ERROR_CODES` names them (`ERROR_CODES.ROOM_FULL`) and `ErrorCode` is their union; `Object.values(ERROR_CODES)` lists them at runtime, in this order ([ADR-0043](adr/0043-named-constants.md)).

| Code | When |
|---|---|
| `PROTOCOL_MISMATCH` | Handshake `protocolVersion` differs from `PROTOCOL_VERSION` |
| `INVALID_PAYLOAD` | A payload failed its guard ([Payload validation](#payload-validation)) |
| `RATE_LIMITED` | More than `RATE_LIMIT_EVENTS_PER_SECOND` events from one socket |
| `SERVER_FULL` | `CREATE_ROOM` with `MAX_ROOMS` rooms open |
| `ROOM_NOT_FOUND` | `JOIN_ROOM` for a room that does not exist (or was lost in a restart) |
| `ROOM_FULL` | `JOIN_ROOM` for a room with both seats taken |
| `SESSION_INVALID` | Handshake `session` malformed, unknown or expired |
| `WRONG_PHASE` | A command outside the phases listed for it |
| `NOT_YOUR_TURN` | `UPDATE_TARGETS` or `FIRE` during the opponent's turn |
| `NOT_ALLOWED` | A command the sender may not send now, e.g. `SET_PAUSED` while the opponent is connected |
| `INVALID_RULES` | `UPDATE_RULES` failing `validateRules` |
| `STALE_RULES` | `CONFIRM_RULES` for a version other than the current one |
| `INVALID_PLACEMENT` | `UPDATE_PLACEMENT` or `CONFIRM_PLACEMENT` with a layout that breaks the [placement rules](domain.md#placement) |
| `PLACEMENT_LOCKED` | `UPDATE_PLACEMENT` while the fleet is confirmed |
| `INVALID_TARGETS` | Targets that break the [shot engine](domain.md#shot-engine)'s constraints for this turn |
