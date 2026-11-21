---
status: accepted
date: 2026-11-19
---

# ADR-0121: Salvo counter and fired-turn wording

The battle view counts a salvo draft, says how many cells a turn fires, and words every fired turn in one message, whoever fired it and however many targets it had. Details in [Client: Board & interaction](../client.md#board--interaction).

- **The counter, in salvo mode only:** the hint under "Fire", which describes the button, leads with "2 of 5 targets" and then names the targets: "2 of 5 targets: B7, C3.", or "0 of 5 targets: tap a cell to aim." before the first. It shows for an allowance of 1 too ("0 of 1 target"), since the match is still a salvo match. The hint is not a live region: each tap announces the count in the existing polite feedback line, after the cell ("Aiming at C3: 2 of 5 targets.", "B7 is no longer a target: 1 of 5 targets."), so one tap gives one announcement, in a known order. Standard mode keeps "Target: B7." and "Aiming at B7.".
- **How many cells:** while the turn fires more than one, the line under the heading says "Aim at 5 cells, then fire." for the player and "Wait for Grace to fire 5 shots." for the opponent, from `shotsAllowed`, which is the shooter's allowance on both pages ([ADR-0112](0112-salvo-shot-allowance.md)). In the low-time warning under "Random shot" ([ADR-0108](0108-low-time-warning.md)) it becomes "Fire now, or random shots fill in.", since a timed-out salvo keeps the drafted targets and draws the others ([ADR-0114](0114-salvo-time-budget.md)). Both sentences are short on purpose: at 320 px, in DejaVu Sans as on the CI runner, "Aim at 5 cells in Enemy waters, then fire." (330 px) and "Fire now, or random shots fill the rest." (305 px) took a second line in the 288 px of text and pushed "Fire" down by 24 px; "Aim at 5 cells, then fire." takes 191 px and "Fire now, or random shots fill in." 257 px.
- **One message per fired turn:** a turn with one target keeps its sentence ("You fired at B7: miss."). A turn with several is one message: who fired how many, the cells that found a ship (sunk ones included) and those that found water, in firing order, then the ships sunk. For example, "You fired 5 shots: hits on A2 and A3, misses on A1, A4 and A5. Your shots sank Grace's destroyer!" and "Grace fired 3 shots: a hit on B2, misses on A1 and C3.".
- **Automatic shots, singular and salvo:** `autoShotTargets` fires the targets the player had drafted first and draws only the rest ([ADR-0100](0100-timeout-actions.md), [ADR-0113](0113-every-salvo-target-resolves.md)), and `SHOT_RESOLVED` does not say which is which. So the words claim neither: "Your time ran out: a shot was fired for you at B7, miss." and "Grace's time ran out, so their 5 shots were fired for them: …". ADR-0109's "a random shot at B7" was already wrong in standard mode whenever the player had aimed before the deadline. The low-time warning for one target follows: "Fire now, or a shot is fired for you." in place of "…, or a random shot is fired.".
- **The allowance after a sink, for both players:** in salvo mode the `STATE` that decides the fired turn ([ADR-0109](0109-afk-warning.md)) also brings the next shooter's `shotsAllowed`. After a salvo the turn always passes, so that is the allowance of the player whose fleet was fired at. When the turn sank a ship, the message ends with it: "You now fire 4 shots per turn." or "Grace now fires 4 shots per turn.". The number is the server's, capped near the end of a match by the cells left to fire at, so it can be lower than the ships afloat.
- **An extra turn on a hit:** the same `STATE` tells whether the shooter fires again, by naming them as `currentTurn` again. This is the snapshot field #139's board hold follows on a narrow screen ([ADR-0057](0057-battle-layout.md)), and the client derives nothing else from the rules or the results. The message ends with "Fire again." for the player or "Grace fires again." for the opponent, after an automatic hit too ([ADR-0120](0120-afk-under-extra-turn.md)).
- **The turn that ends the match:** its `STATE` is `GAME_OVER`, with no AFK count, no turn and no allowance. So the winning salvo reads as fired by hand, even when the server fired it, says nothing of an allowance or an extra turn, and the heading names the winner.

## Considered options

- **A counter in standard mode too ("1 of 1 target"):** one target per turn needs no counting, and the hint already names it.
- **The count in a live region of its own:** two polite regions changing on the same tap are read in an order the browser picks, often the count before the cell it counts.
- **One sentence per target, as before:** five sentences after a salvo, all announced together, for what a glance at the board shows at once. One message groups them and still names every cell.
- **The cells grouped by outcome without naming them ("2 hits, 3 misses"):** shorter, but a player who cannot see the board would not know where the hits were.
- **Telling drafted and random targets apart in the automatic wording:** the client could guess from the draft it last sent, but `SHOT_RESOLVED` does not say it, and a draft refused or still in flight at the deadline would make the guess wrong. A protocol field for it was not worth a version bump.
- **Saying the allowance at the start of the player's next turn instead:** the line under the heading already says how many cells to pick then; the message about the sink is where the reason for the change is.

## Consequences

- The fired-turn feedback carries `keepsTurn` and `nextShotsAllowed` next to `isAutomatic`, all three decided once by the first `STATE` after `SHOT_RESOLVED`. A tap's feedback carries the count (`null` in standard mode).
- The single-shot sentences of ADR-0109 for a shot fired by hand do not change.

## Links

- Added on 2026-11-19 for the salvo UI ([#34](https://github.com/fabogit/battleship/issues/34)) and the extra turn's wording ([#33](https://github.com/fabogit/battleship/issues/33)).
- Spec: [Client: Board & interaction](../client.md#board--interaction)
- Amends: [ADR-0109](0109-afk-warning.md) (the automatic shot's sentences no longer say "random") · [ADR-0108](0108-low-time-warning.md) (the low-time sentence under "Random shot", for one target and for a salvo) · [ADR-0056](0056-target-draft.md) (salvo is no longer to come)
- Related: [ADR-0057](0057-battle-layout.md) (battle layout, the extra-turn hold) · [ADR-0100](0100-timeout-actions.md) (timeout actions) · [ADR-0112](0112-salvo-shot-allowance.md) (salvo allowance) · [ADR-0113](0113-every-salvo-target-resolves.md) (every target resolves) · [ADR-0114](0114-salvo-time-budget.md) (salvo time budget) · [ADR-0120](0120-afk-under-extra-turn.md) (automatic shots and AFK under extra turn)
- Issues: [#34](https://github.com/fabogit/battleship/issues/34) · [#33](https://github.com/fabogit/battleship/issues/33)
