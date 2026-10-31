---
status: accepted
date: 2026-10-31
---

# ADR-0101: AFK forfeit

`BattleRoom.afkCount` holds, per seat, the turns it timed out in a row ([ADR-0009](0009-afk.md)). A timeout adds one to the seat whose turn ran out; that seat's `FIRE` sets it back to zero. A draft (`UPDATE_TARGETS`) does not, nor does an auto shot. The snapshot carries both counts as `afkCount { me, opponent }`.

The timeout that brings a seat to `MAX_CONSECUTIVE_AFK_TURNS` ends the match **instead of** its timeout action ([ADR-0100](0100-timeout-actions.md)): no shot is fired and no turn is passed. The match ends `ABANDONED`, with no winner, when the opponent's count is at least `MAX_CONSECUTIVE_AFK_TURNS − 1`, and `AFK_FORFEIT`, won by the opponent, otherwise. The clients get `STATE` in `GAME_OVER` and nothing before it, and the game-over TTL runs as after any match.

The rest is decided here:

- **An absent player's turns count** once the connected player has resumed the match ([ADR-0074](0074-pause.md)): the timer runs, the turn times out with its action, and the absent seat's count goes up. With `turnTimeLimitSeconds` under 60, three such turns pass before `DISCONNECT_FORFEIT_MS`, so resuming lets the connected player win by `AFK_FORFEIT` sooner. A paused match counts nothing, so an absent player still loses by disconnect forfeit at the latest.
- **The dice animation counts nothing:** the first timeout comes `turnTimeLimitSeconds` after the animation has ended ([ADR-0093](0093-dice-animation.md)).
- **`ABANDONED` needs nobody to have fired:** the starter's third timeout in a row comes after the opponent's second, so a match where neither player fires ends `ABANDONED` at the fifth timeout, `5 × turnTimeLimitSeconds` after the animation.

## Considered options

- **Applying the action before ending the match:** an auto shot could sink the last ship and give the win to the player who stopped playing. A passed turn would change nothing before the match ends anyway.
- **Resetting the count on any command from the seat:** a client (or a script) could keep a player from forfeiting with drafts alone. Firing is the act the rule asks for.
- **Not counting an absent player's turns:** the resume exists so that the connected player need not wait for an absent one, and an absent player is the AFK case the rule is for.

## Consequences

- `GameOverRoom.winner` is `null` for `ABANDONED`, as `GameOverSnapshot.winner` already allowed. The protocol does not change: `afkCount`, `AFK_FORFEIT` and `ABANDONED` have been on the wire since M1, and the client already words both endings.
- Two idle players cannot hold a room: it ends within `5 × turnTimeLimitSeconds` of the last shot (10 minutes at the longest limit), then expires `GAME_OVER_TTL_MS` later.

## Links

- Added on 2026-10-31 for AFK ([#30](https://github.com/fabogit/battleship/issues/30)).
- Spec: [Server: AFK](../server.md#afk) · [Protocol: Snapshot](../protocol.md#snapshot)
- Implements: [ADR-0009](0009-afk.md) (AFK)
- Related: [ADR-0099](0099-turn-timer.md) (turn timer) · [ADR-0100](0100-timeout-actions.md) (timeout actions) · [ADR-0074](0074-pause.md) (pause) · [ADR-0072](0072-seat-presence.md) (disconnect forfeit)
- Issues: [#30](https://github.com/fabogit/battleship/issues/30) · [#31](https://github.com/fabogit/battleship/issues/31) (AFK warning)
