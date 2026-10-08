---
status: accepted
date: 2026-10-07
---

# ADR-0040: Cell names

The UI names a cell by its row letter followed by its column number: rows `A`–`J` from the top, columns `1`–`10` from the left, so `B7` is `{ x: 6, y: 1 }`. The names appear in the cells' accessible labels and on the axes drawn around each board. Only `formatCoordinate` (`shared/board-grid/coordinates.ts`) converts a `Coordinate` to a name. Details in [Client: Board & interaction](../client.md#board--interaction) (#18).

## Considered options

- **Spreadsheet order** (column letter, then row number: `B7` is `{ x: 1, y: 6 }`): it follows the `x`-first order of `Coordinate`, but the classic game marks letters down the side and numbers across the top, and players call "B7" meaning row B.
- **Numbers on both axes** ("2, 7"): read aloud, nothing says which number is the row.
- **Zero-based numbers:** they match the protocol, but no player counts from 0.

## Consequences

- A name reads `y` before `x`, the reverse of the `Coordinate` fields; code never parses names, it only formats them.
- The letters and numbers are the same in Italian and English, so only the words after the name ("hit", "colpito") need translating.

## Links

- Added on 2026-10-07 for the board grid component ([#18](https://github.com/fabogit/battleship/issues/18)).
- Spec: [Client: Board & interaction](../client.md#board--interaction) · [Domain: Placement](../domain.md#placement) (board axes)
- Related: [ADR-0041](0041-board-keyboard-navigation.md) (keyboard navigation)
- Issues: [#18](https://github.com/fabogit/battleship/issues/18)
