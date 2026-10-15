---
status: accepted
date: 2026-10-15
---

# ADR-0072: Seat presence and disconnect forfeit

A seat is **connected** while at least one socket is bound to it and sits in the room's Socket.io room; it is **away** from the moment its last socket leaves, whether the socket disconnected or moved to another room with `CREATE_ROOM` or `JOIN_ROOM`. Room logic stays free of sockets ([ADR-0037](0037-room-transition-shape.md)): every room stores `disconnectedAt`, per seat, the time the seat went away or `null`, and the pure transitions in `room/presence.ts` (`disconnectSeat`, `reconnectSeat`, `forfeitSeat`, `leaveRoom`) change it. The socket layer (`room-handlers`) counts the sockets of each seat after every change to them (a bind, a move, a disconnection, a session resumed at the handshake) and reports the seats whose presence changed to `RoomManager.setPresence`; when one did, every socket of the room gets `STATE`, so the opponent sees `isConnected` and `forfeitRemainingMs` both when a seat drops and when it comes back. Reconnecting through the handshake session ([ADR-0063](0063-session-rebinding.md)) is what brings a seat back.

The forfeit clock runs `DISCONNECT_FORFEIT_MS` from `disconnectedAt`, in every phase but `GAME_OVER`. It is one `DISCONNECT_FORFEIT` room timer ([ADR-0065](0065-clock-and-room-timers.md)) set to the earliest deadline of the two seats, `P1` first on a tie, and reviewed with the room's other timers. When it fires, the seat is freed before the match ([ADR-0073](0073-room-lifecycle-with-forfeits.md)), and during it the opponent wins with `DISCONNECT_FORFEIT`, whether or not the opponent is connected. A seat that comes back in time stops its clock; its deadline is gone with `disconnectedAt`.

A socket replaced by a newer one (`SESSION_REPLACED`, then a server disconnect) is not its seat dropping. The handshake joins the new socket to the room before it disconnects the old ones, so when the old socket's `disconnect` runs, the seat still has a socket. For the same reason the `STATE` of a resumed session moved from the `handshake` plugin to `room-handlers`, whose `connection` listener runs after it: a seat that comes back sends `STATE` to the whole room, and a seat that never dropped (a zombie replaced) sends it only to the new socket. Each socket gets exactly one `STATE` either way.

## Considered options

- **Presence kept in the socket layer only, passed to the projection:** no new field in the room state, but the forfeit outcome (a freed seat, a lost match) and the pause are room transitions, and the projection would need a second input. Stored in the room, presence is tested like any other transition, with times passed in.
- **`isConnected` and a forfeit deadline per player:** two fields that must agree. `disconnectedAt` alone gives both, and keeps the rule "counted from the moment of disconnection" in one place.
- **One timer kind per seat:** two kinds for one rule. The earliest deadline of the room is enough: when it fires, the review schedules the next one.
- **Disconnecting the old socket first, then joining the new one (the order of #22):** the old socket's `disconnect` would find the seat empty, pause the match and tell the opponent, and the new socket would bring it straight back. The opponent would see a drop that did not happen.
- **Moving to another room as `LEAVE_ROOM`:** the client still holds the old room's session and may go back to it, as two tabs on two rooms do. The seat waits for it like after a disconnection; `LEAVE_ROOM` is the explicit way out.

## Consequences

- The opponent of a seat that drops or comes back gets `STATE`; until #23 it got nothing ([ADR-0063](0063-session-rebinding.md)).
- In `GAME_OVER` presence is still shown (`isConnected`), but nothing is forfeited: `forfeitRemainingMs` is `null`, and the room lives by `GAME_OVER_TTL_MS`.
- A seat freed by a forfeit or by `LEAVE_ROOM` takes its secret with it: a later handshake with that session is `SESSION_INVALID`.
- Logged at `info`: "Seat disconnected", "Seat reconnected", "Seat forfeited", "Seat left" ([Server: Logging](../server.md#logging)).

## Links

- Added on 2026-10-15 for disconnection rules ([#23](https://github.com/fabogit/battleship/issues/23)).
- Spec: [Server: Seat presence](../server.md#seat-presence) · [Server: Disconnection & pause](../server.md#disconnection--pause-in_progress) · [Server: Disconnection in other phases](../server.md#disconnection-in-other-phases)
- Implements: [ADR-0008](0008-disconnection-in-battle.md) (disconnection in battle)
- Amends: [ADR-0063](0063-session-rebinding.md) (the opponent learns of the return; the rebound socket's `STATE` comes from `room-handlers`) · [ADR-0065](0065-clock-and-room-timers.md) (the forfeit is a room timer)
- Related: [ADR-0014](0014-duplicate-sessions.md) (latest connection wins) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (room lifecycle) · [ADR-0074](0074-pause.md) (pause)
- Issues: [#23](https://github.com/fabogit/battleship/issues/23) · [#22](https://github.com/fabogit/battleship/issues/22) · [#25](https://github.com/fabogit/battleship/issues/25) (connection-state UI)
