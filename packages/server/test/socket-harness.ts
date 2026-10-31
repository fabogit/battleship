// The Socket.io test harness the server tests share (#53, F11): one in-process server per test on an ephemeral port,
// with a seeded registry and a `FakeClock`, and real `socket.io-client` clients against it (docs/server.md#testability).

import {
  BOARD_SIZE,
  CLIENT_EVENTS,
  createSeededRng,
  DEFAULT_RULES,
  generateRandomFleet,
  PROTOCOL_VERSION,
  SEATS,
  SERVER_EVENTS,
  START_COUNTDOWN_MS,
  type ClientToServerEvents,
  type CommandEvent,
  type CommandPayload,
  type Coordinate,
  type DiceRolledPayload,
  type GameRules,
  type HandshakeAuth,
  type PlacedShip,
  type PlayerStateSnapshot,
  type RoomClosedPayload,
  type Seat,
  type ServerToClientEvents,
  type SessionCredentials,
  type ShipPlacement,
  type ShotResolvedPayload,
} from '@battleship/core';
import { io as connect, type Socket } from 'socket.io-client';
import { expect, vi } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { RoomManager } from '../src/room/room-manager.js';
import { createServer, type ServerOptions } from '../src/server.js';
import { FakeClock } from './fake-clock.js';

/** A client socket typed with the protocol's event maps. */
export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** The Engine.IO transports a client can be limited to. */
export type Transport = 'websocket' | 'polling';

/** The time every test starts at; the clock only moves when a test advances it. */
export const NOW = 1_700_000_000_000;
/** How long a client waits for an ack before the send fails the test. */
export const ACK_TIMEOUT_MS = 2_000;
/** How long a player takes per turn in a full match, so the rate limit sees real pacing. */
export const TURN_MS = 1_000;
/** The origin the test server allows. */
export const ALLOWED_ORIGIN = 'https://battleship.example';
/**
 * Seed of the registry's `Rng`, so the first room id is known in advance; with it, the first match on a server that
 * drew one room id and completed no fleet starts with `P1` (6 against 1).
 */
export const ROOM_SEED = 7;
/** Seed of P1's fleet. */
export const P1_FLEET_SEED = 1;
/** Seed of P2's fleet. */
export const P2_FLEET_SEED = 2;

/** Stands for a command's ack among the events of an inbox; lower case, so no server event can take it. */
const ACK_MARKER = 'ack';

// The running server's parts, as live bindings: `start` sets them, and every importer reads the current ones.
/** The server of the current test. */
export let app: FastifyInstance;
/** Its room registry. */
export let rooms: RoomManager;
/** Its clock. */
export let clock: FakeClock;
/** Its root URL. */
export let baseUrl: string;

/** Whether `app` is listening and not closed yet. */
let isServerRunning = false;
/** Every client a test opened, closed by `stop`. */
const clients: Socket[] = [];

/** What a test may change about its server; everything else is the same for every test. */
export type StartOptions = Partial<Pick<ServerOptions, 'allowedOrigins' | 'logger' | 'trustProxyHops'>> & {
  /** Seed of the registry's `Rng`: room ids, completed fleets and dice; `ROOM_SEED` by default. */
  readonly seed?: number;
};

/**
 * Starts a server with a seeded registry (ADR-0030) and a fake clock at `NOW` (ADR-0065), and sets `app`, `rooms`,
 * `clock` and `baseUrl`.
 * @param options The registry's seed, the allowed origins (`ALLOWED_ORIGIN` by default), the logger (none by default)
 * and the trusted proxy hops.
 */
