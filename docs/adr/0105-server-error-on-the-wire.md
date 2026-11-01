---
status: accepted
date: 2026-10-31
---

# ADR-0105: `SERVER_ERROR` on the wire

A failure the server contains ([ADR-0104](0104-room-failure-containment.md)) reaches clients under one name, `SERVER_ERROR`, in the two sets it can appear in:

- **`ERROR_CODES.SERVER_ERROR`**, the ack of a command whose transition threw (the room kept its state), the ack of a command whose room failed before its ack went out, and the `connect_error` message of a handshake check that threw.
- **`ROOM_CLOSED_REASONS.SERVER_ERROR`**, the reason `ROOM_CLOSED` gives when a room failed after a change was stored.

`PROTOCOL_VERSION` goes from 4 to 5 ([ADR-0017](0017-protocol-versioning.md)). A version 4 client reads `ROOM_CLOSED` through `closedReasons[reason]`, a lookup typed over the reasons it knows: an unknown reason is `undefined`, and calling it throws inside the room page's computed signal, so the player would see a broken page instead of the closed view. With version 5, a tab built before this change is refused at the handshake with `PROTOCOL_MISMATCH` and asked to reload, as after [ADR-0097](0097-room-closed-notice.md).

The client words both:

| Where                              | Text                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Closed view, reason `SERVER_ERROR` | "The server ran into an error in this room and could not go on with it, so the match was lost. Other rooms were not affected. Create a new room and send the new link to your opponent." ([ADR-0098](0098-closed-room-view.md)) |
| Creating or joining a room         | "The server ran into an error, so you are not in the room. Try again."                                                                                                                                                          |
| Rules                              | "The server ran into an error, so the rules did not change. Try again."                                                                                                                                                         |
| Placement                          | "The server ran into an error. Your last change was not saved."                                                                                                                                                                 |
| Battle                             | "The server ran into an error. Your last move was not saved."                                                                                                                                                                   |
| Pause and resume                   | "The server ran into an error, so the match did not change. Try again."                                                                                                                                                         |
| Handshake (`connect_error`)        | "The server refused the connection.", with "Retry", as for any refusal other than `PROTOCOL_MISMATCH` and `SESSION_INVALID`                                                                                                     |

## Considered options

- **An existing error code for the refused transition:** none says it. `NOT_ALLOWED` would tell the player the command is not allowed now, and two screens give it a meaning of their own ("The match has started, so the room can no longer be left", "Your opponent is back"), so the player would read a false reason. `INVALID_PAYLOAD` would blame the client's message.
- **Making the client tolerate unknown values instead of a new version:** a fallback sentence for a reason it does not know, and the generic message every error table already has for codes. It only helps clients built from now on: the version 4 tabs open at the deploy would still break on the new reason. The handshake already guarantees that client and server speak the same contract, so a second, runtime mechanism would only cover what the version check already does, and the typed `Record` keeps every reason worded at compile time.
- **No new reason; a failed room closes with no notice**, like a room nobody is left in: its connected players would stay on a board whose commands are refused with `NOT_ALLOWED`, which is what [ADR-0097](0097-room-closed-notice.md) set out to end.
- **Disconnecting the room's sockets instead of `ROOM_CLOSED`:** the client would show a connection problem and reconnect into `SESSION_INVALID`, which explains the refusal from clues ([ADR-0076](0076-refused-seat-explanation.md)); here the server knows the cause and says it.
- **Different names in the two sets** (`INTERNAL_ERROR`, `ROOM_FAILED`): both say the same thing from two places, and one name makes the logs and the docs easy to search.
- **The generic "Something went wrong. Try again." for the code:** it is what an unknown code shows, and it fits; the dedicated sentences add what the player needs to know, that nothing changed or what was not saved.

## Consequences

- Version 4 clients are refused after the deploy. The Postman collection's `protocolVersion` variable and `ECHO` example say 5, and both seats' `ROOM_CLOSED` descriptions list the new reason.
- `closedReasons` takes the waiting and game-over minutes for every reason, as `seatLosses` takes its minutes, instead of the minutes of the reason's own TTL: a server error has no TTL.
- A further reason or code needs a version bump again, as long as the client looks them up in typed records.

## Links

- Added on 2026-10-31 for containing a room handler failure ([#123](https://github.com/fabogit/battleship/issues/123)).
- Amended on 2026-11-01 ([#128](https://github.com/fabogit/battleship/issues/128)): `closedReasons` takes the negotiation minutes too ([ADR-0103](0103-negotiation-ttl-on-the-wire.md)).
- Spec: [Protocol: Error codes](../protocol.md#error-codes) · [Protocol: Server → client](../protocol.md#server--client) · [Client: Connection states](../client.md#connection-states) · [Domain: Constants](../domain.md#constants)
- Related: [ADR-0104](0104-room-failure-containment.md) (containment) · [ADR-0017](0017-protocol-versioning.md) (protocol versioning) · [ADR-0097](0097-room-closed-notice.md) (version 4, room-closed notice) · [ADR-0098](0098-closed-room-view.md) (closed-room view) · [ADR-0061](0061-handshake-checks.md) (handshake checks) · [ADR-0046](0046-commands-ahead-of-room-logic.md) (`NOT_ALLOWED`)
- Issues: [#123](https://github.com/fabogit/battleship/issues/123) · [#113](https://github.com/fabogit/battleship/issues/113)
