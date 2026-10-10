// Socket.io attached to Fastify's HTTP server, as an internal plugin (ADR-0023): no third-party `fastify-socket.io`.

import { once } from 'node:events';

import { SERVER_EVENTS, type ClientToServerEvents, type Seat, type ServerToClientEvents } from '@battleship/core';
import fp from 'fastify-plugin';
import { Server, type DefaultEventsMap, type Socket } from 'socket.io';

import { corsOrigin, type OriginMatcher } from '../origins.js';

/** Upper bound for flushing `SERVER_SHUTDOWN`; Render sends SIGKILL 30 s after SIGTERM. */
const SHUTDOWN_GRACE_MS = 3_000;

/** The seat a socket plays, set by an accepted `CREATE_ROOM` or `JOIN_ROOM` (ADR-0045). */
export interface SeatBinding {
  /** The room the socket sits in; the socket is also in the Socket.io room of the same name. */
  readonly roomId: string;
  /** Its seat there. */
  readonly seat: Seat;
}

/** What the server keeps on each socket (`socket.data`). */
export interface SocketData {
  /** Absent until the socket creates or joins a room; gone with the socket, since sessions are not bound yet (#22). */
  binding?: SeatBinding;
}

/** Socket.io server typed with the protocol's event maps (docs/protocol.md). Single instance: no inter-server events. */
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

/** One connected client, typed like `GameServer`. */
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

declare module 'fastify' {
  /** Fastify's own instance type, augmented so that every plugin sees `app.io` typed. */
  interface FastifyInstance {
    /** Socket.io server sharing this instance's HTTP server (ADR-0023), decorated by the `socket-io` plugin. */
    readonly io: GameServer;
  }
}

/** What the `socket-io` plugin needs. */
export interface SocketIoOptions {
  /** The matcher built from `ALLOWED_ORIGINS` (ADR-0021, ADR-0024); the `origin-policy` plugin gets the same one. */
  readonly isOriginAllowed: OriginMatcher;
}

/**
 * Creates the Socket.io server on the instance's HTTP server and decorates the instance with it as `app.io`. Handshakes
 * from foreign origins are refused; connections, disconnections and, at `debug`, every event are logged
 * (docs/server.md#logging). `app.close()` sends `SERVER_SHUTDOWN` to every socket and waits for it to flush before
 * closing Socket.io. Event handlers and, later, rate limiting (#24) are separate plugins that declare
 * `dependencies: ['socket-io']`.
 */
export default fp<SocketIoOptions>(
  (app, options, done) => {
    const { isOriginAllowed } = options;

    const io: GameServer = new Server(app.server, {
      cors: {
        origin: (origin, callback) => {
          callback(null, corsOrigin(isOriginAllowed, origin));
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
      // Payloads only at debug: they are noisy and carry player data.
      socket.onAny((event: string, ...args: unknown[]) => {
        log.debug({ event, args: withoutAck(args) }, 'Socket event received');
      });
      socket.onAnyOutgoing((event: string, ...args: unknown[]) => {
        log.debug({ event, args }, 'Socket event sent');
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

    done();
  },
  { name: 'socket-io', fastify: '5.x' },
);

/**
 * Drops the ack callback a client may pass as the last argument: it is not data.
 * @param args The arguments of an inbound event.
 * @returns The same arguments without functions, ready to log.
 */
function withoutAck(args: readonly unknown[]): unknown[] {
  return args.filter((arg) => typeof arg !== 'function');
}
