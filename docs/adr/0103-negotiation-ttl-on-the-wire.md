---
status: accepted
date: 2026-11-01
---

# ADR-0103: The negotiation TTL on the wire

A room closed by the negotiation TTL ([ADR-0102](0102-negotiation-ttl.md)) tells its sockets with `ROOM_CLOSED { roomId, reason: 'NEGOTIATION_TTL' }`, a new value of `ROOM_CLOSED_REASONS` ([ADR-0097](0097-room-closed-notice.md)). `PROTOCOL_VERSION` goes from 5 to 6 ([ADR-0017](0017-protocol-versioning.md)): a version 5 client looks the reason up in `closedReasons`, finds nothing and breaks the room page, as [ADR-0105](0105-server-error-on-the-wire.md) found for `SERVER_ERROR`. With version 6 such a tab is refused at the handshake with `PROTOCOL_MISMATCH` and asked to reload.

The client words it in two places:

| Where                                 | Text                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules screen, under the heading       | "Agree on the rules with Grace. The match starts when you have both confirmed them; if you have not within 10 minutes, the room closes."                                                                               |
| Closed view, reason `NEGOTIATION_TTL` | "The rules were not confirmed by both players within 10 minutes, so the room closed to free its place on the server. Create a new room and send the new link to your opponent." ([ADR-0098](0098-closed-room-view.md)) |

The minutes come from `NEGOTIATION_TTL_MS`. The closed view's "Create a new room" leads home, as for `WAITING_TTL`; the room is gone, so there is nothing to join again.

## Considered options

- **Reusing `WAITING_TTL`:** no protocol change, but the closed view would tell two players who had both been in the room that nobody joined.
- **A generic reason for every TTL (`EXPIRED`) with the phase beside it:** one more field for every client to read, and the sentence would still differ per phase; a reason per cause is what [ADR-0097](0097-room-closed-notice.md) chose.
- **Telling the player only in the closed view:** two players would lose a room they thought was waiting for them. The rules screen says the limit up front, as the waiting screen says its own ([ADR-0096](0096-waiting-ttl.md)).

## Consequences

- Version 5 clients are refused after the deploy. The Postman collection's `protocolVersion` variable and `ECHO` example say 6, and both seats' `ROOM_CLOSED` descriptions list the new reason.
- `closedReasons` now takes the negotiation minutes too, after the waiting and game-over minutes, for every reason ([ADR-0105](0105-server-error-on-the-wire.md)).
- `RulesText.intro` takes the minutes along with the opponent's nickname.

## Links

- Added on 2026-11-01 for bounding rules negotiation ([#128](https://github.com/fabogit/battleship/issues/128)).
- Spec: [Protocol: Server → client](../protocol.md#server--client) · [Client: Rules screen](../client.md#rules-screen) · [Client: Connection states](../client.md#connection-states) · [Domain: Constants](../domain.md#constants)
- Amends: [ADR-0097](0097-room-closed-notice.md) (a new reason) · [ADR-0098](0098-closed-room-view.md) (its sentence) · [ADR-0105](0105-server-error-on-the-wire.md) (`closedReasons` takes the negotiation minutes)
- Related: [ADR-0102](0102-negotiation-ttl.md) (the TTL) · [ADR-0017](0017-protocol-versioning.md) (protocol versioning) · [ADR-0096](0096-waiting-ttl.md) (waiting TTL)
- Issues: [#128](https://github.com/fabogit/battleship/issues/128) · [#113](https://github.com/fabogit/battleship/issues/113)
