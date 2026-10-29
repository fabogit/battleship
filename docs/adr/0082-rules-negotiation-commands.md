---
status: accepted
date: 2026-10-29
---

# ADR-0082: Rules negotiation commands

`JOIN_ROOM` opens `RULES_NEGOTIATION` ([ADR-0003](0003-rules-editing.md)). The room keeps the rules, `rulesVersion` and one confirmation flag per seat. Either player may send `UPDATE_RULES` or `CONFIRM_RULES`. In any other phase both commands are `WRONG_PHASE`, the code [ADR-0046](0046-commands-ahead-of-room-logic.md) named for them, like every other command outside its phase. The rest of each command is decided here:

- **`UPDATE_RULES`** runs `validateRules` first (`INVALID_RULES`, with the violation logged and never sent).
  - Rules that differ from the current ones are stored, `rulesVersion` goes up by one and both confirmations are cleared.
  - **Rules equal to the current ones, field by field, change nothing:** the version stays, the confirmations stay, and the ack carries the version already in place. The ack always carries the version of the rules now in force.
- **`CONFIRM_RULES { rulesVersion }`** checks the version first. Any version other than the current one, older or never issued, is `STALE_RULES`, even from a seat that already confirmed the current one ([ADR-0004](0004-stale-confirmation-protection.md)).
  - **A repeated confirmation of the current version is accepted and changes nothing**, as `CONFIRM_PLACEMENT` on a locked fleet is.
  - The second seat to confirm starts `PLACEMENT` with those rules, and the placement deadline counts from that confirmation.
- **`rulesVersion` is never reset.** It stays monotonic for the room's whole life, through a player leaving ([ADR-0083](0083-rules-kept-when-a-seat-is-freed.md)), so a confirmation can never match a version number used before.

Details in [Server: Rules negotiation](../server.md#rules-negotiation) (#26).

## Considered options

- **Every `UPDATE_RULES` bumps the version**, the literal reading of ADR-0003: simpler, but it clears a confirmation the player gave to exactly these rules. That happens when a client resends its draft (a toggle switched on and off before a debounced send), or when both players happen to pick the same change. The version protects a confirmation from a change it did not see ([ADR-0004](0004-stale-confirmation-protection.md)). An edit that changes nothing gives it nothing to protect against.
- **A repeated `CONFIRM_RULES` as `NOT_ALLOWED`:** a double tap would show an error, which no other command in the protocol does for a no-op (`CONFIRM_PLACEMENT`, `UNLOCK_PLACEMENT`, `SET_PAUSED`).
- **`NOT_ALLOWED` outside `RULES_NEGOTIATION`**, the code these commands answered before #26: a client could not tell "the phase has moved on, a `STATE` is coming" from "this socket has no seat". `WRONG_PHASE` keeps the rule of the error table: the phase is checked before the seat or the payload.
- **A way to withdraw a confirmation:** none is needed, because an edit from either player clears both confirmations. A player who changes their mind edits the rules.

## Consequences

- The client (#27) can send `UPDATE_RULES` on every change without a guard of its own. It reads the version to confirm from the ack or from the next `STATE`.
- Two players' edits that land in turn each bump the version. A confirmation sent in between is `STALE_RULES`, and the client confirms again from the `STATE` that follows.

## Links

- Added on 2026-10-29 for rules negotiation ([#26](https://github.com/fabogit/battleship/issues/26)).
- Spec: [Server: Rules negotiation](../server.md#rules-negotiation) · [Protocol: Client → server](../protocol.md#client--server)
- Implements: [ADR-0003](0003-rules-editing.md) (rules editing) · [ADR-0004](0004-stale-confirmation-protection.md) (stale confirmation)
- Amends: [ADR-0046](0046-commands-ahead-of-room-logic.md) (the rules commands have their room logic) · [ADR-0037](0037-room-transition-shape.md) (`RULES_NEGOTIATION` has its variant)
- Related: [ADR-0010](0010-salvo-vs-extra-turn.md) (the constraint `validateRules` checks) · [ADR-0085](0085-salvo-refused-until-implemented.md) (salvo refused until #32)
- Issues: [#26](https://github.com/fabogit/battleship/issues/26) · [#27](https://github.com/fabogit/battleship/issues/27) (rules UI)
