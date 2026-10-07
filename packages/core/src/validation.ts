// Hand-written guards for every client→server payload (docs/protocol.md#payload-validation, ADR-0016, ADR-0031).

import { BOARD_SIZE, NICKNAME_MAX_LENGTH, ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from './constants.js';
import type { CommandEvent, CommandPayload, EmptyPayload, SessionCredentials, TargetsPayload } from './protocol.js';
import { FLEET, SHIP_LENGTH } from './types.js';
import type {
  Coordinate,
  GameRules,
  Orientation,
  RematchChoice,
  ShipPlacement,
  TimeoutAction,
  TurnTimeLimitSeconds,
} from './types.js';

/**
 * A guard: checks an untrusted value and returns a new, normalized copy of it, or `null` when it is malformed. It never
 * throws and never returns the input object itself.
 * @template T The payload type a well-formed value is returned as.
 */
export type PayloadParser<T> = (value: unknown) => T | null;

/** An object already known to have exactly the expected own properties, whose values are still unchecked. */
type UncheckedFields = Readonly<Record<string, unknown>>;

/** Ships in a draft: one per fleet type at most. Repeated types are left to placement validation. */
const MAX_SHIPS = FLEET.length;

/** Targets in a turn: one per surviving ship in salvo mode, so never more than a whole fleet. */
const MAX_TARGETS = FLEET.length;

/** Valid orientations, as a record so that a new `Orientation` member is a compile error here. */
const ORIENTATIONS: Readonly<Record<Orientation, true>> = { HORIZONTAL: true, VERTICAL: true };

/** Valid timeout actions, as a record so that a new `TimeoutAction` member is a compile error here. */
const TIMEOUT_ACTIONS: Readonly<Record<TimeoutAction, true>> = { AUTO_RANDOM_SHOT: true, PASS_TURN: true };

/** Valid rematch choices, as a record so that a new `RematchChoice` member is a compile error here. */
const REMATCH_CHOICES: Readonly<Record<RematchChoice, true>> = { SAME_RULES: true, CHANGE_RULES: true, LEAVE: true };

/** Valid turn durations, as a record so that a new `TurnTimeLimitSeconds` member is a compile error here. */
const TURN_TIME_LIMITS: Readonly<Record<TurnTimeLimitSeconds, true>> = { 15: true, 30: true, 60: true, 120: true };

/** `ROOM_ID_LENGTH` characters of `ROOM_ID_ALPHABET`, which holds only digits and lowercase letters. */
const ROOM_ID_PATTERN = new RegExp(`^[${ROOM_ID_ALPHABET}]{${String(ROOM_ID_LENGTH)}}$`);

/** A lowercase version 4 UUID, the format of `crypto.randomUUID()`. */
const PLAYER_SECRET_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Checks that a value is a plain object (as `JSON.parse` builds them) with exactly the given own properties. Missing
 * and extra properties are both refused (ADR-0031).
 * @param value The untrusted value.
 * @param keys Every property the payload must have, and the only ones it may have.
 * @returns The value, typed for reading its fields, or `null`.
 */
function withExactKeys(value: unknown, keys: readonly string[]): UncheckedFields | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }
  // Reflect.ownKeys also lists symbol and non-enumerable keys, so nothing hides from the count.
  const hasExactKeys = Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  return hasExactKeys ? (value as UncheckedFields) : null;
}

/**
 * Checks an array's length before looking at any element, then every element.
 * @param value The untrusted value.
 * @param minLength Fewest elements allowed.
 * @param maxLength Most elements allowed.
 * @param parseItem The guard for one element.
 * @returns A new array of the parsed elements, or `null` when the length or any element is wrong.
 */
function parseArray<T>(value: unknown, minLength: number, maxLength: number, parseItem: PayloadParser<T>): T[] | null {
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) {
    return null;
  }
  const items: T[] = [];
  // Indexed, not for…of: a hole in a sparse array reads as `undefined` and is refused like any bad element.
  for (let index = 0; index < value.length; index++) {
    const item = parseItem((value as readonly unknown[])[index]);
    if (item === null) {
      return null;
    }
    items.push(item);
  }
  return items;
}

/**
 * Checks a string against a closed set of values.
 * @param members The set, as a record keyed by its values.
 * @param value The untrusted value.
 * @returns Whether the value is a string and one of the record's own keys.
 */
