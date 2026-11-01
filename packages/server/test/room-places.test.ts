import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  GAME_OVER_TTL_MS,
  MAX_ROOMS,
  NEGOTIATION_TTL_MS,
  RATE_LIMIT_EVENTS_PER_SECOND,
  ROOM_CLOSED_REASONS,
  ROOM_PHASES,
  SEATS,
  WAITING_TTL_MS,
  type SessionCredentials,
} from '@battleship/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clock,
  drop,
  placingPlayers,
  player,
  playToVictory,
  rooms,
  seatedPlayers,
  send,
  start,
  startedMatch,
  stop,
  type Player,
  type SeatedPlayers,
} from './socket-harness.js';

afterEach(stop);

/**
 * Creates a room and reads the creator's first `STATE`.
 * @param creator The client that creates it.
 * @param nickname The creator's nickname.
 * @returns The room's credentials, from the ack.
 */
async function createRoom(creator: Player, nickname = 'Alice'): Promise<SessionCredentials> {
  const created = (await send(creator, CLIENT_EVENTS.CREATE_ROOM, { nickname })) as SessionCredentials & { ok: true };
  expect(created.ok).toBe(true);
  expect((await creator.inbox.state()).roomId).toBe(created.roomId);
  return { roomId: created.roomId, playerSecret: created.playerSecret };
}

/**
 * Joins a room and reads the joiner's first `STATE`.
 * @param joiner The client that joins.
 * @param roomId The room.
 */
