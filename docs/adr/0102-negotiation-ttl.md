---
status: accepted
date: 2026-11-01
---

# ADR-0102: Negotiation TTL

A room in `RULES_NEGOTIATION` closes `NEGOTIATION_TTL_MS` (10 minutes, a core constant) after it entered that phase, whether its players are connected or not. It is one `RULES_NEGOTIATION` room timer ([ADR-0065](0065-clock-and-room-timers.md)), handled like the waiting TTL ([ADR-0096](0096-waiting-ttl.md)): `room-handlers` starts it when it reviews a room in that phase without one, and stops it when the room is in any other phase. When it fires, the room is removed, logged as "Room expired" with the `reason` `RULES_NEGOTIATION`, and every socket still in it gets `ROOM_CLOSED` with the reason `NEGOTIATION_TTL` ([ADR-0103](0103-negotiation-ttl-on-the-wire.md)). Until now, two sockets, one per seat, could keep a room in negotiation for as long as both stayed open (#53, F5; [ADR-0096](0096-waiting-ttl.md) left it open).

The rest is decided here:

- **The count starts at the join** that opens the phase ([ADR-0082](0082-rules-negotiation-commands.md)), and at each later entry: a seat freed during negotiation sends the room back to `WAITING_FOR_OPPONENT` ([ADR-0083](0083-rules-kept-when-a-seat-is-freed.md)), which stops the timer, so the next join starts a new one. A rematch that changes the rules (#36) will enter the phase the same way.
- **Neither an edit nor a confirmation restarts it,** and neither does a reconnection. Only the second confirmation stops it, with the phase.
- **A seat away does not stop it either.** The seat's forfeit clock runs beside it ([ADR-0072](0072-seat-presence.md)), and the earlier of the two decides: a player who drops more than `DISCONNECT_FORFEIT_MS` (3 minutes) before the TTL runs out is forfeited first, the room goes back to waiting and the other player keeps it; one who drops later finds the room closed. The player still connected is told with `ROOM_CLOSED`; the one away learns it from `SESSION_INVALID` when they come back.
- **A last `CONFIRM_RULES` that races the timer:** whatever the server handles first counts, as at the placement deadline ([ADR-0090](0090-placement-timer.md)) and the turn timer ([ADR-0099](0099-turn-timer.md)). A confirmation handled before the timer runs, even at the deadline, starts placement, and the review that follows stops the timer. After the timer has run, the socket has no seat, so the confirmation is `NOT_ALLOWED`, after the `ROOM_CLOSED` that told it so. Room logic stores no deadline and compares no clock.

The value has to be long enough for two friends to agree on four rules, some of them new to one of them, while they talk it over in a chat app, and to come back after a short interruption. Ten minutes covers that with room to spare: the default rules need two taps, and the custom ones a few more. It is also the waiting TTL, so a room holds its place for at most 10 minutes per phase entry before the match, and the rules screen says it, as the waiting screen does.

## Considered options

- **Moving the match on at the deadline instead**, the issue's option (b): the rules on screen taken as agreed, and the room entering `PLACEMENT`, whose own deadline bounds it. Rejected for what the players would see: a placement starts on rules one of them never confirmed, maybe edited by the other a second before, which is what [ADR-0003](0003-rules-editing.md) and [ADR-0004](0004-stale-confirmation-protection.md) exist to prevent. It also needs a deadline in the snapshot and a countdown on the rules screen, and it does not free the place: the room goes on through placement, the dice, five idle turns and the game-over TTL. Closing the room loses nothing two players had agreed on, and they can create a new one in seconds.
- **An edit or a confirmation restarts the time:** friendlier to two players still busy with the rules after 10 minutes, but a script would send one edit every few minutes and hold the place for as long as its sockets stay open, the hold this TTL closes.
- **Counting from the creation of the room:** a friend who joins after nine minutes of waiting would have one minute to agree.
- **Shorter (2 to 5 minutes)**, closer to the placement limit: talking over the rules is part of the game, and two players who discuss them on a call or in a chat may need more than a few minutes. A shorter value buys little, since a script can always create its rooms again ([Roadmap: Open risks](../roadmap.md#open-risks)).
- **Longer (30 minutes):** an idle pair would hold a place three times as long, for no case that two friends need.
- **A countdown on the rules screen:** it would need the deadline in the snapshot. A sentence with the minutes says what a player needs to know, as on the waiting screen; a countdown can store the deadline later.

## Consequences

- The room timers are now `PLACEMENT`, `TURN`, `DISCONNECT_FORFEIT`, `WAITING_FOR_OPPONENT`, `RULES_NEGOTIATION` and `GAME_OVER`. Every phase has a timer while both players stay connected, so no pair of sockets can hold a room's place for longer than its phases' bounds.
- What [Roadmap: Open risks](../roadmap.md#open-risks) still carries: a client that creates or joins its rooms again holds places through new entries. Each entry is bounded now, so it must act every 10 minutes per room, as for the waiting TTL.
- A server test that keeps a room in negotiation must stay within `NEGOTIATION_TTL_MS`; the game-over TTL test now advances only that far.
- The browser journeys skip it on the e2e server's clock (`negotiation-ttl.spec.ts`), which also closes every room left from earlier journeys.

## Links

- Added on 2026-11-01 for bounding rules negotiation ([#128](https://github.com/fabogit/battleship/issues/128)).
- Spec: [Server: Room lifecycle](../server.md#room-lifecycle) · [Server: Rules negotiation](../server.md#rules-negotiation) · [Domain: Constants](../domain.md#constants)
- Amends: [ADR-0065](0065-clock-and-room-timers.md) (a `RULES_NEGOTIATION` kind) · [ADR-0082](0082-rules-negotiation-commands.md) (a negotiation ends without agreement)
- Related: [ADR-0096](0096-waiting-ttl.md) (waiting TTL) · [ADR-0103](0103-negotiation-ttl-on-the-wire.md) (the reason on the wire) · [ADR-0072](0072-seat-presence.md) (forfeit) · [ADR-0083](0083-rules-kept-when-a-seat-is-freed.md) (a freed seat) · [ADR-0090](0090-placement-timer.md) (races at a deadline) · [ADR-0104](0104-room-failure-containment.md) (the task is contained)
- Issues: [#128](https://github.com/fabogit/battleship/issues/128) · [#113](https://github.com/fabogit/battleship/issues/113) · [#53](https://github.com/fabogit/battleship/issues/53) (F5) · [#36](https://github.com/fabogit/battleship/issues/36) (rematch)
