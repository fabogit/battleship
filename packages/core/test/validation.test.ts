import { describe, expect, it } from 'vitest';

import {
  BOARD_SIZE,
  CLIENT_EVENTS,
  DEFAULT_RULES,
  FLEET,
  isRoomId,
  NICKNAME_MAX_LENGTH,
  ORIENTATIONS,
  parseNickname,
  parseSessionCredentials,
  PAYLOAD_PARSERS,
  REMATCH_CHOICES,
  SHIP_TYPES,
  TIMEOUT_ACTIONS,
  type CommandEvent,
} from '../src/index.js';

const ROOM_ID = 'ab23cd45';
// Generated, as the server does, rather than written out: a literal UUID named like a secret trips secret scanners.
const PLAYER_SECRET = crypto.randomUUID();

/** One well-formed payload per command. */
const VALID_PAYLOADS: Record<CommandEvent, unknown> = {
  CREATE_ROOM: { nickname: 'Ada' },
  JOIN_ROOM: { roomId: ROOM_ID, nickname: 'Grace' },
  UPDATE_RULES: { rules: DEFAULT_RULES },
  CONFIRM_RULES: { rulesVersion: 3 },
  UPDATE_PLACEMENT: {
    ships: [{ type: SHIP_TYPES.CARRIER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.HORIZONTAL }],
  },
  CONFIRM_PLACEMENT: {},
  UNLOCK_PLACEMENT: {},
  UPDATE_TARGETS: { targets: [{ x: 9, y: 9 }] },
  FIRE: { targets: [{ x: 0, y: 9 }] },
  SET_PAUSED: { isPaused: true },
  SURRENDER: {},
  REMATCH_CHOICE: { choice: REMATCH_CHOICES.CHANGE_RULES },
  LEAVE_ROOM: {},
};

const COMMANDS = Object.keys(VALID_PAYLOADS) as CommandEvent[];

/**
 * Runs a command's guard on an untrusted value.
 * @param event The command.
 * @param value The payload to check.
 * @returns What the guard returns.
 */
function parse(event: CommandEvent, value: unknown): unknown {
  return PAYLOAD_PARSERS[event](value);
}

/** Values that are never a payload object. */
const NOT_OBJECTS: [string, unknown][] = [
  ['null', null],
  ['undefined', undefined],
  ['a number', 42],
  ['a string', '{}'],
  ['a boolean', true],
  ['an array', []],
  ['a function', () => ({})],
  ['a Date', new Date(0)],
  ['a Map', new Map()],
  ['an object with a custom prototype', Object.create({ nickname: 'Ada' }) as unknown],
];

describe('every command guard', () => {
  it('covers every command', () => {
    expect(Object.keys(PAYLOAD_PARSERS).sort()).toEqual([...COMMANDS].sort());
  });

  describe.each(COMMANDS)('%s', (event) => {
    it('accepts a well-formed payload and returns a new object equal to it', () => {
      const payload = VALID_PAYLOADS[event];
      const parsed = parse(event, payload);
      expect(parsed).toEqual(payload);
      expect(parsed).not.toBe(payload);
    });

    it.each(NOT_OBJECTS)('refuses %s', (_label, value) => {
      expect(parse(event, value)).toBeNull();
    });

    it('refuses an extra property', () => {
      expect(parse(event, { ...(VALID_PAYLOADS[event] as object), extra: 1 })).toBeNull();
    });

    it('refuses a symbol key', () => {
      expect(parse(event, { ...(VALID_PAYLOADS[event] as object), [Symbol('extra')]: 1 })).toBeNull();
    });

    it('refuses an own __proto__ key, as JSON.parse creates it', () => {
      const payload = Object.assign(JSON.parse('{ "__proto__": {} }') as object, VALID_PAYLOADS[event]);
      expect(parse(event, payload)).toBeNull();
    });

    it('accepts an object without a prototype', () => {
      const payload: unknown = Object.assign(Object.create(null) as object, VALID_PAYLOADS[event]);
      expect(parse(event, payload)).toEqual(VALID_PAYLOADS[event]);
    });
  });
});

