---
status: accepted
date: 2026-10-15
---

# ADR-0074: Pause

A match in progress stores `isPaused`. It is set when a seat goes away (auto-pause), cleared when both seats are connected again (auto-resume), and switched by `SET_PAUSED { isPaused }` only from the connected player while the opponent is away; from anyone else, the player who is away included, it is `NOT_ALLOWED`, and outside `IN_PROGRESS` it is `WRONG_PHASE`. Asking for the state the match is already in is accepted and changes nothing. A match that starts while a player is away starts paused. When the second seat drops too, the match stays paused, and the first to come back may resume it while the other is still away.

Pause freezes the turn timer and nothing else ([ADR-0008](0008-disconnection-in-battle.md)): the forfeit clock keeps running, and the active player may still update targets and fire. The turn timer is not enforced yet (#30: `turnRemainingMs` is `null`, no turn times out), so today a pause changes no timer; it is stored and projected as `BattleSnapshot.isPaused`. When #30 lands, its turn timer becomes a `TURN` room timer ([ADR-0065](0065-clock-and-room-timers.md)): pausing stores the remaining time and stops it, resuming starts it again at `now + remaining`.

## Considered options

- **Refusing `FIRE` and `UPDATE_TARGETS` while paused:** a pause that stops play entirely. The spec only freezes the timer, and a connected player whose turn it is gains nothing by waiting; firing hands the turn to the absent player, whose timer is then frozen.
- **Ignoring `SET_PAUSED` for the state already set:** a refusal the client would have to tell apart from `NOT_ALLOWED`; accepting it matches a repeated `CONFIRM_PLACEMENT`.

## Consequences

- #30 owns the frozen remaining time and the AFK count of an absent player's turns while the match is resumed.

## Links

- Added on 2026-10-15 for disconnection rules ([#23](https://github.com/fabogit/battleship/issues/23)); the client's pause control is [ADR-0077](0077-opponent-presence-banner.md) (#25).
- Spec: [Server: Disconnection & pause](../server.md#disconnection--pause-in_progress)
- Implements: [ADR-0008](0008-disconnection-in-battle.md) (disconnection in battle)
- Related: [ADR-0072](0072-seat-presence.md) (seat presence) · [ADR-0065](0065-clock-and-room-timers.md) (room timers)
- Issues: [#23](https://github.com/fabogit/battleship/issues/23) · [#30](https://github.com/fabogit/battleship/issues/30) (turn timer) · [#25](https://github.com/fabogit/battleship/issues/25) (pause control)
