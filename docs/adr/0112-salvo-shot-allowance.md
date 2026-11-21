---
status: accepted
date: 2026-11-19
---

# ADR-0112: Salvo shot allowance

Salvo mode is playable: `validateRules` no longer refuses `isSalvoModeEnabled` on its own, which lifts the refusal of [ADR-0085](0085-salvo-refused-until-implemented.md), and `shotsAllowed` no longer throws. In salvo mode a turn fires exactly `min(shooter's surviving ships, opponent's unshot cells)` targets:

- **The shooter is `battle.currentTurn`.** The count reads the shooter's own board for the ships with an intact cell, and the opponent's board for the cells never shot. It depends on the battle only, not on who asks, so `STATE` gives both seats the shooter's allowance as `shotsAllowed`: the active player's to aim with, the waiting player's to see how many shots are coming. It shrinks as the shooter's ships sink, 5 → 4 → … → 1.
- **A ship is sunk when every one of its cells has been shot,** derived from the coordinates, never from the stored outcomes ([ADR-0034](0034-shot-history.md)). One internal function, `isShipSunk`, says so for the `SUNK` results of `resolveTurn`, for its winner, and, through the exported `countSurvivingShips(board)`, for the allowance.
- **The opponent's unshot cells cap it.** While the match goes on, the shooter has a ship afloat and the opponent a ship with an unshot cell, so the allowance is at least 1. Without the cap, a shooter with more ships left than the opponent has cells left would get a count no draft can reach: the player could not fire, and the auto shot of a timed-out turn would throw a `RangeError` from `randomTargets`, which closes the room with `SERVER_ERROR` ([ADR-0104](0104-room-failure-containment.md)).

Standard mode stays at one target. The extra turn on hit stays standard-only ([ADR-0010](0010-salvo-vs-extra-turn.md)): `resolveTurn` never grants it in salvo mode, even for rules `validateRules` would refuse.

## Considered options

- **Each seat's own allowance in its snapshot,** telling the waiting player how many targets their next turn has: the field would change meaning with the receiver, and that count can still drop before their turn, since the shooter's salvo may sink one of their ships. A client that wants it can count its own surviving ships from `myShips` and `incomingShots` with `countSurvivingShips`.
- **Two fields, the shooter's allowance and the receiver's next one:** a protocol change for a counter nobody has asked for yet; #34 can propose it if its shot counter needs it.
- **The allowance as the surviving ships only, uncapped:** the endgame case above, where the server itself would fail the room.
- **Keeping the sunk-ship rule as a closure inside `resolveTurn`** and deriving the surviving ships again for the allowance: two derivations of one rule, free to drift apart.

## Consequences

- The protocol does not change and `PROTOCOL_VERSION` stays 6: `UPDATE_RULES`, `UPDATE_TARGETS`, `FIRE`, `SHOT_RESOLVED.results` and `shotsAllowed` already have the shapes salvo needs ([ADR-0031](0031-payload-guard-strictness.md)), and `SALVO_NOT_IMPLEMENTED` was logged by the server, never sent.
- `RULES_VIOLATIONS` has one value left, `SALVO_WITH_EXTRA_TURN`.
- The client's rules screen still offers no salvo control; the toggle, the shot counter and the wording come with #34.

## Links

- Added on 2026-11-19 for salvo mode ([#32](https://github.com/fabogit/battleship/issues/32)).
- Amended on 2026-11-19 for the salvo UI ([#34](https://github.com/fabogit/battleship/issues/34)): the client offers salvo on the rules screen ([ADR-0119](0119-salvo-extra-turn-exclusion.md)), and the battle view counts the targets and words salvo turns ([ADR-0121](0121-salvo-counter-and-turn-wording.md)).
- Spec: [Domain: Shot engine](../domain.md#shot-engine) · [Domain: Rules](../domain.md#rules) · [Protocol: Snapshot](../protocol.md#snapshot)
- Supersedes: [ADR-0085](0085-salvo-refused-until-implemented.md) (salvo refused until implemented)
- Amends: [ADR-0033](0033-turn-resolution.md) (`shotsAllowed` and `resolveTurn` no longer throw on salvo)
- Related: [ADR-0010](0010-salvo-vs-extra-turn.md) (salvo vs. extra turn) · [ADR-0034](0034-shot-history.md) (shot history) · [ADR-0100](0100-timeout-actions.md) (timeout actions) · [ADR-0104](0104-room-failure-containment.md) (failure containment) · [ADR-0113](0113-every-salvo-target-resolves.md) (salvo resolution) · [ADR-0114](0114-salvo-time-budget.md) (salvo time budget)
- Issues: [#32](https://github.com/fabogit/battleship/issues/32) · [#34](https://github.com/fabogit/battleship/issues/34) (salvo UI)