describe('CREATE_ROOM', () => {
  it('trims the nickname', () => {
    expect(parse(CLIENT_EVENTS.CREATE_ROOM, { nickname: '  Ada\t\n' })).toEqual({ nickname: 'Ada' });
  });

  it('accepts a nickname of exactly NICKNAME_MAX_LENGTH once trimmed', () => {
    const nickname = 'n'.repeat(NICKNAME_MAX_LENGTH);
    expect(parse(CLIENT_EVENTS.CREATE_ROOM, { nickname: `   ${nickname}   ` })).toEqual({ nickname });
  });

  it('counts UTF-16 code units, like HTML maxlength', () => {
    expect(parse(CLIENT_EVENTS.CREATE_ROOM, { nickname: '🚢'.repeat(NICKNAME_MAX_LENGTH / 2) })).not.toBeNull();
    expect(parse(CLIENT_EVENTS.CREATE_ROOM, { nickname: '🚢'.repeat(NICKNAME_MAX_LENGTH / 2 + 1) })).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['whitespace only', ' \t\n '],
    ['one unit too long', 'n'.repeat(NICKNAME_MAX_LENGTH + 1)],
    ['a megabyte long', 'n'.repeat(1_000_000)],
  ])('refuses a nickname that is %s', (_label, nickname) => {
    expect(parse(CLIENT_EVENTS.CREATE_ROOM, { nickname })).toBeNull();
  });

  it.each([null, 42, true, ['Ada'], { name: 'Ada' }])('refuses a nickname that is not a string: %j', (nickname) => {
    expect(parse(CLIENT_EVENTS.CREATE_ROOM, { nickname })).toBeNull();
  });

  it('refuses a missing nickname', () => {
    expect(parse(CLIENT_EVENTS.CREATE_ROOM, {})).toBeNull();
  });
});

