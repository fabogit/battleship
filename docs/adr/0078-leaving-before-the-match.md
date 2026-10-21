---
status: accepted
date: 2026-10-15
---

# ADR-0078: Leaving before the match

The room page offers "Leave room" under the waiting screen and placement, the phases where the server accepts `LEAVE_ROOM` ([Server: Leaving](../server.md#leaving)). `RoomEntryService.leave` sends it; once accepted, `SessionStore.forget` drops the room's credentials (and the tab's current room) and `GameStateService` forgets the snapshot, since the server sends the leaver nothing more; then the page goes home. Back to the room link shows the join form, so the player can take the seat again while it is free. A refusal stays on the page with its message ("The match has started, so the room can no longer be left." for `NOT_ALLOWED`); no reply (`NO_ACK`) reconnects, so the handshake tells whether the seat is still held, as after a failed `CREATE_ROOM` or `JOIN_ROOM` ([ADR-0070](0070-client-handshake-refusals.md)). Details in [Client: Routes & lobby flow](../client.md#routes--lobby-flow) (#25).

## Considered options

- **A confirmation step:** leaving before the match loses nothing that cannot be redone: the fleet is a draft, and the room link takes the free seat again. A second tap would slow down the common case to protect a rare one.
- **Offering it during the match and at game over:** the server answers `NOT_ALLOWED` there until surrender (#35) and the rematch choice (#36) land; those issues add their own actions.
- **Dropping the credentials before the ack:** a refused or lost `LEAVE_ROOM` would leave the player seated on the server with no way back from this tab.

## Consequences

- The opponent of a player who leaves goes back to the waiting screen and reads "Grace left the room, so their seat is free again." ([ADR-0077](0077-opponent-presence-banner.md)).
- A tab that leaves a room does not show "You left this room" for it: that view is for a room left by entering another one ([ADR-0069](0069-session-storage-layout.md)).

## Links

- Added on 2026-10-15 for the connection-state UX ([#25](https://github.com/fabogit/battleship/issues/25)).
- Spec: [Client: Routes & lobby flow](../client.md#routes--lobby-flow) · [Server: Leaving](../server.md#leaving)
- Related: [ADR-0069](0069-session-storage-layout.md) (session storage layout) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (room lifecycle) · [ADR-0077](0077-opponent-presence-banner.md) (presence banner)
- Issues: [#25](https://github.com/fabogit/battleship/issues/25) · [#35](https://github.com/fabogit/battleship/issues/35) (surrender) · [#36](https://github.com/fabogit/battleship/issues/36) (rematch)