async function joinRoom(joiner: Player, roomId: string): Promise<void> {
  expect(await send(joiner, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' })).toMatchObject({ ok: true });
  expect((await joiner.inbox.state()).roomId).toBe(roomId);
}

// One socket holds at most one waiting room: moving on frees the seat it waited in alone (#113, ADR-0095).
describe('a socket that moves on', () => {
  it('closes the waiting room it created when it creates another', async () => {
    await start();
    const alice = await player();
    const first = await createRoom(alice);
    const second = await createRoom(alice);

    expect(rooms.get(first.roomId)).toBeUndefined();
    expect(rooms.get(second.roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    expect(rooms.size).toBe(1);
    // The seat is freed, not away: its session is gone and nobody can join the room.
    await expect(player(first)).rejects.toThrow(ERROR_CODES.SESSION_INVALID);
    const bob = await player();
    expect(await send(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId: first.roomId, nickname: 'Bob' })).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_NOT_FOUND,
    });
  });

  it('closes the waiting room it created when it joins another', async () => {
    await start();
    const [alice, bob] = await Promise.all([player(), player()]);
    const own = await createRoom(alice);
    const other = await createRoom(bob, 'Bob');
    await joinRoom(alice, other.roomId);

    expect(rooms.get(own.roomId)).toBeUndefined();
    expect(rooms.get(other.roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    expect(rooms.size).toBe(1);
  });

  it('keeps its waiting room when the join is refused', async () => {
    await start();
    const [alice, bob, carol, dave] = await Promise.all([player(), player(), player(), player()]);
    const own = await createRoom(alice);
    const full = await createRoom(bob, 'Bob');
    await joinRoom(carol, full.roomId);

    expect(await send(alice, CLIENT_EVENTS.JOIN_ROOM, { roomId: full.roomId, nickname: 'Alice' })).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_FULL,
    });
    expect(rooms.get(own.roomId)).toMatchObject({
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      disconnectedAt: { P1: null },
    });
    // Still bound to it: a join by someone else reaches Alice.
    await joinRoom(dave, own.roomId);
    expect((await alice.inbox.state()).phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
  });

  it('closes a waiting room it sits in after a seat was freed, keeping the seat it has', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    expect(await send(p1, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    expect(await p2.inbox.state()).toMatchObject({ phase: ROOM_PHASES.WAITING_FOR_OPPONENT, me: { seat: SEATS.P2 } });

    await createRoom(p2, 'Bob');
    expect(rooms.get(roomId)).toBeUndefined();
  });

  // In a later phase the seat has an opponent, so it stays taken and away, as after a disconnection (ADR-0072).
  it.each<[string, () => Promise<SeatedPlayers>]>([
    [ROOM_PHASES.RULES_NEGOTIATION, seatedPlayers],
    [ROOM_PHASES.PLACEMENT, placingPlayers],
    [ROOM_PHASES.IN_PROGRESS, startedMatch],
  ])('keeps its seat in %s, away until its forfeit', async (phase, seated) => {
    await start();
    const { p1, p2, roomId, sessions } = await seated();
    await createRoom(p1);

    expect(rooms.get(roomId)?.phase).toBe(phase);
    expect(await p2.inbox.state()).toMatchObject({ phase, opponent: { isConnected: false } });
    // Its session brings the seat back.
    await player(sessions.P1);
    expect(await p2.inbox.state()).toMatchObject({ phase, opponent: { isConnected: true } });
  });
});

// A room nobody joins closes WAITING_TTL_MS after it started waiting, even with its creator connected (ADR-0096).
describe('the waiting TTL', () => {
  it('closes a room nobody joins and tells its connected creator', async () => {
    await start();
    const alice = await player();
    const { roomId } = await createRoom(alice);

    clock.advance(WAITING_TTL_MS - 1);
    expect(rooms.get(roomId)).toBeDefined();
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
    expect(await alice.inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.WAITING_TTL });

    // The socket stays connected, in no room: a seated command is refused, and it can create a new room.
    expect(alice.socket.connected).toBe(true);
    expect(await send(alice, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
    await createRoom(alice);
  });

  it('closes a room whose creator is away without anyone to tell', async () => {
    await start();
    const alice = await player();
    const { roomId } = await createRoom(alice);
    // Away for less than DISCONNECT_FORFEIT_MS when the TTL runs out.
    clock.advance(WAITING_TTL_MS - DISCONNECT_FORFEIT_MS / 3);
    await drop(alice, roomId, SEATS.P1);

    clock.advance(DISCONNECT_FORFEIT_MS / 3 - 1);
    expect(rooms.get(roomId)).toBeDefined();
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
  });

  it('counts from the start of the wait, not from a reconnection', async () => {
    await start();
    const alice = await player();
    const session = await createRoom(alice);
    clock.advance(WAITING_TTL_MS - 10_000);
    await drop(alice, session.roomId, SEATS.P1);
    const back = await player(session);
    expect((await back.inbox.state()).roomId).toBe(session.roomId);

    clock.advance(10_000);
    expect(rooms.get(session.roomId)).toBeUndefined();
    expect(await back.inbox.roomClosed()).toEqual({ roomId: session.roomId, reason: ROOM_CLOSED_REASONS.WAITING_TTL });
  });

  it('is stopped by a join', async () => {
    await start();
    const [alice, bob] = await Promise.all([player(), player()]);
    const { roomId } = await createRoom(alice);
    clock.advance(WAITING_TTL_MS - 1);
    await joinRoom(bob, roomId);

    // Only the negotiation TTL is left, which runs out later (ADR-0102).
    expect(clock.pendingCount).toBe(1);
    clock.advance(NEGOTIATION_TTL_MS - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
  });

  it('starts again when a seat is freed before the match by LEAVE_ROOM', async () => {
    await start();
    const [alice, bob] = await Promise.all([player(), player()]);
    const { roomId } = await createRoom(alice);
    clock.advance(WAITING_TTL_MS - 1);
    await joinRoom(bob, roomId);
    clock.advance(WAITING_TTL_MS / 2);
    expect(await send(bob, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });

    clock.advance(WAITING_TTL_MS - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
    // Alice saw Bob join, then leave, then the room close.
    expect((await alice.inbox.states(2))?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    expect(await alice.inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.WAITING_TTL });
  });

  it('starts again when a seat is freed before the match by its forfeit', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    await drop(p2, roomId, SEATS.P2);
    clock.advance(DISCONNECT_FORFEIT_MS);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);

    clock.advance(WAITING_TTL_MS - 1);
    expect(rooms.get(roomId)).toBeDefined();
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
    expect((await p1.inbox.states(2))?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    expect(await p1.inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.WAITING_TTL });
  });
});

// Two connected players can no longer hold a room in RULES_NEGOTIATION: it closes NEGOTIATION_TTL_MS after the join
// that opened the phase, whatever they send meanwhile (#128, ADR-0102).
describe('the negotiation TTL', () => {
  it('closes a room whose two connected players never agree, and tells both', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();

    clock.advance(NEGOTIATION_TTL_MS - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
    for (const { inbox, socket } of [p1, p2]) {
      expect(await inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.NEGOTIATION_TTL });
      expect(socket.connected).toBe(true);
    }
    expect(clock.pendingCount).toBe(0);

    // Both stay connected, in no room: a rules command is refused, and either can create a new room.
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
    await createRoom(p1);
  });

  it('is not restarted by an edit or a confirmation', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    clock.advance(NEGOTIATION_TTL_MS / 2);
    const edited = (await send(p1, CLIENT_EVENTS.UPDATE_RULES, {
      rules: { ...DEFAULT_RULES, areAdjacentShipsAllowed: true },
    })) as { ok: true; rulesVersion: number };
    expect(edited.rulesVersion).toBe(1);
    clock.advance(NEGOTIATION_TTL_MS / 4);
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: edited.rulesVersion })).toEqual({ ok: true });

    clock.advance(NEGOTIATION_TTL_MS / 4 - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
    for (const { inbox } of [p1, p2]) {
      // The STATE of the edit and of the confirmation, then the notice.
      await inbox.states(2);
      expect(await inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.NEGOTIATION_TTL });
    }
  });

  it('is not restarted by a reconnection', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await seatedPlayers();
    clock.advance(NEGOTIATION_TTL_MS - 10_000);
    await drop(p2, roomId, SEATS.P2);
    const back = await player(sessions.P2);
    expect((await back.inbox.state()).roomId).toBe(roomId);

    clock.advance(10_000);
    expect(rooms.get(roomId)).toBeUndefined();
    // P1 saw P2 drop and come back.
    await p1.inbox.states(2);
    for (const { inbox } of [p1, back]) {
      expect(await inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.NEGOTIATION_TTL });
    }
  });

  it('lets a last confirmation handled before it runs start placement, and leaves no timer of its own', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({ ok: true });
    clock.advance(NEGOTIATION_TTL_MS - 1);
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({ ok: true });
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    // Only the end of placement is pending.
    expect(clock.pendingCount).toBe(1);

    clock.advance(1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.states(2))?.phase).toBe(ROOM_PHASES.PLACEMENT);
    }
  });

  it('refuses a last confirmation the server handles after it ran', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({ ok: true });
    clock.advance(NEGOTIATION_TTL_MS);

    expect(await send(p2, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
    expect(rooms.get(roomId)).toBeUndefined();
    // P2 saw P1 confirm, then the room close.
    await p2.inbox.state();
    expect(await p2.inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.NEGOTIATION_TTL });
  });

  it('closes the room before a seat that drops late is forfeited', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await seatedPlayers();
    // Away for less than DISCONNECT_FORFEIT_MS when the TTL runs out: the seat away does not stop it.
    clock.advance(NEGOTIATION_TTL_MS - DISCONNECT_FORFEIT_MS / 3);
    await drop(p2, roomId, SEATS.P2);
    expect((await p1.inbox.state()).opponent?.isConnected).toBe(false);

    clock.advance(DISCONNECT_FORFEIT_MS / 3 - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
    expect(await p1.inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.NEGOTIATION_TTL });
    // The player away learns it when they come back.
    await expect(player(sessions.P2)).rejects.toThrow(ERROR_CODES.SESSION_INVALID);
  });

  it('stops when an early drop is forfeited, and the next join starts a new one', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    await drop(p2, roomId, SEATS.P2);
    clock.advance(DISCONNECT_FORFEIT_MS);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    // Only the waiting TTL is pending.
    expect(clock.pendingCount).toBe(1);

    // Carol joins just before the first negotiation would have run out.
    clock.advance(NEGOTIATION_TTL_MS - DISCONNECT_FORFEIT_MS - 1);
    const carol = await player();
    await joinRoom(carol, roomId);
    clock.advance(1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);

    clock.advance(NEGOTIATION_TTL_MS - 2);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
    // P1 saw P2 drop, the seat freed and Carol join.
    expect((await p1.inbox.states(3))?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    for (const { inbox } of [p1, carol]) {
      expect(await inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.NEGOTIATION_TTL });
    }
  });
});

