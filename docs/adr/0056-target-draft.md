---
status: accepted
date: 2026-10-10
---

# ADR-0056: Targets by taps

During their turn the player aims by tapping cells of "Enemy waters" and fires with a separate "Fire" button. A tap on a target takes it out of the draft. A tap on a cell shot in an earlier turn is refused with a message, checked with core's `validateTargets` ([ADR-0033](0033-turn-resolution.md)), and nothing is sent. Any other cell joins the draft. With one shot allowed (standard mode, the only mode until #32), the new cell replaces the old target, so aiming elsewhere takes one tap; a full salvo draft will refuse a new cell until a target is taken out. "Fire" stays focusable but inactive (`aria-disabled`) until the draft holds exactly `shotsAllowed` targets. The draft is synced like the placement draft ([ADR-0054](0054-placement-draft-sync.md)): `BattleStore`, provided by the battle view, keeps the client's copy, shows every change at once and sends the whole draft with `UPDATE_TARGETS`. A `STATE` replaces the copy only while no update waits for its ack, and a failed update puts back the server's draft. Details in [Client: Board & interaction](../client.md#board--interaction) (#20).

## Considered options

- **Fire on the tap itself:** one tap less per turn, but a stray touch on a phone would waste the turn. The two steps are what the specification asks for ([Client: Board & interaction](../client.md#board--interaction)).
- **Refusing a second target in standard mode until the first is taken out:** the same rule as a full salvo draft, but aiming elsewhere would take two taps, and "the cell I tapped is my target" is what a player expects with a single shot.
- **Drawing the snapshot's `myDraftTargets` only:** the target would appear after the round trip, and a `STATE` sent before the server handled the update would briefly move it back, the same problem as for placement ([ADR-0054](0054-placement-draft-sync.md)).
- **Not sending the draft and firing the local targets only:** `UPDATE_TARGETS` is what lets the server keep a valid draft for `AUTO_RANDOM_SHOT` at the turn deadline ([ADR-0009](0009-afk.md), #30) and restore it after a reconnection (#21).

## Consequences

- `INVALID_TARGETS` comes only from a client that is out of step with the server: the view never sends a cell that was already shot.
- The live region names the cell after each tap ("Aiming at B7.", "B7 is no longer a target.", "B7 has already been shot."), so the board can be used without seeing it.
- `FIRE` carries the draft itself, so it does not wait for an `UPDATE_TARGETS` still in flight; Socket.io keeps the order of both commands.

## Links

- Added on 2026-10-10 for the battle view ([#20](https://github.com/fabogit/battleship/issues/20)).
- Spec: [Client: Board & interaction](../client.md#board--interaction)
- Related: [ADR-0033](0033-turn-resolution.md) (`validateTargets`), [ADR-0035](0035-command-acks.md) (acks and transport errors), [ADR-0053](0053-placement-taps.md) (placement by taps), [ADR-0054](0054-placement-draft-sync.md) (the draft sync this reuses)
- Issues: [#20](https://github.com/fabogit/battleship/issues/20), [#30](https://github.com/fabogit/battleship/issues/30) (turn timer), [#32](https://github.com/fabogit/battleship/issues/32) (salvo)
