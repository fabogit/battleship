---
status: accepted
date: 2026-10-07
---

# ADR-0042: Board cell size

Board cells share the board's width in ten equal columns, between 1.5 rem (24 px, the WCAG 2.2 AA minimum of [SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)) and 3 rem (48 px). They reach 2.75 rem (44 px) when the board is about 29 rem (466 px) wide; on phones in portrait they are about 1.9–2.3 rem (30–37 px), on 360–430 px viewports with 1 rem (16 px) gutters. This replaces the "touch targets ≥ 44px on mobile" acceptance criterion of #18. Details in [Client: Board & interaction](../client.md#board--interaction) (#18).

## Considered options

* **At least 2.75 rem (44 px) with horizontal scrolling** (WCAG 2.2 AAA [SC 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), Apple's 44 pt): ten cells alone are 27.5 rem (440 px), wider than every portrait phone. Part of the board would stay hidden while aiming, and scrolling would compete with tapping.
* **Dropping the axes and the gaps between cells:** about 1.6 rem (26 px) more for the cells, still short of 2.75 rem (44 px) on every phone.

## Consequences

* A mistap is cheap: targeting toggles a draft confirmed by "Fire", and placement can be moved or removed before "Confirm" ([Client: Board & interaction](../client.md#board--interaction)).
* On mobile one board is shown at a time ([Client: Layout](../client.md#layout)), so it gets the full width.
* The viewport keeps pinch-zoom (no `user-scalable=no`).
* Landscape phones, tablets and desktops get 2.75–3 rem (44–48 px) cells.

## Links

* Added on 2026-10-07 for the board grid component ([#18](https://github.com/fabogit/battleship/issues/18)).
* Spec: [Client: Board & interaction](../client.md#board--interaction) · [Client: Layout](../client.md#layout)
* Related: [ADR-0041](0041-board-keyboard-navigation.md) (keyboard navigation)
* Issues: [#18](https://github.com/fabogit/battleship/issues/18)