describe('JOIN_ROOM', () => {
  it('trims the nickname', () => {
    expect(parse(CLIENT_EVENTS.JOIN_ROOM, { roomId: ROOM_ID, nickname: ' Grace ' })).toEqual({
      roomId: ROOM_ID,
      nickname: 'Grace',
    });
  });

  it.each([
    ['too short', 'ab23cd4'],
    ['too long', 'ab23cd456'],
    ['uppercase', 'AB23CD45'],
    ['an ambiguous character', 'ab23cd4o'],
    ['a digit 0', 'ab23cd40'],
    ['padded', ` ${ROOM_ID}`],
    ['a path', '../admin'],
    ['empty', ''],
    ['huge', 'a'.repeat(100_000)],
    ['a number', 12345678],
    ['null', null],
  ])('refuses a room id that is %s', (_label, roomId) => {
    expect(parse(CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Grace' })).toBeNull();
  });

  it('refuses an invalid nickname', () => {
    expect(parse(CLIENT_EVENTS.JOIN_ROOM, { roomId: ROOM_ID, nickname: '   ' })).toBeNull();
  });

  it('refuses a missing room id', () => {
    expect(parse(CLIENT_EVENTS.JOIN_ROOM, { nickname: 'Grace' })).toBeNull();
  });
});

// The client runs these two on its own (the nickname field, the room link), so they are exported as they are.
describe('isRoomId and parseNickname', () => {
  it('accept what the JOIN_ROOM guard accepts', () => {
    expect(isRoomId(ROOM_ID)).toBe(true);
    expect(parseNickname(' Grace ')).toBe('Grace');
  });

  it('refuse what the JOIN_ROOM guard refuses', () => {
    expect(isRoomId('AB23CD45')).toBe(false);
    expect(parseNickname(' \t ')).toBeNull();
    expect(parseNickname('n'.repeat(NICKNAME_MAX_LENGTH + 1))).toBeNull();
  });
});

describe('UPDATE_RULES', () => {
  it('accepts every turn time limit and timeout action', () => {
    for (const turnTimeLimitSeconds of [15, 30, 60, 120]) {
      for (const timeoutAction of [TIMEOUT_ACTIONS.AUTO_RANDOM_SHOT, TIMEOUT_ACTIONS.PASS_TURN]) {
        const rules = { ...DEFAULT_RULES, turnTimeLimitSeconds, timeoutAction };
        expect(parse(CLIENT_EVENTS.UPDATE_RULES, { rules })).toEqual({ rules });
      }
    }
  });

  it('leaves the salvo / extra-turn exclusivity to validateRules', () => {
    const rules = { ...DEFAULT_RULES, isSalvoModeEnabled: true, isExtraTurnOnHitEnabled: true };
    expect(parse(CLIENT_EVENTS.UPDATE_RULES, { rules })).toEqual({ rules });
  });

  it.each([
    ['a turn time limit off the list', { turnTimeLimitSeconds: 45 }],
    ['a fractional turn time limit', { turnTimeLimitSeconds: 30.5 }],
    ['a turn time limit as a string', { turnTimeLimitSeconds: '30' }],
    ['a NaN turn time limit', { turnTimeLimitSeconds: Number.NaN }],
    ['an unknown timeout action', { timeoutAction: 'SKIP' }],
    ['a lowercase timeout action', { timeoutAction: 'pass_turn' }],
    ['an inherited key as timeout action', { timeoutAction: 'toString' }],
    ['a boolean as a string', { isSalvoModeEnabled: 'true' }],
    ['a boolean as a number', { areAdjacentShipsAllowed: 0 }],
    ['a null boolean', { isExtraTurnOnHitEnabled: null }],
  ])('refuses %s', (_label, change) => {
    expect(parse(CLIENT_EVENTS.UPDATE_RULES, { rules: { ...DEFAULT_RULES, ...change } })).toBeNull();
  });

  it('refuses rules with a missing field', () => {
    const rules: Record<string, unknown> = { ...DEFAULT_RULES };
    delete rules['timeoutAction'];
    expect(parse(CLIENT_EVENTS.UPDATE_RULES, { rules })).toBeNull();
  });

  it('refuses rules with an extra field', () => {
    expect(parse(CLIENT_EVENTS.UPDATE_RULES, { rules: { ...DEFAULT_RULES, isCheatModeEnabled: true } })).toBeNull();
  });

  it.each([null, 'DEFAULT', [], 30])('refuses rules that are not an object: %j', (rules) => {
    expect(parse(CLIENT_EVENTS.UPDATE_RULES, { rules })).toBeNull();
  });
});

describe('CONFIRM_RULES', () => {
  it('accepts version 0 and the largest safe integer', () => {
    expect(parse(CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({ rulesVersion: 0 });
    expect(parse(CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: Number.MAX_SAFE_INTEGER })).not.toBeNull();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '3', null, [3]])(
    'refuses rulesVersion %j',
    (rulesVersion) => {
      expect(parse(CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion })).toBeNull();
    },
  );
});

describe('UPDATE_PLACEMENT', () => {
  /** A complete fleet, one ship per row. */
  const fleet = FLEET.map((type, row) => ({ type, start: { x: 0, y: row }, orientation: ORIENTATIONS.HORIZONTAL }));

  it('accepts an empty draft and a complete fleet', () => {
    expect(parse(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: [] })).toEqual({ ships: [] });
    expect(parse(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: fleet })).toEqual({ ships: fleet });
  });

  it('leaves repeated types and ships running off the board to placement validation', () => {
    const ship = { type: SHIP_TYPES.CARRIER, start: { x: BOARD_SIZE - 1, y: 0 }, orientation: ORIENTATIONS.HORIZONTAL };
    expect(parse(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: [ship, ship] })).toEqual({ ships: [ship, ship] });
  });

  it('refuses more ships than a fleet holds', () => {
    expect(parse(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: [...fleet, fleet[0]] })).toBeNull();
  });

  it('refuses a huge array', () => {
    const ships = Array.from({ length: 100_000 }, () => fleet[0]);
    expect(parse(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships })).toBeNull();
  });

  it('refuses a sparse array', () => {
    const ships: unknown[] = [fleet[0]];
    ships[2] = fleet[2];
    expect(parse(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships })).toBeNull();
  });

  it.each([
    ['an unknown ship type', { type: 'YACHT' }],
    ['an inherited key as ship type', { type: 'constructor' }],
    ['an unknown orientation', { orientation: 'DIAGONAL' }],
    ['a negative start', { start: { x: -1, y: 0 } }],
    ['a start off the board', { start: { x: 0, y: BOARD_SIZE } }],
    ['a fractional start', { start: { x: 0.5, y: 0 } }],
    ['a start as strings', { start: { x: '0', y: '0' } }],
    ['a start as an array', { start: [0, 0] }],
    ['a start with an extra field', { start: { x: 0, y: 0, z: 0 } }],
    ['a null start', { start: null }],
    ['precomputed coordinates', { coordinates: [{ x: 0, y: 0 }] }],
  ])('refuses a ship with %s', (_label, change) => {
    const ship = { type: SHIP_TYPES.DESTROYER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.VERTICAL, ...change };
    expect(parse(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: [ship] })).toBeNull();
  });

  it.each([null, SHIP_TYPES.CARRIER, 5, { 0: fleet[0], length: 1 }])(
    'refuses ships that are not an array: %j',
    (ships) => {
      expect(parse(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships })).toBeNull();
    },
  );
});

