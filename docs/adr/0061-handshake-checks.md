---
status: accepted
date: 2026-10-13
---

# ADR-0061: Handshake checks

The server checks every Socket.io handshake in a namespace middleware (`io.use`), in the `handshake` plugin, before the socket connects: first the protocol version, by strict equality with `PROTOCOL_VERSION` ([ADR-0017](0017-protocol-versioning.md)), then the stored `session`, if the handshake has one ([ADR-0063](0063-session-rebinding.md)). A refusal calls `next(new Error(code))`, so the client gets a `connect_error` whose `message` is the error code, `PROTOCOL_MISMATCH` or `SESSION_INVALID`, and nothing else; the connection never opens, and Socket.io does not retry it (`socket.active` turns `false`). The version comes first, so an outdated client is told to reload even when its stored session is gone too. The client sends the handshake `auth` as a callback that Socket.io calls again on every reconnect attempt; today it holds only `{ protocolVersion }`, and #21 adds the stored session to it. Details in [Protocol: Handshake](../protocol.md#handshake) and [Server: Sessions & reconnection](../server.md#sessions--reconnection) (#22).

## Considered options

- **Checking in `allowRequest`, with the origin:** it runs at the Engine.IO level and can only answer HTTP 403 without a reason, and the client keeps retrying a refused `allowRequest` ([client.md: cold start](../client.md#cold-start-handling)). A middleware error carries the code and stops the retries, which is what an outdated client needs: retrying cannot help, reloading does.
- **Connecting first, then sending an error event and disconnecting:** the refused socket would briefly count as connected, reach the command listeners, and the client would see `connect` before the refusal.
- **Putting the code in the error's `data` with a human-readable message:** the code is the message the client has to branch on; one field is enough, and the client turns the code into text ([ADR-0018](0018-i18n.md)).
- **A static `auth` object on the client:** the version alone would work, but the stored session changes between attempts (a new room, credentials dropped after `SESSION_INVALID`), and the docs already describe a callback; #21 only adds a field.

## Consequences

- Every client must send the handshake `auth`: the client does from this change on, the `echo` smoke check already did ([ADR-0048](0048-echo-smoke-check.md)), and tools without `auth` pass the version in the query ([ADR-0062](0062-protocol-version-query.md)). A tab opened before the deploy has no `auth` and is refused with `PROTOCOL_MISMATCH`.
- Until #21 and #25 read the code, a refused client only shows the disconnected status; the "please reload" and "session lost" screens arrive with them.
- Refused handshakes are logged at `info` as "Handshake refused", with the error code ([Server: Logging](../server.md#logging)).

## Links

- Added on 2026-10-13 for the server handshake ([#22](https://github.com/fabogit/battleship/issues/22)).
- Spec: [Protocol: Handshake](../protocol.md#handshake) · [Server: Sessions & reconnection](../server.md#sessions--reconnection)
- Related: [ADR-0017](0017-protocol-versioning.md) (protocol versioning) · [ADR-0021](0021-origin-policy.md) (origin policy) · [ADR-0062](0062-protocol-version-query.md) (version in the query) · [ADR-0063](0063-session-rebinding.md) (session rebinding)
- Issues: [#22](https://github.com/fabogit/battleship/issues/22) · [#21](https://github.com/fabogit/battleship/issues/21) (session restore) · [#25](https://github.com/fabogit/battleship/issues/25) (connection-state UX)
