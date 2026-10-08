import {
  BOARD_SIZE,
  CLIENT_EVENTS,
  createSeededRng,
  DEFAULT_RULES,
  ERROR_CODES,
  GAME_OVER_REASONS,
  generateRandomFleet,
  MAX_ROOMS,
  parseSessionCredentials,
  PLACEMENT_TIME_LIMIT_MS,
  REMATCH_CHOICES,
  ROOM_PHASES,
  SEATS,
  SERVER_EVENTS,
  SHOT_OUTCOMES,
  type ClientToServerEvents,
  type CommandEvent,
  type CommandPayload,
  type Coordinate,
  type PlacedShip,
  type PlayerStateSnapshot,
  type ServerToClientEvents,
  type ShipPlacement,
  type ShotResolvedPayload,
} from '@battleship/core';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { generateRoomId, RoomManager } from '../src/room/room-manager.js';
import { createServer } from '../src/server.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Seed of the registry's room ids, so the first room id is known in advance. */
const ROOM_SEED = 7;
/** Seeds of the two fleets. */
const P1_FLEET_SEED = 1;
const P2_FLEET_SEED = 2;
/** The fixed clock every test runs at. */
const NOW = 1_700_000_000_000;
const ACK_TIMEOUT_MS = 2_000;

/** Every command but `ECHO`, which has no guard. */
const COMMAND_EVENTS = Object.values(CLIENT_EVENTS).filter(
  (event): event is CommandEvent => event !== CLIENT_EVENTS.ECHO,
);

/** Commands whose room logic lands later; refused with `NOT_ALLOWED` after their guard (ADR-0046). */
const NOT_YET_SUPPORTED: readonly { [E in CommandEvent]: readonly [E, CommandPayload<E>] }[CommandEvent][] = [
  [CLIENT_EVENTS.UPDATE_RULES, { rules: DEFAULT_RULES }],
  [CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 }],
  [CLIENT_EVENTS.SET_PAUSED, { isPaused: true }],
  [CLIENT_EVENTS.SURRENDER, {}],
  [CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.LEAVE }],
  [CLIENT_EVENTS.LEAVE_ROOM, {}],
];

let app: FastifyInstance;
let rooms: RoomManager;
let baseUrl: string;
const clients: ClientSocket[] = [];

/** Starts a server with a seeded registry and a fixed clock (ADR-0030). */
async function start(): Promise<void> {
  rooms = new RoomManager({ rng: createSeededRng(ROOM_SEED) });
  app = createServer({ allowedOrigins: ['https://battleship.example'], logger: false, rooms, now: () => NOW });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  await app.close();
});

/** A server event as a client received it. */
interface Received {
  readonly event: string;
  readonly payload: unknown;
}

/**
 * Every server event one client receives, in order, so a test reads them one by one and an unexpected or missing event
 * fails the next read.
 */
class Inbox {
  readonly #messages: Received[] = [];
  #waiting: ((message: Received) => void) | undefined;

  constructor(socket: ClientSocket) {
    socket.onAny((event: string, payload: unknown) => {
      const waiting = this.#waiting;
      this.#waiting = undefined;
      if (waiting === undefined) {
        this.#messages.push({ event, payload });
      } else {
        waiting({ event, payload });
      }
    });
  }

  /** The next event, waiting for it when none is queued. */
  next(): Promise<Received> {
    const message = this.#messages.shift();
    return message === undefined
      ? new Promise((resolve) => {
          this.#waiting = resolve;
        })
      : Promise.resolve(message);
  }

  /** The next event, which must be `STATE`. */
  async state(): Promise<PlayerStateSnapshot> {
    const message = await this.next();
    expect(message.event).toBe(SERVER_EVENTS.STATE);
    return message.payload as PlayerStateSnapshot;
  }

  /** The next event, which must be `SHOT_RESOLVED`. */
  async shot(): Promise<ShotResolvedPayload> {
    const message = await this.next();
    expect(message.event).toBe(SERVER_EVENTS.SHOT_RESOLVED);
    return message.payload as ShotResolvedPayload;
  }

  /** Reads `count` snapshots and returns the last one. */
  async states(count: number): Promise<PlayerStateSnapshot | undefined> {
    let last: PlayerStateSnapshot | undefined;
    for (let index = 0; index < count; index++) {
      last = await this.state();
    }
    return last;
  }
}

