---
status: accepted
date: 2026-10-08
---

# ADR-0045: Socket seat binding

The server knows which seat a socket plays from `socket.data.binding` (`{ roomId, seat }`), set by an accepted `CREATE_ROOM` (`P1`) or `JOIN_ROOM` (`P2`), and the socket joins the Socket.io room named after the room id. Seat commands read the binding to build the room command; a socket without one is refused with `NOT_ALLOWED`. `STATE` goes to every socket in the Socket.io room, each with the projection of its own seat ([ADR-0038](0038-snapshot-projection.md)). The binding lives and dies with the socket: until sessions are bound at the handshake (#22), a reconnected socket starts without a seat. A socket that creates or joins another room is moved there, and the seat it leaves stays taken (freeing seats arrives with #23); joining the other seat of the room it already sits in is `NOT_ALLOWED`. Details in [Server: Socket handlers](../server.md#socket-handlers) (#15).

## Considered options

- **A separate map from socket id to seat in the handlers plugin:** duplicates what Socket.io already tracks, and needs its own cleanup on disconnect; `socket.data` and Socket.io rooms are dropped with the socket.
- **Broadcasting one `STATE` to the Socket.io room:** each player must get their own projection (fog-of-war), so the server iterates the room's sockets and emits to each.
- **Refusing `CREATE_ROOM` / `JOIN_ROOM` from a socket that already has a seat:** until `LEAVE_ROOM` lands (#23), a player back on the home screen after a match could not start another one without reconnecting.
- **Allowing a socket to take the other seat of its own room:** the first seat would be left without a socket, and the match could not go on.

## Consequences

- A reload or a dropped connection loses the seat until #22 binds sessions; the room keeps both seats (`isConnected` stays `true` until #23 tracks disconnections, [ADR-0038](0038-snapshot-projection.md)).
- The secrets returned in the acks are not used yet: #22 will look them up to rebind a socket.

## Links

- Added on 2026-10-08 for the socket handlers ([#15](https://github.com/fabogit/battleship/issues/15)).
- Spec: [Server: Socket handlers](../server.md#socket-handlers) · [Server: Sessions & reconnection](../server.md#sessions--reconnection)
- Related: [ADR-0014](0014-duplicate-sessions.md) (latest connection wins) · [ADR-0037](0037-room-transition-shape.md) (room transition shape) · [ADR-0038](0038-snapshot-projection.md) (snapshot projection)
- Issues: [#15](https://github.com/fabogit/battleship/issues/15) · [#22](https://github.com/fabogit/battleship/issues/22) (session binding) · [#23](https://github.com/fabogit/battleship/issues/23) (seat reservation)
