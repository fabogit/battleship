import { DestroyRef, Service, inject, signal } from '@angular/core';
import type { ClientToServerEvents, CommandEvent, CommandPayload, EchoResponse, ServerToClientEvents } from '@battleship/core';
import { io } from 'socket.io-client';

import { SERVER_URL } from './server-url';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/**
 * How long a command waits for its ack, in ms, before resolving as `NO_ACK` (ADR-0035). The server acks right after a
 * synchronous transition, so only a dead connection takes this long.
 */
export const ACK_TIMEOUT_MS = 5_000;

/**
 * Why a command got no reply from the server (ADR-0035): `NOT_CONNECTED` when it was not sent because the socket was
 * not connected; `NO_ACK` when it was sent but the ack did not arrive within `ACK_TIMEOUT_MS`, or the connection
 * dropped first. After `NO_ACK` the server may or may not have applied the command; the next `STATE` tells.
 */
export type TransportError = 'NOT_CONNECTED' | 'NO_ACK';

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
  private readonly statusSignal = signal<ConnectionStatus>('disconnected');
  /** `connecting` from `connect()` until the handshake succeeds, and while Socket.io retries after a drop. */
  readonly status = this.statusSignal.asReadonly();

  /**
   * Created idle (`autoConnect: false`), so services can listen to server events before the server is awake.
   * WebSocket first: the server URL is https in production, so this is `wss://` (docs/deployment.md#frontend-cloudflare-pages).
   * Polling is the fallback for networks that block WebSocket: without `tryAllTransports` the client never moves past
   * the first transport and keeps retrying WebSocket (#51, F3).
   *
   * Left with Socket.io's untyped event maps on purpose: its typed `emit` and `on` resolve payloads through conditional
   * types that a generic event name cannot narrow, so `emitWithAck`, `on` and `send` carry the contract's types instead
   * (ADR-0035). They are the only way to reach the socket's events.
   */
  private readonly socket = io(inject(SERVER_URL), {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
  });

  /** Mirrors the socket's lifecycle events into `status`, and closes the socket with the injector. */
  constructor() {
    const socket = this.socket;
    socket.on('connect', () => {
      this.statusSignal.set('connected');
    });
    // `active` drops to false only when the client closes the socket, the server disconnects it, or a server
    // middleware rejects the connection (`next(err)`). A handshake refused by `allowRequest` (foreign origin, HTTP 403)
    // keeps it true, so the socket stays 'connecting' and retries (#51, F9).
    socket.on('disconnect', () => {
      this.statusSignal.set(socket.active ? 'connecting' : 'disconnected');
    });
    socket.on('connect_error', () => {
      this.statusSignal.set(socket.active ? 'connecting' : 'disconnected');
    });
    inject(DestroyRef).onDestroy(() => socket.close());
  }

  /**
   * Opens the connection; call it only once `ServerWakeService` reports the server awake
   * (docs/client.md#cold-start-handling). Does nothing while the socket is connected or retrying; after Socket.io has
   * given up, it opens the connection again.
   */
  connect(): void {
    if (this.socket.active) {
      return;
    }
    this.statusSignal.set('connecting');
    this.socket.connect();
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
    return this.send(event, payload);
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

  /**
   * Phase 0 connectivity check.
   * @param payload Anything; the server sends it back.
   * @returns The server's ack.
   * @throws When the socket is not connected or no ack arrives, with the `TransportError` as message.
   */
  async echo(payload: unknown): Promise<EchoResponse> {
    const response = await this.send('ECHO', payload);
    if (!response.ok) {
      throw new Error(response.error);
    }
    return response;
  }

  /**
   * Emits any client→server event with an `ACK_TIMEOUT_MS` timeout. Socket.io calls the ack with an error both on
   * timeout and when the connection drops first; either way the reply is lost, so both are `NO_ACK`.
   * @param event The event.
   * @param payload Its payload.
   * @returns The ack, or why there was none.
   */
  private send<E extends keyof ClientToServerEvents>(
    event: E,
    payload: Parameters<ClientToServerEvents[E]>[0],
  ): Promise<AckOf<E> | TransportFailure> {
    if (!this.socket.connected) {
      return Promise.resolve({ ok: false, error: 'NOT_CONNECTED' });
    }
    return new Promise((resolve) => {
      // The error is `null` when the ack arrives in time.
      this.socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (error: Error | null, response: AckOf<E>) => {
        resolve(error === null ? response : { ok: false, error: 'NO_ACK' });
      });
    });
  }
}
