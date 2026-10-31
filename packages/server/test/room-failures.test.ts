import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  ERROR_CODES,
  ROOM_CLOSED_REASONS,
  ROOM_PHASES,
  SEATS,
  type CommandPayload,
} from '@battleship/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ROOM_TIMER_KINDS } from '../src/room/room-timers.js';
import type { RoomState } from '../src/room/room.js';
import {
  drop,
  P1_FLEET_SEED,
  placedFleet,
  placeFleets,
  placements,
  placingPlayers,
  player,
  rooms,
  seatedPlayers,
  send,
  start,
  stop,
  type Player,
  type SeatedPlayers,
} from './socket-harness.js';

// A failure in room logic stays in its room (#123, ADR-0104). Each fault is injected by spying on the test server's
// `RoomManager`, which `createServer` takes as an option: production code has no switch for it.

/** The message of every injected fault, which the error log must carry with its stack. */
const FAULT = 'injected fault';
/** Pino's `error` level. */
const ERROR_LEVEL = 50;

/** A line of the server's Pino log. */
interface LogLine {
  readonly level: number;
  readonly msg: string;
  readonly [key: string]: unknown;
}

/** Every line the current server logged at `info` and above. */
let lines: LogLine[];

afterEach(stop);

/** Starts the harness server with its log collected in `lines`. */
async function startLogged(): Promise<void> {
  const collected: LogLine[] = [];
  lines = collected;
  await start({
    logger: {
      level: 'info',
      stream: {
        write: (line: string) => {
          collected.push(JSON.parse(line) as LogLine);
        },
      },
    },
  });
}

/** Throws the injected fault. */
function fault(): never {
  throw new Error(FAULT);
}

/**
 * A copy of a room whose `field` throws when read, so whatever reads it fails after the room was stored.
 * @param state The room as the transition returned it.
 * @param field The field that throws: `players` fails the `STATE` projection, `rulesVersion` the ack of `UPDATE_RULES`.
 * @returns The trap.
 */
function faulty(state: RoomState, field: keyof RoomState): RoomState {
  return new Proxy(state, {
    get: (target, key, receiver) => (key === field ? fault() : (Reflect.get(target, key, receiver) as unknown)),
  });
}

/**
 * Makes the next `RoomManager.dispatch` store its room as usual, then hand the caller a copy whose `field` throws.
 * @param field The field that throws.
 */
function failAfterStore(field: keyof RoomState): void {
  const dispatch = rooms.dispatch.bind(rooms);
  vi.spyOn(rooms, 'dispatch').mockImplementationOnce((roomId, command, now) => {
    const result = dispatch(roomId, command, now);
    return result.ok ? { ...result, state: faulty(result.state, field) } : result;
  });
}

/**
 * Checks that the injected fault was logged at `error`, with its stack and the fields that place it.
 * @param msg The line's message.
 * @param fields The `roomId`, and the `event` or `timer`.
 */
function expectLoggedFailure(msg: string, fields: Readonly<Record<string, unknown>>): void {
  expect(lines).toContainEqual(
    expect.objectContaining({
      level: ERROR_LEVEL,
      msg,
      ...fields,
      err: expect.objectContaining({ message: FAULT, stack: expect.stringContaining(FAULT) as unknown }) as unknown,
    }),
  );
}

/**
 * Checks that every player of a room got `ROOM_CLOSED` for a server error, and that the room is gone.
 * @param roomId The room.
 * @param players The sockets still in it, with nothing else left to read before the notice.
 */
async function expectClosed(roomId: string, players: readonly Player[]): Promise<void> {
  for (const { inbox } of players) {
    expect(await inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.SERVER_ERROR });
  }
  expect(rooms.get(roomId)).toBeUndefined();
}

/**
 * Proves that a room in placement, which the fault did not touch, still plays: both fleets are placed, the dice are
 * rolled and its match starts.
 */
async function expectToPlay({ p1, p2 }: SeatedPlayers): Promise<void> {
  await placeFleets(p1, p2);
  for (const { inbox } of [p1, p2]) {
    // One snapshot per accepted command, then the dice roll and the snapshot that starts the match.
    await inbox.states(4);
    await inbox.dice();
    expect((await inbox.state()).phase).toBe(ROOM_PHASES.IN_PROGRESS);
  }
}

