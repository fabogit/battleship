---
status: accepted
date: 2026-10-31
---

# ADR-0094: The dice roll on reconnect

`DICE_ROLLED` is sent once, live, to the sockets in the room when the match starts ([ADR-0092](0092-dice-roll-at-match-start.md)). A player who comes back during the dice animation or after it (a reload, a dropped socket rebound to its seat, or a player who was away when a paused match started) gets the `STATE` snapshot only, as on every rebind ([ADR-0063](0063-session-rebinding.md)): `IN_PROGRESS`, `currentTurn` set to the starter, and `turnRemainingMs` `null` until the first turn's timer starts ([ADR-0093](0093-dice-animation.md)). The roll itself is neither sent again nor kept in the snapshot, and the room does not store it. The protocol does not change.

What the timers UI (#31) can rely on:

- **`DICE_ROLLED` comes right before the `STATE` that starts the match,** and only then: at most once per match on a socket. An animation started on its arrival is in step with the server's `firstTurnStartsAt` within the network delay.
- **The snapshot alone is enough to resume:** a `STATE` in `IN_PROGRESS` names the starter while nobody has fired, and `turnRemainingMs` is `null` exactly while no turn timer runs, the animation included. A client that came back without the roll shows who starts, without dice.
- **Timer values are worked out when a snapshot is sent,** as `remainingMs` and `startCountdownMs` are ([ADR-0090](0090-placement-timer.md)), so a player who reconnects gets the time left at that moment; with #30, a `STATE` also marks the start of the first turn's timer. Timers stay in sync after a reconnect without the client keeping any time of its own beyond the countdown from its last snapshot.

## Considered options

- **The roll in the snapshot** (the rounds and the animation time left, in `BattleSnapshot`): a client back within the 3 seconds could finish the animation, but a new field changes the protocol, version 4 on [ADR-0017](0017-protocol-versioning.md)'s and [ADR-0064](0064-game-over-snapshot-boards.md)'s terms, for a few seconds of presentation whose outcome `currentTurn` already carries. #31 can still add it if its design needs the dice after a reload.
- **Sending `DICE_ROLLED` again to a socket that binds during the animation:** it would play a whole animation late, ending after the first turn's timer has started, which is the drift #31 must avoid, and the room would have to keep the roll for it.

## Links

- Added on 2026-10-31 for the dice roll ([#29](https://github.com/fabogit/battleship/issues/29)).
- Spec: [Protocol: Server → client](../protocol.md#server--client) · [Protocol: Snapshot](../protocol.md#snapshot) · [Server: Sessions & reconnection](../server.md#sessions--reconnection)
- Related: [ADR-0092](0092-dice-roll-at-match-start.md) (dice roll) · [ADR-0093](0093-dice-animation.md) (dice animation) · [ADR-0063](0063-session-rebinding.md) (rebinding) · [ADR-0017](0017-protocol-versioning.md) (protocol versioning)
- Issues: [#29](https://github.com/fabogit/battleship/issues/29) · [#31](https://github.com/fabogit/battleship/issues/31) (timers UI) · [#30](https://github.com/fabogit/battleship/issues/30) (turn timer)
