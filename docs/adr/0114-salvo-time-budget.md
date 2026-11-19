---
status: accepted
date: 2026-11-19
---

# ADR-0114: Salvo time budget

A salvo turn gets the same `turnTimeLimitSeconds` as a single-shot turn ([ADR-0099](0099-turn-timer.md)): no extra time per shot and no higher floor when salvo is on, so the shortest salvo turn is 15 seconds for up to five targets. When it runs out, the rules' timeout action applies as to any turn ([ADR-0100](0100-timeout-actions.md)): under `AUTO_RANDOM_SHOT` the draft's targets that are still valid are kept, in draft order, and random ones fill up to the allowance; under `PASS_TURN` the draft is dropped. Players who want more time for a salvo negotiate a longer limit (30, 60 or 120 seconds).

## Considered options

- **A 30-second floor with salvo:** 15 s would be refused or raised while salvo is on, a cross-field rule for `validateRules` and one more thing for the rules screen to explain, before anyone knows that 15 s is too short.
- **A budget per shot** (the limit times the allowance, or a time per target): a turn's length would change as ships sink, the turn timer would need the allowance at every turn start, and the limit on the rules screen would no longer be the length of a turn.

## Consequences

- No code change: the timer and both timeout actions already take any allowance. Tests pin a partial salvo draft timing out (the kept targets first, then the random ones, in one `SHOT_RESOLVED`) in core, in room logic and over sockets, and an auto shot near the end of a match, capped by the opponent's unshot cells ([ADR-0112](0112-salvo-shot-allowance.md)).
- An automatic salvo sends one `SHOT_RESOLVED { shooter, results }` with every target, drafted and random alike, and nothing that tells them apart; `afkCount` in the next `STATE` says the server fired it ([ADR-0100](0100-timeout-actions.md)). The client's sentences for an automatic shot name one cell ([ADR-0109](0109-afk-warning.md)); their wording for a salvo is #34's.
- The open risk "Salvo turns on a phone" stays open with the budget decided: whether 15 s is enough on a real phone is checked in the device playtest (#38).

## Links

- Decided on 2026-11-19 on [#32](https://github.com/fabogit/battleship/issues/32#issuecomment-6995764220) (M4 decision: salvo time budget); added the same day for salvo mode.
- Spec: [Server: Turns](../server.md#turns) · [Roadmap: Open risks](../roadmap.md#open-risks)
- Related: [ADR-0099](0099-turn-timer.md) (turn timer) · [ADR-0100](0100-timeout-actions.md) (timeout actions) · [ADR-0109](0109-afk-warning.md) (AFK warning and the automatic shot) · [ADR-0112](0112-salvo-shot-allowance.md) (salvo shot allowance)
- Issues: [#32](https://github.com/fabogit/battleship/issues/32) · [#34](https://github.com/fabogit/battleship/issues/34) (salvo UI) · [#38](https://github.com/fabogit/battleship/issues/38) (device playtest)
