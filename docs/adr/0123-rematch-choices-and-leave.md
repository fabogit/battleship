---
status: accepted
date: 2026-11-22
---

# ADR-0123: Rematch choices, and `LEAVE` at once

At game over each seat sends `REMATCH_CHOICE` ([ADR-0012](0012-rematch.md)). This ADR settles how the server keeps the choices and what `LEAVE` does. Decision 1 of the [M4 decisions on #36](https://github.com/fabogit/battleship/issues/36). When a rematch resolves is [ADR-0124](0124-rematch-needs-both-seats.md); what it starts from is [ADR-0125](0125-what-a-rematch-starts-from.md).

- **Order of the checks:** the same as every seat command. A socket without a seat gets `NOT_ALLOWED`. Outside `GAME_OVER` every choice is `WRONG_PHASE`, `LEAVE` included.
- **`SAME_RULES` and `CHANGE_RULES` are kept** in `GameOverRoom.rematch`, one per seat. The snapshot shows both to both players (`gameOver.rematch`, `me` and `opponent`).
  - A seat may change its choice until the rematch resolves. The other seat's choice and presence do not matter: a choice can still change while both are made and the other seat is away.
  - The same choice again changes nothing. It is acked `{ ok: true }`, and both seats get `STATE` as after any accepted command.
  - There is no way to take a choice back, only to change it or leave.
- **`LEAVE` frees the leaver's seat at once,** without waiting for the other choice. `REMATCH_CHOICE` with `LEAVE` and `LEAVE_ROOM` in `GAME_OVER` are the same transition (`leaveGameOver` in `presence.ts`).
  - The leaver's sockets lose their binding and leave the Socket.io room, and the stored session stops working. The leaver gets the ack and nothing more, as before the match ([ADR-0073](0073-room-lifecycle-with-forfeits.md)).
  - The other player goes to `WAITING_FOR_OPPONENT` in the seat they had, with the room's rules and `rulesVersion`. Their own choice is dropped. The link stays the same, and the next `JOIN_ROOM` takes the freed seat.
  - A player left behind who is away keeps the time they dropped. Their forfeit clock, stopped at game over, runs again from that time, as it does after a seat is freed before the match.
  - Both seats are taken in `GAME_OVER`, so this never closes the room. The second player's `LEAVE_ROOM` finds the room waiting and frees the last seat, so the room closes, logged as "Room closed" with the reason `LEAVE_ROOM`.
- **Timers:** a choice does not restart the game-over TTL. Every way out of `GAME_OVER` stops it: a resolved rematch, a seat freed by `LEAVE`, and the TTL itself. A freed seat starts the waiting TTL ([ADR-0096](0096-waiting-ttl.md)).
- **Races:** the server handles one command at a time, and the first one it handles wins.
  - A choice that arrives after the room left `GAME_OVER` (a resolved rematch, or the other player's `LEAVE`) is `WRONG_PHASE`. A late `LEAVE` therefore never frees a seat in the next phase.
  - A choice after the game-over TTL closed the room is `NOT_ALLOWED`: the socket lost its seat with the room.
  - A choice from a socket that moved on to another room is answered by that room, never by the match it left.

## Considered options

- **`LEAVE` kept like the other choices until the other seat chooses:** the player who wants to go would wait, or the other player would be stuck facing a choice already lost. Decision 1 rules it out.
- **`REMATCH_CHOICE` with `LEAVE` accepted outside `GAME_OVER` as `LEAVE_ROOM`:** a `LEAVE` sent just as the rematch resolved would free the seat in the new placement or negotiation, a phase the player never saw. The client leaves with `LEAVE_ROOM` anyway ([ADR-0126](0126-leaving-the-page-at-game-over.md)), so after a resolution only a deliberate `LEAVE_ROOM` frees the seat.
- **Clearing the drop time of a player left behind:** an absent player would then wait for `WAITING_TTL_MS` (10 minutes) instead of the 3 minutes left on their forfeit clock. That breaks the rule that a freed seat leaves the other player's clock alone ([ADR-0073](0073-room-lifecycle-with-forfeits.md)).
- **A choice that restarts the game-over TTL:** a player alone could keep a room open by changing their choice every two minutes.

## Consequences

- `leaveRoom` no longer refuses anything: `NOT_ALLOWED` in `GAME_OVER` is gone, and `LEAVE_ROOM` is refused only without a seat.
- With `REMATCH_CHOICE` in place, every command of the protocol has its room logic, so `notYetSupported` goes ([ADR-0046](0046-commands-ahead-of-room-logic.md)).
- `PROTOCOL_VERSION` goes to 8 ([ADR-0127](0127-protocol-version-8.md)).

## Links

- Added on 2026-11-22 for the rematch flow ([#36](https://github.com/fabogit/battleship/issues/36)), from the M4 decisions on the issue.
- Spec: [Server: Game over & rematch](../server.md#game-over--rematch) · [Server: Leaving](../server.md#leaving) · [Protocol: Client → server](../protocol.md#client--server)
- Amends: [ADR-0012](0012-rematch.md) (`LEAVE` at once, choices changeable until resolution) · [ADR-0046](0046-commands-ahead-of-room-logic.md) (`REMATCH_CHOICE` and `LEAVE_ROOM` in `GAME_OVER` have their room logic) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (a seat freed at game over)
- Related: [ADR-0124](0124-rematch-needs-both-seats.md) · [ADR-0125](0125-what-a-rematch-starts-from.md) · [ADR-0126](0126-leaving-the-page-at-game-over.md) · [ADR-0116](0116-surrender-keeps-the-seat.md) (surrender keeps the seat) · [ADR-0096](0096-waiting-ttl.md) (waiting TTL)
- Issues: [#36](https://github.com/fabogit/battleship/issues/36)
