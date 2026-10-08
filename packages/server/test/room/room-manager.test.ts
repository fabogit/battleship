import {
  CLIENT_EVENTS,
  createSeededRng,
  ERROR_CODES,
  MAX_ROOMS,
  parseSessionCredentials,
  PAYLOAD_PARSERS,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  ROOM_PHASES,
  SEATS,
  type Rng,
} from '@battleship/core';
import { describe, expect, it } from 'vitest';

import { generateRoomId, RoomManager } from '../../src/room/room-manager.js';
import { fleet, NOW } from './fixtures.js';

/** An Rng whose `nextInt` replays a script and then repeats its last value. */
function scriptedRng(values: readonly number[]): Rng {
  const seeded = createSeededRng(0);
  let index = 0;
  return {
    nextInt: () => values[Math.min(index++, values.length - 1)] ?? 0,
    pick: (items) => seeded.pick(items),
    shuffle: (items) => seeded.shuffle(items),
  };
}

/** A well-formed id that no test room uses: managers in these tests draw from other seeds. */
const UNKNOWN_ROOM_ID = generateRoomId(createSeededRng(99));

function manager(rng: Rng = createSeededRng(1)): RoomManager {
  return new RoomManager({ rng });
}

describe('generateRoomId', () => {
  it('draws ROOM_ID_LENGTH characters of ROOM_ID_ALPHABET, which the JOIN_ROOM guard accepts', () => {
    const rng = createSeededRng(7);
    for (let attempt = 0; attempt < 100; attempt++) {
      const roomId = generateRoomId(rng);
      expect(roomId).toMatch(new RegExp(`^[${ROOM_ID_ALPHABET}]{${String(ROOM_ID_LENGTH)}}$`));
      expect(PAYLOAD_PARSERS.JOIN_ROOM({ roomId, nickname: 'Bob' })).not.toBeNull();
    }
  });

  it('is repeatable with a fixed seed', () => {
    expect(generateRoomId(createSeededRng(7))).toBe(generateRoomId(createSeededRng(7)));
  });
});

describe('RoomManager', () => {
  it('registers a new room with the creator seated as P1', () => {
    const rooms = manager();
    const created = rooms.createRoom({ nickname: 'Alice' });
    if (!created.ok) {
      expect.fail(created.error);
    }
    expect(parseSessionCredentials({ roomId: created.roomId, playerSecret: created.playerSecret })).not.toBeNull();
    expect(rooms.size).toBe(1);
    expect(rooms.get(created.roomId)).toBe(created.state);
    expect(created.state).toMatchObject({
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      players: { P1: { nickname: 'Alice' } },
    });
  });

  it('draws again when an id is already taken', () => {
    // Index 0 of the alphabet for the first two draws, so the second collides; index 1 from then on.
    const rng = scriptedRng([...Array<number>(16).fill(0), 1]);
    const rooms = manager(rng);
    const first = rooms.createRoom({ nickname: 'Alice' });
    const second = rooms.createRoom({ nickname: 'Carol' });
    expect(first).toMatchObject({ ok: true, roomId: '22222222' });
    expect(second).toMatchObject({ ok: true, roomId: '33333333' });
  });

  it('answers SERVER_FULL once MAX_ROOMS rooms are open', () => {
    const rooms = manager();
    for (let index = 0; index < MAX_ROOMS; index++) {
      expect(rooms.createRoom({ nickname: `Player ${String(index)}` }).ok).toBe(true);
    }
    expect(rooms.createRoom({ nickname: 'Late' })).toEqual({ ok: false, error: ERROR_CODES.SERVER_FULL });
    expect(rooms.size).toBe(MAX_ROOMS);
  });

  it('seats a joiner as P2 and stores the room in placement', () => {
    const rooms = manager();
    const created = rooms.createRoom({ nickname: 'Alice' });
    if (!created.ok) {
      expect.fail(created.error);
    }
    const joined = rooms.joinRoom({ roomId: created.roomId, nickname: 'Bob' }, NOW);
    expect(joined).toMatchObject({ ok: true, state: { phase: ROOM_PHASES.PLACEMENT } });
    if (!joined.ok) {
      expect.fail(joined.error);
    }
    expect(joined.playerSecret).not.toBe(created.playerSecret);
    expect(parseSessionCredentials({ roomId: created.roomId, playerSecret: joined.playerSecret })).not.toBeNull();
    expect(rooms.get(created.roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    expect(rooms.joinRoom({ roomId: created.roomId, nickname: 'Carol' }, NOW)).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_FULL,
    });
  });

  it('answers ROOM_NOT_FOUND for an unknown room', () => {
    const rooms = manager();
    expect(rooms.joinRoom({ roomId: UNKNOWN_ROOM_ID, nickname: 'Bob' }, NOW)).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_NOT_FOUND,
    });
    expect(
      rooms.dispatch(UNKNOWN_ROOM_ID, { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat: SEATS.P1, payload: {} }, NOW),
    ).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_NOT_FOUND,
    });
  });

  it('stores accepted commands and keeps the room on refused ones', () => {
    const rooms = manager();
    const created = rooms.createRoom({ nickname: 'Alice' });
    if (!created.ok) {
      expect.fail(created.error);
    }
    rooms.joinRoom({ roomId: created.roomId, nickname: 'Bob' }, NOW);
    const placed = rooms.dispatch(
      created.roomId,
      { type: CLIENT_EVENTS.UPDATE_PLACEMENT, seat: SEATS.P1, payload: { ships: fleet(1) } },
      NOW,
    );
    expect(placed.ok).toBe(true);
    const stored = rooms.get(created.roomId);
    expect(stored?.phase === ROOM_PHASES.PLACEMENT && stored.fleets.P1.ships).toHaveLength(5);

    const refused = rooms.dispatch(
      created.roomId,
      { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [{ x: 0, y: 0 }] } },
      NOW,
    );
    expect(refused).toEqual({ ok: false, error: ERROR_CODES.WRONG_PHASE });
    expect(rooms.get(created.roomId)).toBe(stored);
  });
});
