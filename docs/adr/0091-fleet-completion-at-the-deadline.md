---
status: accepted
date: 2026-10-29
---

# ADR-0091: Fleet completion at the deadline

At the placement deadline ([ADR-0090](0090-placement-timer.md)) every unconfirmed fleet goes through core's `completeFleet` and is locked. Its input, the player's **current draft**, is the last `UPDATE_PLACEMENT` the room accepted, or no ships at all. A refused update leaves the previous draft in place ([ADR-0037](0037-room-transition-shape.md)), so the stored draft always passes `validateDraft`. A draft is set aside only when the ships it lacks cannot be added: they do not fit (possible when adjacency is forbidden), or the search runs out of its step budget. `completeFleet` then falls back to a whole random fleet ([ADR-0032](0032-fleet-placement.md)). A complete draft that was never confirmed comes back as it is, in `FLEET` order, and is locked. A confirmed fleet is not passed through `completeFleet` at all.

The randomness is the server's injected `Rng`: the one `RoomManager` already draws room ids from, `createCryptoRng()` in production and `createSeededRng(seed)` in tests ([ADR-0030](0030-random-number-generation.md)). It reaches room logic as an argument of `endPlacement`, the only transition that needs it. Unconfirmed fleets are completed `P1` first, so one seed fixes both. Nothing tells the player beyond the `STATE` that starts the match, which shows the completed fleet in `battle.myShips`. The server logs "Fleets completed" with the seats.

## Considered options

- **A separate `Rng` for fleets:** room ids drawn in a test would stay the same whether or not a deadline ran before. One injected source is what [Server: Testability](../server.md#testability) describes, and a test can still work out the expected fleets from the same seed.
- **A random fleet in place of the draft:** simpler, but it throws away the ships the player did place, which ADR-0006 asks to complete.
- **Passing confirmed fleets through `completeFleet` too:** they would come back unchanged, but each would spend draws from the `Rng`, so the fleets completed for the other seat would depend on who had confirmed.
- **An event announcing the completion (`FLEET_COMPLETED`):** a protocol change for what the snapshot already shows. The client knows its fleet was unconfirmed when the match started.

## Links

- Added on 2026-10-29 for the placement timer ([#28](https://github.com/fabogit/battleship/issues/28)).
- Spec: [Server: Placement](../server.md#placement) · [Domain: Placement](../domain.md#placement)
- Implements: [ADR-0006](0006-placement-completion.md) (auto-completion at the deadline)
- Amends: [ADR-0037](0037-room-transition-shape.md) (the `Rng` goes to `endPlacement`, not `applyCommand`)
- Related: [ADR-0032](0032-fleet-placement.md) (`completeFleet` and its fallback) · [ADR-0030](0030-random-number-generation.md) (injected `Rng`) · [ADR-0090](0090-placement-timer.md) (placement timer)
- Issues: [#28](https://github.com/fabogit/battleship/issues/28)