/** A connected client with its inbox. */
interface Player {
  readonly socket: ClientSocket;
  readonly inbox: Inbox;
}

/** A connected client, as the browser opens it. */
async function player(): Promise<Player> {
  const socket: ClientSocket = connect(baseUrl, { transports: ['websocket'], reconnection: false });
  clients.push(socket);
  const inbox = new Inbox(socket);
  await new Promise<void>((resolve) => {
    socket.once('connect', resolve);
  });
  return { socket, inbox };
}

/** Sends a command and returns its ack, untyped: each test asserts the shape. */
async function send<E extends CommandEvent>(from: Player, event: E, payload: CommandPayload<E>): Promise<unknown> {
  return sendRaw(from, event, payload);
}

/** Sends anything under a command's name, as a misbehaving client could. */
async function sendRaw(from: Player, event: string, payload: unknown): Promise<unknown> {
  // The typed socket cannot narrow an event name held in a variable; `send` keeps the contract.
  const response: unknown = await (from.socket as Socket).timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload);
  return response;
}

/** A random fleet, deterministic for its seed. */
function placedFleet(seed: number): PlacedShip[] {
  return generateRandomFleet(DEFAULT_RULES, createSeededRng(seed));
}

/** The fleet as the client sends it: placements without derived coordinates. */
function placements(fleet: readonly PlacedShip[]): ShipPlacement[] {
  return fleet.map(({ type, start, orientation }) => ({ type, start, orientation }));
}

/** Every board cell no ship of the fleet occupies. */
function waterOf(fleet: readonly PlacedShip[]): Coordinate[] {
  const occupied = new Set(fleet.flatMap((ship) => ship.coordinates.map(({ x, y }) => `${String(x)},${String(y)}`)));
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => ({
    x: index % BOARD_SIZE,
    y: Math.floor(index / BOARD_SIZE),
  })).filter(({ x, y }) => !occupied.has(`${String(x)},${String(y)}`));
}

/** P1 creates a room and P2 joins it; the snapshots this sends are read. */
async function seatedPlayers(): Promise<{ p1: Player; p2: Player; roomId: string }> {
  const [p1, p2] = await Promise.all([player(), player()]);
  const created = (await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
  await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId: created.roomId, nickname: 'Bob' });
  await p1.inbox.states(2);
  await p2.inbox.states(1);
  return { p1, p2, roomId: created.roomId };
}

/** Both players place and confirm their seeded fleets, so the match starts with `P1` to fire. */
async function startedMatch(): Promise<{ p1: Player; p2: Player }> {
  const { p1, p2 } = await seatedPlayers();
  for (const [from, seed] of [
    [p1, P1_FLEET_SEED],
    [p2, P2_FLEET_SEED],
  ] as const) {
    await send(from, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(placedFleet(seed)) });
    await send(from, CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
  }
  // One snapshot per accepted command, to each player.
  await p1.inbox.states(4);
  await p2.inbox.states(4);
  return { p1, p2 };
}

