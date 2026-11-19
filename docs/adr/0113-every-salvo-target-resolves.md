---
status: accepted
date: 2026-11-19
---

# ADR-0113: Every target of a salvo resolves

`resolveTurn` resolves a salvo's targets in firing order, each one seeing the hits of the targets before it, and resolves all of them, even after one has sunk the opponent's last ship. Victory is checked once, after the last target: `winner` is the shooter when no ship of the opponent's fleet survives the whole salvo (`FLEET_DESTROYED`). So `SHOT_RESOLVED.results` always holds one result per target of the `FIRE` or the auto shot, the targets after the winning one are `MISS` (no ship is left to hit), and every target is on the opponent's board in the game-over snapshot.

Two targets on one ship in the same salvo give `HIT`, then `SUNK` with `sunkShip`, in either order; a ship hit in earlier turns, in any of its cells, sinks with the salvo that shoots its last cell; one salvo can sink several ships.

## Considered options

- **Stopping the salvo at the winning target:** `results` would be shorter than the targets sent, and the client would have to learn which ones were not fired. The targets were validated together as one turn, so they are fired as one. The extra results cost nothing: misses on a board that game over reveals anyway.
- **Checking victory after each target and ending the turn there:** the same as stopping, with a check per target instead of one.

## Consequences

- The multi-target path of `resolveTurn`, written in M1 ([ADR-0033](0033-turn-resolution.md)) but run with one target only until salvo, is pinned by core tests: two targets on one ship, a ship sunk across turns, the winning target first, in the middle and last, two ships sunk by one salvo.
- A client that animates a salvo plays `results` in order; the match ends with the `STATE` that follows `SHOT_RESOLVED` ([ADR-0047](0047-reply-order.md)), not at the sinking result.

## Links

- Added on 2026-11-19 for salvo mode ([#32](https://github.com/fabogit/battleship/issues/32)).
- Spec: [Domain: Shot engine](../domain.md#shot-engine)
- Related: [ADR-0033](0033-turn-resolution.md) (turn resolution) · [ADR-0112](0112-salvo-shot-allowance.md) (salvo shot allowance) · [ADR-0047](0047-reply-order.md) (reply order)
- Issues: [#32](https://github.com/fabogit/battleship/issues/32) · [#34](https://github.com/fabogit/battleship/issues/34) (salvo UI)
