---
status: accepted
date: 2026-11-01
---

# ADR-0108: Low-time warning

A countdown warns that it is running out over its last `LOW_TIME_MS` (10 seconds), or its last third when the whole countdown is shorter than 30 seconds: `isLowTime(remainingMs, limitMs)` in `shared/countdown.ts`, true at or under `min(LOW_TIME_MS, limitMs / 3)`. So the warning starts as the countdown reads `0:10`, and `0:05` for a 15-second turn. It applies to the turn timer, for both turns, with `turnTimeLimitSeconds` as the limit, and to the placement deadline, with `PLACEMENT_TIME_LIMIT_MS`.

- **What it looks like:** the timer turns bold, in the warning colour (`--color-pending`), and a sentence says it in words, so colour is never the only cue. During the player's turn the line under the heading becomes "Fire now, or a random shot is fired." or "Fire now, or your turn passes.", by the agreed `timeoutAction`; during the opponent's, "Grace's time is almost up.". In placement, while the player's fleet is not locked, a line under the deadline says "Time is almost up: your fleet is then completed at random and locked." ([ADR-0091](0091-fleet-completion-at-the-deadline.md)). Each sentence is in a polite live region, so it is announced once, as it appears; the `timer` itself is not live.
- **Paused:** the timer keeps its colour, since its time is low, but reads "Time left: 0:08, paused", and the urging sentence is not shown: the time does not run.
- **The start countdown** gets no warning: it is 5 seconds long, all of it a warning already.

## Considered options

- **A fixed 10 seconds for every turn:** two thirds of a 15-second turn, so the warning would show for most of it.
- **A share of every limit** (a quarter, say): 30 seconds of a 120-second turn is not "almost up", and a fixed bound is easier to word.
- **Only for the player's own turn:** the other player waits on that time too, and the warning tells them a timeout, maybe an automatic shot at their fleet, is coming.
- **A sound or a vibration:** the app has no sound yet, and one would need a mute setting; a page that buzzes unasked is worse than none.

## Links

- Added on 2026-11-01 for the timers and dice UI ([#31](https://github.com/fabogit/battleship/issues/31)).
- Spec: [Client: Board & interaction](../client.md#board--interaction)
- Related: [ADR-0099](0099-turn-timer.md) (turn timer) · [ADR-0100](0100-timeout-actions.md) (timeout actions) · [ADR-0090](0090-placement-timer.md) (placement timer) · [ADR-0074](0074-pause.md) (pause)
- Issues: [#31](https://github.com/fabogit/battleship/issues/31)
