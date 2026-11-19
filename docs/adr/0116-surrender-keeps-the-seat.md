---
status: accepted
date: 2026-11-19
---

# ADR-0116: Surrender keeps the seat

`SURRENDER`, and `LEAVE_ROOM` sent during `IN_PROGRESS`, end the match the same way: the room goes to `GAME_OVER` with reason `SURRENDER`, and the other seat wins. Neither command frees a seat. Both players stay seated, so `GameOverRoom.players` stays non-nullable, and the room can still offer a rematch (#36). Leaving the room for good is the rematch's `LEAVE` choice. Details in [Server: Leaving](../server.md#leaving).

- **Room logic:** one pure transition, `surrender(state, seat)` in `room.ts`, calls `endMatch(state, state.battle, otherSeat(seat), SURRENDER)`. `applyCommand` runs it for `SURRENDER`, and `leaveRoom` runs it for `LEAVE_ROOM` in `IN_PROGRESS`. Outside `IN_PROGRESS`, `SURRENDER` is `WRONG_PHASE`. `LEAVE_ROOM` keeps its other answers: it frees the seat before the match, and it is `NOT_ALLOWED` in `GAME_OVER` until #36. `GameOverRoomReason` now includes `SURRENDER`, so every `GAME_OVER_REASONS` value can reach a client.
- **Who may surrender:** either seat, on its own turn or the opponent's, paused or not. There is no turn check. A seat that surrenders while its opponent is away hands the win to the absent player, whose seat stays away in `GAME_OVER` (no forfeit runs there, [ADR-0072](0072-seat-presence.md)).
- **Socket handling:** the command goes through the same path as every other seated command: the binding check (`NOT_ALLOWED` without a seat), the transition, then the ack, then `STATE` to both seats ([ADR-0047](0047-reply-order.md)). The timer review that follows any accepted command does the rest: the turn timer (and with it any automatic shot) and the forfeit clock stop, and the game-over TTL starts, as on every other way into `GAME_OVER`. During the match, `LEAVE_ROOM` does not unbind the leaver's sockets or take them out of the Socket.io room. The leaver gets the game-over `STATE` too.
- **Races:** the server runs one command to its end before reading the next. Whatever it handles first wins: two surrenders, or a surrender and the `FIRE` that sinks the last ship, leave the second command with `WRONG_PHASE`. A turn timer or a forfeit due right after a surrender finds its timer stopped. A socket that moved on to another room (`CREATE_ROOM` or `JOIN_ROOM`, [ADR-0045](0045-socket-seat-binding.md)) surrenders there, if anywhere: never in the room it left.

## Considered options

- **Freeing the leaver's seat, as before the match:** `GameOverRoom.players` would need a `null` seat, which no other phase after `JOIN_ROOM` has. The winner would sit alone in a room that can only expire, so a rematch with the same opponent would be impossible. It would also give `LEAVE_ROOM` two meanings in `GAME_OVER`, the one a surrender left and the rematch's `LEAVE`.
- **`LEAVE_ROOM` refused during the match, with `SURRENDER` as the only way out:** a client could not leave in one step, and a "Leave room" sent from placement just as the match started would bounce with a refusal that the player has no way to act on.
- **A turn check, so that only the active player may surrender:** it would make a player wait out the opponent's turn to give up, and a paused match whose turn belongs to the absent player could not be surrendered at all.

## Consequences

- The surrenderer's socket stays bound to its `GAME_OVER` seat after the client has left the page through the leave guard ([ADR-0117](0117-leave-guard.md)). It counts as connected until `bind` moves it to another room or the game-over TTL closes the room, so the opponent sees them as present. #36 has to take this into account when it requires both seats to be connected for a rematch.
- A "Leave room" sent from placement as the match starts is a surrender: the ack is `{ ok: true }`, the client forgets the session and goes home as before, and the opponent reads "<nickname> surrendered." right at the start of the match.
- The client's "The match has started, so the room can no longer be left." no longer has a case to explain, and goes.
- `PROTOCOL_VERSION` goes to 7 ([ADR-0118](0118-protocol-version-7.md)).

## Links

- Added on 2026-11-19 for surrender ([#35](https://github.com/fabogit/battleship/issues/35)), from the M4 decisions on the issue.
- Spec: [Server: Leaving](../server.md#leaving) · [Server: Socket handlers](../server.md#socket-handlers) · [Protocol: Client → server](../protocol.md#client--server)
- Amends: [ADR-0046](0046-commands-ahead-of-room-logic.md) (`SURRENDER` and `LEAVE_ROOM` in `IN_PROGRESS` have their room logic)
- Related: [ADR-0011](0011-game-over.md) (game over) · [ADR-0012](0012-rematch.md) (rematch) · [ADR-0072](0072-seat-presence.md) (seat presence) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (room lifecycle) · [ADR-0078](0078-leaving-before-the-match.md) (leaving before the match) · [ADR-0095](0095-moving-on-frees-a-lone-waiting-seat.md) (moving on) · [ADR-0117](0117-leave-guard.md) (leave guard) · [ADR-0118](0118-protocol-version-7.md) (protocol version 7)
- Issues: [#35](https://github.com/fabogit/battleship/issues/35) · [#36](https://github.com/fabogit/battleship/issues/36)
