---
status: accepted
date: 2026-10-07
---

# ADR-0032: Fleet placement

`packages/core/src/placement.ts` derives every ship's cells from `type`, `start` and `orientation`. Validation returns a result instead of a boolean: on success it carries the derived ships in input order, on failure the first rule broken (`PlacementViolation`) and the index of the ship that broke it. The server answers `INVALID_PLACEMENT` and logs the reason. `generateRandomFleet` and `completeFleet` return `PlacedShip[]` in `FLEET` order. Both use one exhaustive backtracking search: ships are placed largest first, and each one tries every position that still fits, in an order shuffled by the injected `Rng`. Generation has no step limit: the search is finite and a complete fleet always fits. Completion stops after 1,000 placements. When the draft is invalid, cannot be completed or exceeds that limit, `completeFleet` falls back to a whole random fleet and never throws. The payload guards of [ADR-0031](0031-payload-guard-strictness.md) run first, so placement checks only the rules that depend on ship lengths, the other ships and `areAdjacentShipsAllowed`, and repeats none of the guards' checks. Details in [Placement](../domain.md#placement) (#11).

## Considered options

- **A boolean validator:** tests could not tell which rule failed, and the server log could not say why a draft was refused.
- **Throwing on an invalid layout:** invalid drafts are ordinary client input, not exceptional, and every caller would need a `try`.
- **Exposing the violation to the client** (a field next to `INVALID_PLACEMENT`): the client runs the same validation before sending, so only a buggy or hostile client sees the error. That would be a protocol change for no player-facing gain, the same reasoning as for the guards' failures ([ADR-0031](0031-payload-guard-strictness.md)).
- **Returning `ShipPlacement[]` from generation:** both callers need the cells (the client draws them, the snapshot sends `PlacedShip[]`), and `PlacedShip` is a `ShipPlacement` anyway.
- **Keeping the draft's order in `completeFleet`:** the draft can be in any order, and a fixed order makes equal fleets compare equal.
- **Random placement with restarts** (place each ship at a random free spot, start over on a dead end): it ends only with probability 1, and it cannot prove that a draft is impossible to complete, which `completeFleet` needs to decide on the fallback.
- **No step limit in `completeFleet`:** correct, but nothing would bound the time a pathological draft takes, and the search runs inside the server's deadline handling. The limit is more than 100 times the worst case measured.
- **Throwing on an invalid draft in `completeFleet`:** the server only stores validated drafts, but the deadline must always produce a fleet.
- **Uniform sampling over every valid fleet:** it needs the layouts counted or enumerated, and the game gains nothing from it.

## Consequences

- The same seed gives the same fleet only as long as the search order stays the same: `FLEET` order, candidates listed row by row (horizontal ones, then vertical ones), one `shuffle` per ship tried. Changing any of them changes every seeded fleet, though tests compare runs with each other rather than pinning fleets.
- A draft that could be completed but needs more than 1,000 placements would be discarded. None did over 200,000 random drafts, where the worst case was 6.
- A fleet takes about 0.5 ms to generate (Node 24), so the client can regenerate on every "Randomize" click and the server can complete both fleets in the deadline handler.

## Links

- Added on 2026-10-07 for fleet placement ([#11](https://github.com/fabogit/battleship/issues/11)).
- Spec: [Domain: Placement](../domain.md#placement) · [Server: Placement](../server.md#placement) · [ADR-0007](0007-random-placement.md) · [ADR-0030](0030-random-number-generation.md)
- Related: [ADR-0031](0031-payload-guard-strictness.md) (payload guards, `INVALID_PAYLOAD`)
- Issues: [#11](https://github.com/fabogit/battleship/issues/11)
