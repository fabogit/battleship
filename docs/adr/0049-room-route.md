---
status: accepted
date: 2026-10-08
---

# ADR-0049: One room route for both players

The client has two routes: `/` (home: nickname, "Create room") and `/r/:roomId`, the page of one room for both players. After `CREATE_ROOM` the creator is sent to `/r/<roomId>`, so the link to share is the address they are on. The joiner opens the same address. The room page picks its view from what the client knows, in this order: a malformed id is "Room not found" without asking the server; the room's snapshot, once it arrives, decides by phase (waiting screen, then the match views of #19 and #20); a seat held in `SessionStore` without a snapshot yet is "Entering the room…"; otherwise the nickname form and "Join room", replaced by its own screen on `ROOM_NOT_FOUND` or `ROOM_FULL`. The route parameter reaches the page as an input (`withComponentInputBinding`). Details in [Client: Routes & lobby flow](../client.md#routes--lobby-flow) (#17).

## Considered options

- **A route per step (`/r/:roomId/join`, `/r/:roomId/lobby`, `/r/:roomId/play`):** each address would need a guard that redirects to wherever the snapshot says the room is, and the creator's address would differ from the one to share. The phase already says which view applies, and the server sends it on every change.
- **Keeping the room under `/` with in-memory state only:** the address would never name the room, so there would be nothing to share and nothing for #21 to restore on reload.

## Consequences

- A reload of `/r/<roomId>` keeps the address but, until #21 stores the session and sends it in the handshake, loses the seat: the page shows the join form again.
- Each match view (#19, #20) plugs into the room page's phase switch rather than adding a route.

## Links

- Added on 2026-10-08 for the home and lobby screens ([#17](https://github.com/fabogit/battleship/issues/17)).
- Spec: [Client: Routes & lobby flow](../client.md#routes--lobby-flow) · [Client: Layout](../client.md#layout)
- Related: [ADR-0013](0013-session-persistence.md) (session persistence), [ADR-0015](0015-protocol-shape.md) (snapshots as the source of truth)
- Issues: [#17](https://github.com/fabogit/battleship/issues/17), [#21](https://github.com/fabogit/battleship/issues/21)
