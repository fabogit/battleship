export {
  BOARD_SIZE,
  DICE_ANIMATION_MS,
  DISCONNECT_FORFEIT_MS,
  EMPTY_ROOM_TTL_MS,
  GAME_OVER_TTL_MS,
  MAX_CONSECUTIVE_AFK_TURNS,
  MAX_ROOMS,
  NICKNAME_MAX_LENGTH,
  PLACEMENT_TIME_LIMIT_MS,
  PROTOCOL_VERSION,
  RATE_LIMIT_EVENTS_PER_SECOND,
  SESSION_STORE_TTL_MS,
  START_COUNTDOWN_MS,
} from './constants.js';
export type { Ack, ClientToServerEvents, EchoResponse, HealthResponse, ServerToClientEvents } from './protocol.js';
export { DEFAULT_RULES } from './rules.js';
export { FLEET, SHIP_LENGTH } from './types.js';
export type {
  Coordinate,
  GameOverReason,
  GameRules,
  Orientation,
  PlacedShip,
  RematchChoice,
  RoomPhase,
  Seat,
  ShipPlacement,
  ShipType,
  ShotOutcome,
  ShotResult,
  TimeoutAction,
  TurnTimeLimitSeconds,
} from './types.js';
