// Socket.io contract shared by server and client (docs/protocol.md, ADR-0015). Types, plus the `as const` objects that
// name the error codes and event names (ADR-0043): core keeps zero runtime dependencies.

import type {
  Coordinate,
  GameOverReason,
  GameRules,
  PlacedShip,
  RematchChoice,
  RoomPhase,
  Seat,
  ShipPlacement,
  ShotResult,
} from './types.js';

/** Callback a client passes as the last argument of a command to receive the server's reply. */
export type Ack<T> = (response: T) => void;

/** Body of `GET /health` (docs/deployment.md#backend-render); the client polls it to wake the server (docs/client.md#cold-start-handling). */
export interface HealthResponse {
  readonly status: 'ok';
  /** Seconds since the server process started. */
  readonly uptime: number;
}

/** Reply to the Phase 0 `ECHO` connectivity check. */
export interface EchoResponse {
  readonly ok: true;
  readonly payload: unknown;
  readonly protocolVersion: number;
}

/**
 * Every reason the server can refuse a command or a handshake, in the order of docs/protocol.md#error-codes.
 * `Object.values(ERROR_CODES)` lists them at runtime in that order, so the client can check that each code has a
 * message.
 */
export const ERROR_CODES = {
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER_FULL: 'SERVER_FULL',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  SESSION_INVALID: 'SESSION_INVALID',
  WRONG_PHASE: 'WRONG_PHASE',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  NOT_ALLOWED: 'NOT_ALLOWED',
  INVALID_RULES: 'INVALID_RULES',
  STALE_RULES: 'STALE_RULES',
  INVALID_PLACEMENT: 'INVALID_PLACEMENT',
  PLACEMENT_LOCKED: 'PLACEMENT_LOCKED',
  INVALID_TARGETS: 'INVALID_TARGETS',
} as const;

/** Why the server refused a command or a handshake (docs/protocol.md#error-codes): one of the `ERROR_CODES`. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Reply to a refused command; the room is left unchanged. */
export interface AckFailure {
  /** Discriminant shared with the accepted reply. */
  readonly ok: false;
  /** What went wrong; `INVALID_PAYLOAD` when the payload failed its guard (docs/protocol.md#payload-validation). */
  readonly error: ErrorCode;
}

/** Reply to an accepted command; commands that return data add their fields to it. */
export interface AckSuccess {
  /** Discriminant shared with the refused reply. */
  readonly ok: true;
}

/**
 * Reply to a command: `{ ok: true }` plus the command's data, or an `AckFailure`.
 * @template T The data an accepted command returns; none by default.
 */
export type AckResponse<T extends object = AckSuccess> = (AckSuccess & Readonly<T>) | AckFailure;

/** Payload of the commands and server events that carry no data: exactly `{}`. */
export type EmptyPayload = Record<string, never>;

/** What a client stores to get its seat back after a reconnect (docs/server.md#sessions--reconnection). */
export interface SessionCredentials {
  /** `ROOM_ID_LENGTH` characters of `ROOM_ID_ALPHABET`. */
  readonly roomId: string;
  /** The seat's secret, a lowercase `crypto.randomUUID()`; never sent to the other player. */
  readonly playerSecret: string;
}

/**
 * The Socket.io handshake `auth`, re-evaluated by the client on every reconnect attempt (docs/protocol.md#handshake).
 * The server compares `protocolVersion` first (ADR-0017), then checks `session` with `parseSessionCredentials`.
 */
export interface HandshakeAuth {
  /** The client's `PROTOCOL_VERSION`; any other value, or none, is refused with `PROTOCOL_MISMATCH`. */
  readonly protocolVersion: number;
  /** Stored credentials of the room being reopened; absent when the client is not in a room. */
  readonly session?: SessionCredentials;
}

/** `CREATE_ROOM`: opens a room and seats the sender as `P1`. */
export interface CreateRoomPayload {
  /** Trimmed, 1 to `NICKNAME_MAX_LENGTH` UTF-16 code units. */
  readonly nickname: string;
}

/** `JOIN_ROOM`: seats the sender as `P2` in a waiting room. */
export interface JoinRoomPayload {
  /** The id from the shared `/r/<roomId>` link. */
  readonly roomId: string;
  /** Trimmed, 1 to `NICKNAME_MAX_LENGTH` UTF-16 code units. */
  readonly nickname: string;
}

/** `UPDATE_RULES`: replaces the room's rules, bumps `rulesVersion` and clears both confirmations (ADR-0003). */
export interface UpdateRulesPayload {
  /** The complete new rules; the salvo/extra-turn exclusivity is checked by `validateRules` (`INVALID_RULES`). */
  readonly rules: GameRules;
}