export async function start({ seed = ROOM_SEED, ...options }: StartOptions = {}): Promise<void> {
  rooms = new RoomManager({ rng: createSeededRng(seed) });
  clock = new FakeClock(NOW);
  app = createServer({
    allowedOrigins: [ALLOWED_ORIGIN],
    logger: false,
    ...options,
    rooms,
    clock,
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  isServerRunning = true;
}

/** Closes the server; a test that needs the shutdown itself calls it, and `stop` does not close it again. */
export async function closeServer(): Promise<void> {
  if (isServerRunning) {
    isServerRunning = false;
    await app.close();
  }
}

/** Closes every client, then the server: each test file runs it `afterEach`. */
export async function stop(): Promise<void> {
  for (const client of clients.splice(0)) {
    client.close();
  }
  await closeServer();
}

/**
 * Registers a client the test opened itself, so `stop` closes it.
 * @param socket The new client.
 * @returns The same client.
 */
export function track<S extends Socket>(socket: S): S {
  clients.push(socket);
  return socket;
}

/** A server event as a client received it. */
export interface Received {
  /** The event name, or `ACK_MARKER` for an ack put on the timeline. */
  readonly event: string;
  /** Its payload. */
  readonly payload: unknown;
}

/**
 * Every server event one client receives, in order, so a test reads them one by one and an unexpected or missing event
 * fails the next read. Acks recorded with `recordAck` join the same timeline.
 */
export class Inbox {
  readonly #messages: Received[] = [];
  #waiting: ((message: Received) => void) | undefined;

  constructor(socket: ClientSocket) {
    socket.onAny((event: string, payload: unknown) => {
      this.#deliver({ event, payload });
    });
  }

  /**
   * Puts a command's ack on the timeline, called from the emit callback so it lands between the events that arrived
   * before and after it.
   * @param response The ack's reply, read back with `ack()`.
   */
  recordAck(response: unknown): void {
    this.#deliver({ event: ACK_MARKER, payload: response });
  }

  /**
   * Hands a message to the read waiting for it, or queues it.
   * @param message An event or an ack, in arrival order.
   */
  #deliver(message: Received): void {
    const waiting = this.#waiting;
    this.#waiting = undefined;
    if (waiting === undefined) {
      this.#messages.push(message);
    } else {
      waiting(message);
    }
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

  /** The next event, which must be `DICE_ROLLED`. */
  async dice(): Promise<DiceRolledPayload> {
    const message = await this.next();
    expect(message.event).toBe(SERVER_EVENTS.DICE_ROLLED);
    return message.payload as DiceRolledPayload;
  }

  /** The next event, which must be `SHOT_RESOLVED`. */
  async shot(): Promise<ShotResolvedPayload> {
    const message = await this.next();
    expect(message.event).toBe(SERVER_EVENTS.SHOT_RESOLVED);
    return message.payload as ShotResolvedPayload;
  }

  /** The next event, which must be `ROOM_CLOSED`. */
  async roomClosed(): Promise<RoomClosedPayload> {
    const message = await this.next();
    expect(message.event).toBe(SERVER_EVENTS.ROOM_CLOSED);
    return message.payload as RoomClosedPayload;
  }

  /** The next entry, which must be an ack recorded with `recordAck`; returns its reply. */
  async ack(): Promise<unknown> {
    const message = await this.next();
    expect(message.event).toBe(ACK_MARKER);
    return message.payload;
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
export interface Player {
  /** The client. */
  readonly socket: ClientSocket;
  /** Every event it received, in order. */
  readonly inbox: Inbox;
}

/**
 * A connected client, as the browser opens it: the current protocol version and, to reopen a seat, a session.
 * @param session Credentials from a `CREATE_ROOM` or `JOIN_ROOM` ack; none for a client without a room.
 * @param transport The only transport it may use; WebSocket, as browsers try first, by default.
 */
export async function player(session?: SessionCredentials, transport: Transport = 'websocket'): Promise<Player> {
  const auth: HandshakeAuth =
    session === undefined ? { protocolVersion: PROTOCOL_VERSION } : { protocolVersion: PROTOCOL_VERSION, session };
  const socket: ClientSocket = track(connect(baseUrl, { transports: [transport], reconnection: false, auth }));
  const inbox = new Inbox(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return { socket, inbox };
}

/** Sends a command and returns its ack, untyped: each test asserts the shape. */
export async function send<E extends CommandEvent>(
  from: Player,
  event: E,
  payload: CommandPayload<E>,
): Promise<unknown> {
  return sendRaw(from, event, payload);
}

/** Sends anything under any event name, as a misbehaving client could, `ECHO` included. */
export async function sendRaw(from: Player, event: string, payload: unknown): Promise<unknown> {
  // The typed socket cannot narrow an event name held in a variable; `send` keeps the contract.
  const response: unknown = await (from.socket as Socket).timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload);
  return response;
}

/**
 * Proves that nothing is left in a player's inbox. `Inbox` never checks for leftover events, so this creates a room
 * whose `STATE` must be the very next event; a stray event read first fails the check.
 */
export async function expectNothingPending(target: Player): Promise<void> {
  const { roomId } = (await send(target, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Probe' })) as { roomId: string };
  expect((await target.inbox.state()).roomId).toBe(roomId);
}

/**
 * Closes a client, as a tab that is closed or loses its network, and waits until the server has recorded its seat as
 * away, which no other client may be there to see.
 * @param target The client to close; it must be its seat's only socket.
 * @param roomId Its room.
 * @param seat Its seat.
 */
export async function drop(target: Player, roomId: string, seat: Seat): Promise<void> {
  target.socket.close();
  await vi.waitFor(() => {
    expect(rooms.get(roomId)?.disconnectedAt[seat]).not.toBeNull();
  });
}

/** A random fleet, deterministic for its seed. */
export function placedFleet(seed: number): PlacedShip[] {
  return generateRandomFleet(DEFAULT_RULES, createSeededRng(seed));
}

/** The fleet as the client sends it: placements without derived coordinates. */
export function placements(fleet: readonly PlacedShip[]): ShipPlacement[] {
  return fleet.map(({ type, start, orientation }) => ({ type, start, orientation }));
}

/** Every board cell no ship of the fleet occupies. */
export function waterOf(fleet: readonly PlacedShip[]): Coordinate[] {
  const occupied = new Set(fleet.flatMap((ship) => ship.coordinates.map(({ x, y }) => `${String(x)},${String(y)}`)));
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => ({
    x: index % BOARD_SIZE,
    y: Math.floor(index / BOARD_SIZE),
  })).filter(({ x, y }) => !occupied.has(`${String(x)},${String(y)}`));
}

/** Two seated players, with the credentials each got in its ack. */
export interface SeatedPlayers {
  /** The creator. */
  readonly p1: Player;
  /** The joiner. */
  readonly p2: Player;
  /** Their room. */
  readonly roomId: string;
  /** Each seat's session, as the client stores it. */
  readonly sessions: Readonly<Record<Seat, SessionCredentials>>;
}

/** P1 creates a room and P2 joins it, which opens rules negotiation; the snapshots this sends are read. */
export async function seatedPlayers(): Promise<SeatedPlayers> {
  const [p1, p2] = await Promise.all([player(), player()]);
  const created = (await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as SessionCredentials;
  const { roomId } = created;
  const joined = (await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' })) as { playerSecret: string };
  await p1.inbox.states(2);
  await p2.inbox.states(1);
  const sessions = {
    P1: { roomId, playerSecret: created.playerSecret },
    P2: { roomId, playerSecret: joined.playerSecret },
  };
  return { p1, p2, roomId, sessions };
}

/**
 * Both players confirm the rules in place, `P1` first, which starts placement with them (ADR-0003). The inboxes are not
 * read: each player gets one `STATE` per confirmation, two in all.
 * @param rulesVersion The version in place; `0` until someone edits the rules.
 */
export async function agreeOnRules(p1: Player, p2: Player, rulesVersion = 0): Promise<void> {
  for (const from of [p1, p2]) {
    expect(await send(from, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion })).toEqual({ ok: true });
  }
}

/**
 * Both players place and confirm the fleets of `P1_FLEET_SEED` and `P2_FLEET_SEED`, then the clock runs the start
 * countdown, which rolls the dice and starts the match. The inboxes are not read: each player gets one `STATE` per
 * command, then `DICE_ROLLED` and the `STATE` that starts the match.
 */
export async function placeFleets(p1: Player, p2: Player): Promise<void> {
  for (const [from, seed] of [
    [p1, P1_FLEET_SEED],
    [p2, P2_FLEET_SEED],
  ] as const) {
    expect(await send(from, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(placedFleet(seed)) })).toEqual({
      ok: true,
    });
    expect(await send(from, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
  }
  clock.advance(START_COUNTDOWN_MS);
}

/**
 * Two seated players who agreed on the rules, now placing their fleets; the snapshots this sends are read.
 * @param rules The rules `P1` proposes before both confirm; `DEFAULT_RULES` are kept as they are.
 */
export async function placingPlayers(rules: GameRules = DEFAULT_RULES): Promise<SeatedPlayers> {
  const seated = await seatedPlayers();
  const { p1, p2 } = seated;
  let rulesVersion = 0;
  if (rules !== DEFAULT_RULES) {
    expect(await send(p1, CLIENT_EVENTS.UPDATE_RULES, { rules })).toEqual({ ok: true, rulesVersion: 1 });
    rulesVersion = 1;
    await p1.inbox.state();
    await p2.inbox.state();
  }
  await agreeOnRules(p1, p2, rulesVersion);
  await p1.inbox.states(2);
  await p2.inbox.states(2);
  return seated;
}

/** Two seated players whose match has started, with the dice roll that picked who fires first. */
export interface StartedMatch extends SeatedPlayers {
  /** The `DICE_ROLLED` both players got. */
  readonly dice: DiceRolledPayload;
}

/**
 * Two seated players who agreed on the rules and whose match has started; the events this sends are read. With
 * `ROOM_SEED`, `P1` fires first when the room is the server's first.
 * @param rules The rules of the match; `DEFAULT_RULES` by default.
 */
export async function startedMatch(rules: GameRules = DEFAULT_RULES): Promise<StartedMatch> {
  const seated = await placingPlayers(rules);
  const { p1, p2 } = seated;
  await placeFleets(p1, p2);
  const rolls: DiceRolledPayload[] = [];
  for (const { inbox } of [p1, p2]) {
    // One snapshot per accepted command, then the dice roll and the snapshot that starts the match.
    await inbox.states(4);
    rolls.push(await inbox.dice());
    expect((await inbox.state()).battle?.currentTurn).toBe(rolls.at(-1)?.starter);
  }
  const [dice] = rolls;
  if (dice === undefined) {
    expect.fail('no dice roll');
  }
  expect(rolls[1]).toEqual(dice);
  return { ...seated, dice };
}

/**
 * Plays a started match to its end without reading the inboxes: P1 fires at every cell of P2's fleet, P2 at water in
 * between (and first, when it starts), so P1 wins with its last shot. The clock moves `TURN_MS` per round.
 * @param starter The seat the dice picked; `P1` by default, as `ROOM_SEED` rolls it in a server's first room.
 * @returns The cells each player fired at, in order.
 */
export async function playToVictory(
  p1: Player,
  p2: Player,
  starter: Seat = SEATS.P1,
): Promise<Record<Seat, Coordinate[]>> {
  const p1Targets = placedFleet(P2_FLEET_SEED).flatMap((ship) => ship.coordinates);
  const p2ShotCount = starter === SEATS.P1 ? p1Targets.length - 1 : p1Targets.length;
  const p2Targets = waterOf(placedFleet(P1_FLEET_SEED)).slice(0, p2ShotCount);
  /** Fires P2's shot of a round, if it has one left. */
  const fireP2 = async (turn: number): Promise<void> => {
    const p2Target = p2Targets[turn];
    if (p2Target !== undefined) {
      expect(await send(p2, CLIENT_EVENTS.FIRE, { targets: [p2Target] })).toEqual({ ok: true });
    }
  };
  for (const [turn, target] of p1Targets.entries()) {
    // One turn per second for each player, under the rate limit whatever the test sent before.
    clock.advance(TURN_MS);
    if (starter === SEATS.P2) {
      await fireP2(turn);
    }
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [target] })).toEqual({ ok: true });
    if (starter === SEATS.P1) {
      await fireP2(turn);
    }
  }
  return { P1: p1Targets, P2: p2Targets };
}
