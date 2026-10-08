---
status: accepted
date: 2026-10-07
---

# ADR-0036: Countdown resync

The client derives every countdown from the remaining-time fields of the latest snapshot: the value sent minus the time elapsed since the snapshot arrived, measured with `performance.now()` and never below zero. The turn countdown holds still while `battle.isPaused`. Each snapshot replaces the starting point of every countdown, with no smoothing between the local count and the server's. Countdowns are `computed` signals in ms. One interval refreshes the clock signal they read every `COUNTDOWN_TICK_MS` (250 ms), only while a countdown is running, and stops when the longest one reaches zero. Details in [Client: Game state](../client.md#game-state) (#16).

## Considered options

- **Absolute deadlines from the server:** the protocol sends remaining ms precisely so that client clock skew does not matter ([Protocol: Snapshot](../protocol.md#snapshot)).
- **Compensating for latency** (subtracting half a measured round trip): it needs a round-trip measurement for an error of tens of ms, below the tick. Without it the client shows slightly more time than is left, and the server decides when a timer expires anyway.
- **Smoothing, or never letting a countdown go up:** a snapshot can legitimately add time (a new turn, an extra turn on hit, a new double confirmation), so a jump on resync is correct.
- **`Date.now()`:** the wall clock can jump (NTP sync, a manual change); `performance.now()` is monotonic.
- **Ticking at each whole-second boundary, or a timer per countdown:** fewer updates, but the service would then publish seconds and decide the display format. Four updates per second of a few signals cost nothing with OnPush components.
- **`requestAnimationFrame`:** 60 updates per second for a value shown in seconds. A component that animates a progress bar can run its own frame loop on the same signals.
- **Freezing the turn countdown while this client is disconnected** (the server pauses the match when a socket drops): the server notices the drop on its own schedule, so the client cannot know when the pause began. The reconnecting banner (#25) covers that time, and the first snapshot after the reconnection re-syncs.

## Consequences

- A displayed second is at most 250 ms late, plus the network latency of the snapshot.
- Browsers throttle intervals in background tabs. Each tick reads the clock again, so the value is right again at the first tick after the tab comes back.
- A countdown at zero does nothing by itself: the server applies the timeout and its next `STATE` shows the outcome.

## Links

- Added on 2026-10-07 for the client game services ([#16](https://github.com/fabogit/battleship/issues/16)).
- Spec: [Client: Game state](../client.md#game-state) · [Protocol: Snapshot](../protocol.md#snapshot)
- Related: [ADR-0008](0008-disconnection-in-battle.md) (pause freezes the turn timer, not the forfeit clock), [ADR-0015](0015-protocol-shape.md) (snapshots)
- Issues: [#16](https://github.com/fabogit/battleship/issues/16)