/** `CONFIRM_RULES`: accepts the rules as of one version (ADR-0004). */
export interface ConfirmRulesPayload {
  /** The version the player saw, a non-negative integer; any other than the current one is `STALE_RULES`. */
  readonly rulesVersion: number;
}

/** `UPDATE_PLACEMENT`: replaces the player's draft layout (ADR-0005). */
export interface UpdatePlacementPayload {
  /** 0 to `FLEET.length` ships; bounds, overlaps, adjacency and repeated types are `INVALID_PLACEMENT`. */
  readonly ships: readonly ShipPlacement[];
}

/** `UPDATE_TARGETS` (draft) and `FIRE` (commit): the cells the active player aims at this turn. */
export interface TargetsPayload {
  /**
   * On-board cells, at most one per surviving ship, so at most `FLEET.length`; `FIRE` needs at least one. The exact
   * count, repeated cells and cells already shot depend on the turn and are `INVALID_TARGETS`.
   */
  readonly targets: readonly Coordinate[];
}

/** `SET_PAUSED`: pauses or resumes a match while the opponent is disconnected (ADR-0008). */
export interface SetPausedPayload {
  /** Whether the turn timer should be frozen. */
  readonly isPaused: boolean;
}

/** `REMATCH_CHOICE`: the player's pick at game over; it can change until the rematch resolves (ADR-0012). */
export interface RematchChoicePayload {
  /** `CHANGE_RULES` wins over `SAME_RULES`; `LEAVE` frees the sender's seat. */
  readonly choice: RematchChoice;
}

/** Data of an accepted `JOIN_ROOM`; the joiner already knows the room id. */
export interface JoinRoomAckData {
  /** The joiner's secret, stored with the room id as `SessionCredentials`. */
  readonly playerSecret: string;
}

/** Data of an accepted `UPDATE_RULES`. */
export interface UpdateRulesAckData {
  /** The version the new rules got; the sender confirms it like the opponent does. */
  readonly rulesVersion: number;
}

/**
 * Commands a client sends, each with a payload and an ack (docs/protocol.md#client--server). A payload that fails its
 * guard in `validation.ts` is refused with `INVALID_PAYLOAD`; a command sent in another phase with `WRONG_PHASE`.
 */
export interface ClientToServerEvents {
  /** Phase 0 connectivity check (issue #3): the server acks with the payload it received, which no guard checks. */
  ECHO: (payload: unknown, ack: Ack<EchoResponse>) => void;
  /** Opens a room from the home screen; the ack carries the credentials to store (`SERVER_FULL` above `MAX_ROOMS`). */
  CREATE_ROOM: (payload: CreateRoomPayload, ack: Ack<AckResponse<SessionCredentials>>) => void;
  /** Takes the free seat of a room in `WAITING_FOR_OPPONENT` (`ROOM_NOT_FOUND`, `ROOM_FULL`). */
  JOIN_ROOM: (payload: JoinRoomPayload, ack: Ack<AckResponse<JoinRoomAckData>>) => void;
  /** Proposes new rules in `RULES_NEGOTIATION`; either player may (ADR-0003). */
  UPDATE_RULES: (payload: UpdateRulesPayload, ack: Ack<AckResponse<UpdateRulesAckData>>) => void;
  /** Confirms one version of the rules in `RULES_NEGOTIATION`; both confirmations of the current one start placement. */
  CONFIRM_RULES: (payload: ConfirmRulesPayload, ack: Ack<AckResponse>) => void;
  /** Sends the full draft layout in `PLACEMENT` (`PLACEMENT_LOCKED` while confirmed). */
  UPDATE_PLACEMENT: (payload: UpdatePlacementPayload, ack: Ack<AckResponse>) => void;
  /** Locks a complete, valid fleet in `PLACEMENT`. */
  CONFIRM_PLACEMENT: (payload: EmptyPayload, ack: Ack<AckResponse>) => void;
  /** Reverts a confirmed fleet to draft in `PLACEMENT`, cancelling the start countdown. */
  UNLOCK_PLACEMENT: (payload: EmptyPayload, ack: Ack<AckResponse>) => void;
  /** Replaces the draft targets during the sender's own turn in `IN_PROGRESS` (`NOT_YOUR_TURN` otherwise). */
  UPDATE_TARGETS: (payload: TargetsPayload, ack: Ack<AckResponse>) => void;
  /** Fires during the sender's own turn in `IN_PROGRESS`; the outcome arrives as `SHOT_RESOLVED` and `STATE`. */
  FIRE: (payload: TargetsPayload, ack: Ack<AckResponse>) => void;
  /** Pauses or resumes `IN_PROGRESS`; only the connected player, while the opponent is disconnected (`NOT_ALLOWED`). */
  SET_PAUSED: (payload: SetPausedPayload, ack: Ack<AckResponse>) => void;
  /** Ends an `IN_PROGRESS` match with reason `SURRENDER`. */
  SURRENDER: (payload: EmptyPayload, ack: Ack<AckResponse>) => void;
  /** Picks what happens after `GAME_OVER`. */
  REMATCH_CHOICE: (payload: RematchChoicePayload, ack: Ack<AckResponse>) => void;
  /** Frees the sender's seat in any phase; in `IN_PROGRESS` it ends the match as `SURRENDER`. */
  LEAVE_ROOM: (payload: EmptyPayload, ack: Ack<AckResponse>) => void;
}

