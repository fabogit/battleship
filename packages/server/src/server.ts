import { once } from 'node:events';

import cors from '@fastify/cors';
import { PROTOCOL_VERSION } from '@battleship/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

// Spike-only event map (issue #3); the real contract will live in core/protocol.ts (ADR §7).
export interface ClientToServerEvents {
  /** `ack` is `unknown` because a client can emit without one; the handler checks before calling it. */
  ECHO: (payload: unknown, ack: unknown) => void;
}

export interface ServerToClientEvents {
  SERVER_SHUTDOWN: (payload: Record<string, never>) => void;
}

export interface EchoResponse {
  readonly ok: true;
  readonly payload: unknown;
  readonly protocolVersion: number;
}

/** Upper bound for flushing `SERVER_SHUTDOWN`; Render sends SIGKILL 30 s after SIGTERM. */
const SHUTDOWN_GRACE_MS = 3_000;

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

export interface ServerOptions {
  readonly allowedOrigins: readonly string[];
  readonly logger: boolean;
}

export interface CreatedServer {
  readonly app: FastifyInstance;
  readonly io: GameServer;
}

/**
 * Builds the HTTP + Socket.io server without listening. `app.close()` performs the graceful
 * shutdown: every socket gets `SERVER_SHUTDOWN` and is disconnected before the HTTP server closes.
 */
export function createServer(options: ServerOptions): CreatedServer {
  const allowedOrigins = new Set(options.allowedOrigins);
  const app = Fastify({ logger: options.logger });

  // Socket.io handles /socket.io/ requests before Fastify sees them, so CORS is configured on both.
  void app.register(cors, {
    origin: (origin, callback) => {
      if (origin === undefined) {
        // Not a browser cross-origin request (health checks, CLI clients): no CORS headers needed.
        callback(null, false);
      } else if (allowedOrigins.has(origin)) {
        callback(null, origin);
      } else {
        callback(Object.assign(new Error('Origin not allowed'), { statusCode: 403 }), false);
      }
    },
  });

  app.get('/health', () => ({ status: 'ok', uptime: process.uptime() }));

  const io: GameServer = new Server(app.server, {
    cors: { origin: [...allowedOrigins] },
    // CORS headers alone do not stop WebSocket upgrades, so the handshake is rejected outright.
    allowRequest: (request, callback) => {
      const { origin } = request.headers;
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
  });

  io.on('connection', (socket) => {
    socket.on('ECHO', (payload, ack) => {
      if (typeof ack !== 'function') {
        return;
      }
      const response: EchoResponse = { ok: true, payload, protocolVersion: PROTOCOL_VERSION };
      (ack as (response: EchoResponse) => void)(response);
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

  return { app, io };
}
