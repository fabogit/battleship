---
status: accepted
date: 2026-10-15
---

# ADR-0073: Room lifecycle with forfeits

With the disconnect forfeit in place ([ADR-0072](0072-seat-presence.md)), seats are freed by their own clocks, and rooms follow:

- **A freed seat before the match:** a forfeit or `LEAVE_ROOM` in `WAITING_FOR_OPPONENT` or `PLACEMENT` removes the player. The other player, if any, goes back to `WAITING_FOR_OPPONENT` **in the seat they had**, with the rules kept and the fleets cleared; their own forfeit clock keeps running if they are away too. The next `JOIN_ROOM` takes the free seat, which is `P1` when the creator was the one who left.
- **A room with no player left closes at once**, logged as "Room closed" with what freed the last seat (`LEAVE_ROOM` or `DISCONNECT_FORFEIT`).
- **The empty-room TTL is gone** (`EMPTY_ROOM_TTL_MS` and its `EMPTY_ROOM` timer, [ADR-0065](0065-clock-and-room-timers.md)). A room nobody sits in has every seat away, so its forfeits resolve it: before the match within `DISCONNECT_FORFEIT_MS` of the last drop (the room closes), during the match within `DISCONNECT_FORFEIT_MS` of the first drop (the match ends), then `GAME_OVER_TTL_MS` later (the room expires). The TTL, 300 s from the last drop, could never fire first: 180 s + 120 s ≤ 300 s.
- **Both players gone mid-match:** each seat has its own clock, so the first to have dropped forfeits and the other wins, connected or not; their seat stays theirs until the game-over TTL, so they can come back to see the result.
- **`LEAVE_ROOM` once the match has started** is `NOT_ALLOWED` until its own rules land: in `IN_PROGRESS` it is a surrender (#35), in `GAME_OVER` a rematch choice (#36).

## Considered options

- **Keeping `EMPTY_ROOM` as a backstop:** with the current constants it is unreachable, so no test can show it working, and it would read as a second rule for the same room. If a later phase can leave a room without players' clocks (a rematch, #36), the TTL comes back with a test that reaches it.
- **Moving the player left behind to `P1`:** keeps "the creator is `P1`" true, but changes a seated player's seat mid-room: their socket binding and their `me.seat` would change under them. A stable seat costs only the joiner landing in `P1`, which the snapshot already states.
- **`ABANDONED` when the second player is also away at the first forfeit:** mirrors the AFK rule, but would void the reservation of a seat still within its own `DISCONNECT_FORFEIT_MS`, and a brief drop right before the other's deadline would cost a win.

## Consequences

- `MAX_ROOMS` places are freed by forfeits and `LEAVE_ROOM` as well as by the game-over TTL. A `CREATE_ROOM` smoke test followed by `LEAVE_ROOM` leaves nothing behind.
- `DISCONNECT_FORFEIT_MS + GAME_OVER_TTL_MS` is the longest a room nobody sits in stays open; a core test keeps it below Render's 15-minute spin-down.
- "`P1` for the creator, `P2` for the joiner" holds until a creator leaves before the match.

## Links

- Added on 2026-10-15 for disconnection rules ([#23](https://github.com/fabogit/battleship/issues/23)).
- Spec: [Server: Room lifecycle](../server.md#room-lifecycle) · [Server: Leaving](../server.md#leaving) · [Domain: Constants](../domain.md#constants)
- Amends: [ADR-0065](0065-clock-and-room-timers.md) (no `EMPTY_ROOM` timer) · [ADR-0039](0039-room-registry.md) (rooms also leave the registry when nobody is left in them)
- Related: [ADR-0072](0072-seat-presence.md) (seat presence)
- Issues: [#23](https://github.com/fabogit/battleship/issues/23) · [#24](https://github.com/fabogit/battleship/issues/24) (TTLs) · [#35](https://github.com/fabogit/battleship/issues/35) · [#36](https://github.com/fabogit/battleship/issues/36)
