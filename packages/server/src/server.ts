import { once } from 'node:events';

import cors from '@fastify/cors';
import {
  CLIENT_EVENTS,
  PROTOCOL_VERSION,
  SERVER_EVENTS,
  type Ack,
  type ClientToServerEvents,
  type EchoResponse,
  type HealthResponse,
  type ServerToClientEvents,
} from '@battleship/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { Server } from 'socket.io';

import { createOriginMatcher } from './origins.js';

/** Upper bound for flushing `SERVER_SHUTDOWN`; Render sends SIGKILL 30 s after SIGTERM. */
const SHUTDOWN_GRACE_MS = 3_000;

/** Pino levels at which every request and socket event is logged. */
const VERBOSE_LEVELS: readonly string[] = ['debug', 'trace'];

/** Socket.io server typed with the protocol's event maps (docs/protocol.md). */
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Socket.io server sharing this instance's HTTP server (ADR-0023). */
    readonly io: GameServer;
  }
}

/** What `createServer` needs; the entry point builds it from `ServerConfig`. */
export interface ServerOptions {
  /** Exact origins and `https://*.<domain>` wildcards, as validated by `loadConfig` (ADR-0021, ADR-0024). */
  readonly allowedOrigins: readonly string[];
  /** Options for Fastify's built-in Pino logger; `false` disables logging. */
  readonly logger: NonNullable<FastifyServerOptions['logger']>;
}

/**
 * Builds the HTTP + Socket.io server without listening; Socket.io is available as `app.io`.
 * `app.close()` performs the graceful shutdown: every socket gets `SERVER_SHUTDOWN` and is
 * disconnected before the HTTP server closes.
 * @param options Allowed origins and logger settings.
 * @returns The Fastify instance, ready for `listen()`.
 */
export function createServer(options: ServerOptions): FastifyInstance {
  const isOriginAllowed = createOriginMatcher(options.allowedOrigins);
  /**
   * CORS callback result: reflect an allowed `Origin`, send no CORS headers otherwise.
   * @param origin The request's `Origin` header, absent for same-origin and non-browser requests.
   * @returns The origin to echo in `Access-Control-Allow-Origin`, or `false` for no CORS headers.
   */
  const corsOrigin = (origin: string | undefined): string | false =>
    isOriginAllowed(origin) ? (origin ?? false) : false;

  const app = Fastify({ logger: options.logger });

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

  // `debug` and `trace` (local runs) log everything; above them, logs stay to what production needs.
  const isVerbose = VERBOSE_LEVELS.includes(app.log.level);

  // Render's health check hits this every few seconds: unless verbose, keep it out of the logs unless something goes wrong.
  app.get('/health', isVerbose ? {} : { logLevel: 'warn' }, (): HealthResponse => ({
    status: 'ok',
    uptime: process.uptime(),
  }));

  const io: GameServer = new Server(app.server, {
    cors: {
      origin: (origin, callback) => {
        callback(null, corsOrigin(origin));
      },
    },
    // CORS headers alone do not stop WebSocket upgrades, so the handshake is rejected outright.
    allowRequest: (request, callback) => {
      const isAllowed = isOriginAllowed(request.headers.origin);
      if (!isAllowed) {
        app.log.info({ origin: request.headers.origin }, 'Socket.io handshake refused');
      }
      callback(null, isAllowed);
    },
  });
  app.decorate('io', io);

  io.on('connection', (socket) => {
    const log = app.log.child({ socketId: socket.id });
    const { headers, address } = socket.handshake;
    log.info({ transport: socket.conn.transport.name, origin: headers.origin, address }, 'Socket connected');
    socket.conn.once('upgrade', () => {
      log.debug({ transport: socket.conn.transport.name }, 'Socket transport upgraded');
    });
    socket.on('disconnect', (reason) => {
      log.info({ reason }, 'Socket disconnected');
    });
    // Payloads only at debug: they are noisy and will carry player data.
    socket.onAny((event: string, ...args: unknown[]) => {
      log.debug({ event, args: withoutAck(args) }, 'Socket event received');
    });
    socket.onAnyOutgoing((event: string, ...args: unknown[]) => {
      log.debug({ event, args }, 'Socket event sent');
    });

    // Inbound arguments are untrusted: a client can emit without an ack, so it is checked before use.
    socket.on(CLIENT_EVENTS.ECHO, (payload: unknown, ack: unknown) => {
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
    io.emit(SERVER_EVENTS.SERVER_SHUTDOWN, {});
    io.disconnectSockets(true);
    await Promise.allSettled(closed);
  });
  app.addHook('onClose', async () => {
    await io.close();
  });

  return app;
}

/**
 * Drops the ack callback a client may pass as the last argument: it is not data.
 * @param args The arguments of an inbound event.
 * @returns The same arguments without functions, ready to log.
 */
function withoutAck(args: readonly unknown[]): unknown[] {
  return args.filter((arg) => typeof arg !== 'function');
}
