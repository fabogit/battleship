import { DestroyRef, Service, inject, signal } from '@angular/core';
import {
  ERROR_CODES,
  PROTOCOL_VERSION,
  SERVER_EVENTS,
  type ClientToServerEvents,
  type CommandEvent,
  type CommandPayload,
  type HandshakeAuth,
  type ServerToClientEvents,
  type SessionCredentials,
} from '@battleship/core';
import { io } from 'socket.io-client';

import { SERVER_URL } from './server-url';
import { SessionStore } from './session-store';

/** The states of the Socket.io connection, as `GameSocketService.status` reports them (ADR-0043). */
export const CONNECTION_STATUSES = {
  /** Not opened yet, closed by the client or the server, or refused by a server middleware. */
  DISCONNECTED: 'disconnected',
  /** Opening, or retrying after a drop. */
  CONNECTING: 'connecting',
  /** The handshake succeeded. */
  CONNECTED: 'connected',
} as const;

/** One of the `CONNECTION_STATUSES`. */
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[keyof typeof CONNECTION_STATUSES];

/**
 * Why the server ended or refused the last connection, as `GameSocketService.closeReason` reports it (ADR-0075). A drop
 * that Socket.io retries on its own has no reason: it is `isReconnecting`.
 */
export const CLOSE_REASONS = {
  /** The handshake was refused with `PROTOCOL_MISMATCH`: this page speaks another protocol than the server (ADR-0061). */
  PROTOCOL_MISMATCH: 'protocol-mismatch',
  /** `SESSION_REPLACED`: a newer connection took this tab's seat, and the server disconnected this one (ADR-0063). */
  SESSION_REPLACED: 'session-replaced',
  /** `SERVER_SHUTDOWN`: the server is restarting, and the rooms it held are lost (docs/deployment.md#backend-render). */
  SERVER_SHUTDOWN: 'server-shutdown',
  /** The handshake was refused with another code, e.g. `SESSION_INVALID` for a handshake that sent no session. */
  REFUSED: 'refused',
  /** The server disconnected the socket without saying why first. */
  SERVER_DISCONNECT: 'server-disconnect',
} as const;

/** One of the `CLOSE_REASONS`. */
export type CloseReason = (typeof CLOSE_REASONS)[keyof typeof CLOSE_REASONS];

/** Socket.io's `disconnect` reason when the server ended the connection; Socket.io does not retry it. */
const SERVER_DISCONNECT_REASON = 'io server disconnect';

/**
 * How long a command waits for its ack, in ms, before resolving as `NO_ACK` (ADR-0035). The server acks right after a
 * synchronous transition, so only a dead connection takes this long.
 */
export const ACK_TIMEOUT_MS = 5_000;

/** Why a command can get no reply from the server (ADR-0035); kept apart from core's `ERROR_CODES`. */
export const TRANSPORT_ERRORS = {
  /** Not sent, because the socket was not connected. */
  NOT_CONNECTED: 'NOT_CONNECTED',
  /**
   * Sent, but the ack did not arrive within `ACK_TIMEOUT_MS`, or the connection dropped first. The server may or may
   * not have applied the command; the next `STATE` tells.
   */
  NO_ACK: 'NO_ACK',
} as const;

/** One of the `TRANSPORT_ERRORS`. */
export type TransportError = (typeof TRANSPORT_ERRORS)[keyof typeof TRANSPORT_ERRORS];

/** Resolved by `emitWithAck` when the server did not reply; shaped like `AckFailure`, so callers branch on `ok` once. */
export interface TransportFailure {
  /** Discriminant shared with the server's replies. */
  readonly ok: false;
  /** What prevented the reply. */
  readonly error: TransportError;
}

/**
 * The server's reply to one client→server event, read from its ack callback in `ClientToServerEvents`.
 * @template E The event name.
 */
type AckOf<E extends keyof ClientToServerEvents> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];

/**
 * What `emitWithAck` resolves with: the command's `AckResponse`, or a `TransportFailure`.
 * @template E The command's event name.
 */
export type CommandResult<E extends CommandEvent> = AckOf<E> | TransportFailure;

/**
 * Owns the Socket.io connection to the game server: its status as a signal, typed commands with their acks and typed
 * server events (docs/client.md#reactive-model). The socket is created idle and opened by `connect()`.
 */
