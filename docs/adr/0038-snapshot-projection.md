---
status: accepted
date: 2026-10-07
---

# ADR-0038: Snapshot projection

The `STATE` snapshot is built on the server by `projectSnapshot(state, seat, now)` in `packages/server/src/room/snapshot.ts`, a pure function of the room, the receiver and the time. It is the only place that decides what a player sees: the receiver's own fleet, the shots on both boards (each `sunkShip` included), and the opponent's fleet only in `GAME_OVER`; player secrets are never copied. The room state keeps everything; fog-of-war is applied once, on the way out, instead of being kept as a separate per-player state. Timers are turned from stored timestamps into remaining milliseconds here ([ADR-0036](0036-countdown-resync.md)). Details in [Server: Room logic](../server.md#room-logic) (#14).

## Considered options

* **Projection in core:** the client never projects, and the function needs the server's `RoomState`, secrets included, which core should not declare. Core keeps the snapshot types (the contract); the server keeps the function that fills them.
* **Projection inside the transition** (each result carrying both snapshots): every command would build two snapshots even when the caller sends none, and `now` at sending time could differ from the transition's.
* **Separate per-player state kept in sync** (a "tracking board" per seat): two copies of the same shots that could drift; the opponent's board already holds exactly the receiver's outgoing shots ([ADR-0034](0034-shot-history.md)).
* **Filtering by deleting fields from a full copy:** a field added later would leak by default. Building each snapshot field by field means a new field is hidden until someone writes it in.

## Consequences

* Fields whose feature is not built yet hold their neutral value: `isConnected: true` and `forfeitRemainingMs: null` (#23), `startCountdownMs: null` (#28), `turnRemainingMs: null` and `afkCount` zero (#30), `isPaused: false` (#23), `rematch` choices `null` (#36). `hasConfirmedRules` is derived from the phase until #26 stores it: both `true` from `PLACEMENT` on.
* The snapshot shares the room's arrays instead of copying them; nothing mutates either, and Socket.io serializes it on send.
* Tests check fog-of-war on every turn of a seeded match, for both seats.

## Links

* Added on 2026-10-07 for the room logic ([#14](https://github.com/fabogit/battleship/issues/14)).
* Spec: [Protocol: Snapshot](../protocol.md#snapshot) · [Server: Game over & rematch](../server.md#game-over--rematch)
* Related: [ADR-0015](0015-protocol-shape.md) (snapshot as the client's source of truth) · [ADR-0034](0034-shot-history.md) (shot history) · [ADR-0036](0036-countdown-resync.md) (remaining milliseconds) · [ADR-0037](0037-room-transition-shape.md) (room transition shape)
* Issues: [#14](https://github.com/fabogit/battleship/issues/14)
