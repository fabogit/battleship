// Domain entities shared by server and client (docs/domain.md#domain-types).

/** A board cell, addressed from the top-left corner. */
export type Coordinate = {
  /** Column, integer, 0 ≤ x < BOARD_SIZE. */
  readonly x: number;
  /** Row, integer, 0 ≤ y < BOARD_SIZE. */
  readonly y: number;
};

/** The five ships of a fleet; their sizes are in `SHIP_LENGTH`. */
export type ShipType = 'CARRIER' | 'BATTLESHIP' | 'CRUISER' | 'SUBMARINE' | 'DESTROYER';

/** Number of cells each ship occupies. */
export const SHIP_LENGTH: Readonly<Record<ShipType, number>> = {
  CARRIER: 5,
  BATTLESHIP: 4,
  CRUISER: 3,
  SUBMARINE: 3,
  DESTROYER: 2,
};

/** A complete fleet: each ship type exactly once, 17 cells in total. */
export const FLEET: readonly ShipType[] = ['CARRIER', 'BATTLESHIP', 'CRUISER', 'SUBMARINE', 'DESTROYER'];

/** Direction a ship extends from its `start` cell: `HORIZONTAL` towards larger x, `VERTICAL` towards larger y. */
export type Orientation = 'HORIZONTAL' | 'VERTICAL';

/** What the client sends: the server never trusts client-computed coordinates. */
export interface ShipPlacement {
  /** Which ship this is; at most once per fleet. */
  readonly type: ShipType;
  /** The ship's first cell, the one with the smallest x and y. */
  readonly start: Coordinate;
  /** Direction the remaining `SHIP_LENGTH[type] − 1` cells extend in. */
  readonly orientation: Orientation;
}

/** Derived by core from a ShipPlacement. */
export interface PlacedShip extends ShipPlacement {
  /** Every cell the ship occupies, from `start` onwards; `SHIP_LENGTH[type]` entries. */
  readonly coordinates: readonly Coordinate[];
}

/** Turn durations a room can choose, in seconds. */
export type TurnTimeLimitSeconds = 15 | 30 | 60 | 120;

/**
 * What a turn that runs out of time does (docs/server.md#turns): `AUTO_RANDOM_SHOT` keeps the valid draft targets and
 * fills the rest randomly; `PASS_TURN` discards the draft and passes the turn.
 */
export type TimeoutAction = 'AUTO_RANDOM_SHOT' | 'PASS_TURN';

/**
 * The rules both players agree on before placement (docs/server.md#rules-negotiation).
 * Invariant: isSalvoModeEnabled && isExtraTurnOnHitEnabled is invalid (ADR-0010).
 */
export interface GameRules {
  /** Whether any `HIT` or `SUNK` gives the shooter another turn with a fresh timer. Standard mode only. */
  readonly isExtraTurnOnHitEnabled: boolean;
  /** Whether ships may touch, diagonally included; when false, placement rejects touching ships. */
  readonly areAdjacentShipsAllowed: boolean;
  /** Time each turn allows before the timeout action applies. */
  readonly turnTimeLimitSeconds: TurnTimeLimitSeconds;
  /** Whether a turn fires up to one target per surviving ship instead of one (docs/domain.md#shot-engine). */
  readonly isSalvoModeEnabled: boolean;
  /** What happens when a turn runs out of time. */
  readonly timeoutAction: TimeoutAction;
}

/** Result of one target: `SUNK` when the hit was the ship's last intact cell. */
export type ShotOutcome = 'MISS' | 'HIT' | 'SUNK';

/** One resolved target of a turn. */
export interface ShotResult {
  /** The targeted cell. */
  readonly coordinate: Coordinate;
  /** What the shot found there. */
  readonly outcome: ShotOutcome;
  /** The whole ship just sunk, so the shooter can draw it. Present only when outcome === 'SUNK'. */
  readonly sunkShip?: PlacedShip;
}

/** A player's position in the room: `P1` for the creator, `P2` for the joiner. */
export type Seat = 'P1' | 'P2';

/** The stage a room is in; transitions are described in docs/server.md#room-state-machine. */
export type RoomPhase = 'WAITING_FOR_OPPONENT' | 'RULES_NEGOTIATION' | 'PLACEMENT' | 'IN_PROGRESS' | 'GAME_OVER';

/** Why a match ended; every reason but `ABANDONED` has a winner (docs/server.md#game-over--rematch). */
export type GameOverReason =
  | 'FLEET_DESTROYED'
  | 'SURRENDER'
  | 'AFK_FORFEIT'
  | 'DISCONNECT_FORFEIT'
  | 'ABANDONED'; // both players AFK — no winner

/** What a player picks at game over; `CHANGE_RULES` wins over `SAME_RULES`, and `LEAVE` frees the leaver's seat. */
export type RematchChoice = 'SAME_RULES' | 'CHANGE_RULES' | 'LEAVE';
