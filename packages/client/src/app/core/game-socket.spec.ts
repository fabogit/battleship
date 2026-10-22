import { TestBed } from '@angular/core/testing';
import {
  CLIENT_EVENTS,
  ERROR_CODES,
  PROTOCOL_VERSION,
  SERVER_EVENTS,
  type AckResponse,
  type JoinRoomAckData,
  type PlayerStateSnapshot,
} from '@battleship/core';
import { io, type Socket } from 'socket.io-client';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  ACK_TIMEOUT_MS,
  CLOSE_REASONS,
  CONNECTION_STATUSES,
  GameSocketService,
  TRANSPORT_ERRORS,
  type TransportFailure,
} from './game-socket';
import { SERVER_URL } from './server-url';
import { SessionStore } from './session-store';
import { createRoomId, createPlayerSecret } from '../../testing/session-fixtures';

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
  /** As `Socket.disconnect()`: closes the socket, firing `disconnect` only when it was connected. */
  readonly disconnect = vi.fn(() => {
    const wasConnected = this.connected;
    this.active = false;
    this.connected = false;
    if (wasConnected) {
      this.fire('disconnect', 'io client disconnect');
    }
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
  vi.mocked(io)
    .mockReset()
    .mockReturnValue(socket as unknown as Socket);
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

/**
 * Calls the handshake `auth` callback, as Socket.io does on every connection attempt.
 * @returns What the callback sent.
 */
function handshakeAuth(): unknown {
  const auth = vi.mocked(io).mock.calls[0]?.[1]?.auth;
  if (typeof auth !== 'function') {
    throw new Error('The handshake auth is not a callback');
  }
  const send = vi.fn();
  auth(send);
  expect(send).toHaveBeenCalledOnce();
  return send.mock.calls[0]?.[0];
}

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('CONNECTION_STATUSES', () => {
  it('pins the values', () => {
    expect(Object.values(CONNECTION_STATUSES)).toEqual(['disconnected', 'connecting', 'connected']);
  });
});

describe('CLOSE_REASONS', () => {
  it('pins the values', () => {
    expect(Object.values(CLOSE_REASONS)).toEqual([
      'protocol-mismatch',
      'session-replaced',
      'server-shutdown',
      'refused',
      'server-disconnect',
    ]);
  });
});

describe('TRANSPORT_ERRORS', () => {
  it('pins the values', () => {
    expect(Object.values(TRANSPORT_ERRORS)).toEqual(['NOT_CONNECTED', 'NO_ACK']);
  });
});

describe('GameSocketService', () => {
  describe('connection', () => {
    it('tries WebSocket first and falls back to polling (docs/deployment.md#frontend-cloudflare-pages)', () => {
      expect(io).toHaveBeenCalledExactlyOnceWith('https://server.test', {
        autoConnect: false,
        transports: ['websocket', 'polling'],
        tryAllTransports: true,
        auth: expect.any(Function) as unknown,
      });
      expect(service.status()).toBe(CONNECTION_STATUSES.DISCONNECTED);
      expect(socket.connect).not.toHaveBeenCalled();

      service.connect();

      expect(socket.connect).toHaveBeenCalledOnce();
      expect(service.status()).toBe(CONNECTION_STATUSES.CONNECTING);
    });

    it('sends the protocol version alone in the handshake auth while the tab is in no room (ADR-0061)', () => {
      // No `session` key at all: `null` would be refused with SESSION_INVALID.
      expect(handshakeAuth()).toStrictEqual({ protocolVersion: PROTOCOL_VERSION });
    });

    it("adds the current room's stored session, read again on every attempt (ADR-0063)", () => {
      const sessions = TestBed.inject(SessionStore);
      const first = { roomId: createRoomId(0), playerSecret: createPlayerSecret() };
      const next = { roomId: createRoomId(1), playerSecret: createPlayerSecret() };

      sessions.save(first);
      expect(handshakeAuth()).toStrictEqual({ protocolVersion: PROTOCOL_VERSION, session: first });

      sessions.save(next);
      expect(handshakeAuth()).toStrictEqual({ protocolVersion: PROTOCOL_VERSION, session: next });
    });

    it('reports connected once the handshake succeeds', () => {
      connected();

      expect(service.status()).toBe(CONNECTION_STATUSES.CONNECTED);
    });

    it('goes back to connecting while Socket.io reconnects after a drop', () => {
      connected();

      socket.drop('transport close', { isStillActive: true });

      expect(service.status()).toBe(CONNECTION_STATUSES.CONNECTING);
      socket.handshake();
      expect(service.status()).toBe(CONNECTION_STATUSES.CONNECTED);
    });

    it('reports disconnected when the server disconnects the socket', () => {
      connected();

      socket.drop('io server disconnect', { isStillActive: false });

      expect(service.status()).toBe(CONNECTION_STATUSES.DISCONNECTED);
    });

    it('keeps connecting while a refused handshake is retried (#51, F9)', () => {
      service.connect();

      // A foreign origin refused by `allowRequest`: Socket.io stays active and retries.
      socket.refuse('xhr poll error', { isStillActive: true });
      socket.refuse('xhr poll error', { isStillActive: true });
      socket.refuse('xhr poll error', { isStillActive: true });

      expect(service.status()).toBe(CONNECTION_STATUSES.CONNECTING);
    });

    it('reports disconnected when the socket gives up after a connect_error', () => {
      service.connect();

      // A middleware error (`next(err)`), e.g. PROTOCOL_MISMATCH: Socket.io stops retrying.
      socket.refuse(ERROR_CODES.PROTOCOL_MISMATCH, { isStillActive: false });

      expect(service.status()).toBe(CONNECTION_STATUSES.DISCONNECTED);
    });

    it('drops a session refused with SESSION_INVALID and connects again without it (ADR-0070)', () => {
      const sessions = TestBed.inject(SessionStore);
      const refused = { roomId: createRoomId(0), playerSecret: createPlayerSecret() };
      const other = { roomId: createRoomId(1), playerSecret: createPlayerSecret() };
      sessions.save(other);
      sessions.save(refused);
      service.connect();
      handshakeAuth();

      socket.refuse(ERROR_CODES.SESSION_INVALID, { isStillActive: false });

      expect(sessions.get(refused.roomId)).toBeNull();
      expect(sessions.wasRefused(refused.roomId)).toBe(true);
      expect(sessions.get(other.roomId)).not.toBeNull();
      expect(socket.connect).toHaveBeenCalledTimes(2);
      expect(service.status()).toBe(CONNECTION_STATUSES.CONNECTING);
      expect(handshakeAuth()).toStrictEqual({ protocolVersion: PROTOCOL_VERSION });
    });

    it('keeps the stored session when the handshake is refused for another reason', () => {
      const sessions = TestBed.inject(SessionStore);
      const session = { roomId: createRoomId(0), playerSecret: createPlayerSecret() };
      sessions.save(session);
      service.connect();
      handshakeAuth();

      socket.refuse(ERROR_CODES.PROTOCOL_MISMATCH, { isStillActive: false });

      expect(sessions.current()).toEqual(session);
      expect(socket.connect).toHaveBeenCalledOnce();
      expect(service.status()).toBe(CONNECTION_STATUSES.DISCONNECTED);
    });

    it('does not reconnect on SESSION_INVALID when the handshake sent no session', () => {
      service.connect();
      handshakeAuth();

      socket.refuse(ERROR_CODES.SESSION_INVALID, { isStillActive: false });

      expect(socket.connect).toHaveBeenCalledOnce();
      expect(service.status()).toBe(CONNECTION_STATUSES.DISCONNECTED);
    });

    it('reopens an open or opening connection on reconnect(), so the handshake runs again (ADR-0070)', () => {
      connected();

      service.reconnect();

      expect(socket.disconnect).toHaveBeenCalledOnce();
      expect(socket.connect).toHaveBeenCalledTimes(2);
      expect(service.status()).toBe(CONNECTION_STATUSES.CONNECTING);

      service.reconnect();
      expect(socket.disconnect).toHaveBeenCalledTimes(2);
      expect(socket.connect).toHaveBeenCalledTimes(3);
    });

    it('leaves a closed connection closed on reconnect(): the next connect() sends the session', () => {
      service.reconnect();

      socket.drop('io server disconnect', { isStillActive: false });
      service.reconnect();

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.connect).not.toHaveBeenCalled();
      expect(service.status()).toBe(CONNECTION_STATUSES.DISCONNECTED);
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
      expect(service.status()).toBe(CONNECTION_STATUSES.CONNECTING);
    });

    it('closes the socket when the injector is destroyed', () => {
      TestBed.resetTestingModule();

      expect(socket.close).toHaveBeenCalledOnce();
    });
  });

  describe('why a connection ended, and retries (#25, ADR-0075)', () => {
    it('has no close reason, retry error or reconnection before the first connection', () => {
      expect(service.closeReason()).toBeNull();
      expect(service.retryError()).toBeNull();
      expect(service.isReconnecting()).toBe(false);
    });

    it('reports PROTOCOL_MISMATCH as the close reason of a refused handshake', () => {
      service.connect();

      socket.refuse(ERROR_CODES.PROTOCOL_MISMATCH, { isStillActive: false });

      expect(service.closeReason()).toBe(CLOSE_REASONS.PROTOCOL_MISMATCH);
      expect(service.status()).toBe(CONNECTION_STATUSES.DISCONNECTED);
    });

    it('reports any other refused handshake as refused', () => {
      service.connect();
      handshakeAuth();

      // SESSION_INVALID for a handshake without a session: nothing to drop, so the refusal stands.
      socket.refuse(ERROR_CODES.SESSION_INVALID, { isStillActive: false });

      expect(service.closeReason()).toBe(CLOSE_REASONS.REFUSED);
    });

    it('has no close reason after SESSION_INVALID for a sent session: it connects again at once', () => {
      TestBed.inject(SessionStore).save({ roomId: createRoomId(0), playerSecret: createPlayerSecret() });
      service.connect();
      handshakeAuth();

      socket.refuse(ERROR_CODES.SESSION_INVALID, { isStillActive: false });

      expect(service.closeReason()).toBeNull();
    });

    it.each([
      [SERVER_EVENTS.SESSION_REPLACED, CLOSE_REASONS.SESSION_REPLACED],
      [SERVER_EVENTS.SERVER_SHUTDOWN, CLOSE_REASONS.SERVER_SHUTDOWN],
    ])('reports %s, then keeps it through the server disconnect that follows', (event, reason) => {
      connected();

      socket.fire(event, {});
      expect(service.closeReason()).toBe(reason);
      socket.drop('io server disconnect', { isStillActive: false });

      expect(service.closeReason()).toBe(reason);
      expect(service.status()).toBe(CONNECTION_STATUSES.DISCONNECTED);
      expect(service.isReconnecting()).toBe(false);
    });

    it('reports a server disconnect without a reason first', () => {
      connected();

      socket.drop('io server disconnect', { isStillActive: false });

      expect(service.closeReason()).toBe(CLOSE_REASONS.SERVER_DISCONNECT);
    });

    it('forgets the close reason on connect() and on the next handshake', () => {
      connected();
      socket.fire(SERVER_EVENTS.SESSION_REPLACED, {});
      socket.drop('io server disconnect', { isStillActive: false });

      service.connect();
      expect(service.closeReason()).toBeNull();

      socket.fire(SERVER_EVENTS.SERVER_SHUTDOWN, {});
      socket.handshake();
      expect(service.closeReason()).toBeNull();
    });

    it('forgets the last retry error on connect() after Socket.io gave up', () => {
      service.connect();
      socket.refuse('xhr poll error', { isStillActive: true });
      socket.refuse(ERROR_CODES.PROTOCOL_MISMATCH, { isStillActive: false });
      expect(service.retryError()).toBe('xhr poll error');

      service.connect();

      expect(service.retryError()).toBeNull();
    });

    it('keeps the last error while Socket.io retries, and drops it once connected (#51, F9)', () => {
      service.connect();

      socket.refuse('websocket error', { isStillActive: true });
      socket.refuse('xhr poll error', { isStillActive: true });

      expect(service.retryError()).toBe('xhr poll error');
      expect(service.closeReason()).toBeNull();
      expect(service.status()).toBe(CONNECTION_STATUSES.CONNECTING);

      socket.handshake();
      expect(service.retryError()).toBeNull();
    });

    it('tells a reconnection after a drop from a first connection', () => {
      service.connect();
      expect(service.isReconnecting()).toBe(false);
      socket.handshake();

      socket.drop('transport close', { isStillActive: true });
      expect(service.isReconnecting()).toBe(true);
      expect(service.closeReason()).toBeNull();

      socket.handshake();
      expect(service.isReconnecting()).toBe(false);
    });

    it('is not reconnecting after reconnect(): the client closed the socket itself', () => {
      connected();

      service.reconnect();

      expect(service.isReconnecting()).toBe(false);
      expect(service.closeReason()).toBeNull();
    });

    it('stops reconnecting when a retry is refused for good', () => {
      connected();
      socket.drop('transport close', { isStillActive: true });

      socket.refuse(ERROR_CODES.PROTOCOL_MISMATCH, { isStillActive: false });

      expect(service.isReconnecting()).toBe(false);
      expect(service.closeReason()).toBe(CLOSE_REASONS.PROTOCOL_MISMATCH);
    });
  });

  describe('emitWithAck', () => {
    const joinRoom = { roomId: createRoomId(0), nickname: 'Ada' };

    it('emits the command with the ack timeout and resolves with the server reply', async () => {
      connected();

      const result = service.emitWithAck(CLIENT_EVENTS.JOIN_ROOM, joinRoom);
      expect(socket.emitted).toHaveLength(1);
      expect(socket.emitted[0]).toMatchObject({
        event: CLIENT_EVENTS.JOIN_ROOM,
        payload: joinRoom,
        timeoutMs: ACK_TIMEOUT_MS,
      });
      const playerSecret = createPlayerSecret();
      socket.emitted[0]?.ack(null, { ok: true, playerSecret });

      await expect(result).resolves.toEqual({ ok: true, playerSecret });
      expectTypeOf(result).resolves.toEqualTypeOf<AckResponse<JoinRoomAckData> | TransportFailure>();
    });

    it('resolves with a refusal from the server as it is', async () => {
      connected();

      const result = service.emitWithAck(CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] });
      socket.emitted[0]?.ack(null, { ok: false, error: ERROR_CODES.NOT_YOUR_TURN });

      await expect(result).resolves.toEqual({ ok: false, error: ERROR_CODES.NOT_YOUR_TURN });
    });

    it.each(['operation has timed out', 'socket has been disconnected'])(
      'resolves NO_ACK when Socket.io reports "%s"',
      async (message) => {
        connected();

        const result = service.emitWithAck(CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
        socket.emitted[0]?.ack(new Error(message));

        await expect(result).resolves.toEqual({ ok: false, error: TRANSPORT_ERRORS.NO_ACK });
      },
    );

    it('resolves NOT_CONNECTED without emitting while the socket is not connected', async () => {
      service.connect();

      await expect(service.emitWithAck(CLIENT_EVENTS.LEAVE_ROOM, {})).resolves.toEqual({
        ok: false,
        error: TRANSPORT_ERRORS.NOT_CONNECTED,
      });
      expect(socket.emitted).toEqual([]);
    });

    it('takes only the payload of the named command', () => {
      // @ts-expect-error `JOIN_ROOM` needs a room id.
      void service.emitWithAck(CLIENT_EVENTS.JOIN_ROOM, { nickname: 'Ada' });
      // @ts-expect-error `ECHO` is not a command.
      void service.emitWithAck(CLIENT_EVENTS.ECHO, {});
    });
  });

  describe('server events', () => {
    it('delivers events to a listener until it is removed', () => {
      const listener = vi.fn<(snapshot: PlayerStateSnapshot) => void>();
      const snapshot = { roomId: createRoomId(0) } as PlayerStateSnapshot;

      const stop = service.on(SERVER_EVENTS.STATE, listener);
      socket.fire(SERVER_EVENTS.STATE, snapshot);
      stop();
      socket.fire(SERVER_EVENTS.STATE, snapshot);

      expect(listener).toHaveBeenCalledExactlyOnceWith(snapshot);
    });
  });
});
