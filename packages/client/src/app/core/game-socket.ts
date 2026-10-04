import { DestroyRef, Service, inject, signal } from '@angular/core';
import type { ClientToServerEvents, EchoResponse, ServerToClientEvents } from '@battleship/core';
import { io, type Socket } from 'socket.io-client';

import { SERVER_URL } from './server-url';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 5_000;

/** Owns the Socket.io connection to the game server and exposes its status as a signal (ADR §8.1). */
@Service()
export class GameSocketService {
  private readonly serverUrl = inject(SERVER_URL);

  private readonly statusSignal = signal<ConnectionStatus>('disconnected');
  readonly status = this.statusSignal.asReadonly();

  private socket: GameSocket | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.socket?.close());
  }

  /** Opens the connection; call it only once `ServerWakeService` reports the server awake (ADR §4.3). */
  connect(): void {
    if (this.socket !== undefined) {
      return;
    }
    // WebSocket first: the server URL is https in production, so this is `wss://` (ADR §4.2).
    // Polling stays as a fallback for networks that block WebSocket upgrades.
    const socket: GameSocket = io(this.serverUrl, { transports: ['websocket', 'polling'] });
    this.socket = socket;
    this.statusSignal.set('connecting');

    socket.on('connect', () => {
      this.statusSignal.set('connected');
    });
    // `active` is false once Socket.io stops reconnecting (e.g. the server refused the handshake).
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
