import {
  CLIENT_EVENTS,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  ORIENTATIONS,
  PLACEMENT_VIOLATIONS,
  PROTOCOL_VERSION,
  RATE_LIMIT_EVENTS_PER_SECOND,
  ROOM_PHASES,
  SEATS,
  SERVER_EVENTS,
  SHIP_TYPES,
  WAITING_TTL_MS,
} from '@battleship/core';
import { io as connect } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LogLevel } from '../src/config.js';
import {
  ACK_TIMEOUT_MS,
  ALLOWED_ORIGIN as ALLOWED,
  baseUrl as harnessBaseUrl,
  clock,
  closeServer,
  start as startServer,
  startedMatch,
  stop,
  track,
  type ClientSocket,
  type StartOptions,
} from './socket-harness.js';

const FOREIGN = 'https://evil.example';
/** A client address as Render's proxy would append it, and one a client could write itself. */
const CLIENT_ADDRESS = '203.0.113.9';
const SPOOFED_ADDRESS = '198.51.100.1';

interface LogLine {
  readonly level: number;
  readonly msg: string;
  readonly [key: string]: unknown;
}

afterEach(stop);

/** Starts the harness server with its Pino output collected in memory. */
async function start(
  level: LogLevel,
  options: Pick<StartOptions, 'trustProxyHops'> = {},
): Promise<{ baseUrl: string; lines: LogLine[] }> {
  const lines: LogLine[] = [];
  await startServer({
    ...options,
    logger: {
      level,
      stream: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as LogLine);
        },
      },
    },
  });
  return { baseUrl: harnessBaseUrl, lines };
}

function client(
  baseUrl: string,
  origin = ALLOWED,
  auth: object = { protocolVersion: PROTOCOL_VERSION },
  headers: Record<string, string> = {},
): ClientSocket {
  const socket: ClientSocket = connect(baseUrl, {
    transports: ['polling', 'websocket'],
    reconnection: false,
    extraHeaders: { ...headers, origin },
    auth,
  });
  return track(socket);
}

function messages(lines: readonly LogLine[]): string[] {
  return lines.map((line) => line.msg);
}

describe('/health request logs', () => {
  it('are hidden at info', async () => {
    const { baseUrl, lines } = await start('info');
    await fetch(`${baseUrl}/health`);
    expect(lines.filter((line) => line['reqId'] !== undefined)).toEqual([]);
  });

  it('are shown at debug', async () => {
    const { baseUrl, lines } = await start('debug');
    await fetch(`${baseUrl}/health`);
    expect(messages(lines)).toEqual(expect.arrayContaining(['incoming request', 'request completed']));
  });
});

