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
- `JOIN_ROOM` seats the joiner in the free seat and moves to `RULES_NEGOTIATION`. Until rules negotiation lands (#26), it moves straight to `PLACEMENT` with `DEFAULT_RULES`.
  - The free seat is `P2`, unless the creator left or forfeited before the match: then the player left behind keeps `P2` and the joiner takes `P1` ([ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)).
  - Joining a full room → `ROOM_FULL`, in any phase (never `WRONG_PHASE`); unknown room (or lost after a restart) → `ROOM_NOT_FOUND`.
- A seated player who disconnected keeps the seat for `DISCONNECT_FORFEIT_MS` ([Seat presence](#seat-presence)). This covers the common mobile case: the creator switches app to share the link, the friend joins meanwhile and sees the creator away, and both carry on in `PLACEMENT` once the creator is back.

### Rules negotiation

- Either player may send `UPDATE_RULES`. The server validates, stores, increments `rulesVersion`, and clears both confirmations.
- `CONFIRM_RULES { rulesVersion }` with a stale version → `STALE_RULES`.
- When both have confirmed the current version → `PLACEMENT`.
- There is no negotiation timer (good faith). A room stays open while its players stay connected; once they have gone, their forfeits close it ([Room lifecycle](#room-lifecycle)).

### Placement

- The deadline is `PLACEMENT_TIME_LIMIT_MS` from phase entry.
- `UPDATE_PLACEMENT { ships }` replaces the player's draft. It is rejected while confirmed (`PLACEMENT_LOCKED`) or invalid (`INVALID_PLACEMENT` when `validateDraft` fails, with the violation logged; see [Placement](domain.md#placement)).
- `CONFIRM_PLACEMENT` requires a complete valid fleet (`validateFleet`); `UNLOCK_PLACEMENT` reverts to draft. Confirming a confirmed fleet or unlocking a draft is accepted and changes nothing.
- When both are confirmed, a start countdown runs for `min(START_COUNTDOWN_MS, time to deadline)`. An unlock cancels it; a new double confirmation restarts it, still capped by the deadline.
- At the deadline, every unconfirmed fleet is completed with `completeFleet` and locked.
- On phase end: server dice roll → `DICE_ROLLED` → `IN_PROGRESS`. The first turn timer starts after `DICE_ANIMATION_MS`.
- If a player is disconnected at that moment, the match starts paused (see below). Until the countdown lands, "that moment" is the second confirmation: a player can confirm, drop, and find the match started and paused.
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

Decisions: [ADR-0008](adr/0008-disconnection-in-battle.md), [ADR-0072](adr/0072-seat-presence.md), [ADR-0074](adr/0074-pause.md).

- When a seat loses its last socket, the match auto-pauses. A paused match freezes the turn timer with its remaining time, and nothing else: the active player may still update targets and fire.
- `SET_PAUSED { isPaused }` is accepted **only from the connected player while the opponent is disconnected**; otherwise `NOT_ALLOWED` (the player who is away included), and `WRONG_PHASE` outside `IN_PROGRESS`. Asking for the state the match is already in is accepted and changes nothing.
- While unpaused, timers run normally: the turns of the player who is away time out and count as AFK.
- The forfeit clock (`DISCONNECT_FORFEIT_MS`, from the moment of disconnection) runs regardless of pause. On expiry → `GAME_OVER`, reason `DISCONNECT_FORFEIT`, the opponent winning.
- On reconnection the match resumes automatically with the remaining turn time, once both seats are connected; if the opponent is away too, it stays paused and the returning player may resume it.
- Both players away: each seat has its own clock, so the first to have dropped forfeits and the other wins, connected or not ([ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)).
- Until the turn timer lands (#30) no turn times out and `turnRemainingMs` is `null`: the pause is stored and projected (`isPaused`), but has no timer to freeze. #30 adds the turn timer as a room timer that pausing stops with its remaining time and resuming starts again ([ADR-0074](adr/0074-pause.md)).

### Disconnection in other phases

- The seat is kept for `DISCONNECT_FORFEIT_MS`.
- Placement timers keep running; auto-completion handles the player who is away.
- On seat expiry, the player is removed and the other player returns to `WAITING_FOR_OPPONENT`, in the seat they had. Rules are kept; confirmations and fleets are cleared. When nobody is left, the room closes ([Room lifecycle](#room-lifecycle)).
- In `GAME_OVER` nothing is forfeited: the opponent still sees `isConnected`, `forfeitRemainingMs` is `null`, and the room lives by `GAME_OVER_TTL_MS`.

### Leaving

- `LEAVE_ROOM` in a pre-game phase frees the seat immediately (same effect as seat expiry): the leaver gets the ack and nothing more, every socket bound to the seat loses it, the session is no longer valid, and the other player gets `STATE`.
- In `IN_PROGRESS`, `SURRENDER` and `LEAVE_ROOM` both end the match as `SURRENDER`. Until surrender lands (#35), `LEAVE_ROOM` there is `NOT_ALLOWED`; in `GAME_OVER` it is `NOT_ALLOWED` until the rematch flow (#36), where leaving is the `LEAVE` choice.

### Game over & rematch

- The snapshot reveals the opponent's fleet and carries both final boards, every shot included, so a player who reconnects at game over sees what the other saw ([ADR-0064](adr/0064-game-over-snapshot-boards.md)).
- Each player sends `REMATCH_CHOICE`; a player may change their choice until resolution.
  - Both `SAME_RULES` → `PLACEMENT`.
  - Both chosen and at least one `CHANGE_RULES` → `RULES_NEGOTIATION`, with the previous rules pre-filled and confirmations cleared.
  - Any `LEAVE` → the leaver is removed; the other player goes to `WAITING_FOR_OPPONENT` (same room link).

### Room lifecycle

Decisions: [ADR-0065](adr/0065-clock-and-room-timers.md), [ADR-0073](adr/0073-room-lifecycle-with-forfeits.md).

- A room closes as soon as no seat holds a player: its last seat was freed by `LEAVE_ROOM` or by a forfeit. Logged as "Room closed" with the `reason` (`LEAVE_ROOM`, `DISCONNECT_FORFEIT`).
- A room in `GAME_OVER` is destroyed after `GAME_OVER_TTL_MS`, counted from the end of the match, unless it leaves `GAME_OVER` first (a resolved rematch, #36). Connected players do not keep it. Logged as "Room expired" with the `reason` `GAME_OVER`.
- A room nobody sits in has every seat away, so the forfeits resolve it: before the match it closes `DISCONNECT_FORFEIT_MS` after the last player dropped; during the match the first to have dropped forfeits within `DISCONNECT_FORFEIT_MS`, and the finished room expires `GAME_OVER_TTL_MS` later. There is no empty-room TTL: it could never fire first.
- Before game over, a room whose players stay connected has no timer: a waiting room stays open for as long as its creator's socket does, and holds its place under `MAX_ROOMS` meanwhile ([Hardening](#hardening), #113).
- The forfeit and the TTL are room timers (`RoomTimers`, one per room and kind) on the server's `Clock`. `room-handlers` reviews a room's timers after every change to its phase or its seats' presence; when a room is removed, it leaves `RoomManager`, its other timers stop and the sockets still in it lose their seat, so a seated command gets `NOT_ALLOWED` and a later room with the same id never reaches them.

### Seat presence

Decision: [ADR-0072](adr/0072-seat-presence.md).

- A seat is **connected** while at least one socket is bound to it and sits in the room's Socket.io room; it is **away** from the moment its last socket leaves: disconnected, or moved to another room by `CREATE_ROOM` or `JOIN_ROOM`. A socket replaced by a newer one (`SESSION_REPLACED`) is not its seat leaving: the new socket is already in the room when the old one is disconnected.
- The room stores when each seat went away (`disconnectedAt`). The forfeit clock counts `DISCONNECT_FORFEIT_MS` from it, in every phase but `GAME_OVER`, as one `DISCONNECT_FORFEIT` room timer at the earliest deadline of the two seats.
- A session resumed at the handshake brings the seat back: its forfeit clock stops and a paused match resumes once both seats are connected.
- Every seat drop and return sends `STATE` to every socket of the room: the opponent sees `isConnected` and `forfeitRemainingMs` (`PlayerView`), and in battle `isPaused`. A rebound socket whose seat never dropped gets its own `STATE` only.

## Room logic

`packages/server/src/room/`, without timers, sockets or I/O. Decisions: [ADR-0037](adr/0037-room-transition-shape.md), [ADR-0038](adr/0038-snapshot-projection.md), [ADR-0039](adr/0039-room-registry.md).

| Module            | Role                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `room.ts`         | `RoomState`, one variant per phase; `createRoom` for `CREATE_ROOM`; `applyCommand(state, command, now)` for every other command                         |
| `snapshot.ts`     | `projectSnapshot(state, seat, now)`: one player's `PlayerStateSnapshot`, with fog-of-war                                                                |
| `room-manager.ts` | `RoomManager`: the open rooms by id, room ids and player secrets, `MAX_ROOMS`, `remove`                                                                 |
| `presence.ts`     | Seat presence as pure transitions: `disconnectSeat`, `reconnectSeat`, `nextForfeit`, `forfeitSeat`, `leaveRoom` ([ADR-0072](adr/0072-seat-presence.md)) |
| `room-timers.ts`  | `RoomTimers`: the pending timers of every room by kind (`ROOM_TIMER_KINDS`), over the injected `Clock` ([ADR-0065](adr/0065-clock-and-room-timers.md))  |

- **Commands** are the event name, the sender's `seat` and the payload as its guard returned it. `JOIN_ROOM` has no seat yet; it carries the joiner's new secret instead.
- **Results:** `{ ok: true, state, effects }` or `{ ok: false, error }`. A refused command returns no state and mutates nothing; `INVALID_PLACEMENT` and `INVALID_TARGETS` add the core `violation`, for the log only.
- **After an accepted command** the caller stores the state (`RoomManager` does), performs the effects in order, then sends `STATE` to every seated player ([Socket handlers](#socket-handlers)). The only effect so far is `SHOT_RESOLVED`, for both players.
- **Time:** `now` is epoch ms. Deadlines are stored as timestamps (`PlacementRoom.deadline`) and projected as remaining milliseconds.
- **Phase checks:** a placement command outside `PLACEMENT` and a turn command outside `IN_PROGRESS` → `WRONG_PHASE`; the phase is checked before the seat or the payload.
- **Projection:** the receiver's own fleet and both shot lists, in battle and at game over; the opponent's fleet only in `GAME_OVER`; never a secret. Fields whose feature is not built yet hold neutral values ([ADR-0038](adr/0038-snapshot-projection.md)).
- **Registry:** `createRoom` → `SERVER_FULL` at `MAX_ROOMS` open rooms; `joinRoom` → `ROOM_NOT_FOUND` for an unknown id, and the seat the joiner took; `dispatch` runs a seated player's command; `setPresence`, `nextForfeit`, `forfeitDue` and `leave` run the presence transitions, and the last two remove a room nobody is left in; `remove` forgets a room whose game-over TTL ran out ([Room lifecycle](#room-lifecycle)). The registry has no timers.

## Plugins

`createServer` (`packages/server/src/server.ts`) only composes plugins and routes. The plugins live in `packages/server/src/plugins/`, each wrapped with `fastify-plugin` so that what it adds reaches the root instance ([ADR-0023](adr/0023-socket-io-integration.md)).

| Plugin          | Module             | Role                                                                                                                                                      |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin-policy` | `origin-policy.ts` | HTTP side of the [origin policy](deployment.md#backend-render): 403 `onRequest` hook and `@fastify/cors`                                                  |
| `socket-io`     | `socket-io.ts`     | Socket.io on the HTTP server: `allowRequest` origin check, `maxHttpBufferSize`, `app.io` decorator, connection logs, `preClose` flush and `onClose` close |
| `handshake`     | `handshake.ts`     | Handshake middleware: protocol version, session lookup and rebinding, latest connection wins ([Sessions & reconnection](#sessions--reconnection))         |
| `rate-limit`    | `rate-limit.ts`    | The per-socket rate limit, a Socket.io middleware ahead of every listener ([Hardening](#hardening))                                                       |
| `echo`          | `echo.ts`          | The `ECHO` smoke check, sent after every deploy ([ADR-0048](adr/0048-echo-smoke-check.md))                                                                |
| `room-handlers` | `room-handlers.ts` | Every command, wired to room logic ([Socket handlers](#socket-handlers)); seat presence and the room timers ([Seat presence](#seat-presence))             |

- `handshake`, `rate-limit`, `echo` and `room-handlers` declare `dependencies: ['socket-io']`. `handshake` is registered first: its namespace middleware runs before any socket connects, and `handshake` and `room-handlers` share the registry and the clock. `rate-limit` comes next, so its per-socket middleware runs before any event listener.
- `createServer` takes the room registry and the clock as options (`rooms`, `clock`), so tests pass a seeded `RoomManager` and a `FakeClock`; production gets a `RoomManager` with crypto randomness and `systemClock`. It also takes `trustProxyHops` from `TRUST_PROXY_HOPS` ([Logging](#logging)).
- `app.io` exists once the instance is ready (`listen()` or `ready()`).

## Socket handlers

`room-handlers` listens to every command on every socket. Decisions: [ADR-0045](adr/0045-socket-seat-binding.md), [ADR-0046](adr/0046-commands-ahead-of-room-logic.md), [ADR-0047](adr/0047-reply-order.md).

1. **Ack check:** a command without an ack callback is ignored, like `ECHO` ([Client → server](protocol.md#client--server)).
2. **Guard:** the payload goes through its `PAYLOAD_PARSERS` guard; `null` → `INVALID_PAYLOAD`, before any other check.
3. **Dispatch:**
   - `CREATE_ROOM` → `RoomManager.createRoom` (`SERVER_FULL` at `MAX_ROOMS`); the socket is bound to `P1`.
   - `JOIN_ROOM` → `RoomManager.joinRoom` (`ROOM_NOT_FOUND`, `ROOM_FULL`); the socket is bound to the seat the joiner took: `P2`, or `P1` after the creator left ([ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)). Joining the room the socket already sits in → `NOT_ALLOWED`.
   - `UPDATE_PLACEMENT`, `CONFIRM_PLACEMENT`, `UNLOCK_PLACEMENT`, `UPDATE_TARGETS`, `FIRE`, `SET_PAUSED` → `RoomManager.dispatch` with the sender's bound seat; a socket without a seat → `NOT_ALLOWED`.
   - `LEAVE_ROOM` → `RoomManager.leave` with the sender's bound seat ([Leaving](#leaving)); a socket without a seat → `NOT_ALLOWED`.
   - `UPDATE_RULES`, `CONFIRM_RULES`, `SURRENDER`, `REMATCH_CHOICE` → `NOT_ALLOWED` until their room logic lands (#26, #35, #36).
4. **Replies:** a refused command gets `{ ok: false, error }` and nothing else. An accepted one gets the ack (`{ ok: true }`, plus the credentials for `CREATE_ROOM` / `JOIN_ROOM`), then each effect goes to both players (`SHOT_RESOLVED`), then every seated socket gets `STATE` with its own projection.

- **Seat binding:** `socket.data.binding` holds `{ roomId, seat }`, and the socket joins the Socket.io room named after the room id; `STATE` goes to each socket of that room. The binding goes away with the socket; a reconnecting socket gets it back from its handshake `session` ([Sessions & reconnection](#sessions--reconnection)). Creating or joining another room moves the socket there; the seat it leaves stays taken, and is away once no other socket is bound to it ([Seat presence](#seat-presence)).
- **Time:** one `now()` per command, shared by the transition and the projections it triggers.
- **Room cap:** `SERVER_FULL` counts the rooms open at once; closed and expired rooms free their places ([Room lifecycle](#room-lifecycle), [ADR-0039](adr/0039-room-registry.md)).

## Sessions & reconnection

- **Credentials:** on `CREATE_ROOM` / `JOIN_ROOM` the server returns a `playerSecret` (`crypto.randomUUID()`). Seats (`P1`/`P2`) are public; secrets are never sent to the other player.
- **Room ids:** `ROOM_ID_LENGTH` (8) characters of `ROOM_ID_ALPHABET`, a URL-safe alphabet without easily confused characters, drawn with the injected `Rng` (`createCryptoRng()` in production); an id already in use is drawn again ([ADR-0039](adr/0039-room-registry.md)).
- **Generators:** `generateRoomId(rng)` and `createPlayerSecret()` live in core (`packages/core/src/identifiers.ts`), next to the guards that check their output (`isRoomId`, `parseSessionCredentials`). `RoomManager` calls them; the client only in its specs, through `src/testing/session-fixtures.ts`.
- **Client storage:** `SessionStore` writes `{ roomId, playerSecret, expiresAt }` under a per-room key in `localStorage`, and the tab's current room in `sessionStorage` ([ADR-0069](adr/0069-session-storage-layout.md), [Client: Routes & lobby flow](client.md#routes--lobby-flow)).
- **Handshake:** the Socket.io client passes `auth` as a callback, re-evaluated on every reconnect attempt: `{ protocolVersion, session?: { roomId, playerSecret } }`. The client adds the session of the tab's current room, and leaves the field out when the tab is in no room ([Client: Socket service](client.md#socket-service)). The `handshake` plugin checks it in a namespace middleware, before the socket connects ([ADR-0061](adr/0061-handshake-checks.md)); a refusal is a `connect_error` whose message is the error code, and Socket.io does not retry it.
  - Version mismatch, a missing `protocolVersion` included → `PROTOCOL_MISMATCH`; the client shows "Please reload the page" ([Client: Connection states](client.md#connection-states)). Checked before the session. Tools that cannot send `auth` pass `?protocolVersion=<n>` in the URL instead ([ADR-0062](adr/0062-protocol-version-query.md), [Handshake](protocol.md#handshake)).
  - Valid session → `RoomManager.findSeat` finds the open room and the seat holding the secret; the socket is bound to it (`socket.data.binding`) before it connects, joins the room's Socket.io room and receives a `STATE` snapshot immediately ([ADR-0063](adr/0063-session-rebinding.md)). A seat that was away is connected again: its forfeit clock stops, and the opponent gets `STATE` too ([Seat presence](#seat-presence)).
  - Malformed (`parseSessionCredentials` fails), unknown or expired session (the room is gone, or no seat holds the secret) → `SESSION_INVALID`; the client drops the stored credentials, connects again without them and explains the refusal on the room page: a server restart, a closed room or a seat given up ([ADR-0070](adr/0070-client-handshake-refusals.md), [ADR-0076](adr/0076-refused-seat-explanation.md)).
- **Latest connection wins:** binding a new socket to a seat emits `SESSION_REPLACED` to every other socket bound to that seat and disconnects it from the namespace, so the client reads the event, then `io server disconnect`, and does not reconnect on its own ([ADR-0014](adr/0014-duplicate-sessions.md), [ADR-0063](adr/0063-session-rebinding.md)). The new socket joins the room first, so the seat never counts as away, and the opponent gets nothing ([ADR-0072](adr/0072-seat-presence.md)).
- **Drop detection:** a seat is away from the tick its last socket's `disconnect` arrives, with no grace period ([Seat presence](#seat-presence)). A socket that vanishes without closing (a silent network loss) is caught by the Engine.IO heartbeat: `socket-io.ts` sets neither `pingInterval` nor `pingTimeout`, so the defaults apply (25 s and 20 s, announced in the handshake), and such a drop is noticed 20–45 s after it happened. In production a closed connection also reaches the server late: 10 s after a WebSocket close frame, 20 s after a TCP FIN, through Render's proxy ([Deployment: Hosting facts](deployment.md#hosting-facts-render-free)). Tuning either waits for the device playtest (#38).
- **Mobile:** app switching kills sockets frequently. Reconnection is a primary flow and must be covered by integration tests.

## Hardening

Decision: [ADR-0066](adr/0066-rate-limit-and-message-size.md).

- Every inbound payload passes its `core/validation.ts` guard (`PAYLOAD_PARSERS`) before reaching room logic; failures → `INVALID_PAYLOAD` ([Payload validation](protocol.md#payload-validation)). Room logic receives the guard's copy, never the raw payload.
- **Message size:** Socket.io `maxHttpBufferSize` is `MAX_MESSAGE_BYTES` (16 KiB, `socket-io.ts`), about forty times the largest valid command. A larger message closes the connection before anything parses it; the client sees `transport close` or `transport error`. Long polling shares the cap: the client splits its batches to the `maxPayload` the handshake announces.
- **Rate limit:** each socket may send `RATE_LIMIT_EVENTS_PER_SECOND` (20) events in any one-second window (a sliding window on the server's `Clock`). Every inbound event counts, `ECHO` and malformed commands included. A further event is dropped before any guard or handler and its ack, if it has one, gets `{ ok: false, error: 'RATE_LIMITED' }`; refused events do not count, and the socket stays connected. The refusal is sent on `process.nextTick`, the queue Socket.io dispatches admitted events on, so a socket's acks keep the order of its events ([ADR-0066](adr/0066-rate-limit-and-message-size.md)). The first refusal of a run is logged ("Socket rate limited"); the rest of the run is not.
- **Room cap:** `MAX_ROOMS` open rooms → `SERVER_FULL`. Forfeits, `LEAVE_ROOM` and the game-over TTL free places ([Room lifecycle](#room-lifecycle)), but nothing frees a waiting room while its creator stays connected, and the rate limit is per socket: one client with `MAX_ROOMS` open sockets can hold every place (#113).

## Logging

Logs go through Fastify's Pino logger. `LOG_LEVEL` picks how much is written, `LOG_FORMAT` how it is written ([Backend (Render)](deployment.md#backend-render)).

| Level                    | Logged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `info` (default, Render) | HTTP requests except `/health`; socket connections (transport, origin, client address) and disconnections (reason); handshakes refused by the origin policy or by the handshake check (error code); sessions resumed and replaced (room, seat, replaced socket); seats disconnected, reconnected, forfeited and left (room, seat); rooms created, joined, closed and expired (reason), room phase changes and refused commands; the first refused event of each rate-limited run; startup and shutdown |
| `debug` (local `.env`)   | Also `/health` requests, every socket event received or sent with its payload (broadcasts included, ack callbacks left out), transport upgrades, and each connection's raw `X-Forwarded-For` chain and peer address                                                                                                                                                                                                                                                                                    |

- Every socket line carries the `socketId`, so one client's history can be followed.
- **Client address** ([ADR-0067](adr/0067-client-address.md)): the `address` of "Socket connected" and the `req.remoteAddress` of Fastify's request lines are read from `X-Forwarded-For`, `TRUST_PROXY_HOPS` entries from the right (Fastify `trustProxy` for HTTP, `clientAddress` for Socket.io, the same rule). With the default `0` the header is ignored and the TCP peer is logged, which behind Render's proxy is the proxy. With hops set, the logs hold each client's public IP address, which is personal data. On Render the count is `1`, which fits WebSocket handshakes, the transport browsers use; plain HTTP crosses more proxies there, so Fastify's request lines and polling handshakes log Render's internal address (`10.30.x`) instead ([ADR-0081](adr/0081-one-proxy-hop-on-render.md)). See [Deployment: Render](deployment.md#render-service-battleship-server) for calibrating the count.
- Room lines carry the `roomId` and, for creation and joining, the `seat`. A refused command logs its event and error code and, for `INVALID_PLACEMENT` and `INVALID_TARGETS`, the core violation, which is never sent ([ADR-0032](adr/0032-fleet-placement.md)).
- Ack replies are not logged: Socket.io has no hook for them, so the handlers log refusals and room changes themselves.
- Payloads stay at `debug` because they carry player data. No log line carries a `playerSecret`: secrets travel only in acks, which are not logged, and in the handshake `auth`, which is never logged. A debug-level test reads the whole log of a session rebinding for the secret, instead of a Pino `redact` list of paths ([ADR-0063](adr/0063-session-rebinding.md)).
- Socket.io's own internals (handshakes, polling, heartbeats) are not routed through Pino: run with `DEBUG=engine,socket.io*` to see them.

## Testability

- Room logic is a pure transition function `(state, command, now) → { state, effects }`. Time comes from `createServer`'s `clock` option ([ADR-0065](adr/0065-clock-and-room-timers.md)): `now()`, read once per command ([Socket handlers](#socket-handlers)), and `scheduleAt(at, task)` for timers at absolute deadlines. Production uses `systemClock`; tests use `FakeClock` (`test/fake-clock.ts`), which moves only on `advance(ms)` and runs the tasks that fall due, so a TTL or a deadline is tested without waiting. Room timers (`RoomTimers`) hold one timer per room and kind: the disconnect forfeit and the game-over TTL; the placement timer (#28) and the turn timer (#30) join them as new kinds.
- The rate limit reads the same clock: a test that sends more than `RATE_LIMIT_EVENTS_PER_SECOND` events from one socket advances it between them, as the full match does one second per turn.
- The `Rng` is injected (dice, auto shots, auto placement); production uses `createCryptoRng()`, tests `createSeededRng(seed)` ([Randomness](domain.md#randomness)).
- Unit tests drive rooms with a fake clock and a fixed seed. Integration tests use real `socket.io-client` instances against an in-process server on an ephemeral port, set up by `test/socket-harness.ts` (one server per test with a seeded registry and a `FakeClock`, the clients, `send`, the seeded fleets and a match played to victory): `test/game.test.ts` plays a whole match (create → join → place → play to victory) with seeded fleets, a seeded registry and a `FakeClock`, reading every event each client receives in order; it also covers the handshake (refusals, a reconnecting socket rebound to its seat, a zombie socket replaced by a newer one without its seat dropping, a rebind at game over) and the disconnection rules: seat presence, the creator away while a friend joins, `SET_PAUSED`, the disconnect forfeit in and before a match, and `LEAVE_ROOM`. Their pure rules are unit-tested in `test/room/presence.test.ts`. `test/hardening.test.ts` covers room closing and the game-over TTL, the rate limit and the message size over real sockets, and `test/postman.test.ts` replays the saved Postman messages ([Local tooling](development.md#local-tooling)).
