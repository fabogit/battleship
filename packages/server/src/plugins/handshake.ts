// Socket.io handshake checks and session binding (docs/server.md#sessions--reconnection): the protocol version, then the
// stored session, in a namespace middleware (ADR-0061); a valid session gets its seat back, latest connection wins.

import {
  ERROR_CODES,
  parseSessionCredentials,
  PROTOCOL_VERSION,
  SERVER_EVENTS,
  type ErrorCode,
  type SessionCredentials,
} from '@battleship/core';
import fp from 'fastify-plugin';

import type { FastifyBaseLogger } from 'fastify';

import type { RoomManager } from '../room/room-manager.js';
import { projectSnapshot } from '../room/snapshot.js';
import type { GameServer, GameSocket, SeatBinding } from './socket-io.js';

/**
 * Query parameter that carries the protocol version for tools that cannot send the handshake `auth`, such as Postman
 * (ADR-0062). Read only when `auth` has no `protocolVersion`; a session is never read from the query.
 */
export const PROTOCOL_VERSION_QUERY_PARAM = 'protocolVersion';

/** What the `handshake` plugin needs; `createServer` passes the same registry and clock as to `room-handlers`. */
export interface HandshakeOptions {
  /** The open rooms, where a session's seat is looked up. */
  readonly rooms: RoomManager;
  /** Current time in epoch ms, for the `STATE` sent to a rebound socket. */
  readonly now: () => number;
}

/** The handshake as the middleware reads it: Socket.io's own, typed loosely since every field is client input. */
type Handshake = Pick<GameSocket['handshake'], 'auth' | 'query'>;

/** What the handshake check decided: refused with an error code, or accepted with the seat a session reopens. */
export type HandshakeVerdict =
  | {
      /** Discriminant: the connection is refused. */
      readonly ok: false;
      /** `PROTOCOL_MISMATCH` or `SESSION_INVALID`; it becomes the `connect_error` message (ADR-0061). */
      readonly error: ErrorCode;
    }
  | {
      /** Discriminant: the connection goes ahead. */
      readonly ok: true;
      /** The seat a valid session reopens; absent when the handshake carries no session. */
      readonly binding?: SeatBinding;
    };

/**
 * Checks the handshake of every socket before it connects (ADR-0061): a wrong or missing protocol version is refused
 * with `PROTOCOL_MISMATCH`, then a malformed, unknown or expired session with `SESSION_INVALID`; the refusal reaches
 * the client as a `connect_error` whose message is the code, and Socket.io does not retry it. A socket with a valid
 * session is bound to its seat, any socket that held the seat gets `SESSION_REPLACED` and is disconnected, and the
 * rebound socket gets a `STATE` at once (ADR-0063). Registered before the commands, so they read the binding.
 */
export default fp<HandshakeOptions>(
  (app, options, done) => {
    const { rooms, now } = options;

    app.io.use((socket, next) => {
      const verdict = checkHandshake(socket.handshake, rooms);
      if (!verdict.ok) {
        app.log.info({ socketId: socket.id, error: verdict.error }, 'Handshake refused');
        next(new Error(verdict.error));
        return;
      }
      if (verdict.binding !== undefined) {
        socket.data.binding = verdict.binding;
      }
      next();
    });

    app.io.on('connection', (socket) => {
      const binding = socket.data.binding;
      // Middleware and `connection` run in the same tick, with no I/O in between, so the room is still there.
      const state = binding === undefined ? undefined : rooms.get(binding.roomId);
      if (binding === undefined || state === undefined) {
        return;
      }
      const log = app.log.child({ socketId: socket.id });
      replacePreviousSockets(app.io, socket, binding, log);
      void socket.join(binding.roomId);
      log.info({ roomId: binding.roomId, seat: binding.seat }, 'Session resumed');
      socket.emit(SERVER_EVENTS.STATE, projectSnapshot(state, binding.seat, now()));
    });

    done();
  },
  { name: 'handshake', fastify: '5.x', dependencies: ['socket-io'] },
);

/**
 * Decides whether a handshake may connect, and to which seat (docs/protocol.md#handshake). The version is checked
 * before the session, so an outdated client is told to reload even when its stored session is gone too.
 * @param handshake The socket's handshake: `auth` from the client's `auth` option, `query` from the URL.
 * @param rooms The open rooms, where a session's secret is looked up.
 * @returns The refusal, or the seat a valid session reopens.
 */
export function checkHandshake(handshake: Handshake, rooms: RoomManager): HandshakeVerdict {
  const auth: Readonly<Record<string, unknown>> = handshake.auth;
  if (!hasProtocolVersion(handshake)) {
    return { ok: false, error: ERROR_CODES.PROTOCOL_MISMATCH };
  }
  if (!Object.hasOwn(auth, 'session')) {
    return { ok: true };
  }
  const credentials: SessionCredentials | null = parseSessionCredentials(auth['session']);
  const found = credentials === null ? undefined : rooms.findSeat(credentials);
  if (found === undefined) {
    return { ok: false, error: ERROR_CODES.SESSION_INVALID };
  }
  return { ok: true, binding: { roomId: found.state.roomId, seat: found.seat } };
}

/**
 * Whether the handshake speaks this server's protocol: `auth.protocolVersion` strictly equal to `PROTOCOL_VERSION`
 * when `auth` has one, otherwise a single `protocolVersion` query parameter equal to its decimal form (ADR-0062).
 * @param handshake The socket's handshake.
 * @returns `false` for a missing, different or ill-typed version.
 */
function hasProtocolVersion(handshake: Handshake): boolean {
  const auth: Readonly<Record<string, unknown>> = handshake.auth;
  if (Object.hasOwn(auth, 'protocolVersion')) {
    return auth['protocolVersion'] === PROTOCOL_VERSION;
  }
  return handshake.query[PROTOCOL_VERSION_QUERY_PARAM] === String(PROTOCOL_VERSION);
}

/**
 * Latest connection wins (ADR-0014): every other socket bound to the same seat gets `SESSION_REPLACED`, then a
 * namespace disconnect, which reaches the client after the event on any transport and stops its reconnection
 * (ADR-0063).
 * @param io The server, to find the room's sockets.
 * @param socket The socket taking the seat.
 * @param binding The seat it takes.
 * @param log The new socket's logger.
 */
function replacePreviousSockets(
  io: GameServer,
  socket: GameSocket,
  binding: SeatBinding,
  log: FastifyBaseLogger,
): void {
  // Copied first: each disconnect removes its socket from the set being walked.
  for (const socketId of [...(io.sockets.adapter.rooms.get(binding.roomId) ?? [])]) {
    const peer = io.sockets.sockets.get(socketId);
    const peerBinding = peer?.data.binding;
    if (
      peer === undefined ||
      peer.id === socket.id ||
      peerBinding?.roomId !== binding.roomId ||
      peerBinding.seat !== binding.seat
    ) {
      continue;
    }
    log.info({ roomId: binding.roomId, seat: binding.seat, replacedSocketId: peer.id }, 'Session replaced');
    peer.emit(SERVER_EVENTS.SESSION_REPLACED, {});
    peer.disconnect();
  }
}
