---
status: accepted
date: 2026-11-22
---

# ADR-0127: Protocol version 8 for the rematch

`PROTOCOL_VERSION` goes from 7 to 8 ([ADR-0017](0017-protocol-versioning.md)). The rematch ([ADR-0123](0123-rematch-choices-and-leave.md)) changes what two commands mean and what a snapshot can hold:

- `REMATCH_CHOICE` was `NOT_ALLOWED` in every phase. It now runs the rematch in `GAME_OVER`, and is `WRONG_PHASE` in every other phase.
- `LEAVE_ROOM` in `GAME_OVER` was `NOT_ALLOWED`. It now frees the seat, and the other player goes to `WAITING_FOR_OPPONENT`.
- `gameOver.rematch` was always `{ me: null, opponent: null }`. It now holds each seat's choice, never `LEAVE`, and its type narrows to `RecordedRematchChoice`.
- `GAME_OVER` can now be followed by `PLACEMENT`, `RULES_NEGOTIATION` or `WAITING_FOR_OPPONENT` in the same room.

The reason for the bump is the second change. A version 7 tab sends nothing at game over: "New match" is a plain link, and its guard lets a finished match go without a command. Against a version 8 server, that tab's player would leave with their seat still taken. The opponent would see them connected, would wait for a choice that never comes, and could not get a new opponent until the game-over TTL. With version 8, such a tab is refused at the handshake with `PROTOCOL_MISMATCH` and asked to reload, as for every bump since [ADR-0084](0084-protocol-version-3.md).

A second reason is the order of a deploy. Pages and Render deploy separately. A version 8 client that reached a version 7 server would show the rematch controls, and every choice and every "Leave room" at game over would end in `NOT_ALLOWED`. The version check stops that pairing too.

## Considered options

- **Keeping version 7:** no version 7 client crashes or misreads anything on its own. It never sends `REMATCH_CHOICE` or `LEAVE_ROOM` at game over, so it never meets the new answers. It ignores `rematch`, which it already parsed as nullable choices. And it renders the phases that can now follow `GAME_OVER` as it renders them after a join. The harm is to the other player, who waits on a seat that will never choose, as described above. The version exists so that a client and a server that disagree on what the game does refuse each other, and here they would disagree on what leaving at game over means.
- **Accepting a version 7 client and freeing its seat when its socket moves on:** two meanings for leaving a finished match on one server, decided by a version the server would have to keep per socket. A version 7 tab that simply stays open would still never choose.

## Consequences

- Version 7 clients are refused after the deploy. A Render deploy drops every room anyway, since rooms live in memory, so the bump costs no match in progress.
- The Postman collection's `protocolVersion` variable and the `ECHO` example say 8, and `docs/domain.md` too. The core smoke test pins it.

## Links

- Added on 2026-11-22 for the rematch flow ([#36](https://github.com/fabogit/battleship/issues/36)), approved by the M4 hub before it was written into the docs.
- Spec: [Protocol: Handshake](../protocol.md#handshake) · [Protocol: Client → server](../protocol.md#client--server) · [Protocol: Snapshot](../protocol.md#snapshot) · [Domain: Constants](../domain.md#constants)
- Related: [ADR-0017](0017-protocol-versioning.md) (protocol versioning) · [ADR-0118](0118-protocol-version-7.md) (version 7) · [ADR-0084](0084-protocol-version-3.md) (version 3) · [ADR-0123](0123-rematch-choices-and-leave.md) · [ADR-0126](0126-leaving-the-page-at-game-over.md)
- Issues: [#36](https://github.com/fabogit/battleship/issues/36)
