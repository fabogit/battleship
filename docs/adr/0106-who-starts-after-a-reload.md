---
status: accepted
date: 2026-11-01
---

# ADR-0106: Who starts, not the dice, after a reload

A client that comes back during the dice animation, after a reload or a dropped connection, shows **who starts** and no dice. The snapshot stays as it is: `BattleSnapshot` gets no roll, and the protocol does not change. The question was left open by [ADR-0094](0094-dice-roll-on-reconnect.md), which gives the client everything this needs: `DICE_ROLLED` comes only live, right before the `STATE` that starts the match, and a `STATE` in `IN_PROGRESS` with `turnRemainingMs` `null` and no shot on either board means that the server's animation is still running. During that window the battle view's heading names the turn ("Your turn" / "Grace's turn"), and the line under it says "The dice picked you to start." / "The dice picked Grace to start." in place of the turn's hint. The first turn's timer shows as soon as its `STATE` comes, as on a client that played the animation. A client that received the roll keeps it with its arrival time in `GameStateService.diceRoll` ([ADR-0107](0107-dice-animation-in-the-client.md)); a reload loses it, which is what this decision accepts.

## Considered options

- **The roll in `BattleSnapshot`** (the rounds and the animation time left): a client back within the 3 seconds could finish the animation where it was. It is a protocol change (version 7 on [ADR-0017](0017-protocol-versioning.md)'s terms, since #128 took 6) for a few seconds of presentation whose outcome `currentTurn` already carries, and the room would have to keep the roll for the whole match, or clear it at a time of its own.
- **Replaying a whole animation on return, from a stored roll:** the replay would end after the first turn's timer has started, the drift [ADR-0094](0094-dice-roll-on-reconnect.md) warns about, and it would hold the starter's aim for nothing.

## Consequences

- The end-to-end line of #31 "the dice roll ... stays in sync after a reload" means who starts: `timers.spec.ts` reloads both pages in the first turn and checks that the same player has it, with the server's time left ([Development: End-to-end journeys](../development.md#end-to-end-journeys)).
- Should the roll be wanted after a reload later (a match history, say), it is a field added to the snapshot with a protocol bump, with nothing in the client to undo: the view already draws whatever roll `GameStateService` holds.

## Links

- Added on 2026-11-01 for the timers and dice UI ([#31](https://github.com/fabogit/battleship/issues/31)).
- Spec: [Client: Board & interaction](../client.md#board--interaction) · [Protocol: Snapshot](../protocol.md#snapshot)
- Closes the question of: [ADR-0094](0094-dice-roll-on-reconnect.md) (the dice roll on reconnect)
- Related: [ADR-0107](0107-dice-animation-in-the-client.md) (dice animation) · [ADR-0093](0093-dice-animation.md) (the animation is the starter's turn) · [ADR-0017](0017-protocol-versioning.md) (protocol versioning)
- Issues: [#31](https://github.com/fabogit/battleship/issues/31) · [#29](https://github.com/fabogit/battleship/issues/29) (dice roll) · [#128](https://github.com/fabogit/battleship/issues/128) (bound rules negotiation)
