# Server

Behaviour of the game server, `packages/server`.

## Room state machine

```text
   CREATE_ROOM
        │
        ▼
┌──────────────────────┐  opponent leaves / forfeits seat (any pre-game phase)
│ WAITING_FOR_OPPONENT │◄──────────────────────────────────────────────┐
└──────────┬───────────┘                                               │
           │ JOIN_ROOM                                                 │
           ▼                                                           │
┌──────────────────────┐  both confirm same rulesVersion               │
│  RULES_NEGOTIATION   ├──────────────────┐                            │
└──────────▲───────────┘                  ▼                            │
           │                   ┌──────────────────────┐                │
           │                   │      PLACEMENT       ├────────────────┤
           │                   │  draft ↔ confirmed   │                │
           │                   │  start countdown     │                │
           │                   └──────────┬───────────┘                │
           │                              │ countdown ends or deadline │
           │                              │ → dice roll                │
           │                              ▼                            │
           │                   ┌──────────────────────┐                │
           │                   │     IN_PROGRESS      │                │
           │                   │  running ↔ paused    │                │
           │                   └──────────┬───────────┘                │
           │                              │ fleet destroyed / surrender│
           │                              │ / AFK / disconnect forfeit │
           │                              ▼                            │
           │  any CHANGE_RULES ┌──────────────────────┐  one LEAVE     │
           └───────────────────┤      GAME_OVER       ├────────────────┘
                               └──────────┬───────────┘
                                          │ both SAME_RULES
                                          └──────────► PLACEMENT
```

## Transition rules

### Room creation & joining

