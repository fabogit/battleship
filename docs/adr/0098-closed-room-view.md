---
status: accepted
date: 2026-10-31
---

# ADR-0098: The closed-room view

On `ROOM_CLOSED` ([ADR-0097](0097-room-closed-notice.md)), `RoomEntryService` drops the room's credentials through `SessionStore.close`, which also remembers the reason for the tab (`closure`), and `GameStateService` forgets the room's snapshot, as after "Leave room" ([ADR-0078](0078-leaving-before-the-match.md)). The room page then shows the view `closed`, before any other view of that room: the heading "This room has closed", a sentence for the reason and a "Create a new room" link home.

| Reason          | Sentence                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WAITING_TTL`   | "Nobody joined within 10 minutes, so the room closed to free its place on the server. Create a new room and send the new link to your opponent."                                                |
| `GAME_OVER_TTL` | "The match was over, and a room closes 2 minutes after its match ends."                                                                                                                         |
| `SERVER_ERROR`  | "The server ran into an error in this room and could not go on with it, so the match was lost. Other rooms were not affected. Create a new room and send the new link to your opponent." (#123) |

The minutes come from `WAITING_TTL_MS` and `GAME_OVER_TTL_MS`; a server error has none. The waiting screen says beforehand that the room closes if nobody joins within 10 minutes ([ADR-0096](0096-waiting-ttl.md)). Details in [Client: Connection states](../client.md#connection-states) (#113).

## Considered options

- **A banner over the view the player was on**, like the opponent presence banner: the waiting screen would still offer a link nobody can use, and at game over a rematch choice the server would refuse.
- **The refused-seat view `seat-lost` with a new `SEAT_LOSSES` value:** that view guesses the cause from clues ([ADR-0076](0076-refused-seat-explanation.md)) and may offer the join form; here the server states the cause, and the room is gone, so there is nothing to join.
- **Going home with a message:** the room's address would then show the join form for a room that no longer exists. Staying on the room page keeps the explanation on the address it belongs to, as the other room views do.

## Consequences

- `closure` lives in memory, like the refusals: after a reload the tab holds no seat in the room, so the page shows the join form, and joining answers "Room not found".
- A `ROOM_CLOSED` for another room than the one shown drops that room's credentials only.
- `ROOM_VIEWS` gains `closed` (pinned by its spec, ADR-0043).

## Links

- Added on 2026-10-31 for room place limits ([#113](https://github.com/fabogit/battleship/issues/113)).
- Amended on 2026-10-31 ([#123](https://github.com/fabogit/battleship/issues/123)): the reason `SERVER_ERROR` has its sentence ([ADR-0105](0105-server-error-on-the-wire.md)).
- Spec: [Client: Connection states](../client.md#connection-states) · [Client: Routes & lobby flow](../client.md#routes--lobby-flow)
- Related: [ADR-0097](0097-room-closed-notice.md) (the notice) · [ADR-0096](0096-waiting-ttl.md) (waiting TTL) · [ADR-0076](0076-refused-seat-explanation.md) (refused seat) · [ADR-0078](0078-leaving-before-the-match.md) (leaving before the match)
- Issues: [#113](https://github.com/fabogit/battleship/issues/113) · [#123](https://github.com/fabogit/battleship/issues/123)
