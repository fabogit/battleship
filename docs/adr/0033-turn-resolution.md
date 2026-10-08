---
status: accepted
date: 2026-10-07
---

# ADR-0033: Turn resolution

`packages/core/src/engine.ts` resolves a turn in one pure call: `resolveTurn(battle, targets, rules)` validates the targets, fires them and returns either `{ ok: true, results, battle, winner }` or `{ ok: false, reason, targetIndex }`, the same discriminated shape as placement ([ADR-0032](0032-fleet-placement.md)). `results` are the `ShotResult`s in firing order, ready for `SHOT_RESOLVED`; `battle` is a new `Battle` with the results appended to the opponent's board and `currentTurn` already set to the seat that fires next, so the extra-turn rule lives in the engine; `winner` is the shooter when the turn sank the last ship, otherwise `null`. Validation is also exported on its own as `validateTargets(targets, shots, count)`, which needs only the shots, so the client can check a turn on its `outgoingShots`. The payload guard of `FIRE` checks only the shape ([ADR-0031](0031-payload-guard-strictness.md)); the count, bounds, duplicates and already-shot cells are the engine's, and the server maps a rejection to `INVALID_TARGETS`. Until salvo mode lands (#32), `shotsAllowed` and `resolveTurn` throw when `isSalvoModeEnabled` is true. Details in [Shot engine](../domain.md#shot-engine) (#12).

## Considered options

- **Separate validate and resolve calls on the server:** a caller could resolve targets it never validated. `resolveTurn` validates itself; `validateTargets` is exported for the client and for tests, not as a step the server must remember.
- **Throwing on invalid targets:** invalid targets are ordinary client input, and every caller would need a `try` (as for placement).
- **Returning only the results** and leaving the next player and victory to the server: the room would re-derive what the engine just computed, and the extra-turn rule would be split between core and server.
- **An `isGameOver` flag instead of `winner`:** the server needs the winner for `GameOverSnapshot` anyway, and only the shooter can win a turn.
- **Mutating the battle in place:** cheaper, but pure functions keep the tests simple, and a rejected turn cannot leave a half-applied state. A turn copies at most one board's shot list, at most 100 entries.
- **Returning `1` for salvo mode until #32:** a room with salvo enabled would silently play standard turns. Throwing makes the gap loud; M1 rooms play the fixed default rules, so nothing can enable salvo yet.
- **Exposing the violation to the client** (a field next to `INVALID_TARGETS`): only a buggy or hostile client sends invalid targets, the same reasoning as for placement ([ADR-0032](0032-fleet-placement.md)).

## Consequences

- The room stores the returned `Battle` as it is and sends the results unchanged; when `winner` is set it moves to `GAME_OVER` with reason `FLEET_DESTROYED`, and `currentTurn` (still the shooter's) is not used any more.
- `shotsAllowed` already takes the `Battle` salvo needs, so #32 changes its body, not its callers.
- `PASS_TURN` (#30) does not go through `resolveTurn`: the room hands the turn over itself.

## Links

- Added on 2026-10-07 for the shot engine ([#12](https://github.com/fabogit/battleship/issues/12)).
- Spec: [Domain: Shot engine](../domain.md#shot-engine) · [ADR-0010](0010-salvo-vs-extra-turn.md)
- Related: [ADR-0031](0031-payload-guard-strictness.md) (payload guards, `INVALID_PAYLOAD`) · [ADR-0032](0032-fleet-placement.md) (placement results) · [ADR-0034](0034-shot-history.md) (shot history)
- Issues: [#12](https://github.com/fabogit/battleship/issues/12) · [#32](https://github.com/fabogit/battleship/issues/32) (salvo)
