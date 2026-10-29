---
status: accepted
date: 2026-10-29
---

# ADR-0086: Rules edits sent at once

On the rules screen every change of a control sends `UPDATE_RULES` with the whole rules at once; there is no "Propose" step. Both players edit the same rules and any edit clears both confirmations ([ADR-0003](0003-rules-editing.md)), so the server's rules are always the latest proposal, and what each player sees is what the other would confirm. `RulesStore` keeps the rules on screen with the same `createSyncedDraft` as placement ([ADR-0054](0054-placement-draft-sync.md)): the control shows the change at once, a `STATE` replaces it only while no update waits for its ack, and a failure shows its message and puts the server's rules back once no other update is in flight. A value the rules already hold sends nothing. "Confirm rules" sends the `rulesVersion` of the snapshot on screen, and is inactive while an edit of the player's has not reached the snapshot: sent and unanswered, or acked with a version whose `STATE` has not arrived yet. Details in [Client: Rules screen](../client.md#rules-screen) (#27).

## Considered options

- **An edited set the player proposes with a button:** the opponent would not see a change until it is proposed, and a player could confirm while holding an unsent edit, which would then clear both confirmations the moment it is sent. One more button and one more state ("edited, not proposed") on a screen that must fit 320×568 with "Confirm rules" in view.
- **One `UPDATE_RULES` at a time, the controls inactive until its ack:** no draft to reconcile, but a native checkbox or radio changes itself on the tap, so an inactive control would have to undo the browser's change, and every tap would wait a round trip. The rate limit (20 events per second) is far above what taps produce, and Socket.io keeps the order of one connection's commands.
- **Confirming whatever version the snapshot holds, even with an edit on its way:** the server handles the edit first, so the confirmation would always be `STALE_RULES`, or, between the ack and its `STATE`, quote the version before the player's own edit.

## Consequences

- Two players editing at the same moment: last write wins, since each edit sends the whole rules. Each edit bumps the version and clears both confirmations, so neither can confirm rules they have not seen; a `STATE` that arrives while the player's own edit waits for its ack is not drawn, and the next one shows the winner.
- A player who has confirmed can still edit; the edit withdraws their confirmation along with the opponent's. There is no other way to withdraw one.

## Links

- Added on 2026-10-29 for the rules negotiation UI ([#27](https://github.com/fabogit/battleship/issues/27)).
- Spec: [Client: Rules screen](../client.md#rules-screen)
- Related: [ADR-0003](0003-rules-editing.md) (both players edit) · [ADR-0004](0004-stale-confirmation-protection.md) (`rulesVersion`) · [ADR-0047](0047-reply-order.md) (reply order) · [ADR-0054](0054-placement-draft-sync.md) (synced draft)
- Issues: [#27](https://github.com/fabogit/battleship/issues/27) · [#26](https://github.com/fabogit/battleship/issues/26) (rules negotiation on the server)
