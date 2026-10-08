import { type HealthResponse } from '@battleship/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { createOriginMatcher } from './origins.js';
import echo from './plugins/echo.js';
import originPolicy from './plugins/origin-policy.js';
import roomHandlers from './plugins/room-handlers.js';
import socketIo from './plugins/socket-io.js';
import { RoomManager } from './room/room-manager.js';

/** Pino levels at which every request and socket event is logged. */
const VERBOSE_LEVELS: readonly string[] = ['debug', 'trace'];

/** What `createServer` needs; the entry point builds it from `ServerConfig`. */
export interface ServerOptions {
  /** Exact origins and `https://*.<domain>` wildcards, as validated by `loadConfig` (ADR-0021, ADR-0024). */
  readonly allowedOrigins: readonly string[];
  /** Options for Fastify's built-in Pino logger; `false` disables logging. */
  readonly logger: NonNullable<FastifyServerOptions['logger']>;
  /** The room registry; a new `RoomManager` with crypto randomness by default. Tests pass a seeded one (ADR-0030). */
  readonly rooms?: RoomManager;
  /** Current time in epoch ms; `Date.now` by default. Tests pass a fixed clock. */
  readonly now?: () => number;
}

/**
 * Builds the HTTP + Socket.io server without listening by composing the internal plugins (docs/server.md#plugins) and
 * the `/health` route. Socket.io is available as `app.io` once the instance is ready (`listen()` or `ready()`).
 * `app.close()` performs the graceful shutdown: every socket gets `SERVER_SHUTDOWN` and is disconnected before the HTTP
 * server closes.
 * @param options Allowed origins, logger settings and, in tests, the room registry and the clock.
 * @returns The Fastify instance, ready for `listen()`.
 */
export function createServer(options: ServerOptions): FastifyInstance {
  const isOriginAllowed = createOriginMatcher(options.allowedOrigins);
  const app = Fastify({ logger: options.logger });

  // Registered before the route, so the 403 hook and CORS apply to it.
  void app.register(originPolicy, { isOriginAllowed });

  // `debug` and `trace` (local runs) log everything; above them, logs stay to what production needs.
  const isVerbose = VERBOSE_LEVELS.includes(app.log.level);

  // Render's health check hits this every few seconds: unless verbose, keep it out of the logs unless something goes wrong.
  app.get('/health', isVerbose ? {} : { logLevel: 'warn' }, (): HealthResponse => ({
    status: 'ok',
    uptime: process.uptime(),
  }));

  void app.register(socketIo, { isOriginAllowed });
  void app.register(echo);
  void app.register(roomHandlers, { rooms: options.rooms ?? new RoomManager(), now: options.now ?? Date.now });

  return app;
}
