---
status: accepted
date: 2026-10-29
---

# ADR-0090: Placement timer

[ADR-0006](0006-placement-completion.md)'s deadline and start countdown are enforced by one `PLACEMENT` room timer ([ADR-0065](0065-clock-and-room-timers.md)). `PlacementRoom` stores both ends as timestamps: `deadline`, `PLACEMENT_TIME_LIMIT_MS` after phase entry, and `countdownEndsAt`, which the second `CONFIRM_PLACEMENT` sets to `min(now + START_COUNTDOWN_MS, deadline)`, `UNLOCK_PLACEMENT` clears, and the next double confirmation sets again from its own time. Placement ends at `countdownEndsAt ?? deadline`. `room-handlers` sets the timer to that time whenever it reviews the room's timers, now after every accepted command as well as every change of presence, and stops it once the room has left `PLACEMENT`. When it fires, `endPlacement` completes and locks every unconfirmed fleet ([ADR-0091](0091-fleet-completion-at-the-deadline.md)) and starts the match through `startBattle`, the one hand-off from placement to battle: `P1` fires first until the dice roll (#29) replaces it there.

The rest is decided here:

- **The countdown and the deadline cannot race.** The countdown is capped by the deadline, and only the earlier of the two is ever scheduled. When they coincide, both fleets are confirmed, so nothing is completed.
- **The deadline starts the match at once,** with no countdown after it.
- **A command the server handles before the timer runs counts,** even when it reads a time at or past the deadline. A confirmation that lands then locks the player's own fleet, with a countdown of zero; a draft update changes what is completed. After the timer has run, placement commands are `WRONG_PHASE`. The order in which the server handles events decides, and room logic compares no clock against the deadline.
- **A freed seat stops the timer** with the phase. The player left behind goes back to `WAITING_FOR_OPPONENT` ([ADR-0073](0073-room-lifecycle-with-forfeits.md)), with no countdown and no deadline left, and the next `JOIN_ROOM` leads to a new placement with a new deadline. A room that closes stops every timer it has.
- **Nobody is waited for.** A player who is away has their fleet completed, the match starts paused ([ADR-0074](0074-pause.md)), and their forfeit clock keeps running from the drop.
- **Snapshots compute both times when they are sent:** `remainingMs` from `deadline`, `startCountdownMs` from `countdownEndsAt`. A reconnecting player gets the time left at that moment.

Details in [Server: Placement](../server.md#placement) (#28).

## Considered options

- **Two timers, one for the countdown and one for the deadline:** two kinds that must agree, and a tie to break when the countdown is capped at the deadline. One end time leaves nothing to race.
- **Timers as effects returned by `applyCommand`** (the direction [ADR-0037](0037-room-transition-shape.md) expected): an unlock and a freed seat would each need a cancelling effect. Reviewing the timers from the stored room already covers presence and freed seats, and it covers placement the same way.
- **Refusing placement commands at or past the deadline, before the timer runs:** room logic would second-guess the timer to replace a player's own choice with a random one. The timer runs within one turn of the event loop after the deadline, so the window is a few milliseconds.
- **Ending placement on the next command that arrives late:** room logic would need the `Rng` for every command, and a timer would still be needed for rooms where nobody sends anything.
- **A countdown after auto-completion:** the countdown is there so that a player can still unlock after an early agreement. At the deadline there is nothing left to unlock.
- **Pausing placement while a player is away:** a room with an absent player would wait for the forfeit instead of the deadline. The spec keeps placement timers running ([Server: Disconnection in other phases](../server.md#disconnection-in-other-phases)).

## Consequences

- `PLACEMENT_TIME_LIMIT_MS` (60 s) is shorter than `DISCONNECT_FORFEIT_MS` (180 s), so a player who drops during placement always sees the match start before they could be forfeited. A seat is forfeited in `PLACEMENT` only when its player was already away when placement began, having confirmed the rules and then dropped.
- When both players are away, placement still ends at the deadline. The match starts paused, the first to have dropped forfeits it, and the room expires `GAME_OVER_TTL_MS` later: within `DISCONNECT_FORFEIT_MS + GAME_OVER_TTL_MS` of the first drop, the bound [ADR-0073](0073-room-lifecycle-with-forfeits.md) keeps.
- A client sees the match start from `STATE` alone, as before. The protocol does not change: `startCountdownMs` and `remainingMs` already had these meanings.
- Integration tests run the countdown on the `FakeClock`: the socket harness advances `START_COUNTDOWN_MS` after both fleets are confirmed, and the Postman replay waits as long ([ADR-0068](0068-postman-replay-test.md)).

## Links

- Added on 2026-10-29 for the placement timer ([#28](https://github.com/fabogit/battleship/issues/28)).
- Spec: [Server: Placement](../server.md#placement) · [Server: Room lifecycle](../server.md#room-lifecycle) · [Protocol: Snapshot](../protocol.md#snapshot)
- Implements: [ADR-0006](0006-placement-completion.md) (placement completion)
- Amends: [ADR-0065](0065-clock-and-room-timers.md) (a `PLACEMENT` kind, reviewed after every accepted command) · [ADR-0037](0037-room-transition-shape.md) (timers are not effects)
- Related: [ADR-0091](0091-fleet-completion-at-the-deadline.md) (fleet completion) · [ADR-0072](0072-seat-presence.md) (seat presence) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (freed seats) · [ADR-0074](0074-pause.md) (pause)
- Issues: [#28](https://github.com/fabogit/battleship/issues/28) · [#29](https://github.com/fabogit/battleship/issues/29) (dice roll) · [#31](https://github.com/fabogit/battleship/issues/31) (timers UI)
