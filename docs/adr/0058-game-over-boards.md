---
status: accepted
date: 2026-10-10
---

# ADR-0058: Game-over boards

The game-over snapshot carries the revealed opponent fleet but no shots and not the player's own fleet ([Protocol: Snapshot](../protocol.md#snapshot)). To show both boards with every shot at game over, `GameStateService` keeps a battle record: the boards of the latest `IN_PROGRESS` snapshot (own fleet, incoming and outgoing shots) for that room, plus the results of each `SHOT_RESOLVED` received since. The shot that ends the match arrives as `SHOT_RESOLVED` before the `GAME_OVER` snapshot ([ADR-0047](0047-reply-order.md)), so the record holds it. At game over `myFleet` is the recorded fleet under the recorded incoming shots, and `trackingBoard` is the revealed fleet under the recorded outgoing shots. Without a record for the room (a client that arrives at game over, e.g. after #21), `myFleet` is `null` and the revealed fleet has no shots. The battle view serves both `IN_PROGRESS` and `GAME_OVER`, so it stays on the page when the match ends and only its heading, status and actions change. Details in [Client: Game state](../client.md#game-state) (#20).

## Considered options

- **Adding the shot history and the player's fleet to `GameOverSnapshot`:** the cleanest source, but a protocol change (and a `PROTOCOL_VERSION` bump) for what the client already received. It may still come with the reconnection work (#21), and the record then only fills the gap until the next snapshot.
- **Showing the revealed fleet without shots, as the snapshot gives it:** the winner would see the fleet they sank drawn as untouched ships, and the player's own board would disappear.
- **Keeping the record in the battle view:** a view-provided store dies when the room page switches views, and the record has to outlive the last battle snapshot. `GameStateService` is root-provided and already listens to `STATE`.
- **A separate game-over view:** a second component for the same two boards; with one view the boards stay where they were and the player sees the last shot land before the result.

## Consequences

- Each battle `STATE` replaces the record, so a `SHOT_RESOLVED` is never counted twice; any other phase, or another room's snapshot, clears it.
- The game-over screen shows exactly what the player saw during the match; it adds nothing the server did not send.
- `RULES_NEGOTIATION` shows the waiting screen until its rules part lands (#27); the placeholder "Both fleets are ready" is gone.

## Links

- Added on 2026-10-10 for the game-over screen ([#20](https://github.com/fabogit/battleship/issues/20)).
- Spec: [Client: Game state](../client.md#game-state) · [Protocol: Snapshot](../protocol.md#snapshot)
- Related: [ADR-0034](0034-shot-history.md) (shot history), [ADR-0038](0038-snapshot-projection.md) (snapshot projection), [ADR-0047](0047-reply-order.md) (reply order)
- Issues: [#20](https://github.com/fabogit/battleship/issues/20), [#21](https://github.com/fabogit/battleship/issues/21) (session restore), [#27](https://github.com/fabogit/battleship/issues/27) (rules in the lobby)
