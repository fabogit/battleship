---
status: accepted
date: 2026-10-13
---

# ADR-0070: Handshake refusals and resync

The client acts on two things that the handshake tells it ([ADR-0061](0061-handshake-checks.md)):

- **`SESSION_INVALID`:** the server refused the credentials that the handshake sent, because the room is gone or no seat holds the secret. `GameSocketService` drops those credentials (`SessionStore.refuse`), so the tab is in no room, and connects again at once without a session. The room page shows "Room not found" for that room until the app restarts, even over a snapshot that the tab still holds.
- **Resync by reconnecting:** `GameSocketService.reconnect()` closes an open or opening socket and opens it again, so the handshake sends the current room's credentials anew and the server binds the socket to that seat, or to none ([ADR-0063](0063-session-rebinding.md)). A closed socket is left alone, because the next `connect()` sends them anyway. Two cases call it:
  - a `CREATE_ROOM` or `JOIN_ROOM` that ends in `NO_ACK`. The server may have seated the socket in a room the client does not know, while the client still follows its current room. Without the resync, Back to that room showed "Entering the room…" for ever (#52 F1);
  - a new tab that enters a stored room while its socket is already open ([ADR-0069](0069-session-storage-layout.md)).

The client does nothing else on a refusal. `PROTOCOL_MISMATCH` and `SESSION_REPLACED` leave the status at "Disconnected from the server", with its retry button; their screens belong to #25. Details in [Client: Socket service](../client.md#socket-service) (#21).

## Considered options

- **Waiting for the retry button after `SESSION_INVALID`:** Socket.io does not retry a refused handshake, so the player would be stuck on "Disconnected" with a connection that works.
- **Sending the player home with an explanation, as server.md planned:** that screen is part of #25. "Room not found" already says that the room may have closed and links home, and a reload or a link to another room works as before.
- **Retrying the command after `NO_ACK`:** a second `CREATE_ROOM` opens a second room, and a second `JOIN_ROOM` gets `ROOM_FULL` from the seat that the first one took.
- **A command that asks the server which room the socket is in:** a protocol change for a rare case, when the handshake already binds the socket to the room the client follows.

## Consequences

- After a `NO_ACK` for a seat that the server did take, that seat has no socket. A room created that way waits empty, and a seat joined that way keeps the room full, until the server tracks disconnections and expiry (#23, #24).
- #25 picks up the screens: "please reload" for `PROTOCOL_MISMATCH`; for `SESSION_INVALID`, an explanation that tells a closed room from a lost seat; for `SESSION_REPLACED`, a screen saying that the match was opened elsewhere, with a way to take the seat back; and a status line that tells "refused" from "retrying".

## Links

- Added on 2026-10-13 for the client session store ([#21](https://github.com/fabogit/battleship/issues/21)).
- Spec: [Client: Socket service](../client.md#socket-service) · [Client: Routes & lobby flow](../client.md#routes--lobby-flow) · [Server: Sessions & reconnection](../server.md#sessions--reconnection)
- Related: [ADR-0014](0014-duplicate-sessions.md) (latest connection wins) · [ADR-0035](0035-command-acks.md) (command acks) · [ADR-0045](0045-socket-seat-binding.md) (seat binding) · [ADR-0061](0061-handshake-checks.md) (handshake checks) · [ADR-0063](0063-session-rebinding.md) (session rebinding) · [ADR-0069](0069-session-storage-layout.md) (session storage layout)
- Issues: [#21](https://github.com/fabogit/battleship/issues/21) · [#52](https://github.com/fabogit/battleship/issues/52) (M1 review, F1) · [#23](https://github.com/fabogit/battleship/issues/23) (disconnections) · [#24](https://github.com/fabogit/battleship/issues/24) (TTLs) · [#25](https://github.com/fabogit/battleship/issues/25) (connection-state UX)
