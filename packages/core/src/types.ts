// Domain entities shared by server and client (docs/domain.md#domain-types). Each closed set of strings is an
// `as const` object with its type derived from it, so every package names a value instead of writing it out (ADR-0043).

/** A board cell, addressed from the top-left corner. */
export type Coordinate = {
  /** Column, integer, 0 ≤ x < BOARD_SIZE. */
  readonly x: number;
  /** Row, integer, 0 ≤ y < BOARD_SIZE. */
  readonly y: number;
};

/** The five ships of a fleet; their sizes are in `SHIP_LENGTH`. */
export const SHIP_TYPES = {
  /** 5 cells. */
  CARRIER: 'CARRIER',
  /** 4 cells. */
  BATTLESHIP: 'BATTLESHIP',
  /** 3 cells. */
  CRUISER: 'CRUISER',
  /** 3 cells, like the cruiser. */
  SUBMARINE: 'SUBMARINE',
  /** 2 cells. */
  DESTROYER: 'DESTROYER',
} as const;

/** One of the `SHIP_TYPES`. */
export type ShipType = (typeof SHIP_TYPES)[keyof typeof SHIP_TYPES];

/** Number of cells each ship occupies. */
export const SHIP_LENGTH: Readonly<Record<ShipType, number>> = {
  CARRIER: 5,
  BATTLESHIP: 4,
  CRUISER: 3,
  SUBMARINE: 3,
  DESTROYER: 2,
};

/** A complete fleet: each ship type exactly once, 17 cells in total. */
export const FLEET: readonly ShipType[] = [
  SHIP_TYPES.CARRIER,
  SHIP_TYPES.BATTLESHIP,
  SHIP_TYPES.CRUISER,
  SHIP_TYPES.SUBMARINE,
  SHIP_TYPES.DESTROYER,
];

/** Directions a ship can extend in from its `start` cell. */
export const ORIENTATIONS = {
  /** Towards larger x. */
  HORIZONTAL: 'HORIZONTAL',
  /** Towards larger y. */
  VERTICAL: 'VERTICAL',
} as const;

/** One of the `ORIENTATIONS`. */
export type Orientation = (typeof ORIENTATIONS)[keyof typeof ORIENTATIONS];

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

/** What a turn that runs out of time can do (docs/server.md#turns). */
export const TIMEOUT_ACTIONS = {
  /** Keeps the valid draft targets and fills the rest randomly. */
  AUTO_RANDOM_SHOT: 'AUTO_RANDOM_SHOT',
  /** Discards the draft and passes the turn. */
  PASS_TURN: 'PASS_TURN',
} as const;

/** One of the `TIMEOUT_ACTIONS`. */
export type TimeoutAction = (typeof TIMEOUT_ACTIONS)[keyof typeof TIMEOUT_ACTIONS];

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

/** What one target of a turn can find. */
export const SHOT_OUTCOMES = {
  /** No ship on the cell. */
  MISS: 'MISS',
  /** A ship that still has intact cells. */
  HIT: 'HIT',
  /** The ship's last intact cell. */
  SUNK: 'SUNK',
} as const;

/** One of the `SHOT_OUTCOMES`. */
export type ShotOutcome = (typeof SHOT_OUTCOMES)[keyof typeof SHOT_OUTCOMES];

/** One resolved target of a turn. */
export interface ShotResult {
  /** The targeted cell. */
  readonly coordinate: Coordinate;
  /** What the shot found there. */
  readonly outcome: ShotOutcome;
  /** The whole ship just sunk, so the shooter can draw it. Present only when `outcome` is `SUNK`. */
  readonly sunkShip?: PlacedShip;
}

/** A player's position in the room. */
export const SEATS = {
  /** The room's creator. */
  P1: 'P1',
  /** The joiner. */
  P2: 'P2',
} as const;

/** One of the `SEATS`. */
export type Seat = (typeof SEATS)[keyof typeof SEATS];

/** The stages a room goes through; transitions are described in docs/server.md#room-state-machine. */
export const ROOM_PHASES = {
  /** One seat taken: the creator sharing the room link, or the player left behind when the other one leaves. */
  WAITING_FOR_OPPONENT: 'WAITING_FOR_OPPONENT',
  /** Both seated, agreeing on the rules (ADR-0003); skipped with `DEFAULT_RULES` until #26. */
  RULES_NEGOTIATION: 'RULES_NEGOTIATION',
  /** Both placing their fleets within `PLACEMENT_TIME_LIMIT_MS`, then the start countdown. */
  PLACEMENT: 'PLACEMENT',
  /** The battle: turns, shots, AFK and disconnection forfeits. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** The result and the rematch choices, until `GAME_OVER_TTL_MS` passes without a rematch. */
  GAME_OVER: 'GAME_OVER',
} as const;

/** One of the `ROOM_PHASES`. */
export type RoomPhase = (typeof ROOM_PHASES)[keyof typeof ROOM_PHASES];

/** Why a match can end; every reason but `ABANDONED` has a winner (docs/server.md#game-over--rematch). */
export const GAME_OVER_REASONS = {
  /** The winner sank the opponent's last ship. */
  FLEET_DESTROYED: 'FLEET_DESTROYED',
  /** The loser surrendered, or left the room during the match. */
  SURRENDER: 'SURRENDER',
  /** The loser timed out `MAX_CONSECUTIVE_AFK_TURNS` turns in a row (ADR-0009). */
  AFK_FORFEIT: 'AFK_FORFEIT',
  /** The loser stayed disconnected for `DISCONNECT_FORFEIT_MS` (ADR-0008). */
  DISCONNECT_FORFEIT: 'DISCONNECT_FORFEIT',
  /** Both players AFK: no winner. */
  ABANDONED: 'ABANDONED',
} as const;

/** One of the `GAME_OVER_REASONS`. */
export type GameOverReason = (typeof GAME_OVER_REASONS)[keyof typeof GAME_OVER_REASONS];

/** What a player can pick at game over (ADR-0012). */
export const REMATCH_CHOICES = {
  /** Play again with the same rules; loses to `CHANGE_RULES`. */
  SAME_RULES: 'SAME_RULES',
  /** Play again after a new rules negotiation; wins over `SAME_RULES`. */
  CHANGE_RULES: 'CHANGE_RULES',
  /** Free the leaver's seat. */
  LEAVE: 'LEAVE',
} as const;

/** One of the `REMATCH_CHOICES`. */
export type RematchChoice = (typeof REMATCH_CHOICES)[keyof typeof REMATCH_CHOICES];