describe('a match between two real clients', () => {
  it('goes from create to join, placement and battle until victory', async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);

    // Create: P1 gets the credentials in the ack and its first snapshot.
    const created = await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: '  Alice ' });
    const expectedRoomId = generateRoomId(createSeededRng(ROOM_SEED));
    expect(created).toEqual({ ok: true, roomId: expectedRoomId, playerSecret: expect.any(String) as unknown });
    const { roomId, playerSecret: p1Secret } = created as { roomId: string; playerSecret: string };
    expect(parseSessionCredentials({ roomId, playerSecret: p1Secret })).not.toBeNull();
    expect(await p1.inbox.state()).toMatchObject({
      roomId,
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      me: { seat: SEATS.P1, nickname: 'Alice' },
      opponent: null,
    });

    // Join: both get a placement snapshot with the deadline from the fixed clock.
    const joined = await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    expect(joined).toEqual({ ok: true, playerSecret: expect.any(String) as unknown });
    const p2Secret = (joined as { playerSecret: string }).playerSecret;
    expect(p2Secret).not.toBe(p1Secret);
    expect(parseSessionCredentials({ roomId, playerSecret: p2Secret })).not.toBeNull();
    const placementSnapshots = [await p1.inbox.state(), await p2.inbox.state()];
    for (const snapshot of placementSnapshots) {
      expect(snapshot).toMatchObject({
        phase: ROOM_PHASES.PLACEMENT,
        placement: { myShips: [], hasConfirmed: { me: false, opponent: false }, remainingMs: PLACEMENT_TIME_LIMIT_MS },
      });
      // Secrets only ever travel in their owner's ack.
      expect(JSON.stringify(snapshot)).not.toContain(p1Secret);
      expect(JSON.stringify(snapshot)).not.toContain(p2Secret);
    }
    expect(placementSnapshots.map((snapshot) => [snapshot.me.seat, snapshot.opponent?.nickname])).toEqual([
      [SEATS.P1, 'Bob'],
      [SEATS.P2, 'Alice'],
    ]);

    // Placement: P1's draft reaches P1 only; confirm and unlock show up on P2's side.
    const p1Fleet = placedFleet(P1_FLEET_SEED);
    const p2Fleet = placedFleet(P2_FLEET_SEED);
    expect(await send(p1, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(p1Fleet) })).toEqual({ ok: true });
    expect((await p1.inbox.state()).placement?.myShips).toEqual(p1Fleet);
    expect((await p2.inbox.state()).placement?.myShips).toEqual([]);

    expect(await send(p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
    expect((await p1.inbox.state()).placement?.hasConfirmed).toEqual({ me: true, opponent: false });
    expect((await p2.inbox.state()).placement?.hasConfirmed).toEqual({ me: false, opponent: true });

    expect(await send(p1, CLIENT_EVENTS.UNLOCK_PLACEMENT, {})).toEqual({ ok: true });
    expect((await p1.inbox.state()).placement?.hasConfirmed).toEqual({ me: false, opponent: false });
    expect((await p2.inbox.state()).placement?.hasConfirmed).toEqual({ me: false, opponent: false });

    expect(await send(p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
    expect(await send(p2, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(p2Fleet) })).toEqual({ ok: true });
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.states(3)).toMatchObject({
        phase: ROOM_PHASES.IN_PROGRESS,
        placement: null,
        battle: { currentTurn: SEATS.P1, incomingShots: [], outgoingShots: [] },
      });
    }

    // Battle: P1 drafts, then fires at every cell of P2's fleet; P2 fires at water in between.
    const p1Targets = p2Fleet.flatMap((ship) => ship.coordinates);
    const p2Targets = waterOf(p1Fleet);
    let finalStates: PlayerStateSnapshot[] = [];
    for (const [turn, target] of p1Targets.entries()) {
      expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: [target] })).toEqual({ ok: true });
      expect((await p1.inbox.state()).battle?.myDraftTargets).toEqual([target]);
      // The draft is the shooter's own: the opponent's snapshot never shows it.
      expect((await p2.inbox.state()).battle?.myDraftTargets).toEqual([]);

      // Each player gets SHOT_RESOLVED, then STATE (ADR-0047).
      expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [target] })).toEqual({ ok: true });
      for (const { inbox } of [p1, p2]) {
        const shot = await inbox.shot();
        expect(shot).toMatchObject({ shooter: SEATS.P1, results: [{ coordinate: target }] });
        expect(shot.results[0]?.outcome).not.toBe(SHOT_OUTCOMES.MISS);
      }
      const states = [await p1.inbox.state(), await p2.inbox.state()];
      if (turn === p1Targets.length - 1) {
        finalStates = states;
        break;
      }
      // P2 sees P1's shots on its own board; P1 sees them on P2's.
      expect(states[0]?.battle?.outgoingShots).toHaveLength(turn + 1);
      expect(states[1]?.battle?.incomingShots).toHaveLength(turn + 1);
      expect(states[1]?.battle?.currentTurn).toBe(SEATS.P2);

      const p2Target = p2Targets[turn];
      if (p2Target === undefined) {
        expect.fail('P2 ran out of water cells');
      }
      expect(await send(p2, CLIENT_EVENTS.FIRE, { targets: [p2Target] })).toEqual({ ok: true });
      for (const { inbox } of [p1, p2]) {
        expect(await inbox.shot()).toEqual({
          shooter: SEATS.P2,
          results: [{ coordinate: p2Target, outcome: SHOT_OUTCOMES.MISS }],
        });
        expect((await inbox.state()).battle?.currentTurn).toBe(SEATS.P1);
      }
    }

    // Game over: P1 won, and each side now sees the other's whole fleet.
    for (const snapshot of finalStates) {
      expect(snapshot).toMatchObject({
        phase: ROOM_PHASES.GAME_OVER,
        battle: null,
        gameOver: { winner: SEATS.P1, reason: GAME_OVER_REASONS.FLEET_DESTROYED },
      });
    }
    expect(finalStates[0]?.gameOver?.opponentShips).toEqual(p2Fleet);
    expect(finalStates[1]?.gameOver?.opponentShips).toEqual(p1Fleet);
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({
      ok: false,
      error: ERROR_CODES.WRONG_PHASE,
    });
  });
});