function isStringMember<K extends string>(members: Readonly<Record<K, unknown>>, value: unknown): value is K {
  return typeof value === 'string' && Object.hasOwn(members, value);
}

/**
 * Checks a turn duration; a separate check because the record's keys are strings and `'30'` must not pass.
 * @param value The untrusted value.
 * @returns Whether the value is one of the numbers in `TurnTimeLimitSeconds`.
 */
function isTurnTimeLimit(value: unknown): value is TurnTimeLimitSeconds {
  return typeof value === 'number' && Object.hasOwn(TURN_TIME_LIMITS, value);
}

/**
 * Checks one coordinate axis.
 * @param value The untrusted value.
 * @returns Whether the value is an integer from 0 to `BOARD_SIZE − 1`.
 */
function isBoardIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < BOARD_SIZE;
}

/**
 * Checks a room id against its fixed format, so lookups never see arbitrary strings.
 * @param value The untrusted value.
 * @returns Whether the value is `ROOM_ID_LENGTH` characters of `ROOM_ID_ALPHABET`.
 */
function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID_PATTERN.test(value);
}

/**
 * Trims a nickname and checks its length (NICKNAME_MAX_LENGTH counts UTF-16 code units, like HTML `maxlength`).
 * @param value The untrusted value.
 * @returns The trimmed nickname, or `null` when the value is not a string or is empty or too long once trimmed.
 */
function parseNickname(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const nickname = value.trim();
  return nickname.length > 0 && nickname.length <= NICKNAME_MAX_LENGTH ? nickname : null;
}

/**
 * Checks a board cell.
 * @param value The untrusted value.
 * @returns A new `{ x, y }` with both axes on the board, or `null`.
 */
function parseCoordinate(value: unknown): Coordinate | null {
  const fields = withExactKeys(value, ['x', 'y']);
  if (fields === null) {
    return null;
  }
  const x = fields['x'];
  const y = fields['y'];
  return isBoardIndex(x) && isBoardIndex(y) ? { x, y } : null;
}

/**
 * Checks one ship of a draft. Only the start cell must be on the board; whether the whole ship fits is placement
 * validation (`INVALID_PLACEMENT`).
 * @param value The untrusted value.
 * @returns A new `ShipPlacement`, or `null`.
 */
function parseShipPlacement(value: unknown): ShipPlacement | null {
  const fields = withExactKeys(value, ['type', 'start', 'orientation']);
  if (fields === null) {
    return null;
  }
  const type = fields['type'];
  const start = parseCoordinate(fields['start']);
  const orientation = fields['orientation'];
  if (!isStringMember(SHIP_LENGTH, type) || start === null || !isStringMember(ORIENTATIONS, orientation)) {
    return null;
  }
  return { type, start, orientation };
}

/**
 * Checks the shape of a rules object. The salvo/extra-turn exclusivity is `validateRules`'s job (`INVALID_RULES`).
 * @param value The untrusted value.
 * @returns A new `GameRules`, or `null`.
 */
function parseGameRules(value: unknown): GameRules | null {
  const fields = withExactKeys(value, [
    'isExtraTurnOnHitEnabled',
    'areAdjacentShipsAllowed',
    'turnTimeLimitSeconds',
    'isSalvoModeEnabled',
    'timeoutAction',
  ]);
  if (fields === null) {
    return null;
  }
  const isExtraTurnOnHitEnabled = fields['isExtraTurnOnHitEnabled'];
  const areAdjacentShipsAllowed = fields['areAdjacentShipsAllowed'];
  const turnTimeLimitSeconds = fields['turnTimeLimitSeconds'];
  const isSalvoModeEnabled = fields['isSalvoModeEnabled'];
  const timeoutAction = fields['timeoutAction'];
  if (
    typeof isExtraTurnOnHitEnabled !== 'boolean' ||
    typeof areAdjacentShipsAllowed !== 'boolean' ||
    !isTurnTimeLimit(turnTimeLimitSeconds) ||
    typeof isSalvoModeEnabled !== 'boolean' ||
    !isStringMember(TIMEOUT_ACTIONS, timeoutAction)
  ) {
    return null;
  }
  return { isExtraTurnOnHitEnabled, areAdjacentShipsAllowed, turnTimeLimitSeconds, isSalvoModeEnabled, timeoutAction };
}

