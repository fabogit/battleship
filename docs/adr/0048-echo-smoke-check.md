---
status: accepted
date: 2026-10-08
---

# ADR-0048: ECHO as the smoke check

`ECHO` stays in the protocol for good, as the production smoke check, now that the Phase 0 page that sent it is gone. After every deploy `pnpm --filter @battleship/server echo <url>` opens a Socket.io connection, sends `ECHO` and expects the ack with the payload and `protocolVersion`. It checks the origin policy, the transport, the handshake and one event round trip with its ack, without touching a room. The client no longer sends it: `GameSocketService.echo()` is removed, and `ECHO` was never a `CommandEvent`, so `emitWithAck` refuses it at compile time. `EchoResponse` and the Postman `ECHO` requests stay. The script sends the handshake `auth` (`{ protocolVersion }`) already, so the protocol check of #22 lets it in. Details in [Protocol: Client → server](../protocol.md#client--server) (#17).

## Considered options

- **Removing `ECHO`, with a handshake-only smoke test (connect, then close):** a cleaner contract, but the smoke test would no longer cover the path every command takes: an event reaching a handler and its ack coming back.
- **Removing `ECHO`, with a smoke test on `CREATE_ROOM`:** the real flow, but every run would open a room, and rooms are not removed until #24, so each deploy check would use up one of the `MAX_ROOMS` (50) slots for the server's lifetime.

## Consequences

- One event in `ClientToServerEvents` is not part of the game. It has no guard and never fails; its payload is bounded by `maxHttpBufferSize`, and the rate limit (#24) counts it like any other event.
- A future server change that requires a session for every event must leave `ECHO` open to a socket without a room.

## Links

- Added on 2026-10-08 when the Phase 0 page was retired ([#17](https://github.com/fabogit/battleship/issues/17)).
- Spec: [Protocol: Client → server](../protocol.md#client--server) · [Development: Monorepo topology](../development.md#monorepo-topology)
- Related: [ADR-0028](0028-local-tooling.md) (the Postman collection), [ADR-0035](0035-command-acks.md) (commands and their acks)
- Issues: [#17](https://github.com/fabogit/battleship/issues/17), [#51](https://github.com/fabogit/battleship/issues/51) (F16)
