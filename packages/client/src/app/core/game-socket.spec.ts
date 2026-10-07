import { TestBed } from '@angular/core/testing';
import type { AckResponse, JoinRoomAckData, PlayerStateSnapshot } from '@battleship/core';
import { io, type Socket } from 'socket.io-client';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { ACK_TIMEOUT_MS, GameSocketService, type TransportFailure } from './game-socket';
import { SERVER_URL } from './server-url';

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

type Listener = (...args: unknown[]) => void;

/** An emit captured by `FakeSocket`, with the ack Socket.io would call. */
interface Emitted {
  readonly event: string;
  readonly payload: unknown;
  readonly timeoutMs: number;
  readonly ack: (error: Error | null, response?: unknown) => void;
}

/**
 * Stands in for the Socket.io client. `active` and `connected` follow socket.io-client 4.8: `active` is true from
 * `connect()` until the client closes the socket, the server disconnects it or a middleware refuses the handshake.
 */
class FakeSocket {
  active = false;
  connected = false;
  readonly emitted: Emitted[] = [];
  readonly connect = vi.fn(() => {
    this.active = true;
  });
  readonly close = vi.fn(() => {
    this.active = false;
    this.connected = false;
  });
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  timeout(timeoutMs: number): { emit: (event: string, payload: unknown, ack: Emitted['ack']) => void } {
    return {
      emit: (event, payload, ack) => {
        this.emitted.push({ event, payload, timeoutMs, ack });
      },
    };
  }

  /** Delivers an event to the listeners, as the server or the Manager would. */
  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  handshake(): void {
    this.connected = true;
    this.fire('connect');
  }

  drop(reason: string, { isStillActive }: { isStillActive: boolean }): void {
    this.connected = false;
    this.active = isStillActive;
    this.fire('disconnect', reason);
  }

  refuse(message: string, { isStillActive }: { isStillActive: boolean }): void {
    this.active = isStillActive;
    this.fire('connect_error', new Error(message));
  }
}

let socket: FakeSocket;
let service: GameSocketService;

beforeEach(() => {
  socket = new FakeSocket();
  vi.mocked(io).mockReset().mockReturnValue(socket as unknown as Socket);
  TestBed.configureTestingModule({
    providers: [{ provide: SERVER_URL, useValue: 'https://server.test' }],
  });
  service = TestBed.inject(GameSocketService);
});

/** Connects and completes the handshake. */
function connected(): void {
  service.connect();
  socket.handshake();
}

