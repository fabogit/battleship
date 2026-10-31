---
status: accepted
date: 2026-10-13
---

# ADR-0065: Clock and room timers

Time reaches the server through one injected `Clock` (`packages/server/src/clock.ts`): `now()` in epoch ms and `scheduleAt(at, task)`, a one-shot timer at an absolute deadline that returns a `Timer` to `cancel()`. `createServer` takes it as the `clock` option, in place of the bare `now`, and hands it to every plugin that reads time; production uses `systemClock` (`Date.now` and an unreferenced `setTimeout`), tests a `FakeClock` (`packages/server/test/fake-clock.ts`) that moves only on `advance(ms)` and runs the tasks that fall due, in deadline order, with `now()` set to each deadline. Timers that belong to a room live in `RoomTimers` (`room/room-timers.ts`): at most one per room and `ROOM_TIMER_KINDS` value, a new one replacing the old, all stopped with the room or when the server closes. Room logic stays pure: it keeps storing deadlines as timestamps, and the socket layer schedules and cancels the timers ([Server: Testability](../server.md#testability), #24).

The first users are the room TTLs. After every change to a room's sockets or phase, a session resumed at the handshake included ([ADR-0063](0063-session-rebinding.md)), `room-handlers` reviews its timers: a room no socket sits in gets an `EMPTY_ROOM` timer, counted from the moment the last socket left and stopped when one sits in it again; a room in `GAME_OVER` gets a `GAME_OVER` timer, counted from the end of the match and stopped when the room leaves `GAME_OVER` (a rematch, #36). Either one removes the room from `RoomManager`, stops its other timers and unbinds the sockets still in it ([Server: Room lifecycle](../server.md#room-lifecycle)).

## Considered options

- **A periodic sweep** (`setInterval` every few seconds, removing rooms whose timestamps have passed): one timer for the whole server and no cancellation, but expiry would be late by up to the sweep period, and the disconnect forfeit (#23) and the turn timer (#30) need to act at their deadline, not on the next sweep. Two mechanisms for one problem, and a test would still need to drive the interval.
- **Vitest fake timers (`vi.useFakeTimers`) over the real `setTimeout`:** no seam to add, but they also fake the timers inside Socket.io and Engine.IO (heartbeats, ack timeouts), so an integration test with real sockets would hang or need hand-tuned `toFake` lists. An injected clock fakes only the game's time.
- **Relative delays (`schedule(delayMs, task)`):** the usual timer shape, but room logic stores deadlines (`PlacementRoom.deadline`) and #30's paused turn timer resumes at a recomputed deadline; an absolute `at` lets the caller pass the stored value as it is.
- **Timers inside `RoomManager`:** the registry knows phases, but not sockets, and the forfeit and turn timers of #23 and #30 must send `STATE` when they fire. The socket layer already holds both, so the registry stays a passive map with a `remove`.
- **Timers as effects returned by `applyCommand`** (the direction [Server: Testability](../server.md#testability) sketched): fits deadlines set by commands, but emptiness comes from sockets disconnecting, which room logic never sees. The review is a function of the stored state and the socket rooms, so it stays correct whatever caused the change; #28 and #30 can still return deadline effects that the same `RoomTimers` schedules.

## Consequences

- #23 reuses the seam as it is: a forfeit timer per seat and the turn timer become new `ROOM_TIMER_KINDS`, started and stopped by the socket layer, and tested by advancing a `FakeClock`. Pausing the turn timer is `stop`, resuming is `start` at the new deadline.
- An integration test that sends many events must advance its `FakeClock` between them: the rate limit reads the same clock ([ADR-0066](0066-rate-limit-and-message-size.md)), so a clock that never moves puts every event in the same second. The full match in `test/game.test.ts` advances one second per turn.
- `systemClock` timers are unreferenced and `room-handlers` stops every timer on `onClose`, so a pending TTL neither delays the process exit after a graceful shutdown ([ADR-0027](0027-shutdown-signals.md)) nor fires into a closed server.
- A socket whose room expired keeps its connection but loses its seat: a seated command is refused with `NOT_ALLOWED`, and a room that later draws the same id never reaches it. The protocol has no event for an expired room; a reconnecting client learns it from `SESSION_INVALID` ([ADR-0061](0061-handshake-checks.md)).
- Rooms are now removed, so `MAX_ROOMS` caps the rooms open at once, not over the server's lifetime ([ADR-0039](0039-room-registry.md)).

## Links

- Added on 2026-10-13 for server hardening ([#24](https://github.com/fabogit/battleship/issues/24)).
- Amended on 2026-10-15 ([#23](https://github.com/fabogit/battleship/issues/23)): the disconnect forfeit is the `DISCONNECT_FORFEIT` room timer ([ADR-0072](0072-seat-presence.md)), and the `EMPTY_ROOM` timer is gone, since the forfeits always close a room nobody sits in first ([ADR-0073](0073-room-lifecycle-with-forfeits.md)).
- Amended on 2026-10-29 ([#28](https://github.com/fabogit/battleship/issues/28)): the end of placement is the `PLACEMENT` room timer, set from the stored deadlines rather than returned as an effect, and the timers are reviewed after every accepted command ([ADR-0090](0090-placement-timer.md)).
- Amended on 2026-10-31 ([#113](https://github.com/fabogit/battleship/issues/113)): a room nobody joins expires on the `WAITING_FOR_OPPONENT` room timer, reviewed after `CREATE_ROOM` and `JOIN_ROOM` too ([ADR-0096](0096-waiting-ttl.md)), and a socket still in an expired room gets `ROOM_CLOSED` ([ADR-0097](0097-room-closed-notice.md)).
- Spec: [Server: Room lifecycle](../server.md#room-lifecycle) · [Server: Testability](../server.md#testability) · [Domain: Constants](../domain.md#constants)
- Amends: [ADR-0039](0039-room-registry.md) (rooms are removed)
- Related: [ADR-0037](0037-room-transition-shape.md) (room logic without timers), [ADR-0027](0027-shutdown-signals.md) (shutdown)
- Issues: [#24](https://github.com/fabogit/battleship/issues/24), [#23](https://github.com/fabogit/battleship/issues/23) (disconnect forfeit, paused turn timer), [#28](https://github.com/fabogit/battleship/issues/28), [#30](https://github.com/fabogit/battleship/issues/30)
