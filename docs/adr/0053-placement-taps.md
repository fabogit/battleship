---
status: accepted
date: 2026-10-08
---

# ADR-0053: Placement by taps

Ships are placed with taps, not drag and drop. A tap on a ship in the dock selects it. A tap on a cell then puts the selected ship there, with that cell as its start: the bow, from which it extends right or down. A ship whose start is too close to the right or bottom edge is moved back along its length just enough to fit (`fitOnBoard`), so a tap never fails for lack of room. A placed ship stays selected after it lands: the next tap on water moves it, a tap on one of its own cells moves its start there, and "Rotate" turns it about its start, fitted the same way. "Remove" puts it back in the dock. A tap on a cell of another placed ship selects that ship instead. A position the rules refuse (`validateDraft`: ships overlapping or, without `areAdjacentShipsAllowed`, touching) is not sent. The board shows the refused cells as the invalid preview, the live region says why, and the draft stays as it was. Details in [Client: Board & interaction](../client.md#board--interaction) (#19).

## Considered options

- **Drag and drop:** hard to do precisely on cells of about 2 rem (32 px) under a finger, it fights page scrolling, and it needs a separate path for keyboard users. Taps go through the same `<button>` cells as Enter and Space, so one code path serves touch, mouse and keyboard. Drag and drop may come later as a desktop extra.
- **Previewing on the first tap and confirming on a second one:** twice the taps for every ship. A mistap is cheap here: the ship stays selected and the next tap moves it, and nothing is final before "Confirm fleet" ([ADR-0042](0042-board-cell-size.md)).
- **Refusing a start that leaves the board (`OUT_OF_BOUNDS`) instead of fitting it:** the tapped cell would always be the bow, but on a phone most taps near the right or bottom edge would fail. With fitting, the ship still covers the tapped cell or ends as close to it as it can.
- **Placing the next dock ship automatically after each placement:** saves one tap per ship, but "Rotate" and "Remove" would then act on a ship the player has not picked, and a second tap on water would place a ship they did not choose.
- **A tap on the selected ship clearing the selection:** a ship could not be moved by one cell along its own length. The selection is cleared by tapping the selected ship in the dock again, and by "Randomize" and "Confirm fleet".

## Consequences

- `OUT_OF_BOUNDS` cannot come from a tap or a rotation, only from a draft that is already broken, which the server never sends back.
- The selected ship is drawn with an overlay of its own on the board (`selectedCells`, the "selected" word in the cell labels).
- The live region announces every placement, refusal and rotation with the start cell's name, so the board can be used without seeing it.

## Links

- Added on 2026-10-08 for the placement view ([#19](https://github.com/fabogit/battleship/issues/19)).
- Spec: [Client: Board & interaction](../client.md#board--interaction)
- Related: [ADR-0032](0032-fleet-placement.md) (the core validators), [ADR-0041](0041-board-keyboard-navigation.md) (keyboard navigation), [ADR-0042](0042-board-cell-size.md) (cell size), [ADR-0054](0054-placement-draft-sync.md) (how the draft reaches the server)
- Issues: [#19](https://github.com/fabogit/battleship/issues/19)