describe('ROOM_CLOSED', () => {
  it('tells both players when the game-over TTL closes their room', async () => {
    await start();
    const { p1, p2, roomId } = await startedMatch();
    await playToVictory(p1, p2);
    const notices = [p1, p2].map(
      (target) =>
        new Promise((resolve) => {
          target.socket.once('ROOM_CLOSED', resolve);
        }),
    );

    clock.advance(GAME_OVER_TTL_MS);
    expect(await Promise.all(notices)).toEqual([
      { roomId, reason: ROOM_CLOSED_REASONS.GAME_OVER_TTL },
      { roomId, reason: ROOM_CLOSED_REASONS.GAME_OVER_TTL },
    ]);
  });
});

// The acceptance tests of #113 and #128: a client can no longer keep every place under MAX_ROOMS for itself.
describe('room places', () => {
  it('keeps one socket to a single waiting room, however many it creates', async () => {
    await start();
    const alice = await player();
    for (let index = 0; index < MAX_ROOMS; index++) {
      // Within the rate limit, which the same clock counts.
      clock.advance(1_000 / (RATE_LIMIT_EVENTS_PER_SECOND / 2));
      await createRoom(alice);
    }
    expect(rooms.size).toBe(1);

    const bob = await player();
    await createRoom(bob, 'Bob');
  });

  it('frees every place WAITING_TTL_MS after MAX_ROOMS sockets each created a room', async () => {
    await start();
    const creators = await Promise.all(Array.from({ length: MAX_ROOMS }, () => player()));
    const roomIds: string[] = [];
    for (const creator of creators) {
      roomIds.push((await createRoom(creator)).roomId);
    }
    const late = await player();
    expect(await send(late, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Late' })).toEqual({
      ok: false,
      error: ERROR_CODES.SERVER_FULL,
    });
    // A refused CREATE_ROOM moves nobody: the creator keeps the room it waits in.
    const [first] = creators;
    if (first === undefined) {
      expect.fail('no creator');
    }
    expect(await send(first, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })).toEqual({
      ok: false,
      error: ERROR_CODES.SERVER_FULL,
    });

    clock.advance(WAITING_TTL_MS);
    expect(rooms.size).toBe(0);
    for (const [index, creator] of creators.entries()) {
      expect(await creator.inbox.roomClosed()).toEqual({
        roomId: roomIds[index],
        reason: ROOM_CLOSED_REASONS.WAITING_TTL,
      });
    }
    await createRoom(late, 'Late');
  });

  it('frees every place NEGOTIATION_TTL_MS after MAX_ROOMS pairs of sockets opened their negotiations', async () => {
    await start();
    const pairs: SeatedPlayers[] = [];
    for (let index = 0; index < MAX_ROOMS; index++) {
      pairs.push(await seatedPlayers());
    }
    const late = await player();
    expect(await send(late, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Late' })).toEqual({
      ok: false,
      error: ERROR_CODES.SERVER_FULL,
    });

    clock.advance(NEGOTIATION_TTL_MS);
    expect(rooms.size).toBe(0);
    for (const { p1, p2, roomId } of pairs) {
      for (const { inbox } of [p1, p2]) {
        expect(await inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.NEGOTIATION_TTL });
      }
    }
    await createRoom(late, 'Late');
  });
});
