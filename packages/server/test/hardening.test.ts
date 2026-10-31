import { once } from 'node:events';

import {
  CLIENT_EVENTS,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  GAME_OVER_TTL_MS,
  RATE_LIMIT_EVENTS_PER_SECOND,
  ROOM_PHASES,
  SEATS,
} from '@battleship/core';
import { type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_MESSAGE_BYTES } from '../src/plugins/socket-io.js';
import {
  ACK_TIMEOUT_MS,
  agreeOnRules,
  app,
  clock,
  placeFleets,
  player,
  playToVictory,
  rooms,
  send,
  sendRaw,
  start,
  stop,
  type Player,
} from './socket-harness.js';

afterEach(stop);

async function createRoom(socket: Player, nickname = 'Alice'): Promise<string> {
  const created = (await send(socket, CLIENT_EVENTS.CREATE_ROOM, { nickname })) as { ok: boolean; roomId: string };
  expect(created.ok).toBe(true);
  return created.roomId;
}

/**
 * Closes a client and waits until the server has handled its `disconnect`: the handlers' listener was added first, so
 * it has run when this one does.
 */
async function leave({ socket }: Player): Promise<void> {
  const serverSide = app.io.sockets.sockets.get(socket.id ?? '');
  if (serverSide === undefined) {
    expect.fail('the server does not know the socket');
  }
  const gone = once(serverSide, 'disconnect');
  socket.close();
  await gone;
}

/**
 * Plays a match to `GAME_OVER` from rules negotiation: P1 fires at every cell of P2's fleet, P2 at water in between.
 */
async function playToGameOver(p1: Player, p2: Player): Promise<void> {
  await agreeOnRules(p1, p2);
  await placeFleets(p1, p2);
  await playToVictory(p1, p2);
}

// A room nobody sits in is closed by its seats' forfeits, not by a TTL of its own (ADR-0073).
describe('room closing', () => {
  it('closes a waiting room DISCONNECT_FORFEIT_MS after its creator left, not before', async () => {
    await start();
    const alice = await player();
    const roomId = await createRoom(alice);
    await leave(alice);

    clock.advance(DISCONNECT_FORFEIT_MS - 1);
    expect(rooms.get(roomId)).toBeDefined();
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
    expect(rooms.size).toBe(0);

    const bob = await player();
    expect(await send(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' })).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_NOT_FOUND,
    });
  });

  it('keeps the room when the creator resumes the session at the handshake', async () => {
    await start();
    const alice = await player();
    const created = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as {
      roomId: string;
      playerSecret: string;
    };
    await leave(alice);
    clock.advance(DISCONNECT_FORFEIT_MS - 1);

    await player({ roomId: created.roomId, playerSecret: created.playerSecret });
    clock.advance(DISCONNECT_FORFEIT_MS);
    expect(rooms.get(created.roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
  });

  it('closes a room DISCONNECT_FORFEIT_MS after its last player left, not the first', async () => {
    await start();
    const [alice, bob] = await Promise.all([player(), player()]);
    const roomId = await createRoom(alice);
    await send(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    await leave(alice);
    clock.advance(DISCONNECT_FORFEIT_MS / 2);
    await leave(bob);

    // Alice's seat goes first, and Bob, still away, waits alone for a new opponent.
    clock.advance(DISCONNECT_FORFEIT_MS / 2);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    clock.advance(DISCONNECT_FORFEIT_MS / 2 - 1);
    expect(rooms.get(roomId)).toBeDefined();
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
  });

  // A socket leaving a waiting room frees its seat at once instead (ADR-0095, test/room-places.test.ts).
  it('starts counting when a socket moves on from a room past the wait', async () => {
    await start();
    const [alice, bob] = await Promise.all([player(), player()]);
    const first = await createRoom(alice);
    await send(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId: first, nickname: 'Bob' });
    const second = await createRoom(alice);
    clock.advance(DISCONNECT_FORFEIT_MS - 1);
    expect(rooms.get(first)?.players.P1).not.toBeNull();
    clock.advance(1);
    expect(rooms.get(first)).toMatchObject({ phase: ROOM_PHASES.WAITING_FOR_OPPONENT, players: { P1: null } });
    expect(rooms.get(second)).toBeDefined();
  });

  it('frees a place under MAX_ROOMS', async () => {
    await start();
    const alice = await player();
    await createRoom(alice);
    await leave(alice);
    expect(rooms.size).toBe(1);
    clock.advance(DISCONNECT_FORFEIT_MS);
    expect(rooms.size).toBe(0);
  });

  // Both players gone mid-match: the first to leave forfeits, then the finished room lives out its game-over TTL.
  it('closes a match both players left within DISCONNECT_FORFEIT_MS + GAME_OVER_TTL_MS of the first drop', async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);
    const roomId = await createRoom(p1);
    await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    await agreeOnRules(p1, p2);
    await placeFleets(p1, p2);
    await leave(p1);
    clock.advance(1_000);
    await leave(p2);

    clock.advance(DISCONNECT_FORFEIT_MS - 1_000);
    expect(rooms.get(roomId)).toMatchObject({ phase: ROOM_PHASES.GAME_OVER, winner: SEATS.P2 });
    clock.advance(GAME_OVER_TTL_MS - 1);
    expect(rooms.get(roomId)).toBeDefined();
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
  });
});

