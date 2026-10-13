---
status: accepted
date: 2026-10-13
---

# ADR-0063: Session rebinding

A handshake `session` that passes `parseSessionCredentials` is looked up in the room registry (`RoomManager.findSeat`): the room must be open and one of its seats must hold that `playerSecret`. Otherwise, a malformed session included, the handshake is refused with `SESSION_INVALID` ([ADR-0061](0061-handshake-checks.md)). A found seat goes into `socket.data.binding` in the middleware, so the socket is seated from its first event on, as if it had created or joined the room ([ADR-0045](0045-socket-seat-binding.md)). When it connects, the server, in this order: sends `SESSION_REPLACED` to every other socket bound to the same seat and disconnects it from the namespace (latest connection wins, [ADR-0014](0014-duplicate-sessions.md)); joins the new socket to the room's Socket.io room; and sends it its `STATE`. The opponent gets nothing: until disconnections are tracked (#23), a rebinding does not change the room. Details in [Server: Sessions & reconnection](../server.md#sessions--reconnection) (#22).

## Considered options

- **Closing the replaced socket's connection (`disconnect(true)`):** the underlying connection could close before `SESSION_REPLACED` is flushed, on the polling transport in particular. A namespace disconnect is a packet sent after the event on the same connection, so the client reads `SESSION_REPLACED`, then a server disconnect (`io server disconnect`), which stops its reconnection; the client closes the connection itself.
- **First connection wins:** see [ADR-0014](0014-duplicate-sessions.md).
- **Binding in the `connection` listener instead of the middleware:** the session must be looked up before the socket connects anyway, to refuse it; keeping the seat found there spares a second lookup by secret.
- **A constant-time comparison of secrets:** a secret is a random UUID (122 bits), compared once per handshake; measuring string comparison time across the network is not a practical way to guess one.
- **Pino `redact` for `playerSecret`, as server.md planned:** nothing logs a secret. Acks are not logged, the handshake `auth` is never logged, and no event payload carries one; a debug-level test checks the whole log of a rebinding for the secret instead of trusting a list of paths.

## Consequences

- A reload or a dropped connection gets its seat back as soon as the client sends its stored session, which it does since #21 ([ADR-0069](0069-session-storage-layout.md)).
- The secret is the only credential: whoever holds it plays the seat, and the previous holder is disconnected.
- Rebinding is logged at `info` as "Session resumed" and "Session replaced", with the room, the seat and the replaced socket's id, never the secret ([Server: Logging](../server.md#logging)).

## Links

- Added on 2026-10-13 for the server handshake ([#22](https://github.com/fabogit/battleship/issues/22)).
- Spec: [Server: Sessions & reconnection](../server.md#sessions--reconnection) · [Protocol: Handshake](../protocol.md#handshake)
- Related: [ADR-0014](0014-duplicate-sessions.md) (latest connection wins) · [ADR-0045](0045-socket-seat-binding.md) (seat binding) · [ADR-0061](0061-handshake-checks.md) (handshake checks)
- Issues: [#22](https://github.com/fabogit/battleship/issues/22) · [#21](https://github.com/fabogit/battleship/issues/21) (session restore) · [#23](https://github.com/fabogit/battleship/issues/23) (disconnections) · [#24](https://github.com/fabogit/battleship/issues/24) (TTLs: an expired room is an unknown session)