describe('socket logs', () => {
  it('cover connection, events and disconnection at debug', async () => {
    const { baseUrl, lines } = await start('debug');
    const socket = client(baseUrl);
    // Upgrading after the disconnect would never happen: wait for it so the test does not race.
    await new Promise((resolve) => socket.io.engine.once('upgrade', resolve));
    await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.ECHO, { hello: 'battleship' });
    // The client clears its id on disconnect.
    const socketId = socket.id;
    socket.disconnect();

    await vi.waitFor(() => {
      expect(messages(lines)).toContain('Socket disconnected');
    });
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Socket connected', socketId, transport: 'polling', origin: ALLOWED }),
        expect.objectContaining({ msg: 'Socket transport upgraded', transport: 'websocket' }),
        // The ack callback is not logged as an argument.
        expect.objectContaining({
          msg: 'Socket event received',
          event: CLIENT_EVENTS.ECHO,
          args: [{ hello: 'battleship' }],
        }),
        expect.objectContaining({ msg: 'Socket disconnected', reason: 'client namespace disconnect' }),
      ]),
    );
  });

  it('log broadcasts sent to each socket', async () => {
    const { baseUrl, lines } = await start('debug');
    const socket = client(baseUrl);
    await new Promise<void>((resolve) => {
      socket.once('connect', resolve);
    });

    await closeServer();
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Socket event sent', event: SERVER_EVENTS.SERVER_SHUTDOWN, args: [{}] }),
      ]),
    );
  });

  it('keep connections but not events at info', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl);
    await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.ECHO, 'ping');

    expect(messages(lines)).toContain('Socket connected');
    expect(messages(lines)).not.toContain('Socket event received');
  });

  it('name the TCP peer and ignore X-Forwarded-For by default', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl, ALLOWED, undefined, { 'x-forwarded-for': CLIENT_ADDRESS });
    await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.ECHO, 'ping');

    expect(lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ msg: 'Socket connected', address: '127.0.0.1' })]),
    );
  });

  it('name the address the trusted proxy appended, on sockets and HTTP requests alike', async () => {
    const { baseUrl, lines } = await start('info', { trustProxyHops: 1 });
    const forwardedFor = `${SPOOFED_ADDRESS}, ${CLIENT_ADDRESS}`;
    const socket = client(baseUrl, ALLOWED, undefined, { 'x-forwarded-for': forwardedFor });
    await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.ECHO, 'ping');
    // Any route but /health, which is not logged at info; a 404 is logged like any request.
    await fetch(`${baseUrl}/missing`, { headers: { 'x-forwarded-for': forwardedFor } });

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Socket connected', address: CLIENT_ADDRESS }),
        expect.objectContaining({
          msg: 'incoming request',
          req: expect.objectContaining({ remoteAddress: CLIENT_ADDRESS }) as unknown,
        }),
      ]),
    );
    expect(JSON.stringify(lines)).not.toContain(SPOOFED_ADDRESS);
  });

  it('show the whole forwarded chain at debug, for calibrating TRUST_PROXY_HOPS', async () => {
    const { baseUrl, lines } = await start('debug', { trustProxyHops: 1 });
    const forwardedFor = `${SPOOFED_ADDRESS}, ${CLIENT_ADDRESS}`;
    const socket = client(baseUrl, ALLOWED, undefined, { 'x-forwarded-for': forwardedFor });
    await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.ECHO, 'ping');

    expect(lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ msg: 'Socket address chain', forwardedFor })]),
    );
  });

  it('report a rate-limited socket once per run of refused events', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl);
    const flood = async (): Promise<void> => {
      for (let index = 0; index < RATE_LIMIT_EVENTS_PER_SECOND + 3; index++) {
        await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.ECHO, index);
      }
    };
    await flood();
    clock.advance(1_000);
    await flood();

    const reports = lines.filter((line) => line.msg === 'Socket rate limited');
    expect(reports).toEqual([
      expect.objectContaining({ socketId: socket.id, event: CLIENT_EVENTS.ECHO }),
      expect.objectContaining({ socketId: socket.id, event: CLIENT_EVENTS.ECHO }),
    ]);
  });

  it('report a handshake refused by the origin policy', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl, FOREIGN);
    await new Promise((resolve) => socket.once('connect_error', resolve));

    expect(lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ msg: 'Socket.io handshake refused', origin: FOREIGN })]),
    );
  });
});

