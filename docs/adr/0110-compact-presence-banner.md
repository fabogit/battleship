---
status: accepted
date: 2026-11-09
---

# ADR-0110: Compact presence banner in the battle

While the opponent was away, the presence banner ([ADR-0077](0077-opponent-presence-banner.md)) took about 152 px above the battle view at phone width, and "Fire" fell below the fold on every viewport up to about 830 px tall: 678 px at 320×568, 795 px at 360×640, 848 px at 1280×800. At 360×640 it was cut even with no banner, since the short-screen rules started under 640 px (#54, F2). The player whose turn it is may still fire while the match is paused ([ADR-0074](0074-pause.md)), so the button matters most just then. Now:

- **Compact banner during the match** (`IN_PROGRESS`): one row at 0.875 rem (14 px). "Grace is disconnected." and the forfeit countdown, "They forfeit in 2:41." (`role="timer"`, outside the live region), come first, and the button sits right after them. The row is one line at 1280 px; on a phone the text wraps into two lines beside the button. The button stays 2.75 rem (44 px) high, so the row stays that high too. A failure message spans the banner under the row. The waiting screen, the rules screen, placement and game over keep the full banner.
- **The button shows "Pause" / "Resume"** and is named "Pause match" / "Resume match" (`aria-label`): the visible label starts the name (WCAG 2.5.3, label in name), so voice control finds it by what it shows. While the command waits it shows and is named "Pausing…" / "Resuming…", as before.
- **Paused or running, read but not shown:** "The match is paused." and "The match is running." stay in the polite live region, visually hidden. The turn timer beside the battle's heading already shows it: "Time left: 0:30, paused", or a running countdown.
- **The countdown's sentence in the match** is shorter: "They forfeit in 2:41." instead of "Grace loses the match in 2:41 unless they come back.". The sentence before it names the opponent, and "disconnected" says what would stop the countdown. Without the nickname, the sentence takes one line beside the button whatever the nickname's length. Before the match, "Grace's seat is freed in 2:41 unless they come back." is unchanged.
- **The banner in the cell size:** while the compact banner counts down an away opponent's forfeit, the room page sets `--presence-block-size` to the row's 2.75 rem plus its gap, and the battle view takes it off its cells, never below 1.5 rem (24 px):
  - on wide screens, in the clamp of [ADR-0057](0057-battle-layout.md): `(100dvh − 25rem − --presence-block-size) / 10`;
  - on short narrow screens held upright, in a new clamp: `(100dvh − 17.5rem − --presence-block-size) / 10`. Without the banner, a phone held upright stays width-bound (28.8 px allowed against 26.2 px of width at 320×568). In landscape the board keeps its cells: that layout is #38.
- **The short-screen breakpoint** is `height < 42rem` (672 px) instead of `40rem`, in the shell, the room page, the rules screen, placement and the battle, so 360×640 counts as short.
- **Two gaps the view takes back:** the room page's gap under an empty banner (8 px on short screens, 16 px otherwise) and the battle status's gap above its empty AFK live region (4 px). The first was meant to be cancelled by a negative margin on the banner, but a grid row never gets shorter than zero, so the gap stayed. The view under the banner now takes it back with its own negative margin.

Measured with Playwright on the local stack, light and dark alike. The figures are the bottom edge of "Fire" from the top of the viewport, for the player whose turn it is, with a target aimed:

| Viewport | No banner     | "Grace is back." / low time | Opponent away, paused or running |
| -------- | ------------- | --------------------------- | -------------------------------- |
| 320×568  | 526 → 514     | 550 → 543                   | **678** → 544                    |
| 360×640  | **643** → 554 | **667** → 583               | **795** → 606                    |
| 390×844  | 673 → 653–678 | 697 → 690–715               | 825 → 713–738                    |
| 1280×800 | 720 → 700     | 744 → 737                   | **848** → 700                    |

At 390×844 the dice result under the heading takes one line or two, by the faces and the nicknames, so "Fire" moves by 25 px between runs. With the banner before the match, "Confirm rules" ends at 487 px at 320×568 (unchanged) and at 487 px at 360×640 (679 before). "Confirm fleet" ends at 405 px at both (563 before at 360×640). Nothing scrolls sideways. The e2e journey `layout.spec.ts` checks "Fire" with the opponent away at 320×568 and 360×640, between players with nicknames of 20 characters. Details in [Client: Layout](../client.md#layout) and [Client: Connection states](../client.md#connection-states).

## Considered options

- **A sticky "Fire" bar at the bottom on narrow screens** (the finding's other fix): it covers the board's last rows on short phones, which are cells the player aims at ([ADR-0080](0080-leave-room-beside-the-heading.md) turned down a sticky bar for the same reason).
- **The full banner, only budgeted in the cell size:** 152 px at 320×568 would need cells under the 1.5 rem floor, and "Fire" would still be below the fold.
- **"Pause match" / "Resume match" shown in full, and "Grace forfeits in 2:41."** (the first version of this change): at 320 px the text beside the button is 150 px wide. A nickname of 9 letters ("Alexandra") already took the text to four lines (84 px), and "Fire" ended at 584 px at 320×568.
- **"Pause" / "Resume" as the names too:** a screen reader's list of buttons would say less. The `aria-label` keeps the full name.
- **Measuring the banner in script (`ResizeObserver`) to budget its exact height:** code and a listener for what a fixed budget covers, against [ADR-0057](0057-battle-layout.md)'s choice of keeping the layout in CSS.
- **The narrow height clamp in landscape too:** at 640×360 it would take the cells from 3 rem to 1.5 rem, and "Fire" would still be below the fold. Landscape needs its own layout (#38).

## Consequences

- At 320×568 the cells shrink to the 1.5 rem floor while the opponent is away, and grow back when they return. At 360×640 and up, a phone held upright keeps its cells.
- The longest nicknames (20 characters, `NICKNAME_MAX_LENGTH`) wrap "Grace is disconnected." into two lines at 320 px, so the banner takes three lines (63 px), 19 px over its budget. "Fire" still ends at 563 px at 320×568 and 625 px at 360×640.
- `--presence-block-size` is a contract between `room.css` and `battle.css`, set only while the compact banner shows a forfeit countdown. "Grace is back." for one snapshot is not budgeted. It costs 37 px at 1280×800, where "Fire" still ends at 737 px.
- The rules screen hides its intro at 360×640 too, as it already did at 320×568.
- The initial bundle grows by 1.60 kB raw, 0.23 kB estimated transfer: 494.64 → 496.24 kB of the 500 kB warning budget, 129.54 → 129.77 kB.

## Links

- Added on 2026-11-09 for the M3 review ([#54](https://github.com/fabogit/battleship/issues/54), F2).
- Spec: [Client: Layout](../client.md#layout) · [Client: Connection states](../client.md#connection-states)
- Amends: [ADR-0077](0077-opponent-presence-banner.md) (the banner's layout and its countdown sentence during the match) · [ADR-0057](0057-battle-layout.md) (the banner in the cell clamp, and a height clamp on short narrow screens) · [ADR-0042](0042-board-cell-size.md) (cells also shrink with the height on a short phone held upright)
- Related: [ADR-0074](0074-pause.md) (firing while paused) · [ADR-0080](0080-leave-room-beside-the-heading.md) (compact "Leave room", no sticky bar) · [ADR-0108](0108-low-time-warning.md) (the turn timer's "paused")
- Issues: [#54](https://github.com/fabogit/battleship/issues/54) · [#38](https://github.com/fabogit/battleship/issues/38) (landscape)
