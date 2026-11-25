---
status: accepted
date: 2026-11-22
---

# ADR-0124: A rematch needs both seats connected

A rematch resolves only when both seats have chosen to play again while both are connected. Decision 2 of the [M4 decisions on #36](https://github.com/fabogit/battleship/issues/36).

- **One resolution:** `resolveRematch` in `room.ts`, a pure function. It runs after every accepted choice (`recordRematchChoice`) and after a seat's return (`reconnectSeat`).
  - It returns the same room while a choice is missing or a seat is away.
  - Both `SAME_RULES` start `PLACEMENT`. Any `CHANGE_RULES` opens `RULES_NEGOTIATION` ([ADR-0012](0012-rematch.md)).
- **A seat that drops keeps its choice.** When it comes back with both choices made, the return resolves the rematch. The new phase's deadline counts from the return. The socket layer logs "Room phase changed" with the "Seat reconnected" line.
- **The connected seat may still change its choice while the other is away** ([ADR-0123](0123-rematch-choices-and-leave.md)). The resolution reads the choices as they are at the return.
- **No forfeit clock in the new phase:** seat presence carries over into the rematch as it does between every other phase. Since both seats are connected when the rematch resolves, `disconnectedAt` is `null` for both, so nothing is cleared on the way out of `GAME_OVER`.
  - A seat that dropped during the match and came back before game over has `null` already.
  - A seat that dropped at game over has to come back first, and its return clears the drop time.
  - Tests pin this: a resolution on return leaves no forfeit pending, and the old drop's deadline passes without effect.
- **Without a resolution** within `GAME_OVER_TTL_MS` of the end of the match, the room expires as before. Choices do not keep it open.

## Considered options

- **Resolving with a seat away, its forfeit clock carried into placement:** the old drop time would forfeit the seat inside placement, which [ADR-0090](0090-placement-timer.md) rules out for a player who dropped during it. A fresh clock from the resolution would instead keep an absent player's room open for another `DISCONNECT_FORFEIT_MS`.
- **Dropping a seat's choice when it disconnects:** a player whose network blinks would have to choose again, and the opponent would see their choice come and go.
- **Clearing `disconnectedAt` explicitly on leaving `GAME_OVER`:** it always holds `null` there already. Clearing it would be code that no test can tell apart from no code.

## Consequences

- The open risk "A rematch and the forfeit bound" ([Roadmap: Open risks](../roadmap.md#open-risks)) is resolved. A rematch never leaves `GAME_OVER` with a seat away. A seat freed by `LEAVE` keeps the other player's forfeit clock, so `DISCONNECT_FORFEIT_MS + GAME_OVER_TTL_MS` still bounds a room nobody sits in ([ADR-0073](0073-room-lifecycle-with-forfeits.md)).
- [ADR-0116](0116-surrender-keeps-the-seat.md)'s concern, a surrenderer who left the page but still counts as connected, is handled on the client: leaving the page after a guard-surrender sends `LEAVE_ROOM` too ([ADR-0126](0126-leaving-the-page-at-game-over.md)). A client that skips it keeps a seat that looks connected and never chooses, so the room waits for the game-over TTL.

## Links

- Added on 2026-11-22 for the rematch flow ([#36](https://github.com/fabogit/battleship/issues/36)), from the M4 decisions on the issue.
- Spec: [Server: Game over & rematch](../server.md#game-over--rematch) · [Server: Seat presence](../server.md#seat-presence)
- Related: [ADR-0072](0072-seat-presence.md) (seat presence) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (the forfeit bound) · [ADR-0090](0090-placement-timer.md) (placement timer) · [ADR-0116](0116-surrender-keeps-the-seat.md) · [ADR-0123](0123-rematch-choices-and-leave.md) · [ADR-0125](0125-what-a-rematch-starts-from.md)
- Issues: [#36](https://github.com/fabogit/battleship/issues/36)
