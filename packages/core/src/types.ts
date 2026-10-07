// Domain entities shared by server and client (docs/domain.md#domain-types).

/** A board cell. */
export type Coordinate = {
  /** Integer, 0 ≤ x < BOARD_SIZE. */
  readonly x: number;
  /** Integer, 0 ≤ y < BOARD_SIZE. */
  readonly y: number;
};

export type ShipType = 'CARRIER' | 'BATTLESHIP' | 'CRUISER' | 'SUBMARINE' | 'DESTROYER';

/** Number of cells each ship occupies. */
export const SHIP_LENGTH: Readonly<Record<ShipType, number>> = {
  CARRIER: 5,
  BATTLESHIP: 4,
  CRUISER: 3,
  SUBMARINE: 3,
  DESTROYER: 2,
};

/** A complete fleet: each ship type exactly once. */
export const FLEET: readonly ShipType[] = ['CARRIER', 'BATTLESHIP', 'CRUISER', 'SUBMARINE', 'DESTROYER'];

export type Orientation = 'HORIZONTAL' | 'VERTICAL';

/** What the client sends: the server never trusts client-computed coordinates. */
export interface ShipPlacement {
  readonly type: ShipType;
  readonly start: Coordinate;
  readonly orientation: Orientation;
}

/** Derived by core from a ShipPlacement. */
export interface PlacedShip extends ShipPlacement {
  readonly coordinates: readonly Coordinate[];
}

export type TurnTimeLimitSeconds = 15 | 30 | 60 | 120;
export type TimeoutAction = 'AUTO_RANDOM_SHOT' | 'PASS_TURN';

/** Invariant: isSalvoModeEnabled && isExtraTurnOnHitEnabled is invalid. */
export interface GameRules {
  readonly isExtraTurnOnHitEnabled: boolean;
  readonly areAdjacentShipsAllowed: boolean;
  readonly turnTimeLimitSeconds: TurnTimeLimitSeconds;
  readonly isSalvoModeEnabled: boolean;
  readonly timeoutAction: TimeoutAction;
}

export type ShotOutcome = 'MISS' | 'HIT' | 'SUNK';

export interface ShotResult {
  readonly coordinate: Coordinate;
  readonly outcome: ShotOutcome;
  /** Present only when outcome === 'SUNK'. */
  readonly sunkShip?: PlacedShip;
}

export type Seat = 'P1' | 'P2';

export type RoomPhase = 'WAITING_FOR_OPPONENT' | 'RULES_NEGOTIATION' | 'PLACEMENT' | 'IN_PROGRESS' | 'GAME_OVER';

export type GameOverReason =
  | 'FLEET_DESTROYED'
  | 'SURRENDER'
  | 'AFK_FORFEIT'
  | 'DISCONNECT_FORFEIT'
  | 'ABANDONED'; // both players AFK — no winner

export type RematchChoice = 'SAME_RULES' | 'CHANGE_RULES' | 'LEAVE';