@Service()
export class GameSocketService {
  /** Written by `connect()` and the socket's lifecycle listeners only; read through `status`. */
  private readonly statusSignal = signal<ConnectionStatus>(CONNECTION_STATUSES.DISCONNECTED);
  /** `connecting` from `connect()` until the handshake succeeds, and while Socket.io retries after a drop. */
  readonly status = this.statusSignal.asReadonly();

  /** Written by the socket's lifecycle listeners and `connect()` only; read through `closeReason`. */
  private readonly closeReasonSignal = signal<CloseReason | null>(null);
  /**
   * Why the server ended or refused the last connection (ADR-0075); `null` until it does, and again from the next
   * `connect()` or successful handshake. Set as soon as the server says why (`SESSION_REPLACED`, `SERVER_SHUTDOWN`),
   * so it may lead `status` by the moment the disconnect takes.
   */
  readonly closeReason = this.closeReasonSignal.asReadonly();

  /** Written by the socket's lifecycle listeners and `connect()` only; read through `retryError`. */
  private readonly retryErrorSignal = signal<string | null>(null);
  /**
   * The message of the last failed attempt while Socket.io keeps retrying, such as `xhr poll error` for a handshake
   * refused by the origin check (#51, F9); `null` before the first failure and once connected.
   */
  readonly retryError = this.retryErrorSignal.asReadonly();

  /** Written by the socket's lifecycle listeners only; read through `isReconnecting`. */
  private readonly isReconnectingSignal = signal(false);
  /**
   * Whether Socket.io is retrying after an open connection dropped, as opposed to opening a first one: from the drop
   * until the next successful handshake, or until the socket gives up.
   */
  readonly isReconnecting = this.isReconnectingSignal.asReadonly();

  /** Where the handshake reads the current room's credentials, and drops them when the server refuses them. */
  private readonly sessions = inject(SessionStore);
  /** The credentials the latest handshake sent; `null` when it sent none. */
  private sentSession: SessionCredentials | null = null;

  /**
   * Created idle (`autoConnect: false`), so services can listen to server events before the server is awake.
   * WebSocket first: the server URL is https in production, so this is `wss://` (docs/deployment.md#frontend-cloudflare-pages).
   * Polling is the fallback for networks that block WebSocket: without `tryAllTransports` the client never moves past
   * the first transport and keeps retrying WebSocket (#51, F3).
   *
   * The handshake `auth` is a callback, which Socket.io calls again on every reconnect attempt
   * (docs/protocol.md#handshake): the server refuses a missing or different `protocolVersion` with `PROTOCOL_MISMATCH`
   * (ADR-0061). It adds the current room's stored `session`, which binds the socket to its seat (ADR-0063), and omits
   * the field when the tab is in no room: `null` would be refused with `SESSION_INVALID`.
   *
   * Left with Socket.io's untyped event maps on purpose: its typed `emit` and `on` resolve payloads through conditional
   * types that a generic event name cannot narrow, so `emitWithAck` and `on` carry the contract's types instead
   * (ADR-0035). They are the only way to reach the socket's events.
   */
  private readonly socket = io(inject(SERVER_URL), {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    auth: (send) => {
      const session = this.sessions.current();
      this.sentSession = session;
      const auth: HandshakeAuth =
        session === null ? { protocolVersion: PROTOCOL_VERSION } : { protocolVersion: PROTOCOL_VERSION, session };
      send(auth);
    },
  });

