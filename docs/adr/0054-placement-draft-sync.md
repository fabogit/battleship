---
status: accepted
date: 2026-10-08
---

# ADR-0054: Placement draft on the client

During placement the view draws the client's own copy of the draft, not the snapshot's `myShips`. Every accepted change updates that copy at once and sends the whole draft with `UPDATE_PLACEMENT` ([ADR-0005](0005-placement-sync.md)), without waiting for the ack. A `STATE` replaces the copy with the snapshot's ships only while no update is waiting for its ack. A failed update (a refusal, `NOT_CONNECTED` or `NO_ACK`) shows its message, and once no other update is in flight the copy goes back to the latest snapshot's draft. `PlacementStore`, provided by the placement view, holds the copy. Details in [Client: Board & interaction](../client.md#board--interaction) (#19).

## Considered options

- **Drawing the snapshot only:** a ship would land only after the round trip, which feels slow on a mobile network. Worse, the reply order is ack → effects → `STATE` ([ADR-0047](0047-reply-order.md)), and a `STATE` sent for the opponent's change before the server handled the update would briefly draw the old layout.
- **Keeping the local copy and ignoring `STATE` during placement:** the snapshot is the source of truth ([ADR-0015](0015-protocol-shape.md)). Auto-completion at the deadline (#28) and a reconnection (#21) change the draft on the server, and the client has to follow.
- **Waiting for each ack before sending the next update, sending only the latest:** fewer events when taps come fast, but a second state machine to get right. The rate limit (`RATE_LIMIT_EVENTS_PER_SECOND`, 20) is far above what taps produce, and Socket.io keeps the order of commands on one connection, so the server ends on the last draft either way.

## Consequences

- No `STATE` can draw an older layout over a newer local one: every `STATE` the server sends after handling an update follows that update's ack.
- After `NO_ACK` the copy goes back to the latest snapshot, which may still lack an update the server did apply; the next `STATE` brings it.
- The view never sends a layout the core validators refuse, so `INVALID_PLACEMENT` comes only from a client that is out of step with the server.

## Links

- Added on 2026-10-08 for the placement view ([#19](https://github.com/fabogit/battleship/issues/19)).
- Spec: [Client: Board & interaction](../client.md#board--interaction)
- Related: [ADR-0005](0005-placement-sync.md) (whole draft on every change), [ADR-0035](0035-command-acks.md) (acks and transport errors), [ADR-0047](0047-reply-order.md) (reply order), [ADR-0053](0053-placement-taps.md) (the tap model)
- Issues: [#19](https://github.com/fabogit/battleship/issues/19), [#21](https://github.com/fabogit/battleship/issues/21) (session restore), [#28](https://github.com/fabogit/battleship/issues/28) (placement timer)
