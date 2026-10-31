---
status: accepted
date: 2026-10-31
---

# ADR-0099: Turn timer

Every turn runs on one `TURN` room timer ([ADR-0065](0065-clock-and-room-timers.md)) of `turnTimeLimitSeconds`. `BattleRoom` stores the timer as two values: `turnTimerStartsAt`, when the current turn's time starts to run, and `turnTimeLeftMs`, the time it has from then on. The time-out is `turnTimerStartsAt + turnTimeLeftMs` (`turnTimerEndsAt`) while the match runs. These two replace `firstTurnStartsAt` ([ADR-0093](0093-dice-animation.md)): the first turn starts with `turnTimerStartsAt` at the end of the dice animation, `DICE_ANIMATION_MS` after the roll, and every later turn starts at the moment the previous one ended (a `FIRE` or a timeout), with the whole limit.

The pause ([ADR-0074](0074-pause.md)) changes only these two values, through `pauseTurnTimer` and `resumeTurnTimer`, which every pause and resume goes through: a seat dropping, both seats back, and `SET_PAUSED`.

- **A pause** stores the time left, `turnTimerEndsAt − now`. Before `turnTimerStartsAt` (during the dice animation) that is the whole `turnTimeLeftMs`.
- **A resume** sets `turnTimerStartsAt` to `max(turnTimerStartsAt, now)`. The time left runs from the resume, or from the end of the animation when the resume comes before it, since a pause does not move it ([ADR-0093](0093-dice-animation.md)).
- **A shot fired while paused** starts the next turn with the whole limit, frozen until the resume.

`room-handlers` sets the `TURN` timer on every review of the room's timers (`nextTurnTimerAt`):

- At `turnTimerStartsAt` while it is ahead, **paused or not**. When it runs, every seated socket gets `STATE`, so `turnRemainingMs` goes from `null` to the whole turn time on every client at once, a frozen one included.
- At `turnTimerEndsAt` once the turn's time runs and the match is not paused. When it runs, the turn times out ([ADR-0100](0100-timeout-actions.md)).
- Nowhere while the match is paused after `turnTimerStartsAt`, and nowhere outside `IN_PROGRESS`.

The snapshot computes `turnRemainingMs` when it is sent: `null` before `turnTimerStartsAt`, `turnTimeLeftMs` while paused, `max(0, turnTimerEndsAt − now)` otherwise. A player who reconnects gets the time left at that moment, as with `remainingMs` in placement ([ADR-0090](0090-placement-timer.md)).

The rest is decided here:

- **A `FIRE` that races the timer:** whatever the server handles first counts, as at the placement deadline ([ADR-0090](0090-placement-timer.md)). A `FIRE` handled before the timer runs, even at or past `turnTimerEndsAt`, is a normal shot: it ends the turn, and the timer then finds the next turn not due. After the timer has run, the same `FIRE` is the next turn's: `NOT_YOUR_TURN` from the seat that timed out, `WRONG_PHASE` once the match is over. Room logic compares no clock against the deadline for commands.
- **The end of the dice animation always sends `STATE`,** even while paused. Without it, a paused client would keep `null` until the resume, while a client reconnecting in the same pause would get the frozen time.

## Considered options

- **Keeping `firstTurnStartsAt` and adding a deadline and a frozen remaining time:** three fields to keep consistent, and a flag to tell the first turn from the next ones, since a shot during the animation must start the next turn's timer before `firstTurnStartsAt`. Two values cover the animation, a running turn, a frozen turn and a turn started during a pause.
- **Storing `pausedAt` and shifting the deadline on resume:** the deadline arithmetic would depend on whether the pause began before the end of the animation, and `setPaused`, `disconnectSeat` and `reconnectSeat` would each need it.
- **Two timer kinds, one for the animation's end and one for the time-out:** they never run at once. One `TURN` kind set to whichever comes first needs no rule to keep them apart.
- **Refusing a `FIRE` at or past `turnTimerEndsAt`:** room logic would second-guess the timer to replace the player's own shot with a random one, over a window of a few milliseconds.

## Consequences

- A room in `IN_PROGRESS` with both players connected now has a timer, so it ends within `5 × turnTimeLimitSeconds` of the last shot when nobody plays ([ADR-0101](0101-afk-forfeit.md)), and no longer holds its place under `MAX_ROOMS` for as long as both sockets stay open.
- The protocol does not change: `turnRemainingMs` keeps the meaning [Protocol: Snapshot](../protocol.md#snapshot) gives it, now with values. The client already shows it as `m:ss`.
- A server test that lets time pass in battle now sees turns time out. The socket harness can start a match with other rules (`startedMatch(rules)`), so a test can pick 120-second turns to let a disconnect forfeit run first.

## Links

- Added on 2026-10-31 for the turn timer ([#30](https://github.com/fabogit/battleship/issues/30)).
- Spec: [Server: Turns](../server.md#turns) · [Server: Disconnection & pause](../server.md#disconnection--pause-in_progress) · [Protocol: Snapshot](../protocol.md#snapshot)
- Amends: [ADR-0093](0093-dice-animation.md) (`turnTimerStartsAt` replaces `firstTurnStartsAt`) · [ADR-0074](0074-pause.md) (the frozen time) · [ADR-0065](0065-clock-and-room-timers.md) (a `TURN` kind)
- Related: [ADR-0100](0100-timeout-actions.md) (timeout actions) · [ADR-0101](0101-afk-forfeit.md) (AFK) · [ADR-0090](0090-placement-timer.md) (placement timer) · [ADR-0094](0094-dice-roll-on-reconnect.md) (reconnect)
- Issues: [#30](https://github.com/fabogit/battleship/issues/30) · [#31](https://github.com/fabogit/battleship/issues/31) (timers UI)