describe('GameSocketService', () => {
  describe('connection', () => {
    it('tries WebSocket first and falls back to polling (docs/deployment.md#frontend-cloudflare-pages)', () => {
      expect(io).toHaveBeenCalledExactlyOnceWith('https://server.test', {
        autoConnect: false,
        transports: ['websocket', 'polling'],
        tryAllTransports: true,
      });
      expect(service.status()).toBe('disconnected');
      expect(socket.connect).not.toHaveBeenCalled();

      service.connect();

      expect(socket.connect).toHaveBeenCalledOnce();
      expect(service.status()).toBe('connecting');
    });

    it('reports connected once the handshake succeeds', () => {
      connected();

      expect(service.status()).toBe('connected');
    });

    it('goes back to connecting while Socket.io reconnects after a drop', () => {
      connected();

      socket.drop('transport close', { isStillActive: true });

      expect(service.status()).toBe('connecting');
      socket.handshake();
      expect(service.status()).toBe('connected');
    });

    it('reports disconnected when the server disconnects the socket', () => {
      connected();

      socket.drop('io server disconnect', { isStillActive: false });

      expect(service.status()).toBe('disconnected');
    });

    it('keeps connecting while a refused handshake is retried (#51, F9)', () => {
      service.connect();

      // A foreign origin refused by `allowRequest`: Socket.io stays active and retries.
      socket.refuse('xhr poll error', { isStillActive: true });
      socket.refuse('xhr poll error', { isStillActive: true });
      socket.refuse('xhr poll error', { isStillActive: true });

      expect(service.status()).toBe('connecting');
    });

    it('reports disconnected when the socket gives up after a connect_error', () => {
      service.connect();

      // A middleware error (`next(err)`), e.g. PROTOCOL_MISMATCH: Socket.io stops retrying.
      socket.refuse('PROTOCOL_MISMATCH', { isStillActive: false });

      expect(service.status()).toBe('disconnected');
    });

    it('ignores connect() while connecting or connected and reopens a socket that gave up', () => {
      service.connect();
      service.connect();
      socket.handshake();
      service.connect();
      expect(socket.connect).toHaveBeenCalledOnce();

      socket.drop('io server disconnect', { isStillActive: false });
      service.connect();

      expect(socket.connect).toHaveBeenCalledTimes(2);
      expect(service.status()).toBe('connecting');
    });

    it('closes the socket when the injector is destroyed', () => {
      TestBed.resetTestingModule();

      expect(socket.close).toHaveBeenCalledOnce();
    });
  });

  describe('emitWithAck', () => {
    const joinRoom = { roomId: 'abcd2345', nickname: 'Ada' };

    it('emits the command with the ack timeout and resolves with the server reply', async () => {
      connected();

      const result = service.emitWithAck('JOIN_ROOM', joinRoom);
      expect(socket.emitted).toHaveLength(1);
      expect(socket.emitted[0]).toMatchObject({ event: 'JOIN_ROOM', payload: joinRoom, timeoutMs: ACK_TIMEOUT_MS });
      socket.emitted[0]?.ack(null, { ok: true, playerSecret: 'secret' });

      await expect(result).resolves.toEqual({ ok: true, playerSecret: 'secret' });
      expectTypeOf(result).resolves.toEqualTypeOf<AckResponse<JoinRoomAckData> | TransportFailure>();
    });

    it('resolves with a refusal from the server as it is', async () => {
      connected();

      const result = service.emitWithAck('FIRE', { targets: [{ x: 0, y: 0 }] });
      socket.emitted[0]?.ack(null, { ok: false, error: 'NOT_YOUR_TURN' });

      await expect(result).resolves.toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    });

    it.each(['operation has timed out', 'socket has been disconnected'])(
      'resolves NO_ACK when Socket.io reports "%s"',
      async (message) => {
        connected();

        const result = service.emitWithAck('CONFIRM_PLACEMENT', {});
        socket.emitted[0]?.ack(new Error(message));

        await expect(result).resolves.toEqual({ ok: false, error: 'NO_ACK' });
      },
    );

    it('resolves NOT_CONNECTED without emitting while the socket is not connected', async () => {
      service.connect();

      await expect(service.emitWithAck('LEAVE_ROOM', {})).resolves.toEqual({ ok: false, error: 'NOT_CONNECTED' });
      expect(socket.emitted).toEqual([]);
    });

    it('takes only the payload of the named command', () => {
      // @ts-expect-error `JOIN_ROOM` needs a room id.
      void service.emitWithAck('JOIN_ROOM', { nickname: 'Ada' });
      // @ts-expect-error `ECHO` is not a command.
      void service.emitWithAck('ECHO', {});
    });
  });

  describe('server events', () => {
    it('delivers events to a listener until it is removed', () => {
      const listener = vi.fn<(snapshot: PlayerStateSnapshot) => void>();
      const snapshot = { roomId: 'abcd2345' } as PlayerStateSnapshot;

      const stop = service.on('STATE', listener);
      socket.fire('STATE', snapshot);
      stop();
      socket.fire('STATE', snapshot);

      expect(listener).toHaveBeenCalledExactlyOnceWith(snapshot);
    });
  });

  describe('echo', () => {
    it('rejects with the transport error when not connected', async () => {
      await expect(service.echo(null)).rejects.toThrow('NOT_CONNECTED');
    });
  });
});
