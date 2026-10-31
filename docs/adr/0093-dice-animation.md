---
status: accepted
date: 2026-10-31
---

# ADR-0093: The dice animation is the starter's turn

The match is `IN_PROGRESS` from the dice roll ([ADR-0092](0092-dice-roll-at-match-start.md)), with `currentTurn` set to the starter, while the clients show the roll for `DICE_ANIMATION_MS`. The server does not hold the turn back for it: the starter's `UPDATE_TARGETS` and `FIRE` are accepted at once, as [Client: Game state](../client.md#game-state) already counts the animation in `isMyTurn`. What the animation delays is the turn timer: `BattleRoom.firstTurnStartsAt` stores when the first turn's timer starts, `DICE_ANIMATION_MS` after the roll, and the snapshot's `turnRemainingMs` is `null` before then. The turn timer is #30, so until it lands `firstTurnStartsAt` is stored and read by nobody, and `turnRemainingMs` stays `null` after the animation too.

What #30 builds on it:

- **The first turn's timer starts at `firstTurnStartsAt`,** with the whole `turnTimeLimitSeconds`, and the server sends `STATE` then, so every client sees `turnRemainingMs` go from `null` to the full time without guessing when the animation ended.
- **A shot fired during the animation ends the first turn** like any other; the next turn's timer starts at that shot, and `firstTurnStartsAt` no longer matters.
- **A pause does not move `firstTurnStartsAt`:** the animation is the clients' to play and is never paused. A match paused when it is reached (one that started paused, [ADR-0074](0074-pause.md)) holds the first turn's timer frozen with its whole time, and the time runs from the resume.
- **The animation is no timeout:** nothing counts toward `MAX_CONSECUTIVE_AFK_TURNS` before the first turn's timer has run out.

## Considered options

- **Refusing turn commands until `firstTurnStartsAt`,** with `NOT_YOUR_TURN` or a new code: the starter would be refused in what their screen calls their turn, and a client that came back during the animation cannot know when it ends ([ADR-0094](0094-dice-roll-on-reconnect.md)). A shot fired early resolves the same as a shot fired later. A client may still keep its Fire button idle while its own animation plays; that is #31's choice, not a rule the server enforces.
- **Projecting `turnRemainingMs` now,** from `firstTurnStartsAt` and the agreed limit: a countdown that nothing enforces until #30 would mislead every client.
- **Counting the first turn from the roll, with `DICE_ANIMATION_MS` added to its limit:** the deadline would be the same, but `turnRemainingMs` would count down during the animation, where the protocol says `null`.
- **A timer at `firstTurnStartsAt` already in this change, sending `STATE`:** before #30 that `STATE` would equal the one before it. #30 adds it with the turn timer.

## Links

- Added on 2026-10-31 for the dice roll ([#29](https://github.com/fabogit/battleship/issues/29)).
- Spec: [Server: Placement](../server.md#placement) · [Server: Disconnection & pause](../server.md#disconnection--pause-in_progress) · [Protocol: Snapshot](../protocol.md#snapshot) · [Client: Game state](../client.md#game-state)
- Related: [ADR-0092](0092-dice-roll-at-match-start.md) (dice roll) · [ADR-0094](0094-dice-roll-on-reconnect.md) (reconnect) · [ADR-0074](0074-pause.md) (pause) · [ADR-0065](0065-clock-and-room-timers.md) (room timers)
- Issues: [#29](https://github.com/fabogit/battleship/issues/29) · [#30](https://github.com/fabogit/battleship/issues/30) (turn timer) · [#31](https://github.com/fabogit/battleship/issues/31) (timers UI)
