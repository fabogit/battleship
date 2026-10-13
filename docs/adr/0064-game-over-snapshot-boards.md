---
status: accepted
date: 2026-10-13
---

# ADR-0064: Game-over snapshot boards

The `GAME_OVER` part of the snapshot carries both final boards, named as in `BattleSnapshot`: `myShips` (the receiver's fleet), `incomingShots` (every shot on it) and `outgoingShots` (every shot the receiver fired), next to `opponentShips`, the revealed fleet that `outgoingShots` landed on. The winning shot is in them. `PROTOCOL_VERSION` goes from 1 to 2. Supersedes [ADR-0058](0058-game-over-boards.md), which chose to rebuild these boards on the client from a battle record and left this change for the reconnection work. Details in [Protocol: Snapshot](../protocol.md#snapshot) and [Server: Room logic](../server.md#room-logic) (#22, #52 F16).

## Considered options

- **Keeping the client's battle record as the only source ([ADR-0058](0058-game-over-boards.md)):** once the server pushes `STATE` on a rebind ([ADR-0063](0063-session-rebinding.md)), a socket that dropped before the last `SHOT_RESOLVED` arrives at game over with a record one shot short, or with none, and draws the wrong boards. The snapshot is the source of truth ([ADR-0015](0015-protocol-shape.md)); the record only repeated it.
- **Sending the whole `BattleSnapshot` at game over:** its turn, draft, timer, pause and AFK fields mean nothing once the match has ended.
- **Without a version bump:** the fields are added, not changed, so an old client would ignore them; but the bump makes every tab opened before the deploy reload, so client and server always agree on what a snapshot holds.

## Consequences

- The client kept its battle record and ignored the new fields until #21, which dropped the record and its `SHOT_RESOLVED` listener and reads both boards from the snapshot. A client that reaches game over without having seen the battle, after a reload for instance, now shows both boards and the board toggle ([Client: Game state](../client.md#game-state)).
- Fog-of-war does not change: at game over the receiver already knew every shot, and the opponent's fleet was revealed before ([ADR-0038](0038-snapshot-projection.md)).

## Links

- Added on 2026-10-13 for the server handshake ([#22](https://github.com/fabogit/battleship/issues/22)), from the M1 review ([#52](https://github.com/fabogit/battleship/issues/52), F16).
- Supersedes: [ADR-0058](0058-game-over-boards.md) (game-over boards)
- Spec: [Protocol: Snapshot](../protocol.md#snapshot) · [Client: Game state](../client.md#game-state)
- Related: [ADR-0017](0017-protocol-versioning.md) (protocol versioning) · [ADR-0034](0034-shot-history.md) (shot history) · [ADR-0038](0038-snapshot-projection.md) (snapshot projection) · [ADR-0063](0063-session-rebinding.md) (session rebinding)
- Issues: [#22](https://github.com/fabogit/battleship/issues/22) · [#21](https://github.com/fabogit/battleship/issues/21) (session restore) · [#52](https://github.com/fabogit/battleship/issues/52) (M1 review)