/**
 * Checks a payload that must be exactly `{}`.
 * @param value The untrusted value.
 * @returns A new `{}`, or `null`.
 */
function parseEmptyPayload(value: unknown): EmptyPayload | null {
  return withExactKeys(value, []) === null ? null : {};
}

/**
 * Builds the guard for `UPDATE_TARGETS` (a draft may be empty) or `FIRE` (a turn fires at least one target).
 * @param minTargets Fewest targets the command accepts.
 * @returns The guard.
 */
function targetsParser(minTargets: number): PayloadParser<TargetsPayload> {
  return (value) => {
    const fields = withExactKeys(value, ['targets']);
    const targets = fields === null ? null : parseArray(fields['targets'], minTargets, MAX_TARGETS, parseCoordinate);
    return targets === null ? null : { targets };
  };
}

/**
 * One guard per command, which the server runs before any room logic; `null` means `INVALID_PAYLOAD`. Guards check
 * shape only: types, integer ranges, closed enums, string lengths and array sizes that no room state could make valid
 * (ADR-0031). The mapped type makes a command without a guard a compile error.
 */
export const PAYLOAD_PARSERS: { readonly [E in CommandEvent]: PayloadParser<CommandPayload<E>> } = {
  CREATE_ROOM: (value) => {
    const fields = withExactKeys(value, ['nickname']);
    const nickname = fields === null ? null : parseNickname(fields['nickname']);
    return nickname === null ? null : { nickname };
  },
  JOIN_ROOM: (value) => {
    const fields = withExactKeys(value, ['roomId', 'nickname']);
    if (fields === null) {
      return null;
    }
    const roomId = fields['roomId'];
    const nickname = parseNickname(fields['nickname']);
    return isRoomId(roomId) && nickname !== null ? { roomId, nickname } : null;
  },
  UPDATE_RULES: (value) => {
    const fields = withExactKeys(value, ['rules']);
    const rules = fields === null ? null : parseGameRules(fields['rules']);
    return rules === null ? null : { rules };
  },
  CONFIRM_RULES: (value) => {
    const rulesVersion = withExactKeys(value, ['rulesVersion'])?.['rulesVersion'];
    return typeof rulesVersion === 'number' && Number.isSafeInteger(rulesVersion) && rulesVersion >= 0
      ? { rulesVersion }
      : null;
  },
  UPDATE_PLACEMENT: (value) => {
    const fields = withExactKeys(value, ['ships']);
    const ships = fields === null ? null : parseArray(fields['ships'], 0, MAX_SHIPS, parseShipPlacement);
    return ships === null ? null : { ships };
  },
  CONFIRM_PLACEMENT: parseEmptyPayload,
  UNLOCK_PLACEMENT: parseEmptyPayload,
  UPDATE_TARGETS: targetsParser(0),
  FIRE: targetsParser(1),
  SET_PAUSED: (value) => {
    const isPaused = withExactKeys(value, ['isPaused'])?.['isPaused'];
    return typeof isPaused === 'boolean' ? { isPaused } : null;
  },
  SURRENDER: parseEmptyPayload,
  REMATCH_CHOICE: (value) => {
    const choice = withExactKeys(value, ['choice'])?.['choice'];
    return isStringMember(REMATCH_CHOICES, choice) ? { choice } : null;
  },
  LEAVE_ROOM: parseEmptyPayload,
};

/**
 * Guard for the `session` of the handshake `auth` (docs/protocol.md#handshake); `null` means `SESSION_INVALID`, the
 * same as an unknown session.
 * @param value The untrusted `auth.session`.
 * @returns New credentials with a well-formed room id and player secret, or `null`.
 */
export function parseSessionCredentials(value: unknown): SessionCredentials | null {
  const fields = withExactKeys(value, ['roomId', 'playerSecret']);
  if (fields === null) {
    return null;
  }
  const roomId = fields['roomId'];
  const playerSecret = fields['playerSecret'];
  return isRoomId(roomId) && typeof playerSecret === 'string' && PLAYER_SECRET_PATTERN.test(playerSecret)
    ? { roomId, playerSecret }
    : null;
}
