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
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  SESSION_STORE_TTL_MS,
  START_COUNTDOWN_MS,
} from './constants.js';
export { randomTargets, resolveTurn, shotsAllowed, validateTargets } from './engine.js';
export type {
  Battle,
  Board,
  InvalidTargets,
  ResolvedTurn,
  TargetValidation,
  TargetViolation,
  TurnResolution,
  ValidTargets,
} from './engine.js';
export {
  completeFleet,
  generateRandomFleet,
  toPlacedShip,
  validateDraft,
  validateFleet,
} from './placement.js';
export type { InvalidPlacement, PlacementValidation, PlacementViolation, ValidPlacement } from './placement.js';
export { ERROR_CODES } from './protocol.js';
export type {
  Ack,
  AckFailure,
  AckResponse,
  AckSuccess,
  BattleSnapshot,
  ClientToServerEvents,
  CommandEvent,
  CommandPayload,
  ConfirmRulesPayload,
  CreateRoomPayload,
  DiceRoll,
  DiceRolledPayload,
  EchoResponse,
  EmptyPayload,
  ErrorCode,
  GameOverSnapshot,
  HandshakeAuth,
  HealthResponse,
  JoinRoomAckData,
  JoinRoomPayload,
  PerPlayer,
  PlacementSnapshot,
  PlayerStateSnapshot,
  PlayerView,
  RematchChoicePayload,
  ServerToClientEvents,
  SessionCredentials,
  SetPausedPayload,
  ShotResolvedPayload,
  TargetsPayload,
  UpdatePlacementPayload,
  UpdateRulesAckData,
  UpdateRulesPayload,
} from './protocol.js';
export { createCryptoRng, createSeededRng } from './random.js';
export type { Rng } from './random.js';
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
export { PAYLOAD_PARSERS, parseSessionCredentials } from './validation.js';
export type { PayloadParser } from './validation.js';
