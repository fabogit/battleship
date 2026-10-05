# Protocol

The contract lives in `packages/core/src/protocol.ts`.

## Client → server

All commands use Socket.io acknowledgements: `ack({ ok: true, ...data } | { ok: false, error: ErrorCode })`.

| Event | Payload | Ack data | Phase |
|---|---|---|---|
| `CREATE_ROOM` | `{ nickname }` | `{ roomId, playerSecret }` | — |
| `JOIN_ROOM` | `{ roomId, nickname }` | `{ playerSecret }` | `WAITING_FOR_OPPONENT` |
| `UPDATE_RULES` | `{ rules: GameRules }` | `{ rulesVersion }` | `RULES_NEGOTIATION` |
| `CONFIRM_RULES` | `{ rulesVersion }` | — | `RULES_NEGOTIATION` |
| `UPDATE_PLACEMENT` | `{ ships: ShipPlacement[] }` | — | `PLACEMENT` |
| `CONFIRM_PLACEMENT` | `{}` | — | `PLACEMENT` |
| `UNLOCK_PLACEMENT` | `{}` | — | `PLACEMENT` |
| `UPDATE_TARGETS` | `{ targets: Coordinate[] }` | — | `IN_PROGRESS`, own turn |
| `FIRE` | `{ targets: Coordinate[] }` | — | `IN_PROGRESS`, own turn |
| `SET_PAUSED` | `{ paused: boolean }` | — | `IN_PROGRESS`, opponent disconnected |
| `SURRENDER` | `{}` | — | `IN_PROGRESS` |
| `REMATCH_CHOICE` | `{ choice: RematchChoice }` | — | `GAME_OVER` |
| `LEAVE_ROOM` | `{}` | — | any |
| `ECHO` | any | `{ payload, protocolVersion }` | Phase 0 connectivity check only |

## Server → client

| Event | Payload | Purpose |
|---|---|---|
| `STATE` | `PlayerStateSnapshot` | Source of truth; sent after every state change and on (re)connect |
| `SHOT_RESOLVED` | `{ shooter: Seat, results: ShotResult[] }` | Animation/sound only (also reflected in `STATE`) |
| `DICE_ROLLED` | `{ rolls: { P1: number, P2: number }[], starter: Seat }` | Dice animation, including re-rolls |
| `SESSION_REPLACED` | `{}` | This socket was superseded by a newer one |
| `SERVER_SHUTDOWN` | `{}` | Server restarting; the match is lost |

## Snapshot

```typescript
export interface PlayerView {
  readonly seat: Seat;
  readonly nickname: string;
  readonly connected: boolean;
  readonly forfeitRemainingMs: number | null; // set while disconnected
}

export interface PlayerStateSnapshot {
  readonly roomId: string;
  readonly phase: RoomPhase;
  readonly me: PlayerView;
  readonly opponent: PlayerView | null;
  readonly rules: GameRules;
  readonly rulesVersion: number;
  readonly rulesConfirmed: { readonly me: boolean; readonly opponent: boolean };
  readonly placement: {
    readonly myShips: readonly PlacedShip[];
    readonly myConfirmed: boolean;
    readonly opponentConfirmed: boolean;
    readonly remainingMs: number;
    readonly startCountdownMs: number | null;
  } | null;
  readonly battle: {
    readonly myShips: readonly PlacedShip[];
    readonly incomingShots: readonly ShotResult[]; // opponent's shots on my board
    readonly outgoingShots: readonly ShotResult[]; // my shots on opponent's board
    readonly currentTurn: Seat;
    readonly shotsAllowed: number;
    readonly myDraftTargets: readonly Coordinate[];
    readonly turnRemainingMs: number | null; // null before the first turn starts
    readonly paused: boolean;
    readonly afkCount: { readonly me: number; readonly opponent: number };
  } | null;
  readonly gameOver: {
    readonly winner: Seat | null;
    readonly reason: GameOverReason;
    readonly opponentShips: readonly PlacedShip[];
    readonly rematch: { readonly me: RematchChoice | null; readonly opponent: RematchChoice | null };
  } | null;
}
```

Timers are sent as **remaining milliseconds** (not absolute timestamps) to avoid client clock skew. The client counts down locally and re-syncs on every snapshot.

## Error codes

`PROTOCOL_MISMATCH`, `INVALID_PAYLOAD`, `RATE_LIMITED`, `SERVER_FULL`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `SESSION_INVALID`, `WRONG_PHASE`, `NOT_YOUR_TURN`, `NOT_ALLOWED`, `INVALID_RULES`, `STALE_RULES`, `INVALID_PLACEMENT`, `PLACEMENT_LOCKED`, `INVALID_TARGETS`.