describe.each([CLIENT_EVENTS.UPDATE_TARGETS, CLIENT_EVENTS.FIRE] as const)('%s', (event) => {
  /** One target in each of the first `count` cells of the top row. */
  const targets = (count: number) => Array.from({ length: count }, (_, x) => ({ x, y: 0 }));

  it('accepts the board corners', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: BOARD_SIZE - 1, y: 0 },
      { x: 0, y: BOARD_SIZE - 1 },
      { x: BOARD_SIZE - 1, y: BOARD_SIZE - 1 },
    ];
    expect(parse(event, { targets: corners })).toEqual({ targets: corners });
  });

  it('accepts one target per ship of a whole fleet, and refuses one more', () => {
    expect(parse(event, { targets: targets(FLEET.length) })).not.toBeNull();
    expect(parse(event, { targets: targets(FLEET.length + 1) })).toBeNull();
  });

  it('leaves repeated targets to the shot engine', () => {
    const target = { x: 4, y: 4 };
    expect(parse(event, { targets: [target, target] })).toEqual({ targets: [target, target] });
  });

  it('refuses a huge array', () => {
    expect(parse(event, { targets: Array.from({ length: 1_000_000 }, () => ({ x: 0, y: 0 })) })).toBeNull();
  });

  it.each([
    ['negative', { x: -1, y: 0 }],
    ['off the board', { x: BOARD_SIZE, y: 0 }],
    ['far off the board', { x: 0, y: 1e9 }],
    ['fractional', { x: 1.5, y: 2 }],
    ['NaN', { x: Number.NaN, y: 0 }],
    ['infinite', { x: Number.POSITIVE_INFINITY, y: 0 }],
    ['strings', { x: '1', y: '2' }],
    ['missing an axis', { x: 1 }],
    ['an array', [1, 2]],
    ['null', null],
    ['a number', 12],
  ])('refuses a target that is %s', (_label, target) => {
    expect(parse(event, { targets: [{ x: 0, y: 0 }, target] })).toBeNull();
  });

  it.each([null, { x: 0, y: 0 }, '0,0'])('refuses targets that are not an array: %j', (value) => {
    expect(parse(event, { targets: value })).toBeNull();
  });
});

