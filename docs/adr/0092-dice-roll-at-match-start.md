---
status: accepted
date: 2026-10-31
---

# ADR-0092: Dice roll at the start of every match

The dice roll of [ADR-0002](0002-who-starts.md) happens in `startBattle`, the one hand-off from placement to battle ([ADR-0090](0090-placement-timer.md)), so every match rolls: one started by the start countdown, by the deadline, or paused because a player is away, and the rematch (#36), which goes back to `PLACEMENT` and ends it the same way. Core's `rollDice(rng)` rolls a d6 per seat, `P1`'s die first, and rolls both again while they show the same face; the higher face of the last round fires first. The `Rng` is the server's injected one ([ADR-0030](0030-random-number-generation.md)), the source of room ids and of the fleets completed at the deadline ([ADR-0091](0091-fleet-completion-at-the-deadline.md)): `endPlacement` completes the fleets first, then rolls, so one seed fixes both. `endPlacement` returns the roll with the room, and `room-handlers` sends `DICE_ROLLED { rolls, starter }`, every round in order with the ties first, to the room's sockets, then `STATE` to each seated socket, which shows `IN_PROGRESS` with `currentTurn` set to `starter`. The server logs "Dice rolled" with the rounds and the starter.

## Considered options

- **The roll as a room effect, beside `SHOT_RESOLVED`:** effects are what the caller does after an accepted command, and no command starts a match: the `PLACEMENT` timer does. `EndedPlacement` already carries what the timer's caller needs (`completedSeats`), and the roll joins it.
- **A separate `Rng` for the dice:** the reasons [ADR-0091](0091-fleet-completion-at-the-deadline.md) gave for the fleets hold here too. A test works the roll out from the registry's seed, as the socket harness and the Postman replay do.
- **Rolling once and breaking a tie in favour of a seat:** [ADR-0002](0002-who-starts.md) re-rolls ties, and `rolls` lists them so the client can animate each one.
- **Rolling when both fleets are confirmed, before the countdown:** an unlock would leave a roll for a match that has not started, and the deadline path would need a roll of its own.

## Consequences

- The protocol does not change: `DICE_ROLLED` and its payload have been in protocol version 3 since M1, and `currentTurn` could already be either seat. A client that ignores the event (the current one, until #31) still sees who starts from `STATE`.
- Either player may fire first now, in production and in the browser journeys, whose server rolls with crypto randomness; the journeys already find the shooter from the turn heading ([Development: End-to-end journeys](../development.md#end-to-end-journeys)). The server tests roll with the seeded registry: `ROOM_SEED` makes `P1` start a server's first match, which is what `playToVictory` assumes by default, and the Postman replay expects `DICE_ROLLED` with that roll on both seats ([ADR-0068](0068-postman-replay-test.md)).
- `DICE_ROLLED` goes to the sockets in the room when the match starts: a player who is away gets none, and learns who starts from the snapshot when they come back ([ADR-0094](0094-dice-roll-on-reconnect.md)).

## Links

- Added on 2026-10-31 for the dice roll ([#29](https://github.com/fabogit/battleship/issues/29)).
- Spec: [Server: Placement](../server.md#placement) · [Domain: Shot engine](../domain.md#shot-engine) · [Protocol: Server → client](../protocol.md#server--client)
- Implements: [ADR-0002](0002-who-starts.md) (who starts)
- Amends: [ADR-0090](0090-placement-timer.md) (`startBattle` rolls instead of giving `P1` the first turn) · [ADR-0037](0037-room-transition-shape.md) (`DICE_ROLLED` is not an effect)
- Related: [ADR-0093](0093-dice-animation.md) (the dice animation) · [ADR-0094](0094-dice-roll-on-reconnect.md) (reconnect) · [ADR-0091](0091-fleet-completion-at-the-deadline.md) (one `Rng`) · [ADR-0047](0047-reply-order.md) (event before `STATE`)
- Issues: [#29](https://github.com/fabogit/battleship/issues/29) · [#36](https://github.com/fabogit/battleship/issues/36) (rematch) · [#31](https://github.com/fabogit/battleship/issues/31) (dice UI)
