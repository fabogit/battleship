import { PROTOCOL_VERSION, type ClientToServerEvents, type ServerToClientEvents } from '@battleship/core';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { createServer } from '../src/server.js';

const ALLOWED = 'https://battleship.example';
const FOREIGN = 'https://evil.example';
const TRANSPORTS = ['websocket', 'polling'] as const;

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: FastifyInstance;
let baseUrl: string;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  app = createServer({ allowedOrigins: [ALLOWED], logger: false });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  await app.close();
});

function client(transport: (typeof TRANSPORTS)[number], origin?: string): ClientSocket {
  const socket: ClientSocket = connect(baseUrl, {
    transports: [transport],
    reconnection: false,
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
});

describe('HTTP CORS', () => {
  it('allows a listed origin', async () => {
    const response = await fetch(`${baseUrl}/health`, { headers: { origin: ALLOWED } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
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
  ])('echoes the payload %s', async (_label, origin) => {
    const socket = client(transport, origin);
    await nextEvent(socket, 'connect');

    const payload = { hello: 'battleship', n: 42 };
    // socket.io-client types `timeout().emitWithAck()` as Promise<any>; the assertion checks the shape.
    const response: unknown = await socket.timeout(2_000).emitWithAck('ECHO', payload);

    expect(response).toEqual({ ok: true, payload, protocolVersion: PROTOCOL_VERSION });
  });

  it('rejects the handshake from a foreign origin', async () => {
    const socket = client(transport, FOREIGN);
    await nextEvent(socket, 'connect_error');
    expect(socket.connected).toBe(false);
    expect(app.io.engine.clientsCount).toBe(0);
  });

  it('sends SERVER_SHUTDOWN before closing', async () => {
    const socket = client(transport, ALLOWED);
    await nextEvent(socket, 'connect');

    const shutdown = nextEvent(socket, 'SERVER_SHUTDOWN');
    const disconnected = nextEvent(socket, 'disconnect');
    await app.close();

    expect(await shutdown).toEqual({});
    await disconnected;
  });
});

describe('Socket.io handshake over plain HTTP', () => {
  it.each([
    [ALLOWED, 200],
    [FOREIGN, 403],
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
    (socket as Socket).emit('ECHO', 'no ack', 'not a function');
    const response: unknown = await socket.timeout(2_000).emitWithAck('ECHO', 'still alive');

    expect(response).toMatchObject({ ok: true, payload: 'still alive' });
  });
});
