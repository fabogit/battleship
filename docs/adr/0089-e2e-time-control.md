---
status: accepted
date: 2026-10-29
---

# ADR-0089: Time control in the end-to-end suite

The browser journeys of `packages/e2e` run against the production `createServer` on a **skip clock** (`packages/e2e/src/skip-clock.ts`): real time plus an offset that a journey moves forward. `advance(ms)` adds to the offset and runs every timer the skip passes, in deadline order, with `now()` set to each timer's deadline while it runs, as the server tests' `FakeClock` does ([ADR-0065](0065-clock-and-room-timers.md)); between skips its timers fire in real time, like `systemClock`'s. It implements the server's `Clock`, so nothing in the server changes.

Journeys reach it through `POST /e2e/clock/advance` (`{ ms }`, 1 ms to one day), a route that only the e2e entry point (`packages/e2e/src/server.ts`) registers on the instance `createServer` returns. That server listens on `127.0.0.1` only. The production entry point (`packages/server/src/index.ts`) never imports the e2e package, so the route and the clock are absent from `packages/server/dist` and from the client bundle. The `skipServerClock(ms)` fixture calls the route; a journey skips only after it has seen the state it skips from (the opponent shown as disconnected, say), so the timer exists when the skip runs.

The client needs no control of its own. Its countdowns come from the snapshot's remaining-ms fields (`forfeitRemainingMs`, `placement.remainingMs`, `startCountdownMs`, `turnRemainingMs`), so they stay true however far the server skipped, and it reads `DISCONNECT_FORFEIT_MS` and `GAME_OVER_TTL_MS` from core only to word them ("kept for 3 minutes"). Playwright's `page.clock` is kept for the journey that checks a countdown the page runs by itself; none of the first five does, so none installs it.

Details in [Development: End-to-end journeys](../development.md#end-to-end-journeys).

## Considered options

- **A frozen `FakeClock`, advanced by the journeys:** it cannot run a match. The rate limit reads `clock.now()` ([ADR-0066](0066-rate-limit-and-message-size.md)), and with a clock that never moves every event of a socket falls in the same second: after 20 events (a placement and a few shots) the socket is refused for good. Advancing it before every step would put clock calls between clicks that have nothing to do with time.
- **Shorter timings from an environment variable** (`DISCONNECT_FORFEIT_MS=20000`, as the hub's ad-hoc presence script did by editing core and rebuilding): it puts a test switch into production configuration, and the client would still word the real values, saying "kept for 3 minutes" next to a 20-second countdown. The journey would also wait those 20 seconds in real time.
- **`page.clock` everywhere:** it fakes the page's timers and `Date`, not the server's. The disconnect forfeit, and later the placement and turn timers (#28, #30), are decided by the server, so a faked page clock cannot make them fire. Fast-forwarding it also runs Socket.io's own timers in the page (heartbeat and reconnection), which would drop a connection the journey wants kept.
- **The skip clock in `packages/server`:** next to `systemClock` it would ship in `dist/` and invite a production switch. In the e2e package it is out of the server's build by construction.

## Consequences

- One worker runs the journeys in sequence: they share one server, and a skip moves the time of every room on it.
- Rooms the journeys leave behind close within `DISCONNECT_FORFEIT_MS + GAME_OVER_TTL_MS` (5 minutes) of real time, sooner when a skip passes their timers. A run opens 9 rooms, so `MAX_ROOMS` (50) allows `--repeat-each` up to 5 on one server.
- The timer journeys of #28, #30 and #31 skip the server clock the same way; a journey that checks a countdown the page runs between snapshots (a dice roll, a ticking turn timer) adds `page.clock` for that page only.

## Links

- Added on 2026-10-29 for the end-to-end suite ([#120](https://github.com/fabogit/battleship/issues/120)).
- Amended on 2026-11-01 ([#31](https://github.com/fabogit/battleship/issues/31)): `timers.spec.ts` checks the dice and the ticking countdowns without `page.clock`, which would also hold Angular's rendering and Socket.io's timers; the dice within their 3 seconds of real time, the countdowns with a few seconds of slack after a reload ([Development: End-to-end journeys](../development.md#end-to-end-journeys)).
- Spec: [Development: End-to-end journeys](../development.md#end-to-end-journeys) · [Server: Testability](../server.md#testability)
- Related: [ADR-0065](0065-clock-and-room-timers.md) (the `Clock` seam), [ADR-0066](0066-rate-limit-and-message-size.md) (rate limit), [ADR-0022](0022-workspace-type-resolution.md) (`@battleship/source`, now also on the server's `exports`)
- Issues: [#120](https://github.com/fabogit/battleship/issues/120), [#28](https://github.com/fabogit/battleship/issues/28), [#30](https://github.com/fabogit/battleship/issues/30)
