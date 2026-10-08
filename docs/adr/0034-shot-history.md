---
status: accepted
date: 2026-10-07
---

# ADR-0034: Shot history

The shot engine keeps the history of a match as one flat list per board: `Battle.boards[seat]` holds the seat's fleet and `shots: ShotResult[]`, every shot the opponent fired at it, oldest first, each cell at most once. These are exactly the snapshot's lists: the owner's `incomingShots` and the opponent's `outgoingShots` ([Snapshot](../protocol.md#snapshot)), so the server sends them without converting anything. The engine treats the stored outcomes as a record for the players, not as state: which cells are hit, which ships are sunk and whether the fleet is destroyed are derived on every call from the shot coordinates and the fleet, in time linear in the shots (at most 100 per board). Details in [Shot engine](../domain.md#shot-engine) (#12).

## Considered options

- **A per-cell grid** (`UNSHOT` / `MISS` / `HIT` per cell): constant-time lookups, but the snapshot needs the shots in order, so the room would keep both or rebuild the list on every `STATE`. At 100 cells the lookups gain nothing measurable.
- **Hit counters on each ship:** quick sinking checks, but a second copy of what the shots already say, which could drift from them.
- **A list of turns** (one entry per `SHOT_RESOLVED`): keeps which shots were fired together, which only a replay would use; the snapshot is flat, and a reconnecting client needs the board, not the turns.
- **Trusting the stored outcomes** for hits and sinks: works as long as every list came from the engine, but deriving from the coordinates costs nothing and means the outcome strings cannot make the engine wrong.

## Consequences

- The order in which shots were grouped into turns is lost once a turn is resolved; only `SHOT_RESOLVED` carries it, live.
- A board is shot only by the other seat, so a `ShotResult` needs no shooter field.

## Links

- Added on 2026-10-07 for the shot engine ([#12](https://github.com/fabogit/battleship/issues/12)).
- Spec: [Domain: Shot engine](../domain.md#shot-engine) · [Protocol: Snapshot](../protocol.md#snapshot)
- Related: [ADR-0033](0033-turn-resolution.md) (turn resolution) · [ADR-0015](0015-protocol-shape.md) (snapshot as the client's source of truth)
- Issues: [#12](https://github.com/fabogit/battleship/issues/12)
