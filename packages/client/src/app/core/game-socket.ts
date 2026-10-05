import { DestroyRef, Service, inject, signal } from '@angular/core';
import type { ClientToServerEvents, EchoResponse, ServerToClientEvents } from '@battleship/core';
import { io, type Socket } from 'socket.io-client';

import { SERVER_URL } from './server-url';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 5_000;

/** Owns the Socket.io connection to the game server and exposes its status as a signal (docs/client.md#81-reactive-model). */
@Service()
export class GameSocketService {
  private readonly serverUrl = inject(SERVER_URL);

  private readonly statusSignal = signal<ConnectionStatus>('disconnected');
  readonly status = this.statusSignal.asReadonly();

  private socket: GameSocket | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.socket?.close());
  }

  /** Opens the connection; call it only once `ServerWakeService` reports the server awake (docs/client.md#43-cold-start-handling-client-serverwakeservice). */
  connect(): void {
    if (this.socket !== undefined) {
      return;
    }
    // WebSocket first: the server URL is https in production, so this is `wss://` (docs/deployment.md#42-frontend-cloudflare-pages).
    // Polling is the fallback for networks that block WebSocket: without `tryAllTransports` the client
    // never moves past the first transport and keeps retrying WebSocket.
    const socket: GameSocket = io(this.serverUrl, { transports: ['websocket', 'polling'], tryAllTransports: true });
    this.socket = socket;
    this.statusSignal.set('connecting');

    socket.on('connect', () => {
      this.statusSignal.set('connected');
    });
    // `active` drops to false only when the client closes the socket or a server middleware rejects the
    // connection (`next(err)`). A handshake refused by `allowRequest` (foreign origin, HTTP 403) keeps it
    // true, so the socket stays 'connecting' and retries.
    socket.on('disconnect', () => {
      this.statusSignal.set(socket.active ? 'connecting' : 'disconnected');
    });
    socket.on('connect_error', () => {
      this.statusSignal.set(socket.active ? 'connecting' : 'disconnected');
    });
  }

  /** Phase 0 connectivity check: resolves with the server's ack, rejects on timeout or when not connected. */
  echo(payload: unknown): Promise<EchoResponse> {
    const socket = this.socket;
    if (socket?.connected !== true) {
      return Promise.reject(new Error('Not connected'));
    }
    // Callback form: `timeout().emitWithAck()` is typed `Promise<any>` by socket.io-client.
    return new Promise((resolve, reject) => {
      socket.timeout(ACK_TIMEOUT_MS).emit('ECHO', payload, (error, response) => {
        // Typed `Error`, but it is `null` when the ack arrives in time.
        if (error instanceof Error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }
}
