---
status: accepted
date: 2026-10-13
---

# ADR-0062: Protocol version in the query

The server also accepts the protocol version as a `protocolVersion` query parameter of the Socket.io URL, for tools that cannot send the handshake `auth`. Postman is one: its Socket.IO client builds the connection from the URL, headers and settings only, and Collection v3 has no field for `auth`. The query is read only when `auth` has no `protocolVersion`, and must be a single value equal to the decimal form of `PROTOCOL_VERSION` (`?protocolVersion=2`). A `session` is read from `auth` only, never from the query. The app and the `echo` smoke check keep sending `auth`. Details in [Protocol: Handshake](../protocol.md#handshake) (#22).

## Considered options

- **`auth` only:** every Postman Socket.IO request (`ECHO`, `Seat P1`, `Seat P2`) would be refused with `PROTOCOL_MISMATCH`, and the manual checks of [ADR-0028](0028-local-tooling.md) would move to scripts.
- **The session in the query too:** Postman could then rebind a seat and trigger `SESSION_REPLACED`, but player secrets would travel in URLs, which proxies and hosting platforms (Render) may log. Rebinding is covered by the integration tests and checked by hand with a socket.io-client script instead.
- **A custom header:** browsers cannot set headers on a WebSocket handshake, so it would be a second path used by tools only, like the query, and Postman's `ECHO — foreign origin` request already uses the headers for `Origin`.

## Consequences

- The Postman Socket.IO requests carry `protocolVersion` in their query parameters, and `ECHO — wrong protocol version` sends an old one to show `PROTOCOL_MISMATCH` ([Development: Local tooling](../development.md#local-tooling)).
- The version is not secret, so the query adds no exposure; it adds one more input to the handshake check, covered by the server tests over both transports.

## Links

- Added on 2026-10-13 for the server handshake ([#22](https://github.com/fabogit/battleship/issues/22)); chosen by the user over the two other options.
- Spec: [Protocol: Handshake](../protocol.md#handshake) · [Development: Local tooling](../development.md#local-tooling)
- Related: [ADR-0017](0017-protocol-versioning.md) (protocol versioning) · [ADR-0028](0028-local-tooling.md) (local tooling) · [ADR-0061](0061-handshake-checks.md) (handshake checks)
- Issues: [#22](https://github.com/fabogit/battleship/issues/22) · [#61](https://github.com/fabogit/battleship/issues/61) (Postman collection)
