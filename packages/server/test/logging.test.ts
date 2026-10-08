import {
  CLIENT_EVENTS,
  ERROR_CODES,
  ORIENTATIONS,
  PLACEMENT_VIOLATIONS,
  SEATS,
  SERVER_EVENTS,
  SHIP_TYPES,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@battleship/core';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FastifyInstance } from 'fastify';

import type { LogLevel } from '../src/config.js';
import { createServer } from '../src/server.js';

const ALLOWED = 'https://battleship.example';
const FOREIGN = 'https://evil.example';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface LogLine {
  readonly level: number;
  readonly msg: string;
  readonly [key: string]: unknown;
}

let app: FastifyInstance | undefined;
const clients: ClientSocket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  await app?.close();
  app = undefined;
});

/** Starts a server whose Pino output is collected in memory. */
async function start(level: LogLevel): Promise<{ baseUrl: string; lines: LogLine[] }> {
  const lines: LogLine[] = [];
  app = createServer({
    allowedOrigins: [ALLOWED],
    logger: {
      level,
      stream: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as LogLine);
        },
      },
    },
  });
  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  return { baseUrl, lines };
}

function client(baseUrl: string, origin = ALLOWED): ClientSocket {
  const socket: ClientSocket = connect(baseUrl, {
    transports: ['polling', 'websocket'],
    reconnection: false,
    extraHeaders: { origin },
  });
  clients.push(socket);
  return socket;
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
    await socket.timeout(2_000).emitWithAck(CLIENT_EVENTS.ECHO, { hello: 'battleship' });
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

    await app?.close();
    app = undefined;
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'Socket event sent', event: SERVER_EVENTS.SERVER_SHUTDOWN, args: [{}] }),
      ]),
    );
  });

  it('keep connections but not events at info', async () => {
    const { baseUrl, lines } = await start('info');
    const socket = client(baseUrl);
    await socket.timeout(2_000).emitWithAck(CLIENT_EVENTS.ECHO, 'ping');

    expect(messages(lines)).toContain('Socket connected');
    expect(messages(lines)).not.toContain('Socket event received');
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
    const created: unknown = await socket.timeout(2_000).emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const { roomId } = created as { roomId: string };
    const ship = { type: SHIP_TYPES.CARRIER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.HORIZONTAL };
    await socket.timeout(2_000).emitWithAck(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: [ship] });

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

  it('never contain a player secret, even at debug', async () => {
    const { baseUrl, lines } = await start('debug');
    const [p1, p2] = [client(baseUrl), client(baseUrl)];
    const created: unknown = await p1.timeout(2_000).emitWithAck(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const { roomId, playerSecret } = created as { roomId: string; playerSecret: string };
    const joined: unknown = await p2.timeout(2_000).emitWithAck(CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    const ship = { type: SHIP_TYPES.CARRIER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.VERTICAL };
    const refused: unknown = await p2
      .timeout(2_000)
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