describe('payload guards', () => {
  it.each(COMMAND_EVENTS)('refuse a malformed %s with INVALID_PAYLOAD', async (event) => {
    await start();
    const alice = await player();
    expect(await sendRaw(alice, event, { unexpected: true })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_PAYLOAD,
    });
  });

  it('run before the seat check', async () => {
    await start();
    const alice = await player();
    expect(await sendRaw(alice, CLIENT_EVENTS.FIRE, { targets: [{ x: BOARD_SIZE, y: 0 }] })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_PAYLOAD,
    });
  });
});

describe('command acks', () => {
  it('carry SERVER_FULL once MAX_ROOMS rooms are open', async () => {
    await start();
    for (let index = 0; index < MAX_ROOMS; index++) {
      rooms.createRoom({ nickname: `Player ${String(index)}` });
    }
    const alice = await player();
    expect(await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Late' })).toEqual({
      ok: false,
      error: ERROR_CODES.SERVER_FULL,
    });
  });

  it('carry ROOM_NOT_FOUND and ROOM_FULL from the registry and room logic', async () => {
    await start();
    const { roomId } = await seatedPlayers();
    const third = await player();
    expect(await send(third, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Carol' })).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_FULL,
    });
    const unknownRoomId = generateRoomId(createSeededRng(ROOM_SEED + 1));
    expect(await send(third, CLIENT_EVENTS.JOIN_ROOM, { roomId: unknownRoomId, nickname: 'Carol' })).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_NOT_FOUND,
    });
  });

  it('refuse a seat command from a socket without a seat with NOT_ALLOWED', async () => {
    await start();
    const alice = await player();
    expect(await send(alice, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
  });

  it.each(NOT_YET_SUPPORTED)('refuse %s with NOT_ALLOWED until its room logic lands', async (event, payload) => {
    await start();
    const { p1 } = await seatedPlayers();
    expect(await sendRaw(p1, event, payload)).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
  });

  it('refuse joining the other seat of the room the socket sits in', async () => {
    await start();
    const alice = await player();
    const { roomId } = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    expect(await send(alice, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Alice' })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
  });

  it('send nothing for a refused command', async () => {
    await start();
    const { p1, p2 } = await startedMatch();
    expect(await send(p2, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_YOUR_TURN,
    });
    // Events on one socket arrive in order: the next ones each player reads come from the accepted shot.
    await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] });
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).shooter).toBe(SEATS.P1);
      expect((await inbox.state()).battle?.currentTurn).toBe(SEATS.P2);
    }
  });

  it('ignore a command sent without an ack', async () => {
    await start();
    const alice = await player();
    (alice.socket as Socket).emit(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    // Still served, and the command above created nothing.
    expect(await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })).toMatchObject({ ok: true });
    expect(rooms.size).toBe(1);
  });
});

describe('seat binding', () => {
  it('moves a socket that creates a second room out of the first', async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);
    const first = (await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    const second = (await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    expect((await p1.inbox.state()).roomId).toBe(first.roomId);
    expect((await p1.inbox.state()).roomId).toBe(second.roomId);

    await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId: first.roomId, nickname: 'Bob' });
    expect((await p2.inbox.state()).phase).toBe(ROOM_PHASES.PLACEMENT);
    // P1's commands now go to the second room, still waiting for an opponent; the first room's STATE never reached P1.
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: false, error: ERROR_CODES.WRONG_PHASE });
    const third = (await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    expect((await p1.inbox.state()).roomId).toBe(third.roomId);
  });
});
