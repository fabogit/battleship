---
status: accepted
date: 2026-10-22
---

# ADR-0080: "Leave room" beside the heading

[ADR-0078](0078-leaving-before-the-match.md) put "Leave room" under the waiting screen and placement. In placement that is under the whole board, so the player had to scroll to reach it while the placement timer ran: 150 px at 390×844, 324 px at 360×640, 444 px at 320×568 and 278 px at 1280×800, and more again with the opponent-away banner above the view (#53, F1). The control now sits on the right of the view's heading:

- **Where:** the room page keeps the control and its state, and the waiting screen (`Lobby`) and placement (`Placement`) project it into their heading row (`<ng-content />`, with `NgTemplateOutlet` in `Room`). The heading takes the free width, the button sits on its right, and a failure message spans the row below both. The battle view still does not offer it.
- **Size:** compact (0.75 rem, 12 px, side padding instead of 1.25 rem) but still 2.75 rem (44 px) high, with the shared 3 px focus ring.
- **Hint:** "Your seat is freed for someone else, and you go back to the home screen." is now a description only: `aria-describedby` points to a `hidden` paragraph. Screen readers still announce it with the button, and it no longer takes a line under the heading.
- **Reading order:** the heading, then "Leave room", then its message (an empty `role="alert"` until a refusal), then the rest of the view.
- **Unchanged from ADR-0078:** no confirmation step, one button whose label reads "Leaving…" while the command is pending, further taps ignored, and the credentials dropped only after the ack.

Measured on a local stack with Playwright, light and dark alike: the button's bottom edge is at most 251 px from the top of the viewport, opponent-away banner included, so no viewport above needs a scroll. Details in [Client: Routes & lobby flow](../client.md#routes--lobby-flow).

## Considered options

- **A slot in the shell header:** it needs a header-actions service or a portal that the room page fills and clears as its view changes. The header sits outside `<main>`, so a screen reader would meet "Leave room" before the page's own heading, apart from the views it acts on.
- **A sticky bar at the bottom of the page:** it covers the board's last rows on short phones, the very cells placement needs.
- **Keeping the hint visible under the heading:** it pushes the board down by a line or two on phones, for a sentence that only matters once.

## Consequences

- `Lobby` and `Placement` take content beside their heading. Nothing else projects into them.
- A long heading wraps beside the button: "Waiting for your opponent" takes three lines at 320 px.
- The initial bundle grows by 3.9 kB raw, 0.9 kB estimated transfer (465.5 → 469.3 kB of the 500 kB warning budget), mostly `NgTemplateOutlet`. Writing the control out in both views would cost 1.7 kB instead, but would repeat the button, its bindings and its message in the template.

## Links

- Added on 2026-10-22 for the M2 review ([#53](https://github.com/fabogit/battleship/issues/53), F1).
- Spec: [Client: Routes & lobby flow](../client.md#routes--lobby-flow)
- Amends: [ADR-0078](0078-leaving-before-the-match.md) (where the control sits; the hint becomes a description)
- Related: [ADR-0050](0050-entry-before-connection.md) (`aria-disabled` controls) · [ADR-0077](0077-opponent-presence-banner.md) (presence banner)
- Issues: [#53](https://github.com/fabogit/battleship/issues/53) · [#25](https://github.com/fabogit/battleship/issues/25)
