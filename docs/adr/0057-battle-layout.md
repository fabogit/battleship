---
status: accepted
date: 2026-10-10
---

# ADR-0057: Battle layout

Below a viewport width of 52 rem (832 px) the battle view shows one board at a time, picked with a two-button toggle ("My fleet" / "Enemy waters", `aria-pressed`); from 52 rem up it shows both boards side by side and hides the toggle. The breakpoint is a CSS media query, so the choice never runs through code. On a narrow screen the toggle follows the turn: "Enemy waters" during the player's turn and at game over, "My fleet" during the opponent's. After every `SHOT_RESOLVED` the board the shot landed on stays in front for `SHOT_HOLD_MS` (1.5 s) before the next turn's board takes over, so each player sees where the shot fell. A board the player picks by hand stays until the turn changes. For the side-by-side layout the app shell widens from 40 rem to 68 rem while the battle view is on the page (`:host:has(app-battle)`), which gives each board its full 3 rem (48 px) cells ([ADR-0042](0042-board-cell-size.md)). Details in [Client: Layout](../client.md#layout) (#20).

## Considered options

- **Following the turn without a hold:** with one shot per turn, the turn passes at the moment the shot lands, so the shooter's board would switch to "My fleet" before they see their shot, and the opponent's to "Enemy waters" before they see where they were hit. Only the text in the live region would tell.
- **Tabs (`tablist`, `tab`, `tabpanel`):** the right pattern for one panel at a time, but on a wide screen both panels are shown, where tabs would be wrong. Toggle buttons with `aria-controls` fit both layouts, and each board keeps its own heading.
- **Choosing the layout in code (`matchMedia` or a resize observer):** the same result as a media query, with listeners to manage and a layout that tests would have to fake.
- **Widening the shell for every page:** the forms of the home, join and waiting screens would stretch to 68 rem on a desktop. `:has()` keeps the wider shell to the one page that needs it.
- **Two boards side by side on phones in landscape:** 52 rem is wider than most phones in landscape, which then get one board at a time with large cells; a two-board layout there would need cells below the 1.5 rem minimum.

## Consequences

- Both boards are always in the DOM; the hidden one is `display: none`, so it leaves the accessibility tree too, and the toggle names the board shown.
- The hold only moves the board that is shown: the turn heading and the board's interactivity follow the snapshot at once.
- When the turn timer lands (#30), a turn that times out has no `SHOT_RESOLVED` under `PASS_TURN`, so the next board comes forward without a hold.

## Links

- Added on 2026-10-10 for the battle view ([#20](https://github.com/fabogit/battleship/issues/20)).
- Spec: [Client: Layout](../client.md#layout)
- Related: [ADR-0042](0042-board-cell-size.md) (cell size), [ADR-0047](0047-reply-order.md) (the `SHOT_RESOLVED` that starts the hold arrives before the `STATE` that passes the turn)
- Issues: [#20](https://github.com/fabogit/battleship/issues/20), [#30](https://github.com/fabogit/battleship/issues/30) (turn timer)
