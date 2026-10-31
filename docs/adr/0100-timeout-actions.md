---
status: accepted
date: 2026-10-31
---

# ADR-0100: Timeout actions

When a turn's timer runs out ([ADR-0099](0099-turn-timer.md)), `timeOutTurn` applies the rules' `timeoutAction` for the seat whose turn it was:

- **`AUTO_RANDOM_SHOT`** fires the targets of core's `autoShotTargets(battle, draft, count, rng)`, with `count` from `shotsAllowed`. It keeps the targets of the stored draft that are still valid (on the board, never shot, not repeated), in draft order and up to `count`. The rest comes from `randomTargets`, which now takes the kept cells as `excluded`. The `Rng` is the server's injected one, the source of room ids, completed fleets and dice ([ADR-0091](0091-fleet-completion-at-the-deadline.md), [ADR-0092](0092-dice-roll-at-match-start.md)). The targets go through `resolveTurn` like a `FIRE`'s. So the shot can sink the last ship and end the match with `FLEET_DESTROYED`, won by the seat that timed out, and with extra turn on hit a hit keeps the turn.
- **`PASS_TURN`** discards the draft and hands the turn to the opponent; no shot is fired.

Either way the next turn starts at once with the whole limit, and the seat's AFK count goes up by one ([ADR-0101](0101-afk-forfeit.md)).

What the clients get follows the order after a `FIRE` ([ADR-0047](0047-reply-order.md)): an auto shot sends `SHOT_RESOLVED { shooter, results }` to the room's sockets, then `STATE` to each seated socket; a passed turn sends `STATE` only. Nothing tells a client that the shot was automatic: `afkCount` in the snapshot goes up, which is what the AFK warning of #31 can read. The server logs "Turn timed out" at `info` with the room, the seat, the `action` applied and the seat's `afkCount`. A timeout happens at most once per turn, and a turn lasts 15 seconds at least, so a room writes no more than one such line every 15 seconds, comparable to the other room lines.

## Considered options

- **Keeping the draft in `room.ts` and calling `randomTargets` for the missing count:** `randomTargets` would draw cells already in the draft. The filter belongs next to `validateTargets`, and core can test it with a count above one, which the server cannot hold until salvo (#32).
- **Firing the whole draft as it is:** the stored draft is always valid today, since `UPDATE_TARGETS` refuses anything else and the draft is cleared at every turn. Filtering costs nothing, and keeps a later rule (salvo's changing allowance) from making the auto shot throw.
- **A flag on `SHOT_RESOLVED` for an automatic shot:** a protocol change for a hint the client can already infer from `afkCount`. If #31 wants to word the shot differently, it can propose the field then.
- **Logging timeouts at `debug`:** a timeout changes the room like a phase change does, and is what explains an `AFK_FORFEIT` in the logs.

## Consequences

- The protocol does not change: `SHOT_RESOLVED`, `STATE` and `TIMEOUT_ACTIONS` are already on the wire, and the client handles an auto shot like any other (it reads "You fired at …" for the seat that timed out until #31 words it).
- `timeOutTurn` throws if `resolveTurn` refuses the auto shot, which `autoShotTargets` rules out. The `TURN` task runs inside `RoomTimers`' containment, so such a throw closes the room with the `ROOM_CLOSED` reason `SERVER_ERROR` and leaves the process running ([ADR-0104](0104-room-failure-containment.md)).
- A test works out an auto shot from the registry's seed and the draws before it: the room id, the dice, and any fleet completed at the deadline.

## Links

- Added on 2026-10-31 for timeout actions ([#30](https://github.com/fabogit/battleship/issues/30)).
- Spec: [Server: Turns](../server.md#turns) · [Domain: Shot engine](../domain.md#shot-engine) · [Server: Logging](../server.md#logging)
- Related: [ADR-0099](0099-turn-timer.md) (turn timer) · [ADR-0101](0101-afk-forfeit.md) (AFK) · [ADR-0033](0033-turn-resolution.md) (turn resolution) · [ADR-0030](0030-random-number-generation.md) (randomness) · [ADR-0047](0047-reply-order.md) (reply order) · [ADR-0104](0104-room-failure-containment.md) (failure containment)
- Issues: [#30](https://github.com/fabogit/battleship/issues/30) · [#31](https://github.com/fabogit/battleship/issues/31) (AFK warning) · [#32](https://github.com/fabogit/battleship/issues/32) (salvo)
