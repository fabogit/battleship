---
status: accepted
date: 2026-10-29
---

# ADR-0088: Rules change notices

A polite live region on the rules screen says what the latest `STATE` changed, without moving focus: an edit, with who made it, what it changed and whose confirmation it cleared ("Grace set the time per turn to 60 seconds. You need to confirm again."), or the opponent's confirmation ("Grace confirmed the rules."). The snapshot does not say who edited the rules, so the client tells: the server acks an accepted `UPDATE_RULES` with the version it gave the edit, and acks before it sends the `STATE` ([ADR-0047](0047-reply-order.md)). `RulesStore` keeps the versions its own edits got, and compares each `STATE` with the previous negotiation snapshot of the same room as it arrives, as `GameStateService` does for the presence banner ([ADR-0077](0077-opponent-presence-banner.md)): a new version that one of its acks named is the player's, any other the opponent's. The player's own edit is announced only when it cleared a confirmation: otherwise the control already says it. The first snapshot of the screen, as after a reload, announces nothing. Details in [Client: Rules screen](../client.md#rules-screen) (#27).

## Considered options

- **A neutral "The rules changed." for every edit:** true, but it leaves the player to find what changed among four controls, and to tell whether their own tap or the opponent's caused it.
- **An editor field in the snapshot:** exact even after a lost ack, but a protocol change for #26 to carry, for a sentence the client can already form.
- **Announcing the change from the controls' bindings (`linkedSignal`):** it computes only when read, and misses snapshots that arrive between two reads, as the presence banner found ([ADR-0077](0077-opponent-presence-banner.md)).

## Consequences

- An edit whose ack is lost (`NO_ACK`) but which the server applied is credited to the opponent. It is rare, and the rules and confirmations shown are right either way.
- A version that skips others, after a reconnection, is credited by its own number and lists every rule that differs from the last version seen.
- The notice describes the latest change only: the player's own edit that cleared no confirmation empties it.

## Links

- Added on 2026-10-29 for the rules negotiation UI ([#27](https://github.com/fabogit/battleship/issues/27)).
- Spec: [Client: Rules screen](../client.md#rules-screen)
- Related: [ADR-0003](0003-rules-editing.md) (any edit clears both confirmations) · [ADR-0047](0047-reply-order.md) (reply order) · [ADR-0077](0077-opponent-presence-banner.md) (presence banner) · [ADR-0086](0086-rules-edits-sent-at-once.md) (edits sent at once)
- Issues: [#27](https://github.com/fabogit/battleship/issues/27)
