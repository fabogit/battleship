---
status: accepted
date: 2026-11-01
---

# ADR-0107: The dice animation in the client

`GameStateService` listens to `DICE_ROLLED` as well as `STATE`, and keeps the roll with its arrival time (`performance.now()`) as `diceRoll`. The event comes while the room page still shows placement, right before the `STATE` that switches it to the battle view ([ADR-0094](0094-dice-roll-on-reconnect.md)), so the view could not listen to it itself. A snapshot of another room or outside `IN_PROGRESS`, and `clear()`, drop the roll. `DiceAnimation`, provided by the battle view, plays it from the arrival time, so the view, created a moment later, joins the animation where it is.

- **Frames:** every round of `rolls` gets an equal share of `DICE_ANIMATION_MS`, the dice tumbling for its first half and showing their faces for the second. One round: tumbling 0–1.5 s, faces 1.5–3 s; a tie and its re-roll: 0.75 s each. A timer sets each frame at its start, so a frame is never late by a tick.
- **The view:** the two dice, drawn with CSS (`Die`, `shared/die`: pips on a 3 × 3 grid, a wobble and a face changing every 100 ms while tumbling), sit beside the heading where the turn timer goes, with "You" and the opponent's nickname under them. They are `aria-hidden`; the line under the heading says the rounds in a polite live region: "Rolling the dice…", "You and Grace both rolled 4: rolling again.", "You rolled 5, Grace rolled 3: you start." / "…: Grace starts.".
- **How the animation and the first turn's timer meet:** while the animation plays, the heading reads "Who starts?" and neither player can aim (the hint under "Fire" says "You can aim once the dice have picked who starts."), so the animation ends on who starts. At `DICE_ANIMATION_MS` after the roll arrived, the heading names the turn and the starter may aim; the server starts the first turn's timer at the same moment, within the network delay ([ADR-0093](0093-dice-animation.md)), and its `STATE` replaces the dice with the turn timer. Until that `STATE` comes, the dice keep the result.
- **A shot fired during the animation** (another client may, [ADR-0093](0093-dice-animation.md)) ends it: a snapshot with a shot on either board shows no dice.
- **Reduced motion** (`prefers-reduced-motion: reduce`, read through the `PREFERS_REDUCED_MOTION` token): the last round's faces and the result at once, still, and no hold: the heading names the turn and the starter may aim, since there is nothing left to watch. The dice stay until the first turn's timer starts. The die's wobble is also behind `prefers-reduced-motion: no-preference` in CSS.

## Considered options

- **Not holding the turn**, the heading saying "Your turn" from the first frame: the animation would end on something the page has already said. The starter loses nothing by waiting, since the first turn's timer starts only at the end of the animation.
- **Faces driven by the 250 ms countdown tick** of `GameStateService`: frames of 750 ms or 1 s would show up to a tick late, and the tick runs only while a countdown does, which no countdown does during the animation.
- **A fixed time per round** (say 1 s), the result shown for whatever is left: a run of ties would overrun `DICE_ANIMATION_MS` and the end would drift from the server's first turn.
- **A Unicode die (⚀–⚅) or an image:** the glyphs differ by font and some systems draw them as emoji; an image would need light and dark versions. Pips in CSS follow the theme through `currentcolor`.
- **The roll in the room page or a service of its own:** `GameStateService` already holds the snapshot with its arrival time and knows when the roll belongs to a match that is over.

## Consequences

- The browser journeys that start a battle wait for the animation, up to 3 seconds of real time, before the first shot; `startBattle` already waits for the turn headings, which now come at its end.
- `BattleStore.canTarget` reads `DiceAnimation.isPlaying`, so the store needs the animation provided next to it.

## Links

- Added on 2026-11-01 for the timers and dice UI ([#31](https://github.com/fabogit/battleship/issues/31)).
- Spec: [Client: Board & interaction](../client.md#board--interaction) · [Client: Game state](../client.md#game-state)
- Implements: [ADR-0093](0093-dice-animation.md) (the client's side of the animation)
- Related: [ADR-0106](0106-who-starts-after-a-reload.md) (who starts after a reload) · [ADR-0092](0092-dice-roll-at-match-start.md) (dice roll) · [ADR-0036](0036-countdown-resync.md) (countdown resync)
- Issues: [#31](https://github.com/fabogit/battleship/issues/31) · [#29](https://github.com/fabogit/battleship/issues/29) (dice roll)
