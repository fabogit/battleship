---
status: accepted
date: 2026-10-15
---

# ADR-0076: Explaining a refused seat

`SESSION_INVALID` says only that the room is gone or that no seat holds the secret ([ADR-0063](0063-session-rebinding.md)). The room page tells the player more from three clues, without a protocol change:

- **When the seat was taken:** `SessionStore.refuse` remembers it (`RefusedSeat.seatTakenAt`), read from the stored entry's `expiresAt` minus `SESSION_STORE_TTL_MS` ([ADR-0069](0069-session-storage-layout.md)).
- **When the server started:** `ServerWakeService.startedAt()` asks `GET /health` once and returns `Date.now()` minus its `uptime`. Both times are on the device's clock, so the offset between the device and the server does not matter.
- **Whether this tab saw the match end:** the room's latest snapshot in `GameStateService` was `GAME_OVER`.

`classifySeatLoss` turns them into one of `SEAT_LOSSES`, and the view `seat-lost` words it:

| Seat loss   | When                                                                      | Heading                          | Then                                    |
| ----------- | ------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- |
| `restarted` | The server started after the seat was taken: rooms live in its memory     | "The server restarted"           | "Create a new room"                     |
| `closed`    | Otherwise, after a match this tab saw end: the room expired after its TTL | "This room has closed"           | "Create a new room"                     |
| `given-up`  | Otherwise, the server has run since the seat was taken: forfeit or leave  | "You lost your seat"             | The join form, then "Create a new room" |
| `unknown`   | `/health` did not answer (or has not yet): every cause is listed          | "You are no longer in this room" | The join form, then "Create a new room" |

The minutes in the sentences come from `DISCONNECT_FORFEIT_MS` and `GAME_OVER_TTL_MS`. The join form takes the free seat if the room still waits for a player (a seat freed before the match, [ADR-0073](0073-room-lifecycle-with-forfeits.md)), possibly `P1`; a room that is gone answers `ROOM_NOT_FOUND` and the page shows "Room not found". Joining first forgets the room's snapshot from the refused seat, so the old board never shows under the new seat. Details in [Client: Connection states](../client.md#connection-states) (#25).

## Considered options

- **A reason in the refusal (`SESSION_INVALID` with "forfeited", "left", "unknown room"):** the most precise, but a protocol change, and the server would have to remember freed secrets; a restarted server knows nothing of the old rooms anyway, which is the case that matters most on Render.
- **Remembering when the tab was last connected, and comparing it with `DISCONNECT_FORFEIT_MS`:** a phone that suspends the page does not run the client's timers, so the client cannot tell how long the server saw it away; the server's own start time is a fact.
- **Probing the room with `JOIN_ROOM`:** it takes the seat as a side effect. The page offers the join form instead, and the player decides.
- **One sentence for every cause:** what #21 had ("Room not found"). The player who was forfeited in placement could not tell that the room was still waiting for them, and a restart read like a mistyped link.

## Consequences

- A refused seat costs one extra `/health` request; while it is on its way the page shows the `unknown` wording, which covers every cause.
- `unknown` and `given-up` offer the join form even when the room has closed: the server's answer then shows "Room not found".
- `SEAT_LOSSES` and the view `seat-lost` are new client values (pinned by their specs, ADR-0043).

## Links

- Added on 2026-10-15 for the connection-state UX ([#25](https://github.com/fabogit/battleship/issues/25)).
- Spec: [Client: Connection states](../client.md#connection-states) · [Client: Routes & lobby flow](../client.md#routes--lobby-flow)
- Amends: [ADR-0070](0070-client-handshake-refusals.md) (a refused seat is explained instead of "Room not found")
- Related: [ADR-0063](0063-session-rebinding.md) (session rebinding) · [ADR-0069](0069-session-storage-layout.md) (session storage layout) · [ADR-0072](0072-seat-presence.md) (disconnect forfeit) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (room lifecycle) · [ADR-0075](0075-client-connection-states.md) (connection states)
- Issues: [#25](https://github.com/fabogit/battleship/issues/25) · [#8](https://github.com/fabogit/battleship/issues/8) (`SERVER_SHUTDOWN` lost on a Render deploy)
