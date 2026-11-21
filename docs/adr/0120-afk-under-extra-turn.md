---
status: accepted
date: 2026-11-19
---

# ADR-0120: Automatic shots and AFK under extra turn

With "Extra turn on hit" and "Random shot" both agreed, a turn that runs out fires an automatic shot ([ADR-0100](0100-timeout-actions.md)), and when that shot hits, the same seat keeps the turn, as for a shot fired by hand. Every timeout still raises that seat's `afkCount`, whether its automatic shot hits or misses, and whether the turn passes or stays. Only the seat's own `FIRE` sets the count back to zero. So the third timeout in a row ends the match (`AFK_FORFEIT`, or `ABANDONED` when the other seat is one away from it too, [ADR-0009](0009-afk.md), [ADR-0101](0101-afk-forfeit.md)), even when the two before it were automatic hits that each kept the turn. Each extra turn starts its own timer, with the whole `turnTimeLimitSeconds`, as the server does after any hit that keeps the turn.

This is what `timeOutTurn` in `room.ts` has done since #30: it counts the timeout first and then fires. This ADR records the rule and pins it with tests:

- `room.test.ts` › the turn timer › "counts every timeout of an extra-turn chain of automatic hits, and ends the match at the third": `afkCount` 1, then 2, the same seat on turn with a timer restarted at each deadline, then `AFK_FORFEIT`.
- `turn-timer.test.ts` › AFK › "keeps the turn after a FIRE that hits under extra turn on hit, with a fresh timer and the count reset", over sockets: a hit fired by hand 10 s into the turn keeps it, `turnRemainingMs` is the whole limit again, the count is back to zero, and the timer then runs the whole limit from the hit.
- `battle-store.spec.ts` › "keeps isAutomatic per shot across two STATEs from the same seat under extra turn on hit": the client calls each automatic shot automatic, though the turn never changes hands, and a hit fired by hand right after them not.

## Considered options

- **Not counting a timeout whose automatic shot hits:** a player could walk away while their automatic shots kept hitting and keep the match, and the turn, for as long as the hits lasted. The count is about the player not acting, which a lucky automatic shot does not change.
- **Ending the extra turn on a timeout, passing the turn even after an automatic hit:** a second rule for the same hit, depending on who fired it, which `resolveTurn` does not know. The AFK count already stops a chain at three.

## Consequences

- The client tells an automatic shot from a fired one by the count alone ([ADR-0109](0109-afk-warning.md)). The count goes up at every timeout, so this holds in an extra-turn chain too, where two `STATE`s in a row name the same seat.
- The AFK warning ("One more timeout and you lose.") can show while the player's automatic hit has just kept their turn.

## Links

- Added on 2026-11-19 for the extra turn's left-overs ([#33](https://github.com/fabogit/battleship/issues/33)), decision 2 of the [M4 decisions on #34](https://github.com/fabogit/battleship/issues/34).
- Spec: [Server: Turns](../server.md#turns) · [Domain: Shot engine](../domain.md#shot-engine)
- Related: [ADR-0009](0009-afk.md) (AFK) · [ADR-0100](0100-timeout-actions.md) (timeout actions) · [ADR-0101](0101-afk-forfeit.md) (AFK forfeit) · [ADR-0109](0109-afk-warning.md) (AFK warning and the automatic shot) · [ADR-0121](0121-salvo-counter-and-turn-wording.md) (the extra turn's wording)
- Issues: [#33](https://github.com/fabogit/battleship/issues/33) · [#34](https://github.com/fabogit/battleship/issues/34)
