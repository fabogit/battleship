import { once } from 'node:events';

import cors from '@fastify/cors';
import {
  PROTOCOL_VERSION,
  type Ack,
  type ClientToServerEvents,
  type EchoResponse,
  type HealthResponse,
  type ServerToClientEvents,
} from '@battleship/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

import { createOriginMatcher } from './origins.js';

/** Upper bound for flushing `SERVER_SHUTDOWN`; Render sends SIGKILL 30 s after SIGTERM. */
const SHUTDOWN_GRACE_MS = 3_000;

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Socket.io server sharing this instance's HTTP server (ADR-0023). */
    readonly io: GameServer;
  }
}

export interface ServerOptions {
  /** Exact origins and `https://*.<domain>` wildcards, as validated by `loadConfig` (ADR-0021, ADR-0024). */
  readonly allowedOrigins: readonly string[];
  readonly isLoggingEnabled: boolean;
}

/**
 * Builds the HTTP + Socket.io server without listening; Socket.io is available as `app.io`.
 * `app.close()` performs the graceful shutdown: every socket gets `SERVER_SHUTDOWN` and is
 * disconnected before the HTTP server closes.
 */
export function createServer(options: ServerOptions): FastifyInstance {
  const isOriginAllowed = createOriginMatcher(options.allowedOrigins);
  // CORS callback result: reflect an allowed `Origin`, send no CORS headers otherwise.
  const corsOrigin = (origin: string | undefined): string | false => (isOriginAllowed(origin) ? (origin ?? false) : false);

  const app = Fastify({ logger: options.isLoggingEnabled });

  // Foreign origins get a plain 403 before any route runs (ADR-0021).
  app.addHook('onRequest', async (request, reply) => {
    if (!isOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Origin not allowed' });
    }
  });

  // Socket.io handles /socket.io/ requests before Fastify sees them, so CORS is configured on both.
  // Both apply the matcher, so the policy does not depend on the hook above running first.
  void app.register(cors, {
    origin: (origin, callback) => {
      callback(null, corsOrigin(origin));
    },
  });

  // Render's health check hits this every few seconds: keep it out of the logs unless something goes wrong.
  app.get('/health', { logLevel: 'warn' }, (): HealthResponse => ({ status: 'ok', uptime: process.uptime() }));

  const io: GameServer = new Server(app.server, {
    cors: {
      origin: (origin, callback) => {
        callback(null, corsOrigin(origin));
      },
    },
    // CORS headers alone do not stop WebSocket upgrades, so the handshake is rejected outright.
    allowRequest: (request, callback) => {
      callback(null, isOriginAllowed(request.headers.origin));
    },
  });
  app.decorate('io', io);

  io.on('connection', (socket) => {
    // Inbound arguments are untrusted: a client can emit without an ack, so it is checked before use.
    socket.on('ECHO', (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        return;
      }
      const response: EchoResponse = { ok: true, payload, protocolVersion: PROTOCOL_VERSION };
      (ack as Ack<EchoResponse>)(response);
    });
  });

  // Waits for every connection to flush and close: a polling client only receives the message on
  // its next poll, and `io.close()` below would discard anything still buffered.
  app.addHook('preClose', async () => {
    const signal = AbortSignal.timeout(SHUTDOWN_GRACE_MS);
    const closed = [...io.sockets.sockets.values()].map((socket) => once(socket.conn, 'close', { signal }));
    io.emit('SERVER_SHUTDOWN', {});
    io.disconnectSockets(true);
    await Promise.allSettled(closed);
  });
  app.addHook('onClose', async () => {
    await io.close();
  });

  return app;
}
