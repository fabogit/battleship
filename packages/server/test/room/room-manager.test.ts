import {
  CLIENT_EVENTS,
  createSeededRng,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  generateRoomId,
  MAX_ROOMS,
  parseSessionCredentials,
  ROOM_PHASES,
  SEATS,
  type Rng,
} from '@battleship/core';
import { describe, expect, it } from 'vitest';

import { RoomManager } from '../../src/room/room-manager.js';
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
    expect(joined).toMatchObject({ ok: true, seat: SEATS.P2, state: { phase: ROOM_PHASES.PLACEMENT } });
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

  it('records presence changes and reports only real ones', () => {
    const rooms = manager();
    const created = rooms.createRoom({ nickname: 'Alice' });
    if (!created.ok) {
      expect.fail(created.error);
    }
    const { roomId } = created;
    expect(rooms.setPresence(roomId, SEATS.P1, true, NOW)).toBeUndefined();
    expect(rooms.setPresence(roomId, SEATS.P1, false, NOW)?.disconnectedAt.P1).toBe(NOW);
    expect(rooms.setPresence(roomId, SEATS.P1, false, NOW + 1)).toBeUndefined();
    expect(rooms.get(roomId)?.disconnectedAt.P1).toBe(NOW);
    expect(rooms.nextForfeit(roomId)).toEqual({ seat: SEATS.P1, at: NOW + DISCONNECT_FORFEIT_MS });
    expect(rooms.setPresence(roomId, SEATS.P1, true, NOW + 2)?.disconnectedAt.P1).toBeNull();
    expect(rooms.nextForfeit(roomId)).toBeUndefined();
    expect(rooms.setPresence(UNKNOWN_ROOM_ID, SEATS.P1, false, NOW)).toBeUndefined();
  });

  it('runs a forfeit only once it is due, and removes a room nobody is left in', () => {
    const rooms = manager();
    const created = rooms.createRoom({ nickname: 'Alice' });
    if (!created.ok) {
      expect.fail(created.error);
    }
    const { roomId } = created;
    rooms.setPresence(roomId, SEATS.P1, false, NOW);
    expect(rooms.forfeitDue(roomId, NOW + DISCONNECT_FORFEIT_MS - 1)).toBeUndefined();
    expect(rooms.forfeitDue(roomId, NOW + DISCONNECT_FORFEIT_MS)).toEqual({ seat: SEATS.P1, state: null });
    expect(rooms.get(roomId)).toBeUndefined();
    expect(rooms.size).toBe(0);
  });

  it('frees a seat on leave, seats the next joiner there, and removes the room once empty', () => {
    const rooms = manager();
    const created = rooms.createRoom({ nickname: 'Alice' });
    if (!created.ok) {
      expect.fail(created.error);
    }
    const { roomId } = created;
    rooms.joinRoom({ roomId, nickname: 'Bob' }, NOW);
    expect(rooms.leave(roomId, SEATS.P1)).toMatchObject({
      ok: true,
      state: { phase: ROOM_PHASES.WAITING_FOR_OPPONENT, players: { P1: null } },
    });
    expect(rooms.findSeat({ roomId, playerSecret: created.playerSecret })).toBeUndefined();
    expect(rooms.joinRoom({ roomId, nickname: 'Carol' }, NOW)).toMatchObject({ ok: true, seat: SEATS.P1 });
    expect(rooms.leave(roomId, SEATS.P1)).toMatchObject({ ok: true });
    expect(rooms.leave(roomId, SEATS.P2)).toEqual({ ok: true, state: null });
    expect(rooms.get(roomId)).toBeUndefined();
    expect(rooms.leave(roomId, SEATS.P2)).toEqual({ ok: false, error: ERROR_CODES.ROOM_NOT_FOUND });
  });
});