describe('room logs', () => {
  it('record rooms and refused commands at info, with the violation', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl);
    const created: unknown = await socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const { roomId } = created as { roomId: string };
    const ship = { type: SHIP_TYPES.CARRIER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.HORIZONTAL };
    await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: [ship] });

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Room created', roomId, seat: SEATS.P1 }),
        expect.objectContaining({
          msg: 'Command refused',
          event: CLIENT_EVENTS.UPDATE_PLACEMENT,
          error: ERROR_CODES.WRONG_PHASE,
        }),
      ]),
    );
  });

  it('record a seat that dropped and was forfeited, and the room it closed, at info', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl);
    const created: unknown = await socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const { roomId } = created as { roomId: string };
    socket.disconnect();
    await vi.waitFor(() => {
      expect(messages(lines)).toContain('Socket disconnected');
    });
    clock.advance(DISCONNECT_FORFEIT_MS);

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Seat disconnected', roomId, seat: SEATS.P1 }),
        expect.objectContaining({ msg: 'Seat forfeited', roomId, seat: SEATS.P1 }),
        expect.objectContaining({ msg: 'Room closed', roomId, reason: 'DISCONNECT_FORFEIT', roomCount: 0 }),
      ]),
    );
  });

  it('record a seat left and the room it closed at info', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl);
    const created: unknown = await socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const { roomId } = created as { roomId: string };
    await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.LEAVE_ROOM, {});

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Seat left', roomId, seat: SEATS.P1 }),
        expect.objectContaining({ msg: 'Room closed', roomId, reason: CLIENT_EVENTS.LEAVE_ROOM, roomCount: 0 }),
      ]),
    );
  });

  it('record the dice roll and the start of the match at info', async () => {
    const { lines } = await start('info');
    const { roomId, dice } = await startedMatch();

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Dice rolled', roomId, rolls: dice.rolls, starter: dice.starter }),
        expect.objectContaining({ msg: 'Room phase changed', roomId, phase: ROOM_PHASES.IN_PROGRESS }),
      ]),
    );
  });

  it('record a waiting room closed by a socket moving on, with the command that moved it, at info', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl);
    const created: unknown = await socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const { roomId } = created as { roomId: string };
    await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Seat left', roomId, seat: SEATS.P1 }),
        // The new room is already open.
        expect.objectContaining({ msg: 'Room closed', roomId, reason: CLIENT_EVENTS.CREATE_ROOM, roomCount: 1 }),
      ]),
    );
  });

  it('record a waiting room expired after WAITING_TTL_MS at info', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl);
    const created: unknown = await socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const { roomId } = created as { roomId: string };
    clock.advance(WAITING_TTL_MS);

    expect(lines).toContainEqual(
      expect.objectContaining({ msg: 'Room expired', roomId, reason: 'WAITING_FOR_OPPONENT', roomCount: 0 }),
    );
  });

  it('never contain a player secret, even at debug', async () => {
    const { baseUrl, lines } = await start('debug');
    const [p1, p2] = [client(baseUrl), client(baseUrl)];
    const created: unknown = await p1
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const { roomId, playerSecret } = created as { roomId: string; playerSecret: string };
    const joined: unknown = await p2
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    for (const socket of [p1, p2]) {
      await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 });
    }
    const ship = { type: SHIP_TYPES.CARRIER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.VERTICAL };
    const refused: unknown = await p2
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: [ship, ship] });

    expect(refused).toEqual({ ok: false, error: ERROR_CODES.INVALID_PLACEMENT });
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Room joined', roomId, seat: SEATS.P2 }),
        expect.objectContaining({
          msg: 'Command refused',
          error: ERROR_CODES.INVALID_PLACEMENT,
          violation: PLACEMENT_VIOLATIONS.DUPLICATE_TYPE,
        }),
      ]),
    );
    const log = JSON.stringify(lines);
    expect(log).not.toContain(playerSecret);
    expect(log).not.toContain((joined as { playerSecret: string }).playerSecret);
  });
});

describe('session logs', () => {
  it('record refused handshakes, resumed and replaced sessions at info, never the secret even at debug', async () => {
    const { baseUrl, lines } = await start('debug');
    const first = client(baseUrl);
    const created: unknown = await first
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const { roomId, playerSecret } = created as { roomId: string; playerSecret: string };
    // The client clears its id once the server disconnects it.
    const firstId = first.id;

    const outdated = client(baseUrl, ALLOWED, {
      protocolVersion: PROTOCOL_VERSION - 1,
      session: { roomId, playerSecret },
    });
    await new Promise((resolve) => outdated.once('connect_error', resolve));
    const second = client(baseUrl, ALLOWED, { protocolVersion: PROTOCOL_VERSION, session: { roomId, playerSecret } });
    await new Promise((resolve) => second.once(SERVER_EVENTS.STATE, resolve));
    await vi.waitFor(() => {
      expect(messages(lines)).toContain('Socket disconnected');
    });

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Handshake refused', error: ERROR_CODES.PROTOCOL_MISMATCH }),
        expect.objectContaining({ msg: 'Session resumed', roomId, seat: SEATS.P1, socketId: second.id }),
        expect.objectContaining({ msg: 'Session replaced', roomId, seat: SEATS.P1, replacedSocketId: firstId }),
        expect.objectContaining({ msg: 'Socket disconnected', reason: 'server namespace disconnect' }),
      ]),
    );
    // The replaced socket was not the seat's last one: the seat never dropped (ADR-0072).
    expect(messages(lines)).not.toContain('Seat disconnected');
    expect(JSON.stringify(lines)).not.toContain(playerSecret);
  });
});
