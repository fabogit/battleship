---
status: accepted
date: 2026-10-07
---

# ADR-0041: Board keyboard navigation

Each board follows the WAI-ARIA [grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/): `role="grid"` with ten `row`s of `gridcell`s, each holding the cell's `<button>`. The board is a single tab stop (roving `tabindex`): the cell last focused or clicked, `A1` at first. Arrows move one cell and stop at the edges; Home / End go to the ends of the row, Ctrl (or ⌘) + Home / End to `A1` / `J10`, Page Up / Page Down to the ends of the column. Enter and Space are left to the button, which activates natively. Details in [Client: Board & interaction](../client.md#board--interaction) (#18).

## Considered options

- **Every cell in the tab sequence:** 100 Tab presses to cross a board, 200 for both boards on desktop.
- **A plain group of buttons** (no `grid` role): screen readers in browse mode (NVDA, JAWS) keep the arrow keys for their own cursor, so the arrows would never reach the board. A `grid` switches them to focus mode.
- **`aria-activedescendant`** with focus on the grid itself: the buttons would no longer hold the real focus, so native Enter / Space activation and `:focus-visible` would need reimplementing.
- **Wrapping at the edges** (Right on `A10` → `B1`): the pattern leaves it optional; stopping lets a keyboard user feel the edge instead of silently changing row.
- **Page Up / Page Down by a fixed number of rows:** with ten rows, jumping to the edge of the column is simpler to predict.
- **Axes as `columnheader` / `rowheader`:** screen readers would announce the row and column on top of a label that already starts with the [cell name](0040-cell-names.md). The axes are `aria-hidden` instead.
- **Rows with `display: contents`:** older browser versions dropped the ARIA role of such elements; rows are real grid items with `grid-template-columns: subgrid`.

## Consequences

- The component moves the real focus itself (`focus()` on the target button), and the tab stop follows focus and clicks, so Tab comes back to the last cell used.
- A board that is not interactive stays navigable: its buttons report `aria-disabled` instead of being `disabled`, which would remove them from the focus order.
- Arrows with Alt, Ctrl, ⌘ or Shift are not handled, so browser shortcuts such as Alt + Left (back) keep working.

## Links

- Added on 2026-10-07 for the board grid component ([#18](https://github.com/fabogit/battleship/issues/18)).
- Spec: [Client: Board & interaction](../client.md#board--interaction)
- Related: [ADR-0040](0040-cell-names.md) (cell names), [ADR-0042](0042-board-cell-size.md) (cell size)
- Issues: [#18](https://github.com/fabogit/battleship/issues/18)
