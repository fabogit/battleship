---
status: accepted
date: 2026-10-31
---

# ADR-0104: Room failure containment

An exception thrown while the server handles one room stays in that room. Until now it left the Socket.io listener or the timer as an uncaught exception, and Node ended the process with every room in it ([ADR-0085](0085-salvo-refused-until-implemented.md) records the crash that found this). Where the throw happens decides what follows:

- **In a command's transition**, before anything is stored: the command is refused with `SERVER_ERROR` and the room keeps its state. `RoomManager` stores a room only once the pure transition has returned (`createRoom`, `joinRoom`, `dispatch`, `leave`), so a throw there has changed nothing, and the players may go on or send the command again.
- **After a change is stored**: in the ack, the effects, the timer review or the `STATE` projection. The room closes as by a TTL ([ADR-0097](0097-room-closed-notice.md)): it leaves `RoomManager`, its timers stop, and every socket still bound to it gets `ROOM_CLOSED` with the reason `SERVER_ERROR` and loses its seat. A sender that has no ack yet gets `SERVER_ERROR` first. The stored room and what its players were sent no longer match, and nothing can tell which part of the change went out.
- **In a room timer task**: the room closes the same way. `RoomTimers.start` runs every task inside the containment and hands a throw to the failure handler that `room-handlers` gives it, with the room and the timer kind. Every kind is covered, the turn timer of #30 included, whatever its task does. A timer whose transition failed has fired and is gone, so the room would wait forever for the end of placement or a forfeit; there is no sender to refuse.
- **In a socket's `connection` or `disconnect` listener** (a resumed session, a seat dropping): the room whose seat presence was being updated closes the same way.
- **While a socket moves on to another room** ([ADR-0095](0095-moving-on-frees-a-lone-waiting-seat.md)): a failure while settling the room it leaves closes that room only; the new seat is taken as usual.
- **In the handshake check**, before the socket connects: the connection is refused with `SERVER_ERROR` as the `connect_error` message ([ADR-0061](0061-handshake-checks.md)). Socket.io 4 runs namespace middlewares inside a promise that nothing awaits, so a throw there was an unhandled rejection, which also ends the process. The check stores nothing, so no room is touched.

Each contained failure is logged at `error` with its stack (`err`): "Command failed" with the `roomId` (none for `CREATE_ROOM`) and the `event` for a refused transition, "Room failed" with the `roomId` and either the `event` (a command, `connection`, `disconnect`) or the `timer` kind for a closed room, and "Handshake failed" with the `socketId`.

Everything else still ends the process: the server registers no `uncaughtException` or `unhandledRejection` handler, and nothing catches outside the places above. A throw while removing a failed room is not caught either.

## Considered options

- **A process-wide `uncaughtException` handler:** keeps the process up, but cannot tell which room threw, so the broken room stays open with its timers, and Node's documentation calls resuming after it unsafe. It would also swallow failures that are not tied to a room.
- **One try/catch around every listener, closing the sender's room:** a command does not always know its room before it runs (`CREATE_ROOM`), a `LEAVE_ROOM` has already unbound the socket when the room is settled, and a socket moving on works on two rooms. The containment runs where the code knows the room.
- **Closing the room on every failure, the transition's too:** a room logic bug reached by one unusual command would end a match that is still consistent. A refusal keeps the match, and the error log still shows the bug.
- **Keeping the room open after a failure that followed the store:** the players' screens may lag behind the stored state or miss an effect, and a timer may be left unscheduled. Closing it tells both players at once and frees its place under `MAX_ROOMS`.
- **Retrying a failed timer task:** a deterministic bug fails again on every retry, and the room stays stuck in between.
- **A fault-injection flag in production code:** the tests spy on the `RoomManager` they already pass to `createServer` as its `rooms` option, so the production bundle and API carry nothing for them.

## Consequences

- A command's sender always gets one ack: a failure before the ack sends `SERVER_ERROR`; one after it is dropped, as Socket.io sends only the first reply.
- The other rooms on the server, and their timers, are untouched: the tests inject a fault in one room while a second room places its fleets and starts its match.
- A bug in room logic now shows up as an `error` line and a closed room instead of a restarted service, so Render's restart count no longer reveals it; the error lines do.
- The protocol gains `SERVER_ERROR` as an error code and as a `ROOM_CLOSED` reason ([ADR-0105](0105-server-error-on-the-wire.md)).

## Links

- Added on 2026-10-31 for containing a room handler failure ([#123](https://github.com/fabogit/battleship/issues/123)).
- Spec: [Server: Socket handlers](../server.md#socket-handlers) · [Server: Room lifecycle](../server.md#room-lifecycle) · [Server: Logging](../server.md#logging) · [Server: Testability](../server.md#testability)
- Amends: [ADR-0065](0065-clock-and-room-timers.md) (a timer task that throws closes its room)
- Related: [ADR-0085](0085-salvo-refused-until-implemented.md) (the crash) · [ADR-0037](0037-room-transition-shape.md) (room transition shape) · [ADR-0047](0047-reply-order.md) (reply order) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (room lifecycle) · [ADR-0090](0090-placement-timer.md) (placement timer) · [ADR-0097](0097-room-closed-notice.md) (room-closed notice)
- Issues: [#123](https://github.com/fabogit/battleship/issues/123) · [#26](https://github.com/fabogit/battleship/issues/26) · [#30](https://github.com/fabogit/battleship/issues/30) (turn timer)