describe('targets count', () => {
  it('lets an UPDATE_TARGETS draft be empty', () => {
    expect(parse(CLIENT_EVENTS.UPDATE_TARGETS, { targets: [] })).toEqual({ targets: [] });
  });

  it('refuses a FIRE without targets', () => {
    expect(parse(CLIENT_EVENTS.FIRE, { targets: [] })).toBeNull();
  });
});

describe('SET_PAUSED', () => {
  it('accepts false', () => {
    expect(parse(CLIENT_EVENTS.SET_PAUSED, { isPaused: false })).toEqual({ isPaused: false });
  });

  it.each(['true', 1, 0, null, undefined])('refuses isPaused %j', (isPaused) => {
    expect(parse(CLIENT_EVENTS.SET_PAUSED, { isPaused })).toBeNull();
  });

  it('refuses the field under its old name', () => {
    expect(parse(CLIENT_EVENTS.SET_PAUSED, { paused: true })).toBeNull();
  });
});

describe('REMATCH_CHOICE', () => {
  it.each([REMATCH_CHOICES.SAME_RULES, REMATCH_CHOICES.CHANGE_RULES, REMATCH_CHOICES.LEAVE])('accepts %s', (choice) => {
    expect(parse(CLIENT_EVENTS.REMATCH_CHOICE, { choice })).toEqual({ choice });
  });

  it.each(['REMATCH', 'leave', 'hasOwnProperty', '', null, 0])('refuses choice %j', (choice) => {
    expect(parse(CLIENT_EVENTS.REMATCH_CHOICE, { choice })).toBeNull();
  });
});

describe.each([
  CLIENT_EVENTS.CONFIRM_PLACEMENT,
  CLIENT_EVENTS.UNLOCK_PLACEMENT,
  CLIENT_EVENTS.SURRENDER,
  CLIENT_EVENTS.LEAVE_ROOM,
] as const)('%s', (event) => {
  it('refuses any field', () => {
    expect(parse(event, { reason: 'bored' })).toBeNull();
  });
});

describe('parseSessionCredentials', () => {
  const credentials = { roomId: ROOM_ID, playerSecret: PLAYER_SECRET };

  it('accepts a room id and a randomUUID secret, as a new object', () => {
    const parsed = parseSessionCredentials(credentials);
    expect(parsed).toEqual(credentials);
    expect(parsed).not.toBe(credentials);
  });

  it.each([
    ['uppercase', PLAYER_SECRET.toUpperCase()],
    ['without dashes', PLAYER_SECRET.replaceAll('-', '')],
    // The version digit is the first of the third group, at index 14.
    ['not version 4', `${PLAYER_SECRET.slice(0, 14)}1${PLAYER_SECRET.slice(15)}`],
    ['braced', `{${PLAYER_SECRET}}`],
    ['followed by more text', `${PLAYER_SECRET}\n`],
    ['empty', ''],
    ['huge', 'a'.repeat(100_000)],
    ['a number', 42],
    ['null', null],
  ])('refuses a secret that is %s', (_label, playerSecret) => {
    expect(parseSessionCredentials({ roomId: ROOM_ID, playerSecret })).toBeNull();
  });

  it('refuses a malformed room id', () => {
    expect(parseSessionCredentials({ roomId: 'ROOM', playerSecret: PLAYER_SECRET })).toBeNull();
  });

  it('refuses missing and extra fields', () => {
    expect(parseSessionCredentials({ roomId: ROOM_ID })).toBeNull();
    expect(parseSessionCredentials({ ...credentials, expiresAt: 0 })).toBeNull();
  });

  it.each(NOT_OBJECTS)('refuses %s', (_label, value) => {
    expect(parseSessionCredentials(value)).toBeNull();
  });
});
