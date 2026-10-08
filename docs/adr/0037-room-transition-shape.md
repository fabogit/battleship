---
status: accepted
date: 2026-10-07
---

# ADR-0037: Room transition shape

Room logic lives in `packages/server/src/room/room.ts` as one pure function, `applyCommand(state, command, now)`, that returns `{ ok: true, state, effects }` or `{ ok: false, error }`, the same discriminated shape as placement and turn resolution ([ADR-0032](0032-fleet-placement.md), [ADR-0033](0033-turn-resolution.md)). `RoomState` is a union with one variant per phase (`WaitingRoom`, `PlacementRoom`, `BattleRoom`, `GameOverRoom`), so each phase carries only its own data: fleets exist only in placement, the core `Battle` only from `IN_PROGRESS`. A command is the protocol event name, the sender's `seat` (the caller maps the socket to it) and the payload exactly as its core guard returned it (`CommandPayload<E>`), so room logic declares no payload type of its own. `STATE` is not an effect: every accepted command may change what someone sees, so the caller sends a fresh snapshot to every seated player after each one. `effects` lists only what the state cannot say, today `SHOT_RESOLVED`. A refused command carries no state at all, and nothing is mutated, so the caller keeps the room it had. Details in [Server: Room logic](../server.md#room-logic) (#14).

## Considered options

- **One record with nullable fields per phase** (`fleets: … | null`, `battle: … | null`): mirrors the snapshot, but every function would check fields its phase guarantees, and invalid mixes (a battle during placement) would type-check.
- **`STATE` as an explicit effect:** the function would have to decide when a change is visible to whom, which the projection already decides. Sending after every accepted command is simpler and costs one small message per player.
- **Returning `{ state, effects, error? }` in every case:** a caller could store the state of a refused command by mistake. With no state on refusal, keeping the old room is the only option.
- **Throwing on refused commands:** refusals are ordinary client input, as for placement and turns.
- **Generating the player secret inside room logic:** it would need a second random source in a pure function. The caller (`RoomManager`) generates it and passes it in `JOIN_ROOM`, and returns it in the ack.
- **Mutating the state in place:** cheaper, but a refused command could leave a half-applied room, and tests could not compare before and after.

## Consequences

- `now` is the only clock: deadlines are stored as epoch-ms timestamps (`PlacementRoom.deadline`) and projected as remaining time; nothing schedules them yet. Timer effects (#28, #30) and `DICE_ROLLED` (#29) will join `RoomEffect`; a random source will be passed in when a transition first needs one (#28).
- Refused `INVALID_PLACEMENT` and `INVALID_TARGETS` carry the core `violation` for the server log; it is never sent ([ADR-0032](0032-fleet-placement.md)).
- `CONFIRM_PLACEMENT` on a confirmed fleet and `UNLOCK_PLACEMENT` on a draft are accepted and return the same state: a double tap is not an error.
- `RULES_NEGOTIATION` gets its variant with #26; until then `JOIN_ROOM` goes straight to `PLACEMENT`.

## Links

- Added on 2026-10-07 for the room logic ([#14](https://github.com/fabogit/battleship/issues/14)).
- Spec: [Server: Room state machine](../server.md#room-state-machine) · [Server: Transition rules](../server.md#transition-rules) · [Server: Testability](../server.md#testability)
- Related: [ADR-0031](0031-payload-guard-strictness.md) (guards before room logic) · [ADR-0033](0033-turn-resolution.md) (turn resolution) · [ADR-0038](0038-snapshot-projection.md) (snapshot projection) · [ADR-0039](0039-room-registry.md) (room registry)
- Issues: [#14](https://github.com/fabogit/battleship/issues/14) · [#15](https://github.com/fabogit/battleship/issues/15) (socket handlers)
