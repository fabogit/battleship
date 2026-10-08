---
status: accepted
date: 2026-10-08
---

# ADR-0047: Reply order

After an accepted command, the server sends, in this order: the ack to the sender, then each effect to both players (`SHOT_RESOLVED` today), then `STATE` to each seated player. A refused command gets its ack and nothing else. Socket.io keeps the order of what one socket receives, so the shooter's client reads ack → `SHOT_RESOLVED` → `STATE`, and the opponent's `SHOT_RESOLVED` → `STATE`. Details in [Server: Socket handlers](../server.md#socket-handlers) (#15).

## Considered options

- **`STATE` before the effects:** the board would already show the outcome when `SHOT_RESOLVED` arrives to animate it, so the client would have to hold the snapshot back. With the effect first, the client animates and the next `STATE` confirms the same outcome, as the core contract describes `SHOT_RESOLVED`.
- **`STATE` before the ack:** the sender's promise would resolve after the view already changed; acking first lets the caller react to the result (for example, navigate to the room after `CREATE_ROOM`) before the snapshot that follows it.

## Consequences

- `DICE_ROLLED` (#29) is an effect too, so the dice animation will also arrive before the `STATE` that starts the match.

## Links

- Added on 2026-10-08 for the socket handlers ([#15](https://github.com/fabogit/battleship/issues/15)).
- Spec: [Server: Socket handlers](../server.md#socket-handlers) · [Protocol: Server → client](../protocol.md#server--client)
- Related: [ADR-0035](0035-command-acks.md) (command acks) · [ADR-0037](0037-room-transition-shape.md) (room transition shape)
- Issues: [#15](https://github.com/fabogit/battleship/issues/15) · [#29](https://github.com/fabogit/battleship/issues/29) (dice roll)