- `CREATE_ROOM` creates the room in `WAITING_FOR_OPPONENT` with `DEFAULT_RULES` and seats the creator as `P1`.
- `JOIN_ROOM` seats the joiner as `P2` and moves to `RULES_NEGOTIATION`. Until rules negotiation lands (#26), it moves straight to `PLACEMENT` with `DEFAULT_RULES`.
  - Joining a full room → `ROOM_FULL`, in any phase (never `WRONG_PHASE`); unknown room (or lost after a restart) → `ROOM_NOT_FOUND`.
- A seated player who disconnected keeps the seat for `DISCONNECT_FORFEIT_MS`. This covers the common mobile case: the creator switches app to share the link and the friend joins meanwhile.

### Rules negotiation

- Either player may send `UPDATE_RULES`. The server validates, stores, increments `rulesVersion`, and clears both confirmations.
- `CONFIRM_RULES { rulesVersion }` with a stale version → `STALE_RULES`.
- When both have confirmed the current version → `PLACEMENT`.
- There is no negotiation timer (good faith). Idle rooms are bounded by the TTLs.

### Placement

- The deadline is `PLACEMENT_TIME_LIMIT_MS` from phase entry.
- `UPDATE_PLACEMENT { ships }` replaces the player's draft. It is rejected while confirmed (`PLACEMENT_LOCKED`) or invalid (`INVALID_PLACEMENT` when `validateDraft` fails, with the violation logged; see [Placement](domain.md#placement)).
- `CONFIRM_PLACEMENT` requires a complete valid fleet (`validateFleet`); `UNLOCK_PLACEMENT` reverts to draft. Confirming a confirmed fleet or unlocking a draft is accepted and changes nothing.
- When both are confirmed, a start countdown runs for `min(START_COUNTDOWN_MS, time to deadline)`. An unlock cancels it; a new double confirmation restarts it, still capped by the deadline.
- At the deadline, every unconfirmed fleet is completed with `completeFleet` and locked.
- On phase end: server dice roll → `DICE_ROLLED` → `IN_PROGRESS`. The first turn timer starts after `DICE_ANIMATION_MS`.
- If a player is disconnected at that moment, the match starts paused (see below).
- Until the placement timer and the dice roll land (#28, #29), the deadline is only shown, never enforced, and the second confirmation starts the match at once with `P1` first.

### Turns

- The active player edits a draft with `UPDATE_TARGETS { targets }` (any count up to the allowance, freely changeable) and commits with `FIRE { targets }`. Both are `NOT_YOUR_TURN` from the other player. A draft follows the shot rules except the exact count; a refused draft or shot (`resolveTurn` rejection) → `INVALID_TARGETS`. Firing clears the draft.
- On turn timeout:
  - `AUTO_RANDOM_SHOT`: keep the valid draft targets, fill the rest randomly, resolve.
  - `PASS_TURN`: discard the draft, pass the turn.
- Every timeout increments that player's AFK counter; any `FIRE` resets it.

### AFK

- When a player's counter reaches `MAX_CONSECUTIVE_AFK_TURNS`:
  - If the opponent's counter is ≥ `MAX_CONSECUTIVE_AFK_TURNS − 1` (both idle) → `GAME_OVER`, reason `ABANDONED`, no winner.
  - Otherwise → `GAME_OVER`, reason `AFK_FORFEIT`, the opponent wins.

### Disconnection & pause (`IN_PROGRESS`)

- When a player's socket drops, the match auto-pauses. A paused match freezes the turn timer with its remaining time.
- `SET_PAUSED { isPaused }` is accepted **only from the connected player while the opponent is disconnected**.
- While unpaused, timers run normally: the absent player's turns time out and count as AFK.
- The forfeit clock (`DISCONNECT_FORFEIT_MS`, from the moment of disconnection) runs regardless of pause. On expiry → `GAME_OVER`, reason `DISCONNECT_FORFEIT`.
- On reconnection the match resumes automatically with the remaining turn time.

### Disconnection in other phases

- The seat is kept for `DISCONNECT_FORFEIT_MS`.
- Placement timers keep running; auto-completion handles the absent player.
- On seat expiry, the player is removed and the other player returns to `WAITING_FOR_OPPONENT`. Rules are kept; confirmations and fleets are cleared.

### Leaving

- `LEAVE_ROOM` in a pre-game phase frees the seat immediately (same effect as seat expiry).
- In `IN_PROGRESS`, `SURRENDER` and `LEAVE_ROOM` both end the match as `SURRENDER`.

### Game over & rematch

- The snapshot reveals the opponent's fleet.
- Each player sends `REMATCH_CHOICE`; a player may change their choice until resolution.
  - Both `SAME_RULES` → `PLACEMENT`.
  - Both chosen and at least one `CHANGE_RULES` → `RULES_NEGOTIATION`, with the previous rules pre-filled and confirmations cleared.
  - Any `LEAVE` → the leaver is removed; the other player goes to `WAITING_FOR_OPPONENT` (same room link).

### Room lifecycle

- A room with no connected player is destroyed after `EMPTY_ROOM_TTL_MS`.
- A room in `GAME_OVER` is destroyed after `GAME_OVER_TTL_MS` without a resolved rematch.

## Room logic

`packages/server/src/room/`, without timers, sockets or I/O. Decisions: [ADR-0037](adr/0037-room-transition-shape.md), [ADR-0038](adr/0038-snapshot-projection.md), [ADR-0039](adr/0039-room-registry.md).

| Module            | Role                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `room.ts`         | `RoomState`, one variant per phase; `createRoom` for `CREATE_ROOM`; `applyCommand(state, command, now)` for every other command |
| `snapshot.ts`     | `projectSnapshot(state, seat, now)`: one player's `PlayerStateSnapshot`, with fog-of-war                                        |
| `room-manager.ts` | `RoomManager`: the open rooms by id, room ids and player secrets, `MAX_ROOMS`                                                   |

- **Commands** are the event name, the sender's `seat` and the payload as its guard returned it. `JOIN_ROOM` has no seat yet; it carries the joiner's new secret instead.
- **Results:** `{ ok: true, state, effects }` or `{ ok: false, error }`. A refused command returns no state and mutates nothing; `INVALID_PLACEMENT` and `INVALID_TARGETS` add the core `violation`, for the log only.
- **After an accepted command** the caller stores the state (`RoomManager` does), sends `STATE` to every seated player and performs the effects in order. The only effect so far is `SHOT_RESOLVED`, for both players.
- **Time:** `now` is epoch ms. Deadlines are stored as timestamps (`PlacementRoom.deadline`) and projected as remaining milliseconds.
- **Phase checks:** a placement command outside `PLACEMENT` and a turn command outside `IN_PROGRESS` → `WRONG_PHASE`; the phase is checked before the seat or the payload.
- **Projection:** the receiver's own fleet and both shot lists; the opponent's fleet only in `GAME_OVER`; never a secret. Fields whose feature is not built yet hold neutral values ([ADR-0038](adr/0038-snapshot-projection.md)).
- **Registry:** `createRoom` → `SERVER_FULL` at `MAX_ROOMS`; `joinRoom` → `ROOM_NOT_FOUND` for an unknown id; `dispatch` runs a seated player's command. Rooms are not removed until the TTL sweeps (#24).

## Sessions & reconnection

- **Credentials:** on `CREATE_ROOM` / `JOIN_ROOM` the server returns a `playerSecret` (`crypto.randomUUID()`). Seats (`P1`/`P2`) are public; secrets are never sent to the other player.
- **Room ids:** `ROOM_ID_LENGTH` (8) characters of `ROOM_ID_ALPHABET`, a URL-safe alphabet without easily confused characters, drawn with the injected `Rng` (`createCryptoRng()` in production); an id already in use is drawn again ([ADR-0039](adr/0039-room-registry.md)).
- **Client storage:** `SessionStore` writes `{ roomId, playerSecret, expiresAt }` under a per-room key in `localStorage`.
- **Handshake:** the Socket.io client passes `auth` as a callback, re-evaluated on every reconnect attempt: `{ protocolVersion, session?: { roomId, playerSecret } }`.
  - Version mismatch, a missing `protocolVersion` included → `connect_error` with `PROTOCOL_MISMATCH`; the client shows "please reload" ([Handshake](protocol.md#handshake)).
  - Valid session → the socket is bound to the seat and receives a `STATE` snapshot immediately.
  - Malformed (`parseSessionCredentials` fails), unknown or expired session → `SESSION_INVALID`; the client drops the stored credentials and returns to the home screen with an explanation.
- **Latest connection wins:** binding a new socket to a seat emits `SESSION_REPLACED` to the previous socket and disconnects it.
- **Mobile:** app switching kills sockets frequently. Reconnection is a primary flow and must be covered by integration tests.

## Hardening

- Every inbound payload passes its `core/validation.ts` guard (`PAYLOAD_PARSERS`) before reaching room logic; failures → `INVALID_PAYLOAD` ([Payload validation](protocol.md#payload-validation)). Room logic receives the guard's copy, never the raw payload.
- Socket.io `maxHttpBufferSize` is set to a small value (e.g. 16 KB).
- Per-socket rate limit (`RATE_LIMIT_EVENTS_PER_SECOND`) → `RATE_LIMITED`.
- `MAX_ROOMS` cap → `SERVER_FULL`.

## Logging

Logs go through Fastify's Pino logger. `LOG_LEVEL` picks how much is written, `LOG_FORMAT` how it is written ([Backend (Render)](deployment.md#backend-render)).

| Level                    | Logged                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `info` (default, Render) | HTTP requests except `/health`; socket connections (transport, origin, address) and disconnections (reason); handshakes refused by the origin policy; startup and shutdown |
| `debug` (local `.env`)   | Also `/health` requests, every socket event received or sent with its payload (broadcasts included, ack callbacks left out), and transport upgrades                        |

- Every socket line carries the `socketId`, so one client's history can be followed.
- Ack replies are not logged: Socket.io has no hook for them, so handlers log their own results where needed.
- Payloads stay at `debug` because they will carry player data; when sessions arrive (#22), `playerSecret` must be redacted (Pino `redact`).
- Socket.io's own internals (handshakes, polling, heartbeats) are not routed through Pino: run with `DEBUG=engine,socket.io*` to see them.

## Testability

- Room logic is a pure transition function `(state, command, now) → { state, effects }`; timers are scheduled effects executed by a thin `scheduler.ts` over an injectable `Clock`.
- The `Rng` is injected (dice, auto shots, auto placement); production uses `createCryptoRng()`, tests `createSeededRng(seed)` ([Randomness](domain.md#randomness)).
- Unit tests drive rooms with a fake clock and a fixed seed. Integration tests use real `socket.io-client` instances against an in-process server.
