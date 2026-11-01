---
status: accepted
date: 2026-11-01
---

# ADR-0109: AFK warning and the automatic shot

The battle view reads `afkCount` ([ADR-0101](0101-afk-forfeit.md)) and, while either count is above zero, shows a line under the heading's hint, in the warning colour, inside a polite live region:

- **For the player:** "2 more timeouts in a row and you lose." after one, "One more timeout and you lose." after two, from `MAX_CONSECUTIVE_AFK_TURNS − afkCount.me`.
- **About the opponent:** "2 more timeouts in a row and Grace loses." / "One more timeout and Grace loses.", from `afkCount.opponent`.

Each line stays until that player fires, which sets their count back to zero; both can show at once. They name what is left rather than what happened, since the count lasts across the other player's turns, when "your time ran out" would no longer be news.

The shot the server fires for a player whose time ran out ([ADR-0100](0100-timeout-actions.md)) is worded as such: "Your time ran out: a random shot at B7, miss." and "Grace's time ran out: a random shot at A1, hit.", in place of "You fired at …". `BattleStore` keeps the shooter's `afkCount` when `SHOT_RESOLVED` arrives, and calls the shot automatic when the first `STATE` after it counts one more timeout for the shooter. That `STATE` alone decides, and the answer is kept: under "Pass the turn" a later timeout sends no `SHOT_RESOLVED`, so the shot still announced would otherwise turn automatic when its shooter's count goes up. A shot that ends the match leaves no count to compare (the `STATE` is `GAME_OVER`) and reads as a fired one.

## Considered options

- **The warning in the presence banner,** above the view: the banner is about the connection, in every phase, and an idle player is connected. The heading's lines are where the turn and its time are.
- **Only the idle player's own warning:** the other player is the one who wins by it, and an opponent who stops answering looks the same as a slow one until the count says otherwise.
- **A flag on `SHOT_RESOLVED` for an automatic shot:** a protocol change for what `afkCount` already tells ([ADR-0100](0100-timeout-actions.md)).

## Consequences

- At 320 × 568 every line under the heading is one line long at the default font size, so the warning and the low-time sentence fit with "Fire" in view ([Client: Layout](../client.md#layout)); a long nickname may take a second line.

## Links

- Added on 2026-11-01 for the timers and dice UI ([#31](https://github.com/fabogit/battleship/issues/31)).
- Spec: [Client: Board & interaction](../client.md#board--interaction)
- Related: [ADR-0101](0101-afk-forfeit.md) (AFK forfeit) · [ADR-0100](0100-timeout-actions.md) (timeout actions) · [ADR-0108](0108-low-time-warning.md) (low-time warning)
- Issues: [#31](https://github.com/fabogit/battleship/issues/31) · [#30](https://github.com/fabogit/battleship/issues/30) (turn timer)