/** P1's fleet, as a draft `UPDATE_PLACEMENT` sends it. */
function draft(): CommandPayload<typeof CLIENT_EVENTS.UPDATE_PLACEMENT> {
  return { ships: placements(placedFleet(P1_FLEET_SEED)) };
}

describe('a command whose transition throws', () => {
  it('is refused with SERVER_ERROR, and the room keeps its state', async () => {
    await startLogged();
    const failing = await placingPlayers();
    const other = await placingPlayers();
    const before = rooms.get(failing.roomId);
    vi.spyOn(rooms, 'dispatch').mockImplementationOnce(fault);

    expect(await send(failing.p1, CLIENT_EVENTS.UPDATE_PLACEMENT, draft())).toEqual({
      ok: false,
      error: ERROR_CODES.SERVER_ERROR,
    });

    expect(rooms.get(failing.roomId)).toBe(before);
    expectLoggedFailure('Command failed', { roomId: failing.roomId, event: CLIENT_EVENTS.UPDATE_PLACEMENT });
    // Nothing was half-applied: the same command goes through once the fault is gone, and its `STATE` is the first
    // event either player gets.
    expect(await send(failing.p1, CLIENT_EVENTS.UPDATE_PLACEMENT, draft())).toEqual({ ok: true });
    expect((await failing.p1.inbox.state()).placement?.myShips).toHaveLength(draft().ships.length);
    expect((await failing.p2.inbox.state()).phase).toBe(ROOM_PHASES.PLACEMENT);
    await expectToPlay(other);
  });

  it('is refused for CREATE_ROOM and JOIN_ROOM too, leaving no room behind', async () => {
    await startLogged();
    const [alice, bob] = await Promise.all([player(), player()]);
    vi.spyOn(rooms, 'createRoom').mockImplementationOnce(fault);
    expect(await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })).toEqual({
      ok: false,
      error: ERROR_CODES.SERVER_ERROR,
    });
    expect(rooms.size).toBe(0);
    expectLoggedFailure('Command failed', { event: CLIENT_EVENTS.CREATE_ROOM });

    const { roomId } = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    await alice.inbox.state();
    vi.spyOn(rooms, 'joinRoom').mockImplementationOnce(fault);
    expect(await send(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' })).toEqual({
      ok: false,
      error: ERROR_CODES.SERVER_ERROR,
    });
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    expectLoggedFailure('Command failed', { roomId, event: CLIENT_EVENTS.JOIN_ROOM });
    expect(await send(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' })).toMatchObject({ ok: true });
  });
});

