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

The `handshake` plugin checks it in a Socket.io middleware, before the socket connects ([ADR-0061](adr/0061-handshake-checks.md)):

- `protocolVersion` is checked first, by strict equality with `PROTOCOL_VERSION`: any other value, a string or a missing `auth` included, is `PROTOCOL_MISMATCH`. When `auth` has no `protocolVersion`, the server reads a `protocolVersion` query parameter instead, which must equal the decimal form (`?protocolVersion=2`): tools such as Postman cannot send `auth` ([ADR-0062](adr/0062-protocol-version-query.md)). The app always sends `auth`.
- `session`, when present, then goes through `parseSessionCredentials` and is looked up: its room must be open and one of its seats must hold the `playerSecret`. A malformed session is `SESSION_INVALID`, like an unknown or expired one. A session is never read from the query.
- A refusal is a `connect_error` whose `message` is the error code; the connection never opens and Socket.io does not retry it.
- A valid session binds the socket to its seat; any other socket on that seat gets `SESSION_REPLACED` and a server disconnect, and the new socket gets `STATE` at once ([ADR-0063](adr/0063-session-rebinding.md), [Sessions & reconnection](server.md#sessions--reconnection)).

## Client → server

All commands use Socket.io acknowledgements: `ack({ ok: true, ...data } | { ok: false, error: ErrorCode })` (`AckResponse<T>`). Code names the events through `CLIENT_EVENTS` (`CLIENT_EVENTS.JOIN_ROOM`), which `satisfies` the `ClientToServerEvents` map ([ADR-0043](adr/0043-named-constants.md)).

- A command sent without an ack callback is ignored: not applied, not answered.
- A refused command gets only its ack. An accepted one gets its ack, then any effect (`SHOT_RESOLVED`) and then `STATE` reach both players ([ADR-0047](adr/0047-reply-order.md)).
- The commands after `JOIN_ROOM` come from the socket that created or joined the room; from any other socket they are `NOT_ALLOWED` ([ADR-0045](adr/0045-socket-seat-binding.md)). A socket that reconnects with its stored `session` gets its seat back at the [handshake](#handshake); without one it has no seat.
- `UPDATE_RULES`, `CONFIRM_RULES`, `SURRENDER` and `REMATCH_CHOICE` pass their guard, then are `NOT_ALLOWED` until their room logic lands ([ADR-0046](adr/0046-commands-ahead-of-room-logic.md)). So is `LEAVE_ROOM` in `IN_PROGRESS` (surrender, #35) and `GAME_OVER` (rematch, #36); before the match it frees the seat ([Server: Leaving](server.md#leaving)).
- `JOIN_ROOM` takes the free seat: `P2`, or `P1` when the creator left before the match ([ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)), so a client reads its seat from `STATE` (`me.seat`).
- Until rules negotiation lands (#26), `JOIN_ROOM` moves the room straight to `PLACEMENT`.
- `JOIN_ROOM` outside `WAITING_FOR_OPPONENT` finds both seats taken, so it is `ROOM_FULL`, never `WRONG_PHASE` ([Server: Room creation & joining](server.md#room-creation--joining)).

| Event               | Payload                      | Ack data                       | Phase                                                                     |
| ------------------- | ---------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `CREATE_ROOM`       | `{ nickname }`               | `{ roomId, playerSecret }`     | —                                                                         |
| `JOIN_ROOM`         | `{ roomId, nickname }`       | `{ playerSecret }`             | `WAITING_FOR_OPPONENT`                                                    |
| `UPDATE_RULES`      | `{ rules: GameRules }`       | `{ rulesVersion }`             | `RULES_NEGOTIATION`                                                       |
| `CONFIRM_RULES`     | `{ rulesVersion }`           | —                              | `RULES_NEGOTIATION`                                                       |
| `UPDATE_PLACEMENT`  | `{ ships: ShipPlacement[] }` | —                              | `PLACEMENT`                                                               |
| `CONFIRM_PLACEMENT` | `{}`                         | —                              | `PLACEMENT`                                                               |
| `UNLOCK_PLACEMENT`  | `{}`                         | —                              | `PLACEMENT`                                                               |
| `UPDATE_TARGETS`    | `{ targets: Coordinate[] }`  | —                              | `IN_PROGRESS`, own turn                                                   |
| `FIRE`              | `{ targets: Coordinate[] }`  | —                              | `IN_PROGRESS`, own turn                                                   |
| `SET_PAUSED`        | `{ isPaused: boolean }`      | —                              | `IN_PROGRESS`, opponent disconnected                                      |
| `SURRENDER`         | `{}`                         | —                              | `IN_PROGRESS`                                                             |
| `REMATCH_CHOICE`    | `{ choice: RematchChoice }`  | —                              | `GAME_OVER`                                                               |
| `LEAVE_ROOM`        | `{}`                         | —                              | any                                                                       |
| `ECHO`              | any                          | `{ payload, protocolVersion }` | any; the smoke check (ADR-0048), no guard; only the rate limit refuses it |

`ECHO` is permanent ([ADR-0048](adr/0048-echo-smoke-check.md)): after every deploy, `pnpm --filter @battleship/server echo <url>` connects with the handshake `auth`, sends it and expects its ack, so the check covers the origin policy, the transport, the handshake and one event round trip without opening a room (a `CREATE_ROOM` would leave a room open until its TTL runs out). It is not a command: the client never sends it, and `emitWithAck` refuses it at compile time. The Postman collection keeps its `ECHO` requests ([Local tooling](development.md#local-tooling)).

## Payload validation

Every command payload passes its guard in `PAYLOAD_PARSERS` before reaching room logic; a guard returns a new, normalized copy or `null`, and `null` is `INVALID_PAYLOAD` ([ADR-0031](adr/0031-payload-guard-strictness.md)). Guards check only what no room state could make valid; everything that depends on the room is the job of the domain and has its own error code.

- **Objects:** plain objects only (as `JSON.parse` builds them), with exactly the listed properties. A missing or an extra property is refused, nested objects included.
- **Nickname:** a string, trimmed, then 1 to `NICKNAME_MAX_LENGTH` UTF-16 code units (what an HTML `maxlength` counts). The trimmed value is what the server stores. Its characters ([ADR-0060](adr/0060-nickname-characters.md)): no control (`Cc`), format (`Cf`), surrogate (`Cs`), line separator (`Zl`) or paragraph separator (`Zp`) anywhere, except a zero-width joiner (U+200D) between two pictographs, as in the emoji sequence 👩 U+200D 💻 (technologist); no blank-looking character anywhere (the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0, the braille blank U+2800, the musical null notehead U+1D159); and at least one letter, number, punctuation mark or symbol. Inner spaces are kept. Zero-width and bidi characters, tabs and line breaks are therefore refused, while accented, CJK, Arabic, Hebrew and emoji names pass.
- **Room id:** exactly `ROOM_ID_LENGTH` characters of `ROOM_ID_ALPHABET`.
- **Rules:** every `GameRules` field present, booleans as booleans, `turnTimeLimitSeconds` one of `15`, `30`, `60`, `120`, `timeoutAction` a known value. The salvo/extra-turn exclusivity is `validateRules` → `INVALID_RULES`.
- **`rulesVersion`:** a non-negative safe integer. A stale one is `STALE_RULES`.
- **Coordinates:** integers from `0` to `BOARD_SIZE − 1` on both axes; floats, `NaN`, strings and off-board values are refused.
- **Ships:** 0 to `FLEET.length` (5) entries, each with a known `type`, an on-board `start` and a known `orientation`. Repeated types, ships running off the board, overlaps and adjacency are placement validation → `INVALID_PLACEMENT`.
- **Targets:** at most one per surviving ship, so at most `FLEET.length` (5); `UPDATE_TARGETS` may send none, `FIRE` at least one. The exact count, repeated cells and cells already shot depend on the turn → `INVALID_TARGETS`.
- **Enums** (`orientation`, `timeoutAction`, `choice`): exact, case-sensitive members only.
- **Empty payloads** (`CONFIRM_PLACEMENT`, `UNLOCK_PLACEMENT`, `SURRENDER`, `LEAVE_ROOM`): exactly `{}`.

Lengths are checked before elements, so an oversized array is refused without being walked; Socket.io's `maxHttpBufferSize` bounds the raw message at 16 KiB: a larger one closes the connection before any guard runs ([Hardening](server.md#hardening)).

## Server → client

Code names these events through `SERVER_EVENTS` (`SERVER_EVENTS.STATE`), which `satisfies` the `ServerToClientEvents` map.

| Event              | Payload                                                  | Purpose                                                           |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `STATE`            | `PlayerStateSnapshot`                                    | Source of truth; sent after every state change and on (re)connect |
| `SHOT_RESOLVED`    | `{ shooter: Seat, results: ShotResult[] }`               | Animation/sound only; the `STATE` right after it reflects it      |
| `DICE_ROLLED`      | `{ rolls: { P1: number, P2: number }[], starter: Seat }` | Dice animation, including re-rolls                                |
| `SESSION_REPLACED` | `{}`                                                     | A newer socket took this seat; a server disconnect follows        |
| `SERVER_SHUTDOWN`  | `{}`                                                     | Server restarting; the match is lost                              |

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
  readonly forfeitRemainingMs: number | null; // set while disconnected, except in GAME_OVER
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
  readonly myShips: readonly PlacedShip[]; // both final boards, as in BattleSnapshot (ADR-0064)
  readonly incomingShots: readonly ShotResult[]; // the winning shot included
  readonly outgoingShots: readonly ShotResult[];
  readonly opponentShips: readonly PlacedShip[]; // revealed
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

| Code                | When                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROTOCOL_MISMATCH` | Handshake `protocolVersion` differs from `PROTOCOL_VERSION` or is missing                                                                                                                                                                                                                   |
| `INVALID_PAYLOAD`   | A payload failed its guard ([Payload validation](#payload-validation))                                                                                                                                                                                                                      |
| `RATE_LIMITED`      | More than `RATE_LIMIT_EVENTS_PER_SECOND` events from one socket in any one second; the event is dropped before its guard, `ECHO` included, and the socket stays connected                                                                                                                   |
| `SERVER_FULL`       | `CREATE_ROOM` with `MAX_ROOMS` rooms open                                                                                                                                                                                                                                                   |
| `ROOM_NOT_FOUND`    | `JOIN_ROOM` for a room that does not exist (or was lost in a restart)                                                                                                                                                                                                                       |
| `ROOM_FULL`         | `JOIN_ROOM` for a room with both seats taken                                                                                                                                                                                                                                                |
| `SESSION_INVALID`   | Handshake `session` malformed, unknown or expired                                                                                                                                                                                                                                           |
| `WRONG_PHASE`       | A command outside the phases listed for it, except `JOIN_ROOM` (`ROOM_FULL`)                                                                                                                                                                                                                |
| `NOT_YOUR_TURN`     | `UPDATE_TARGETS` or `FIRE` during the opponent's turn                                                                                                                                                                                                                                       |
| `NOT_ALLOWED`       | A command the sender may not send now: `SET_PAUSED` while the opponent is connected, a seat command from a socket without a seat, joining the room the socket already sits in, and every command whose room logic has not landed yet ([ADR-0046](adr/0046-commands-ahead-of-room-logic.md)) |
| `INVALID_RULES`     | `UPDATE_RULES` failing `validateRules`                                                                                                                                                                                                                                                      |
| `STALE_RULES`       | `CONFIRM_RULES` for a version other than the current one                                                                                                                                                                                                                                    |
| `INVALID_PLACEMENT` | `UPDATE_PLACEMENT` or `CONFIRM_PLACEMENT` with a layout that breaks the [placement rules](domain.md#placement)                                                                                                                                                                              |
| `PLACEMENT_LOCKED`  | `UPDATE_PLACEMENT` while the fleet is confirmed                                                                                                                                                                                                                                             |
| `INVALID_TARGETS`   | Targets that break the [shot engine](domain.md#shot-engine)'s constraints for this turn                                                                                                                                                                                                     |
