---
status: accepted
date: 2026-10-31
---

# ADR-0097: Room-closed notice

When the server closes a room with a socket still bound to it, that socket gets `ROOM_CLOSED { roomId, reason }`, then loses its seat. It stays connected, in no room. `reason` is one of `ROOM_CLOSED_REASONS` (core): `WAITING_TTL` when nobody joined in time ([ADR-0096](0096-waiting-ttl.md)), `GAME_OVER_TTL` when the match ended `GAME_OVER_TTL_MS` ago. `room-handlers` sends it from the one place a room is removed, so every later cause only adds a reason: #123 will add one for a room closed by a handler failure. A room closed because nobody is left in it (`LEAVE_ROOM`, a forfeit, a socket moving on, [ADR-0095](0095-moving-on-frees-a-lone-waiting-seat.md)) has no socket left to tell.

`PROTOCOL_VERSION` goes from 3 to 4 ([ADR-0017](0017-protocol-versioning.md)). The event is new, and a client built before it would ignore it: a creator whose room expired would stay on a waiting screen that no join can reach, until a later command was refused. With version 4 such a tab is refused at the handshake with `PROTOCOL_MISMATCH` and asked to reload.

## Considered options

- **No event; the client learns it later** from `SESSION_INVALID` after a reconnection, as [ADR-0065](0065-clock-and-room-timers.md) and [ADR-0076](0076-refused-seat-explanation.md) had it: a creator who stays connected never reconnects, so the waiting screen would wait forever.
- **A `STATE` with a `CLOSED` phase:** the snapshot describes a room that exists; a closed room has no rules, seats or timers to project, and every view would need a phase it can do nothing with.
- **Disconnecting the socket after the notice**, as `SESSION_REPLACED` does: the player then needs a new connection to create the next room, and the cold-start screens would show for a server that is awake.
- **One event per cause** (`ROOM_EXPIRED`, later `ROOM_FAILED`): each one a new event and a new client listener for the same outcome, a seat that is gone. One event with a reason keeps one path.
- **Leaving out `roomId`:** the socket is bound to one room at a time, but a client that has just moved on could still be told about the room it left; naming it lets the client drop the right credentials.
- **Telling the game-over expiry too, or only the waiting one:** at game over the screen stays usable after its room closes only until the next command; with the rematch (#36) that command is the point of the screen. The notice is the same, so both TTLs send it.

## Consequences

- Version 3 clients are refused after the deploy; the Postman collection's `protocolVersion` variable, the `ECHO` example and `docs/domain.md` say 4, and both Postman seats listen to `ROOM_CLOSED`.
- [ADR-0065](0065-clock-and-room-timers.md)'s "the protocol has no event for an expired room" no longer holds for a connected socket.
- Client: the room page shows "This room has closed" with the reason ([ADR-0098](0098-closed-room-view.md)).

## Links

- Added on 2026-10-31 for room place limits ([#113](https://github.com/fabogit/battleship/issues/113)).
- Amended on 2026-10-31 ([#123](https://github.com/fabogit/battleship/issues/123)): a room that fails after a change was stored closes with the reason `SERVER_ERROR`, and `PROTOCOL_VERSION` goes to 5 ([ADR-0104](0104-room-failure-containment.md), [ADR-0105](0105-server-error-on-the-wire.md)).
- Spec: [Protocol: Server → client](../protocol.md#server--client) · [Server: Room lifecycle](../server.md#room-lifecycle) · [Domain: Constants](../domain.md#constants)
- Amends: [ADR-0065](0065-clock-and-room-timers.md) (an expired room is told)
- Related: [ADR-0017](0017-protocol-versioning.md) (protocol versioning) · [ADR-0084](0084-protocol-version-3.md) (version 3) · [ADR-0096](0096-waiting-ttl.md) (waiting TTL) · [ADR-0098](0098-closed-room-view.md) (closed-room view)
- Issues: [#113](https://github.com/fabogit/battleship/issues/113) · [#123](https://github.com/fabogit/battleship/issues/123) (a room closed by a failure) · [#36](https://github.com/fabogit/battleship/issues/36) (rematch)
