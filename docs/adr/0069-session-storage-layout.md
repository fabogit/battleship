---
status: accepted
date: 2026-10-13
---

# ADR-0069: Session storage layout

`SessionStore` keeps each room's credentials in `localStorage`, shared by the browser's tabs, and the room the tab is in now (the current room) in `sessionStorage`, which belongs to one tab and survives its reloads. The handshake sends the current room's credentials. Details:

- **Credentials:** one entry per room, under `battleship:session:<roomId>`, holding the JSON `{ roomId, playerSecret, expiresAt }`. `expiresAt` is set when the entry is saved, `SESSION_STORE_TTL_MS` (24 h) later, and is not extended when the entry is used ([ADR-0013](0013-session-persistence.md)).
- **Current room:** the room id under `battleship:current-room`. An accepted `CREATE_ROOM` or `JOIN_ROOM` sets it; a refused session clears it ([ADR-0070](0070-client-handshake-refusals.md)).
- **New tab:** a new tab starts in no room. When it opens `/r/<roomId>` and credentials are stored for that room, the room page makes it the current room (`RoomEntryService.reopen`). If the socket is already open or opening, it reconnects, so the handshake sends the credentials. A tab that is already in a room keeps it, and the page shows "You left this room" for any other stored room, before and after a reload (#52 F1).
- **Untrusted input:** both storages are read once, when the app starts. An entry is kept only if it is JSON with exactly `roomId`, `playerSecret` and `expiresAt`, if its credentials pass core's `parseSessionCredentials`, if its room id matches its key, and if `expiresAt` is a number in (now, now + `SESSION_STORE_TTL_MS`]. Any other entry is removed, and so is a current room that fails `isRoomId`. Every read checks the expiry again, so the handshake never sends expired credentials.
- **Blocked storage:** when storage throws on access, on a read or on a write (site data blocked, quota full), the store keeps working in memory for the tab, as before #21.

Details in [Client: Routes & lobby flow](../client.md#routes--lobby-flow) and [Server: Sessions & reconnection](../server.md#sessions--reconnection) (#21).

## Considered options

- **The current room in `localStorage`, next to the credentials:** every tab would share it. When a tab reloaded, it would send the room that another tab entered last. The server would then move that seat to the reloaded tab and send `SESSION_REPLACED` to the other one, while the reloaded tab showed "You left this room" for its own room.
- **The room in the address as the current room, with nothing stored:** the shell opens the socket before any route is known, and the home page has no room. Back to a room the tab has left would also rebind that seat without a word, which undoes the "You left this room" of #52 F1.
- **An expiry extended on every use:** a match lasts minutes, and the server forgets rooms long before 24 h (#24). The server has the last word anyway (`SESSION_INVALID`).
- **Syncing tabs through `storage` events:** each tab keeps its own current room on purpose. Credentials saved by another tab are read at the next start, which is when a new tab needs them.
- **An injected storage token:** `SessionStore` already is the abstraction that ADR-0013 asks for, and a native app would replace the class. The specs use jsdom's storage, which a setup file empties before each test.

## Consequences

- A new tab that opens a room's link while another tab is still playing that room takes the seat over: the latest connection wins ([ADR-0014](0014-duplicate-sessions.md)), and the other tab receives `SESSION_REPLACED` (its screen is #25).
- A tab that is in one room and opens the link of another stored room shows "You left this room". There is no "rejoin" action yet.
- The entries of finished rooms stay until they expire or are refused. Each one is a few dozen bytes.
- Client specs start with empty web storage: `src/testing/setup.ts`, listed under `setupFiles` in `angular.json` ([Development: Local tooling](../development.md#local-tooling)).

## Links

- Added on 2026-10-13 for the client session store ([#21](https://github.com/fabogit/battleship/issues/21)).
- Spec: [Client: Routes & lobby flow](../client.md#routes--lobby-flow) · [Server: Sessions & reconnection](../server.md#sessions--reconnection)
- Related: [ADR-0013](0013-session-persistence.md) (session persistence) · [ADR-0014](0014-duplicate-sessions.md) (latest connection wins) · [ADR-0045](0045-socket-seat-binding.md) (seat binding) · [ADR-0049](0049-room-route.md) (room route) · [ADR-0063](0063-session-rebinding.md) (session rebinding) · [ADR-0070](0070-client-handshake-refusals.md) (handshake refusals and resync)
- Issues: [#21](https://github.com/fabogit/battleship/issues/21) · [#52](https://github.com/fabogit/battleship/issues/52) (M1 review, F1) · [#25](https://github.com/fabogit/battleship/issues/25) (connection-state UX)
