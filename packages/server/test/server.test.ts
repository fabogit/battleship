import {
  CLIENT_EVENTS,
  ERROR_CODES,
  PROTOCOL_VERSION,
  SERVER_EVENTS,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@battleship/core';
import { io as connect, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { createServer } from '../src/server.js';

const ALLOWED = 'https://battleship.example';
const PREVIEW = 'https://3f9a1c2e.battleship.pages.dev';
const FOREIGN = 'https://evil.example';
const TRANSPORTS = ['websocket', 'polling'] as const;

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: FastifyInstance;
let baseUrl: string;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  app = createServer({ allowedOrigins: [ALLOWED, 'https://*.battleship.pages.dev'], logger: false });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  await app.close();
});

/** The handshake of a client without a room, as the browser sends it. */
const CURRENT_AUTH = { protocolVersion: PROTOCOL_VERSION };

/**
 * A client over one transport, connecting at once.
 * @param handshake Overrides the handshake `auth` and `query`; the current protocol version by default.
 */
function client(
  transport: (typeof TRANSPORTS)[number],
  origin?: string,
  handshake: Pick<Partial<ManagerOptions & SocketOptions>, 'auth' | 'query'> = { auth: CURRENT_AUTH },
): ClientSocket {
  const socket: ClientSocket = connect(baseUrl, {
    transports: [transport],
    reconnection: false,
    ...handshake,
    ...(origin === undefined ? {} : { extraHeaders: { origin } }),
  });
  clients.push(socket);
  return socket;
}

type ClientEvent = 'connect' | 'connect_error' | 'disconnect' | keyof ServerToClientEvents;

function nextEvent(socket: ClientSocket, event: ClientEvent): Promise<unknown> {
  // The typed socket narrows listeners per event; the payload is asserted by each test instead.
  return new Promise((resolve) => (socket as Socket).once(event, resolve));
}

describe('GET /health', () => {
  it('returns status and uptime', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', uptime: expect.any(Number) as unknown });
  });

  it('reports the uptime in seconds', async () => {
    const { uptime } = (await (await fetch(`${baseUrl}/health`)).json()) as { uptime: number };
    expect(uptime).toBeGreaterThan(0);
    expect(uptime).toBeLessThanOrEqual(process.uptime());
  });
});

describe('HTTP CORS', () => {
  it('allows a listed origin', async () => {
    const response = await fetch(`${baseUrl}/health`, { headers: { origin: ALLOWED } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
  });

  it('allows a preview origin matching the wildcard', async () => {
    const response = await fetch(`${baseUrl}/health`, { headers: { origin: PREVIEW } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(PREVIEW);
  });

  it('answers a preflight from a listed origin', async () => {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
  });

  it.each(['GET', 'OPTIONS'])('rejects %s from a foreign origin', async (method) => {
    const response = await fetch(`${baseUrl}/health`, {
      method,
      headers: { origin: FOREIGN, 'access-control-request-method': 'GET' },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Origin not allowed' });
  });
});

describe.each(TRANSPORTS)('Socket.io over %s', (transport) => {
  it.each([
    ['without an Origin header', undefined],
    ['from a listed origin', ALLOWED],
    ['from a preview origin', PREVIEW],
  ])('echoes the payload %s', async (_label, origin) => {
    const socket = client(transport, origin);
    await nextEvent(socket, 'connect');

    const payload = { hello: 'battleship', n: 42 };
    // socket.io-client types `timeout().emitWithAck()` as Promise<any>; the assertion checks the shape.
    const response: unknown = await socket.timeout(2_000).emitWithAck(CLIENT_EVENTS.ECHO, payload);

    expect(response).toEqual({ ok: true, payload, protocolVersion: PROTOCOL_VERSION });
  });

  it('rejects the handshake from a foreign origin', async () => {
    const socket = client(transport, FOREIGN);
    await nextEvent(socket, 'connect_error');
    expect(socket.connected).toBe(false);
    expect(app.io.engine.clientsCount).toBe(0);
  });

  it.each([
    ['without auth', {}],
    ['with an empty auth', { auth: {} }],
    ['with the previous version', { auth: { protocolVersion: PROTOCOL_VERSION - 1 } }],
    ['with the version as a string', { auth: { protocolVersion: String(PROTOCOL_VERSION) } }],
    ['with a wrong version in the query', { query: { protocolVersion: String(PROTOCOL_VERSION - 1) } }],
    // auth wins over the query when it has a version (ADR-0062).
    [
      'with a wrong auth version and the right query',
      { auth: { protocolVersion: PROTOCOL_VERSION + 1 }, query: { protocolVersion: String(PROTOCOL_VERSION) } },
    ],
  ])('refuses a handshake %s with PROTOCOL_MISMATCH', async (_label, handshake) => {
    const socket = client(transport, ALLOWED, handshake);
    const error = (await nextEvent(socket, 'connect_error')) as Error;
    expect(error.message).toBe(ERROR_CODES.PROTOCOL_MISMATCH);
    // A middleware refusal is final: Socket.io does not retry it.
    expect(socket.active).toBe(false);
    expect(app.io.of('/').sockets.size).toBe(0);
  });

  it('accepts the protocol version as a query parameter, for tools without auth (ADR-0062)', async () => {
    const socket = client(transport, ALLOWED, { query: { protocolVersion: String(PROTOCOL_VERSION) } });
    await nextEvent(socket, 'connect');
    expect(await socket.timeout(2_000).emitWithAck(CLIENT_EVENTS.ECHO, 'hi')).toMatchObject({ ok: true });
  });

  it('sends SERVER_SHUTDOWN before closing', async () => {
    const socket = client(transport, ALLOWED);
    await nextEvent(socket, 'connect');

    const shutdown = nextEvent(socket, SERVER_EVENTS.SERVER_SHUTDOWN);
    const disconnected = nextEvent(socket, 'disconnect');
    await app.close();

    expect(await shutdown).toEqual({});
    // Socket.io leaves `active` false only for this reason, which the client's forced wake needs (ADR-0075).
    expect(await disconnected).toBe('io server disconnect');
  });
});

describe('Socket.io handshake over plain HTTP', () => {
  it.each([
    [ALLOWED, 200],
    [PREVIEW, 200],
    [FOREIGN, 403],
    ['https://a.b.battleship.pages.dev', 403],
  ])('responds to origin %s with %i', async (origin, status) => {
    const response = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, { headers: { origin } });
    expect(response.status).toBe(status);
  });
});

describe('ECHO without an ack', () => {
  it('is ignored instead of crashing the handler', async () => {
    const socket = client('websocket');
    await nextEvent(socket, 'connect');

    // Bypasses the typed event map to send what a misbehaving client could.
    (socket as Socket).emit(CLIENT_EVENTS.ECHO, 'no ack', 'not a function');
    const response: unknown = await socket.timeout(2_000).emitWithAck(CLIENT_EVENTS.ECHO, 'still alive');

    expect(response).toMatchObject({ ok: true, payload: 'still alive' });
  });
});
