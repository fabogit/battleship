---
status: accepted
date: 2026-11-22
---

# ADR-0125: What a rematch starts from

A resolved rematch ([ADR-0124](0124-rematch-needs-both-seats.md)) starts the next match in the same room. It goes through the same phases as the first match, so placement, the dice and the turns run the code they always ran. Decision 3 of the [M4 decisions on #36](https://github.com/fabogit/battleship/issues/36), and the list of what carries over.

- **Both `SAME_RULES`:** `PLACEMENT`, built by the same `startPlacement` that follows the rules negotiation.
  - Both fleets start empty and unconfirmed. "Random" fills one in a tap ([ADR-0007](0007-random-placement.md)). The last fleet is not offered again, because the opponent saw it at game over (`opponentShips`).
  - The deadline is `PLACEMENT_TIME_LIMIT_MS` from the resolution, and no start countdown runs.
- **Any `CHANGE_RULES`:** `RULES_NEGOTIATION` with the rules of the last match pre-filled and neither seat confirmed. The negotiation TTL counts from the resolution, as from a join ([ADR-0102](0102-negotiation-ttl.md)).
  - `rulesVersion` stays as it was. [ADR-0004](0004-stale-confirmation-protection.md)'s invariant is that only an `UPDATE_RULES` that changes the rules bumps it.
  - A stale confirmation cannot slip through. Both flags are cleared, nothing in `GAME_OVER` sends `CONFIRM_RULES`, and the client builds a new rules screen with nobody confirmed and no changed-rules notice.
  - The first edit bumps the version as usual.
- **What resets:** the boards and their shots (`battle`), the winner and the reason, both rematch choices, the placement fleets, and the start countdown.
  - Then, when placement ends, `startBattle` builds the new match from nothing: no draft targets, `afkCount` at zero for both seats, the turn timer from its full time, and a new dice roll ([ADR-0092](0092-dice-roll-at-match-start.md)).
  - On the client, the dice animation and the shot count start again from the new `IN_PROGRESS` snapshot ([ADR-0107](0107-dice-animation-in-the-client.md)).
- **What carries over:**
  - the room id and link;
  - both players, in the seats they had, with their secrets, so the stored sessions keep working;
  - the rules and their `rulesVersion`;
  - seat presence, which is all connected ([ADR-0124](0124-rematch-needs-both-seats.md)).

## Considered options

- **Offering the last fleet again:** one tap to replay, but the opponent saw every ship at game over, so the placement would hand them the answer.
- **A new `rulesVersion` on `CHANGE_RULES`:** it would break ADR-0004's invariant for no gain. No confirmation can be in flight, and a version that moves without a change reads as a change.
- **Skipping placement on `SAME_RULES` with the last fleets:** the same leak as offering the fleet again, and a second way into the match beside `startBattle`.

## Consequences

- Every match rolls the dice, a rematch's included, because every match starts in `startBattle`.
- A player who wants the same fleet places it again by hand.

## Links

- Added on 2026-11-22 for the rematch flow ([#36](https://github.com/fabogit/battleship/issues/36)), from the M4 decisions on the issue.
- Spec: [Server: Game over & rematch](../server.md#game-over--rematch) · [Server: Placement](../server.md#placement) · [Server: Rules negotiation](../server.md#rules-negotiation)
- Related: [ADR-0004](0004-stale-confirmation-protection.md) (rules version) · [ADR-0012](0012-rematch.md) (rematch) · [ADR-0090](0090-placement-timer.md) (placement timer) · [ADR-0092](0092-dice-roll-at-match-start.md) (dice at the match start) · [ADR-0102](0102-negotiation-ttl.md) (negotiation TTL) · [ADR-0123](0123-rematch-choices-and-leave.md) · [ADR-0124](0124-rematch-needs-both-seats.md)
- Issues: [#36](https://github.com/fabogit/battleship/issues/36)
