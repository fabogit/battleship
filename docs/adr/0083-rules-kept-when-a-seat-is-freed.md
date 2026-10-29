---
status: accepted
date: 2026-10-29
---

# ADR-0083: Rules kept when a seat is freed

`RULES_NEGOTIATION` is a pre-game phase like `WAITING_FOR_OPPONENT` and `PLACEMENT` ([ADR-0073](0073-room-lifecycle-with-forfeits.md)). `LEAVE_ROOM`, or a forfeit after `DISCONNECT_FORFEIT_MS` away, frees the seat at once. The other player goes back to `WAITING_FOR_OPPONENT` in the seat they had:

- **The rules stay as they were last edited**, by either player, and so does `rulesVersion`.
- Both confirmations are cleared, since the waiting room has none, and so are the fleets, as before.
- The next `JOIN_ROOM` opens a new negotiation on those rules at that version, with nobody confirmed.

Details in [Server: Disconnection in other phases](../server.md#disconnection-in-other-phases) and [Server: Leaving](../server.md#leaving) (#26).

## Considered options

- **Back to `DEFAULT_RULES`** (with a new version, never `0` again: [ADR-0082](0082-rules-negotiation-commands.md)): a clean slate for the newcomer, but the player left behind loses their own edits through no doing of theirs. The newcomer gains nothing from defaults: every join opens a negotiation, so they see the rules and can change any of them before confirming. Rooms are symmetric and have no host, so rules nobody has confirmed bind nobody.
- **Keeping the confirmation of the player left behind:** it would let a newcomer's single confirmation start placement on rules the newcomer only glimpsed. ADR-0003 asks both players to confirm the same version, and a different opponent makes it a different agreement.
- **Resetting `rulesVersion` to `0`:** versions would repeat within one room, and a version number would no longer name one set of rules.

## Consequences

- This extends ADR-0073's "rules kept" for a seat freed in `PLACEMENT`, where the rules had been agreed, to rules still under negotiation.
- The rules a room shows in `WAITING_FOR_OPPONENT` may differ from `DEFAULT_RULES`. The client (#27) shows them as they are.

## Links

- Added on 2026-10-29 for rules negotiation ([#26](https://github.com/fabogit/battleship/issues/26)).
- Spec: [Server: Room lifecycle](../server.md#room-lifecycle) · [Server: Leaving](../server.md#leaving)
- Amends: [ADR-0073](0073-room-lifecycle-with-forfeits.md) (a freed seat before the match now includes `RULES_NEGOTIATION`)
- Related: [ADR-0003](0003-rules-editing.md) (rules editing) · [ADR-0082](0082-rules-negotiation-commands.md) (rules negotiation commands)
- Issues: [#26](https://github.com/fabogit/battleship/issues/26) · [#27](https://github.com/fabogit/battleship/issues/27)
