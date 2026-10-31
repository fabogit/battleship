---
status: accepted
date: 2026-10-31
---

# ADR-0095: Moving on frees a lone waiting seat

A socket that takes a seat in another room, with an accepted `CREATE_ROOM` or `JOIN_ROOM`, frees at once the seat it leaves in a room in `WAITING_FOR_OPPONENT`, as `LEAVE_ROOM` does ([Server: Leaving](../server.md#leaving)). In that phase the socket's player is the room's only one, so the room closes, logged as "Seat left" and "Room closed" with the `reason` `CREATE_ROOM` or `JOIN_ROOM`, and its session is no longer valid. One socket therefore holds at most one waiting room: before this, it could create `MAX_ROOMS` rooms within the rate limit in about 2.5 s, and each stayed open until its seat was forfeited, `DISCONNECT_FORFEIT_MS` later (#53, F5).

A seat the socket leaves in any later phase (`RULES_NEGOTIATION`, `PLACEMENT`, `IN_PROGRESS`, `GAME_OVER`) stays taken and away, as before ([ADR-0072](0072-seat-presence.md)): an opponent sits there, the match may be under way, and the player can still go back to it, as two tabs on two rooms do. Its forfeit, or the game-over TTL, bounds how long it holds the room.

The seat is freed only once the new seat is taken. A refused `JOIN_ROOM` (`ROOM_NOT_FOUND`, `ROOM_FULL`) or `CREATE_ROOM` (`SERVER_FULL`) moves nobody, so the player keeps the room they were waiting in. Details in [Server: Socket handlers](../server.md#socket-handlers) (#113).

## Considered options

- **Freeing the seat in every phase before the match**, as `LEAVE_ROOM` does there: a player who opens a second room during negotiation or placement would drop the opponent back to the waiting screen with no way back for themselves. Those rooms are not the one-socket hold, since each needs a second player, and their forfeits already bound them.
- **Freeing it before the new seat is taken:** a `CREATE_ROOM` at `MAX_ROOMS` would then always succeed, by swapping one room for another, but a `JOIN_ROOM` refused after the free would cost the player their room for nothing. Keeping one order for both commands is simpler; a full server refuses a swap too.
- **Refusing `CREATE_ROOM` and `JOIN_ROOM` from a socket that already holds a waiting room:** the player would have to leave first, and the client does not send `LEAVE_ROOM` when the player opens another room from the home screen.

## Consequences

- [ADR-0072](0072-seat-presence.md)'s rejection of "moving to another room as `LEAVE_ROOM`" still holds after the wait; for a waiting room it no longer does.
- The tab's "You left this room" view of the old room stays true: the player entered another room. Opened in another tab, its credentials are refused with `SESSION_INVALID`, explained as a seat given up ([ADR-0076](0076-refused-seat-explanation.md)).
- It closes the one-socket case only. Many sockets still hold a room each; the waiting TTL bounds how long ([ADR-0096](0096-waiting-ttl.md)).

## Links

- Added on 2026-10-31 for room place limits ([#113](https://github.com/fabogit/battleship/issues/113)).
- Spec: [Server: Socket handlers](../server.md#socket-handlers) · [Server: Seat presence](../server.md#seat-presence) · [Server: Hardening](../server.md#hardening)
- Amends: [ADR-0072](0072-seat-presence.md) (a seat left behind in a waiting room is freed, not away)
- Related: [ADR-0073](0073-room-lifecycle-with-forfeits.md) (a room with no player closes) · [ADR-0078](0078-leaving-before-the-match.md) (leaving before the match) · [ADR-0096](0096-waiting-ttl.md) (waiting TTL)
- Issues: [#113](https://github.com/fabogit/battleship/issues/113) · [#53](https://github.com/fabogit/battleship/issues/53) (F5)
