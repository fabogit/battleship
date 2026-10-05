# 6. Server Behaviour (`packages/server`)

## 6.1 Room State Machine

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

## 6.2 Transition Rules

### Room creation & joining

* `CREATE_ROOM` creates the room in `WAITING_FOR_OPPONENT` with `DEFAULT_RULES` and seats the creator as `P1`.
* `JOIN_ROOM` seats the joiner as `P2` and moves to `RULES_NEGOTIATION`.
  * Joining a full room → `ROOM_FULL`; unknown room (or lost after a restart) → `ROOM_NOT_FOUND`.
* A seated player who disconnected keeps the seat for `DISCONNECT_FORFEIT_MS`. This covers the common mobile case: the creator switches app to share the link and the friend joins meanwhile.

### Rules negotiation

* Either player may send `UPDATE_RULES`. The server validates, stores, increments `rulesVersion`, and clears both confirmations.
* `CONFIRM_RULES { rulesVersion }` with a stale version → `STALE_RULES`.
* When both have confirmed the current version → `PLACEMENT`.
* There is no negotiation timer (good faith). Idle rooms are bounded by the TTLs.

### Placement

* The deadline is `PLACEMENT_TIME_LIMIT_MS` from phase entry.
* `UPDATE_PLACEMENT { ships }` replaces the player's draft. It is rejected while confirmed (`PLACEMENT_LOCKED`) or invalid (`INVALID_PLACEMENT`).
* `CONFIRM_PLACEMENT` requires a complete valid fleet; `UNLOCK_PLACEMENT` reverts to draft.
* When both are confirmed, a start countdown runs for `min(START_COUNTDOWN_MS, time to deadline)`. An unlock cancels it; a new double confirmation restarts it, still capped by the deadline.
* At the deadline, every unconfirmed fleet is completed with `completeFleet` and locked.
* On phase end: server dice roll → `DICE_ROLLED` → `IN_PROGRESS`. The first turn timer starts after `DICE_ANIMATION_MS`.
* If a player is disconnected at that moment, the match starts paused (see below).

### Turns

* The active player edits a draft with `UPDATE_TARGETS { targets }` (any count up to the allowance, freely changeable) and commits with `FIRE { targets }`.
* On turn timeout:
  * `AUTO_RANDOM_SHOT`: keep the valid draft targets, fill the rest randomly, resolve.
  * `PASS_TURN`: discard the draft, pass the turn.
* Every timeout increments that player's AFK counter; any `FIRE` resets it.

### AFK

* When a player's counter reaches `MAX_CONSECUTIVE_AFK_TURNS`:
  * If the opponent's counter is ≥ `MAX_CONSECUTIVE_AFK_TURNS − 1` (both idle) → `GAME_OVER`, reason `ABANDONED`, no winner.
  * Otherwise → `GAME_OVER`, reason `AFK_FORFEIT`, the opponent wins.

### Disconnection & pause (`IN_PROGRESS`)

* When a player's socket drops, the match auto-pauses. A paused match freezes the turn timer with its remaining time.
* `SET_PAUSED { paused }` is accepted **only from the connected player while the opponent is disconnected**.
* While unpaused, timers run normally: the absent player's turns time out and count as AFK.
* The forfeit clock (`DISCONNECT_FORFEIT_MS`, from the moment of disconnection) runs regardless of pause. On expiry → `GAME_OVER`, reason `DISCONNECT_FORFEIT`.
* On reconnection the match resumes automatically with the remaining turn time.

### Disconnection in other phases

* The seat is kept for `DISCONNECT_FORFEIT_MS`.
* Placement timers keep running; auto-completion handles the absent player.
* On seat expiry, the player is removed and the other player returns to `WAITING_FOR_OPPONENT`. Rules are kept; confirmations and fleets are cleared.

### Leaving

* `LEAVE_ROOM` in a pre-game phase frees the seat immediately (same effect as seat expiry).
* In `IN_PROGRESS`, `SURRENDER` and `LEAVE_ROOM` both end the match as `SURRENDER`.

### Game over & rematch

* The snapshot reveals the opponent's fleet.
* Each player sends `REMATCH_CHOICE`; a player may change their choice until resolution.
  * Both `SAME_RULES` → `PLACEMENT`.
  * Both chosen and at least one `CHANGE_RULES` → `RULES_NEGOTIATION`, with the previous rules pre-filled and confirmations cleared.
  * Any `LEAVE` → the leaver is removed; the other player goes to `WAITING_FOR_OPPONENT` (same room link).

### Room lifecycle

* A room with no connected player is destroyed after `EMPTY_ROOM_TTL_MS`.
* A room in `GAME_OVER` is destroyed after `GAME_OVER_TTL_MS` without a resolved rematch.

## 6.3 Sessions & Reconnection

* **Credentials:** on `CREATE_ROOM` / `JOIN_ROOM` the server returns a `playerSecret` (`crypto.randomUUID()`). Seats (`P1`/`P2`) are public; secrets are never sent to the other player.
* **Room ids:** 8 characters of a URL-safe, unambiguous alphabet, generated with `crypto`.
* **Client storage:** `SessionStore` writes `{ roomId, playerSecret, expiresAt }` under a per-room key in `localStorage`.
* **Handshake:** the Socket.io client passes `auth` as a callback, re-evaluated on every reconnect attempt: `{ protocolVersion, session?: { roomId, playerSecret } }`.
  * Version mismatch → `connect_error` with `PROTOCOL_MISMATCH`; the client shows "please reload".
  * Valid session → the socket is bound to the seat and receives a `STATE` snapshot immediately.
  * Invalid or expired session → `SESSION_INVALID`; the client drops the stored credentials and returns to the home screen with an explanation.
* **Latest connection wins:** binding a new socket to a seat emits `SESSION_REPLACED` to the previous socket and disconnects it.
* **Mobile:** app switching kills sockets frequently. Reconnection is a primary flow and must be covered by integration tests.

## 6.4 Hardening

* Every inbound payload passes the `core/validation.ts` guards before reaching room logic; failures → `INVALID_PAYLOAD`.
* Socket.io `maxHttpBufferSize` is set to a small value (e.g. 16 KB).
* Per-socket rate limit (`RATE_LIMIT_EVENTS_PER_SECOND`) → `RATE_LIMITED`.
* `MAX_ROOMS` cap → `SERVER_FULL`.

## 6.5 Testability

* Room logic is a pure transition function `(state, command, now) → { state, effects }`; timers are scheduled effects executed by a thin `scheduler.ts` over an injectable `Clock`.
* The `Rng` is injected (dice, auto shots, auto placement).
* Unit tests drive rooms with a fake clock and a fixed seed. Integration tests use real `socket.io-client` instances against an in-process server.
