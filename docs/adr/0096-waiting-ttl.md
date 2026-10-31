---
status: accepted
date: 2026-10-31
---

# ADR-0096: Waiting TTL

A room in `WAITING_FOR_OPPONENT` closes `WAITING_TTL_MS` (10 minutes, a core constant) after it entered that phase, whether its player is connected or not. It is one `WAITING_FOR_OPPONENT` room timer ([ADR-0065](0065-clock-and-room-timers.md)), handled like the game-over TTL: `room-handlers` starts it when it reviews a room in that phase without one, and stops it when the room is in any other phase. The room enters the phase at creation and when a seat is freed before the match ([ADR-0073](0073-room-lifecycle-with-forfeits.md)), so each wait counts from its own start; a join ends the wait and stops the timer, and a seat freed later starts a new one. A reconnection does not restart it. When it fires, the room is removed, logged as "Room expired" with the `reason` `WAITING_FOR_OPPONENT`, and a player still connected is told with `ROOM_CLOSED` ([ADR-0097](0097-room-closed-notice.md)). The waiting screen says how long the room waits.

The value is a trade-off between two needs:

- **Long enough to share a link and wait for a friend.** The creator sends the link through a chat app, and the friend may need a few minutes to see it, open it and pick a nickname. Ten minutes covers that, and the waiting screen says so. A creator who still waits after it creates a new room in a few seconds.
- **Short enough to bound the hold.** Before this, a waiting room whose creator stayed connected never closed: `MAX_ROOMS` open sockets held every place for as long as they stayed open (#53, F5). Now each holds its place for at most 10 minutes, and has to create its room again to keep it.

Details in [Server: Room lifecycle](../server.md#room-lifecycle) (#113).

## Considered options

- **Shorter (2 to 5 minutes)**, like the other TTLs: the hold would be shorter, but a friend who answers the link a few minutes later would find "Room not found", and the creator would have to share a new link. Unlike `GAME_OVER_TTL_MS`, the wait is a normal part of the game, not its end.
- **Longer (30 minutes or more):** a waiting player keeps the Render instance awake anyway, through the open socket, so nothing ties the value to the 15-minute spin-down; but a client opening `MAX_ROOMS` sockets would hold every place three times as long between refills.
- **The deadline stored in the room** (`WaitingRoom.expiresAt`, like `PlacementRoom.deadline`): the snapshot could then show a countdown, but `createRoom` and the presence transitions that free a seat take no time, and nobody asked for a countdown on the waiting screen. The timer reviewed from the phase, as the game-over TTL is, needs no change to room logic; a countdown can store the deadline later.
- **Counting from the creation of the room only:** a player left alone by a freed seat after nine minutes would have one minute left to find a new opponent.
- **A per-address cap instead:** out while `TRUST_PROXY_HOPS` is `1` on Render, where every polling client logs Render's internal address and would share one cap ([ADR-0081](0081-one-proxy-hop-on-render.md)).

## Consequences

- The room timers are now `PLACEMENT`, `DISCONNECT_FORFEIT`, `WAITING_FOR_OPPONENT` and `GAME_OVER`. Two phases still have no timer while both players stay connected: `RULES_NEGOTIATION`, and `IN_PROGRESS` until the turn timer and its AFK forfeits land (#30). A client with two sockets per room can hold a place there for as long as both stay open ([Roadmap: Open risks](../roadmap.md#open-risks)).
- A creator who is away has two clocks: the forfeit and the waiting TTL. The earlier one closes the room.
- Many sockets can still hold a room each: they must create it again every 10 minutes, which a script can do. A cap per client waits for a hop count per transport ([#53 addendum](https://github.com/fabogit/battleship/issues/53#issuecomment-6329698267)); see [Roadmap: Open risks](../roadmap.md#open-risks).
- `CREATE_ROOM` and `JOIN_ROOM` now review the room's timers, as every other accepted command does.

## Links

- Added on 2026-10-31 for room place limits ([#113](https://github.com/fabogit/battleship/issues/113)).
- Spec: [Server: Room lifecycle](../server.md#room-lifecycle) · [Server: Hardening](../server.md#hardening) · [Domain: Constants](../domain.md#constants)
- Amends: [ADR-0065](0065-clock-and-room-timers.md) (a `WAITING_FOR_OPPONENT` kind; `CREATE_ROOM` and `JOIN_ROOM` review the timers) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (a waiting room closes without a forfeit too)
- Related: [ADR-0095](0095-moving-on-frees-a-lone-waiting-seat.md) (one socket, one waiting room) · [ADR-0097](0097-room-closed-notice.md) (the notice) · [ADR-0066](0066-rate-limit-and-message-size.md) (per-socket rate limit) · [ADR-0081](0081-one-proxy-hop-on-render.md) (why no per-address cap)
- Issues: [#113](https://github.com/fabogit/battleship/issues/113) · [#53](https://github.com/fabogit/battleship/issues/53) (F5) · [#28](https://github.com/fabogit/battleship/issues/28) · [#30](https://github.com/fabogit/battleship/issues/30)