  /**
   * Mirrors the socket's lifecycle events into `status`, `closeReason`, `retryError` and `isReconnecting`, drops
   * credentials the server refuses, and closes the socket with the injector.
   */
  constructor() {
    const socket = this.socket;
    socket.on('connect', () => {
      this.closeReasonSignal.set(null);
      this.retryErrorSignal.set(null);
      this.isReconnectingSignal.set(false);
      this.statusSignal.set(CONNECTION_STATUSES.CONNECTED);
    });
    // `active` drops to false only when the client closes the socket, the server disconnects it, or a server
    // middleware rejects the connection (`next(err)`). A handshake refused by `allowRequest` (foreign origin, HTTP 403)
    // keeps it true, so the socket stays `CONNECTING` and retries (#51, F9).
    socket.on('disconnect', (reason: string) => {
      this.isReconnectingSignal.set(socket.active);
      if (reason === SERVER_DISCONNECT_REASON && this.closeReasonSignal() === null) {
        this.closeReasonSignal.set(CLOSE_REASONS.SERVER_DISCONNECT);
      }
      this.statusSignal.set(socket.active ? CONNECTION_STATUSES.CONNECTING : CONNECTION_STATUSES.DISCONNECTED);
    });
    // A refused handshake carries the error code as its message (ADR-0061). `SESSION_INVALID` drops the credentials
    // sent and connects again without them (ADR-0070); any other refusal ends the connection with its reason. While
    // Socket.io keeps retrying, the message is the last attempt's error (ADR-0075).
    socket.on('connect_error', (error: Error) => {
      const session = this.sentSession;
      if (socket.active) {
        this.retryErrorSignal.set(error.message);
      } else if (error.message === ERROR_CODES.SESSION_INVALID && session !== null) {
        this.sessions.refuse(session.roomId);
        socket.connect();
      } else {
        this.isReconnectingSignal.set(false);
        this.closeReasonSignal.set(
          error.message === ERROR_CODES.PROTOCOL_MISMATCH ? CLOSE_REASONS.PROTOCOL_MISMATCH : CLOSE_REASONS.REFUSED,
        );
      }
      this.statusSignal.set(socket.active ? CONNECTION_STATUSES.CONNECTING : CONNECTION_STATUSES.DISCONNECTED);
    });
    // Both arrive just before the server's disconnect, which stops Socket.io's own reconnection (ADR-0063,
    // docs/deployment.md#backend-render): the reason tells the views what happened, and `ServerStatus` reconnects
    // after a shutdown.
    socket.on(SERVER_EVENTS.SESSION_REPLACED, () => {
      this.closeReasonSignal.set(CLOSE_REASONS.SESSION_REPLACED);
    });
    socket.on(SERVER_EVENTS.SERVER_SHUTDOWN, () => {
      this.closeReasonSignal.set(CLOSE_REASONS.SERVER_SHUTDOWN);
    });
    inject(DestroyRef).onDestroy(() => socket.close());
  }

  /**
   * Opens the connection; call it only once `ServerWakeService` reports the server awake
   * (docs/client.md#cold-start-handling). Does nothing while the socket is connected or retrying; after Socket.io has
   * given up, it opens the connection again and forgets why it gave up (`closeReason`).
   */
  connect(): void {
    if (this.socket.active) {
      return;
    }
    this.closeReasonSignal.set(null);
    this.retryErrorSignal.set(null);
    this.statusSignal.set(CONNECTION_STATUSES.CONNECTING);
    this.socket.connect();
  }

  /**
   * Opens the connection again while it is open or opening, so the handshake sends the current room's credentials
   * anew (ADR-0070): after the tab enters a stored room, or after a `CREATE_ROOM` or `JOIN_ROOM` without an ack, which
   * may have moved the socket to a room the client does not know. Does nothing while the socket is closed: the next
   * `connect()` sends them.
   */
  reconnect(): void {
    if (!this.socket.active) {
      return;
    }
    this.socket.disconnect();
    this.connect();
  }

  /**
   * Sends a command and waits for its ack (docs/protocol.md#client--server, ADR-0035). Never rejects: a refused command
   * resolves with the server's `AckFailure`, a command that got no reply with a `TransportFailure`. Nothing is sent
   * while the socket is not connected, so a command is never queued for a later reconnection.
   * @param event The command.
   * @param payload Its payload, as the command's guard in core expects it.
   * @returns The server's reply, or why there was none.
   */
  emitWithAck<E extends CommandEvent>(event: E, payload: CommandPayload<E>): Promise<CommandResult<E>> {
    if (!this.socket.connected) {
      return Promise.resolve({ ok: false, error: TRANSPORT_ERRORS.NOT_CONNECTED });
    }
    return new Promise((resolve) => {
      // Socket.io calls the ack with an error both on timeout and when the connection drops first; either way the
      // reply is lost, so both are `NO_ACK`. The error is `null` when the ack arrives in time.
      this.socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (error: Error | null, response: AckOf<E>) => {
        resolve(error === null ? response : { ok: false, error: TRANSPORT_ERRORS.NO_ACK });
      });
    });
  }

  /**
   * Listens to a server event until the returned function is called; the listener survives reconnections.
   * @param event The server event.
   * @param listener Called with the event's payload.
   * @returns Removes the listener.
   */
  on<E extends keyof ServerToClientEvents>(event: E, listener: ServerToClientEvents[E]): () => void {
    // Widened so Socket.io resolves its conditional listener type; the signature above keeps the contract.
    const name: string = event;
    this.socket.on(name, listener);
    return () => {
      this.socket.off(name, listener);
    };
  }
}
