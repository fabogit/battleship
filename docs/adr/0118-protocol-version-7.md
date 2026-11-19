---
status: accepted
date: 2026-11-19
---

# ADR-0118: Protocol version 7 for surrender

`PROTOCOL_VERSION` goes from 6 to 7 ([ADR-0017](0017-protocol-versioning.md)). Surrender ([ADR-0116](0116-surrender-keeps-the-seat.md)) changes what two commands mean:

- `SURRENDER` was `NOT_ALLOWED` in every phase. It now ends the match in `IN_PROGRESS`, and is `WRONG_PHASE` in every other phase.
- `LEAVE_ROOM` in `IN_PROGRESS` was `NOT_ALLOWED`. It now ends the match as a surrender.

`reason: 'SURRENDER'` can now reach a client. It was already a value of `GAME_OVER_REASONS`, and the version 6 client words it ("Grace surrendered.", "You surrendered."), so the new reason alone would not break a version 6 tab.

The reason for the bump is the second change. A version 6 tab shows "Leave room" in placement. If that click reaches the server just as the match starts, the version 6 client expects `NOT_ALLOWED`, which it explains as "The match has started, so the room can no longer be left." ([ADR-0105](0105-server-error-on-the-wire.md) records that meaning). A version 7 server would instead surrender the match and ack `{ ok: true }`, and the old tab would go home without telling the player they gave up a match. With version 7, such a tab is refused at the handshake with `PROTOCOL_MISMATCH` and asked to reload.

A second reason is the order of a deploy. Pages and Render deploy separately. A version 7 client that reached a version 6 server would show "Surrender" and the leave guard, and both would end in `NOT_ALLOWED`. The version check stops that pairing too.

## Considered options

- **Keeping version 6:** no version 6 client crashes on the new server, and `SURRENDER` is a reason it knows. But the version exists so that a client and a server that disagree on what a command means refuse each other ([ADR-0084](0084-protocol-version-3.md)). Here they would disagree silently, about whether a click gave up a match.
- **Accepting `LEAVE_ROOM` as a surrender only from version 7 clients:** two meanings for one command on one server, decided by a version the server would have to keep per socket.

## Consequences

- Version 6 clients are refused after the deploy. A Render deploy drops every room anyway, since rooms live in memory, so the bump costs no match in progress.
- The Postman collection's `protocolVersion` variable and the `ECHO` example say 7, and `docs/domain.md` too. The core smoke test pins it.

## Links

- Added on 2026-11-19 for surrender ([#35](https://github.com/fabogit/battleship/issues/35)).
- Spec: [Protocol: Handshake](../protocol.md#handshake) · [Protocol: Client → server](../protocol.md#client--server) · [Domain: Constants](../domain.md#constants)
- Related: [ADR-0017](0017-protocol-versioning.md) (protocol versioning) · [ADR-0116](0116-surrender-keeps-the-seat.md) (surrender keeps the seat) · [ADR-0084](0084-protocol-version-3.md) (version 3) · [ADR-0103](0103-negotiation-ttl-on-the-wire.md) (version 6) · [ADR-0105](0105-server-error-on-the-wire.md) (version 5)
- Issues: [#35](https://github.com/fabogit/battleship/issues/35)