describe('game-over TTL', () => {
  it('removes a room GAME_OVER_TTL_MS after the match ended, with both players still connected', async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);
    const roomId = await createRoom(p1);
    await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    await playToGameOver(p1, p2);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.GAME_OVER);

    clock.advance(GAME_OVER_TTL_MS - 1);
    expect(rooms.get(roomId)).toBeDefined();
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();

    // The sockets lost their seat with the room: a seated command is refused without reaching any room.
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
  });

  it('counts from the end of the match, not from a reconnection', async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);
    const roomId = await createRoom(p1);
    const { playerSecret } = (await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' })) as {
      playerSecret: string;
    };
    await playToGameOver(p1, p2);

    clock.advance(GAME_OVER_TTL_MS - 10_000);
    await leave(p2);
    await player({ roomId, playerSecret });
    clock.advance(10_000);
    expect(rooms.get(roomId)).toBeUndefined();
  });

  it('takes the sockets still in an expired room out of its Socket.io room', async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);
    const roomId = await createRoom(p1);
    await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    await playToGameOver(p1, p2);
    expect(app.io.sockets.adapter.rooms.get(roomId)?.size).toBe(2);

    clock.advance(GAME_OVER_TTL_MS);
    expect(app.io.sockets.adapter.rooms.get(roomId)).toBeUndefined();
  });

  it('does not run before the match ends', async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);
    const roomId = await createRoom(p1);
    await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    clock.advance(10 * GAME_OVER_TTL_MS);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
  });
});

describe('leaving', () => {
  it("takes the leaver out of the room's Socket.io room", async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);
    const roomId = await createRoom(p1);
    await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    expect(await send(p2, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    expect([...(app.io.sockets.adapter.rooms.get(roomId) ?? [])]).toEqual([p1.socket.id]);
  });
});

