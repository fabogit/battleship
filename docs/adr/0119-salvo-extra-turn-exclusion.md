---
status: accepted
date: 2026-11-19
---

# ADR-0119: Salvo and extra turn exclude each other on the rules screen

The rules screen offers salvo as a switch, "Salvo: one shot per ship", right under "Extra turn on hit". The server refuses both rules together ([ADR-0010](0010-salvo-vs-extra-turn.md), `SALVO_WITH_EXTRA_TURN`), so while one of the two is on, the screen keeps the other one off and inactive:

- **Which one:** `RulesStore.excludedRule` reads the rules on screen, so the player's own edit excludes the other switch at once, before its ack, and the opponent's edit does so when its `STATE` arrives. It is `null` while both are off.
- **The inactive switch** stays focusable with `aria-disabled="true"`, as "Fire" and "Confirm rules" do. A click, a tap on its row or Space is cancelled (`preventDefault` on `click`), so it never checks, and `RulesStore.change` sends nothing for the excluded rule either. A dashed outline and the `not-allowed` cursor draw it as inactive.
- **The hint:** under the switch's name, a second line in the muted colour says why: "Not with salvo. Turn salvo off first." or "Not with extra turn on hit. Turn it off first.". It is the switch's description (`aria-describedby`), so a screen reader reads it on focus, and `aria-hidden`, so it does not join the label's accessible name. It sits inside the row, which is 2.75 rem (44 px) high already, so the screen does not move when it appears.
- **One tap, one change:** the screen never turns the other rule off by itself. Turning salvo on with extra turn on takes two taps, extra turn off then salvo on, and each is its own `UPDATE_RULES` with its own notice ([ADR-0088](0088-rules-change-notices.md)).
- **A refused edit:** two players can still turn on one rule each at the same moment. The server accepts whichever it handles first and refuses the other with `INVALID_RULES` (the violation stays in the server's log, [ADR-0112](0112-salvo-shot-allowance.md)). The refused player reads "The server refused these rules. The screen shows the room's rules again.", and the synced draft puts the room's rules back. The inputs are re-synced after the render as for any other failure ([ADR-0087](0087-rules-controls-as-native-inputs.md)), so the switch the player tapped goes back off and becomes the inactive one.

## Considered options

- **Switching the other rule off automatically:** one tap instead of two, but one `UPDATE_RULES` would carry two changes the player made only one of. The opponent's notice would name a rule the player never touched, and a player who taps salvo by mistake would lose an extra turn they had agreed on without seeing why.
- **Native `disabled`:** no click handler needed, but a disabled input leaves the tab order, so a keyboard or screen-reader user tabbing through the rules never meets the switch, and never hears why it is off. Only a browse-mode read of the page would find it. `aria-disabled` keeps the switch and its reason in the tab order, as the repo does for every other inactive control.
- **Hiding the excluded switch:** a rule that comes and goes as the other one changes, and nothing would tell the player that the two exclude each other.
- **A hint shown below the row:** the screen would grow by a line whenever one of the two rules is on, and the confirm button would move under the player's finger.

## Consequences

- Both rules can be off; at most one is on. The screen never shows both on, since the switch the player taps is the one that is not excluded.
- At 320×568 "Confirm rules" moves down by the new row (44 px) and stays in view ([Client: Layout](../client.md#layout)).

## Links

- Added on 2026-11-19 for the salvo UI ([#34](https://github.com/fabogit/battleship/issues/34)), decision 1 of the [M4 decisions on #34](https://github.com/fabogit/battleship/issues/34).
- Spec: [Client: Rules screen](../client.md#rules-screen)
- Related: [ADR-0010](0010-salvo-vs-extra-turn.md) (salvo vs. extra turn) · [ADR-0086](0086-rules-edits-sent-at-once.md) (edits sent at once) · [ADR-0087](0087-rules-controls-as-native-inputs.md) (native inputs, re-synced after a failure) · [ADR-0088](0088-rules-change-notices.md) (change notices) · [ADR-0112](0112-salvo-shot-allowance.md) (salvo allowance)
- Issues: [#34](https://github.com/fabogit/battleship/issues/34) · [#27](https://github.com/fabogit/battleship/issues/27) (rules screen)