/**
 * The name of every client→server event, in the order of `ClientToServerEvents`. `satisfies` keeps it in step with the
 * event map: a missing or extra event, or a value that differs from its key, is a compile error.
 */
export const CLIENT_EVENTS = {
  ECHO: 'ECHO',
  CREATE_ROOM: 'CREATE_ROOM',
  JOIN_ROOM: 'JOIN_ROOM',
  UPDATE_RULES: 'UPDATE_RULES',
  CONFIRM_RULES: 'CONFIRM_RULES',
  UPDATE_PLACEMENT: 'UPDATE_PLACEMENT',
  CONFIRM_PLACEMENT: 'CONFIRM_PLACEMENT',
  UNLOCK_PLACEMENT: 'UNLOCK_PLACEMENT',
  UPDATE_TARGETS: 'UPDATE_TARGETS',
  FIRE: 'FIRE',
  SET_PAUSED: 'SET_PAUSED',
  SURRENDER: 'SURRENDER',
  REMATCH_CHOICE: 'REMATCH_CHOICE',
  LEAVE_ROOM: 'LEAVE_ROOM',
} as const satisfies { readonly [E in keyof ClientToServerEvents]: E };

/** Client→server events whose payload passes a guard: every command but the Phase 0 `ECHO`. */
export type CommandEvent = Exclude<keyof ClientToServerEvents, typeof CLIENT_EVENTS.ECHO>;

/**
 * The payload of one command, as its guard returns it.
 * @template E The command's event name.
 */
export type CommandPayload<E extends CommandEvent> = Parameters<ClientToServerEvents[E]>[0];

/**
 * One value per player, from the receiver's point of view.
 * @template T What is tracked per player.
 */
export interface PerPlayer<T> {
  /** The receiver's value. */
  readonly me: T;
  /** The other seat's value. */
  readonly opponent: T;
}

/** What a snapshot shows about one seated player. */
export interface PlayerView {
  /** `P1` for the creator, `P2` for the joiner. */
  readonly seat: Seat;
  /** Trimmed by the guard; rendered as text only. */
  readonly nickname: string;
  /** Whether a socket is bound to the seat right now. */
  readonly isConnected: boolean;
  /** Time left before the seat is forfeited (`DISCONNECT_FORFEIT_MS` from the disconnection); `null` while connected. */
  readonly forfeitRemainingMs: number | null;
}

/** The `PLACEMENT` part of a snapshot. */
export interface PlacementSnapshot {
  /** The receiver's draft or confirmed layout; the opponent's is never sent. */
  readonly myShips: readonly PlacedShip[];
  /** Whether each player has locked their fleet. */
  readonly hasConfirmed: PerPlayer<boolean>;
  /** Time left before every unconfirmed fleet is completed and locked. */
  readonly remainingMs: number;
  /** Time left before the match starts while both fleets are confirmed; `null` otherwise. */
  readonly startCountdownMs: number | null;
}

/** The `IN_PROGRESS` part of a snapshot. */
export interface BattleSnapshot {
  /** The receiver's fleet as placed; hits on it are in `incomingShots`. */
  readonly myShips: readonly PlacedShip[];
  /** The opponent's shots on the receiver's board, oldest first. */
  readonly incomingShots: readonly ShotResult[];
  /** The receiver's shots on the opponent's board, oldest first: all the receiver learns of that fleet (fog-of-war). */
  readonly outgoingShots: readonly ShotResult[];
  /** Whose turn it is. */
  readonly currentTurn: Seat;
  /** How many targets the current turn fires (docs/domain.md#shot-engine). */
  readonly shotsAllowed: number;
  /** The receiver's draft from `UPDATE_TARGETS`; empty when it is not their turn. */
  readonly myDraftTargets: readonly Coordinate[];
  /** Time left in the current turn; `null` before the first turn starts, while the dice animation plays. */
  readonly turnRemainingMs: number | null;
  /** Whether the turn timer is frozen because a player is disconnected (ADR-0008). */
  readonly isPaused: boolean;
  /** Turns each player timed out in a row; `MAX_CONSECUTIVE_AFK_TURNS` forfeits (ADR-0009). */
  readonly afkCount: PerPlayer<number>;
}