describe('rate limit', () => {
  // A client reads the last reply as the state of its last change (createSyncedDraft): a refusal must not overtake the
  // replies to the events sent before it (ADR-0066).
  it.each(['websocket', 'polling'] as const)('keeps the acks in emit order over %s', async (transport) => {
    await start();
    const alice = await player(undefined, transport);
    const count = RATE_LIMIT_EVENTS_PER_SECOND + 5;
    const arrivals: string[] = [];
    await new Promise<void>((resolve, reject) => {
      for (let index = 0; index < count; index++) {
        (alice.socket as Socket)
          .timeout(ACK_TIMEOUT_MS)
          .emit(CLIENT_EVENTS.ECHO, index, (error: Error | null, reply: unknown) => {
            if (error !== null) {
              reject(error);
              return;
            }
            const { ok } = reply as { ok: boolean };
            arrivals.push(ok ? String(index) : `${String(index)}x`);
            if (arrivals.length === count) {
              resolve();
            }
          });
      }
    });
    expect(arrivals).toEqual(
      Array.from({ length: count }, (_, index) =>
        index < RATE_LIMIT_EVENTS_PER_SECOND ? String(index) : `${String(index)}x`,
      ),
    );
  });

  it.each(['websocket', 'polling'] as const)(
    'refuses events beyond RATE_LIMIT_EVENTS_PER_SECOND with RATE_LIMITED over %s',
    async (transport) => {
      await start();
      const alice = await player(undefined, transport);
      const replies = await Promise.all(
        Array.from({ length: RATE_LIMIT_EVENTS_PER_SECOND + 1 }, (_, index) =>
          sendRaw(alice, CLIENT_EVENTS.ECHO, index),
        ),
      );
      expect(replies.slice(0, -1).every((reply) => (reply as { ok: boolean }).ok)).toBe(true);
      expect(replies.at(-1)).toEqual({ ok: false, error: ERROR_CODES.RATE_LIMITED });
    },
  );

  it('keeps a refused command away from room logic', async () => {
    await start();
    const alice = await player();
    for (let index = 0; index < RATE_LIMIT_EVENTS_PER_SECOND; index++) {
      await sendRaw(alice, CLIENT_EVENTS.ECHO, index);
    }
    expect(await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })).toEqual({
      ok: false,
      error: ERROR_CODES.RATE_LIMITED,
    });
    expect(rooms.size).toBe(0);
  });

  it('admits events again once a second has passed', async () => {
    await start();
    const alice = await player();
    for (let index = 0; index <= RATE_LIMIT_EVENTS_PER_SECOND; index++) {
      await sendRaw(alice, CLIENT_EVENTS.ECHO, index);
    }
    clock.advance(1_000);
    expect(await sendRaw(alice, CLIENT_EVENTS.ECHO, 'again')).toMatchObject({ ok: true, payload: 'again' });
  });

  it('counts per socket and keeps the limited socket connected', async () => {
    await start();
    const [alice, bob] = await Promise.all([player(), player()]);
    for (let index = 0; index <= RATE_LIMIT_EVENTS_PER_SECOND; index++) {
      await sendRaw(alice, CLIENT_EVENTS.ECHO, index);
    }
    // Events without an ack are dropped silently once over the limit.
    (alice.socket as Socket).emit(CLIENT_EVENTS.ECHO);
    expect(await sendRaw(bob, CLIENT_EVENTS.ECHO, 'bob')).toMatchObject({ ok: true });
    expect(alice.socket.connected).toBe(true);
  });
});

describe('message size', () => {
  /** An `ECHO` payload whose encoded packet is `bytes` long, give or take the framing. */
  function payloadOf(bytes: number): string {
    return 'x'.repeat(bytes);
  }

  it.each(['websocket', 'polling'] as const)(
    'accepts a message just under MAX_MESSAGE_BYTES over %s',
    async (transport) => {
      await start();
      const alice = await player(undefined, transport);
      const payload = payloadOf(MAX_MESSAGE_BYTES - 100);
      expect(await sendRaw(alice, CLIENT_EVENTS.ECHO, payload)).toMatchObject({ ok: true, payload });
    },
  );

  it.each(['websocket', 'polling'] as const)('closes the connection on a larger message over %s', async (transport) => {
    await start();
    const alice = await player(undefined, transport);
    const disconnected = new Promise((resolve) => {
      alice.socket.once('disconnect', resolve);
    });
    (alice.socket as Socket).emit(CLIENT_EVENTS.ECHO, payloadOf(MAX_MESSAGE_BYTES + 1));
    expect(await disconnected).toMatch(/transport (close|error)/);
  });
});