describe('a socket moving on from a room that fails', () => {
  it('closes the room it left, and takes its new seat', async () => {
    await startLogged();
    const alice = await player();
    const { roomId: left } = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as {
      roomId: string;
    };
    await alice.inbox.state();
    // Freeing the lone waiting seat it leaves (ADR-0095) throws.
    vi.spyOn(rooms, 'leave').mockImplementationOnce(fault);

    const created = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };

    expect(created).toMatchObject({ ok: true });
    expect((await alice.inbox.state()).roomId).toBe(created.roomId);
    expect(rooms.get(left)).toBeUndefined();
    expect(rooms.get(created.roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    expectLoggedFailure('Room failed', { roomId: left, event: CLIENT_EVENTS.CREATE_ROOM });
  });
});

describe('a failure after a command stored its change', () => {
  it('closes the room with ROOM_CLOSED to every socket in it when the STATE projection throws', async () => {
    await startLogged();
    const failing = await placingPlayers();
    const other = await placingPlayers();
    failAfterStore('players');

    // The ack went out before the failure.
    expect(await send(failing.p1, CLIENT_EVENTS.UPDATE_PLACEMENT, draft())).toEqual({ ok: true });

    await expectClosed(failing.roomId, [failing.p1, failing.p2]);
    expectLoggedFailure('Room failed', { roomId: failing.roomId, event: CLIENT_EVENTS.UPDATE_PLACEMENT });
    // Both sockets lost their seat, and stay connected.
    expect(await send(failing.p2, CLIENT_EVENTS.UPDATE_PLACEMENT, draft())).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
    await expectToPlay(other);
  });

  it('closes the room when the timer review throws', async () => {
    await startLogged();
    const failing = await placingPlayers();
    const other = await placingPlayers();
    vi.spyOn(rooms, 'placementEndsAt').mockImplementationOnce(fault);

    expect(await send(failing.p1, CLIENT_EVENTS.UPDATE_PLACEMENT, draft())).toEqual({ ok: true });

    await expectClosed(failing.roomId, [failing.p1, failing.p2]);
    expectLoggedFailure('Room failed', { roomId: failing.roomId, event: CLIENT_EVENTS.UPDATE_PLACEMENT });
    await expectToPlay(other);
  });

  it('answers SERVER_ERROR when it comes before the ack, then closes the room', async () => {
    await startLogged();
    const failing = await seatedPlayers();
    const other = await placingPlayers();
    failAfterStore('rulesVersion');

    expect(
      await send(failing.p1, CLIENT_EVENTS.UPDATE_RULES, {
        rules: { ...DEFAULT_RULES, isExtraTurnOnHitEnabled: true },
      }),
    ).toEqual({ ok: false, error: ERROR_CODES.SERVER_ERROR });

    await expectClosed(failing.roomId, [failing.p1, failing.p2]);
    expectLoggedFailure('Room failed', { roomId: failing.roomId, event: CLIENT_EVENTS.UPDATE_RULES });
    await expectToPlay(other);
  });
});

describe('a room timer task that throws', () => {
  it('closes its room, and the other rooms keep their timers', async () => {
    await startLogged();
    const failing = await placingPlayers();
    const other = await placingPlayers();
    vi.spyOn(rooms, 'endPlacementDue').mockImplementationOnce(fault);

    // Both fleets are confirmed, so the start countdown runs and the `PLACEMENT` timer fires.
    await placeFleets(failing.p1, failing.p2);
    for (const { inbox } of [failing.p1, failing.p2]) {
      await inbox.states(4);
    }

    await expectClosed(failing.roomId, [failing.p1, failing.p2]);
    expectLoggedFailure('Room failed', { roomId: failing.roomId, timer: ROOM_TIMER_KINDS.PLACEMENT });
    await expectToPlay(other);
  });
});

describe('a seat presence change that throws', () => {
  it('closes the room when a socket disconnects', async () => {
    await startLogged();
    const failing = await seatedPlayers();
    const other = await placingPlayers();
    vi.spyOn(rooms, 'setPresence').mockImplementationOnce(fault);

    failing.p2.socket.close();

    await expectClosed(failing.roomId, [failing.p1]);
    expectLoggedFailure('Room failed', { roomId: failing.roomId, event: 'disconnect' });
    await expectToPlay(other);
  });

  it('closes the room when a session comes back', async () => {
    await startLogged();
    const failing = await seatedPlayers();
    const other = await placingPlayers();
    await drop(failing.p2, failing.roomId, SEATS.P2);
    await failing.p1.inbox.state();
    vi.spyOn(rooms, 'setPresence').mockImplementationOnce(fault);

    const back = await player(failing.sessions.P2);

    await expectClosed(failing.roomId, [failing.p1, back]);
    expectLoggedFailure('Room failed', { roomId: failing.roomId, event: 'connection' });
    await expectToPlay(other);
  });
});

describe('a handshake check that throws', () => {
  it('refuses that connection with SERVER_ERROR and changes nothing', async () => {
    await startLogged();
    const { p1, roomId, sessions } = await placingPlayers();
    const before = rooms.get(roomId);
    vi.spyOn(rooms, 'findSeat').mockImplementationOnce(fault);

    await expect(player(sessions.P2)).rejects.toThrow(ERROR_CODES.SERVER_ERROR);

    expectLoggedFailure('Handshake failed', {});
    expect(rooms.get(roomId)).toBe(before);
    // The next attempt goes through, replacing the socket that held the seat, and the room plays on.
    const back = await player(sessions.P2);
    await back.inbox.state();
    await expectToPlay({ p1, p2: back, roomId, sessions });
  });
});