/** The `GAME_OVER` part of a snapshot. */
export interface GameOverSnapshot {
  /** `null` only when the reason is `ABANDONED`. */
  readonly winner: Seat | null;
  /** How the match ended (docs/server.md#game-over--rematch). */
  readonly reason: GameOverReason;
  /** The opponent's whole fleet, revealed now that the match is over. */
  readonly opponentShips: readonly PlacedShip[];
  /** Each player's pick so far; `null` until they choose. */
  readonly rematch: PerPlayer<RematchChoice | null>;
}

/**
 * Everything one player may see of a room: the client's single source of truth (ADR-0015). Sent as `STATE` after every
 * change and on (re)connect. Timers are remaining milliseconds, not timestamps, so client clock skew does not matter.
 */
export interface PlayerStateSnapshot {
  /** The room's id, as in its `/r/<roomId>` link. */
  readonly roomId: string;
  /** Which of `placement`, `battle` and `gameOver` is set follows from it. */
  readonly phase: RoomPhase;
  /** The receiver. */
  readonly me: PlayerView;
  /** `null` while the other seat is empty. */
  readonly opponent: PlayerView | null;
  /** The current rules; during negotiation, the latest proposal. */
  readonly rules: GameRules;
  /** Bumped by every `UPDATE_RULES`; `CONFIRM_RULES` quotes it (ADR-0004). */
  readonly rulesVersion: number;
  /** Whether each player has confirmed `rulesVersion`; `false` for an empty seat. */
  readonly hasConfirmedRules: PerPlayer<boolean>;
  /** Set in `PLACEMENT` only. */
  readonly placement: PlacementSnapshot | null;
  /** Set in `IN_PROGRESS` only. */
  readonly battle: BattleSnapshot | null;
  /** Set in `GAME_OVER` only. */
  readonly gameOver: GameOverSnapshot | null;
}

/** `SHOT_RESOLVED`: one fired turn, for animation and sound; the next `STATE` carries the same outcome. */
export interface ShotResolvedPayload {
  /** Who fired. */
  readonly shooter: Seat;
  /** One result per target, in firing order. */
  readonly results: readonly ShotResult[];
}

/** One round of the starting dice roll: a d6 per seat, each 1 to 6 (ADR-0002). */
export type DiceRoll = Readonly<Record<Seat, number>>;

/** `DICE_ROLLED`: who starts the match, with every round so the client can animate the re-rolls. */
export interface DiceRolledPayload {
  /** Every round in order; all but the last are ties. */
  readonly rolls: readonly DiceRoll[];
  /** The seat with the higher last roll; it takes the first turn. */
  readonly starter: Seat;
}

/** Events the server sends (docs/protocol.md#server--client). */
export interface ServerToClientEvents {
  /** The receiver's snapshot, after every change and on (re)connect. */
  STATE: (snapshot: PlayerStateSnapshot) => void;
  /** A turn was fired; animation only. */
  SHOT_RESOLVED: (payload: ShotResolvedPayload) => void;
  /** The starting dice roll; the first turn timer waits `DICE_ANIMATION_MS` for it. */
  DICE_ROLLED: (payload: DiceRolledPayload) => void;
  /** A newer socket took this seat; the server disconnects this one (ADR-0014). */
  SESSION_REPLACED: (payload: EmptyPayload) => void;
  /** The server is restarting; any match in progress is lost (docs/deployment.md#backend-render). */
  SERVER_SHUTDOWN: (payload: EmptyPayload) => void;
}

/**
 * The name of every server→client event, in the order of `ServerToClientEvents`. `satisfies` keeps it in step with the
 * event map: a missing or extra event, or a value that differs from its key, is a compile error.
 */
export const SERVER_EVENTS = {
  STATE: 'STATE',
  SHOT_RESOLVED: 'SHOT_RESOLVED',
  DICE_ROLLED: 'DICE_ROLLED',
  SESSION_REPLACED: 'SESSION_REPLACED',
  SERVER_SHUTDOWN: 'SERVER_SHUTDOWN',
} as const satisfies { readonly [E in keyof ServerToClientEvents]: E };
