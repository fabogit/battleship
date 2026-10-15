import { TestBed } from '@angular/core/testing';
import { CLIENT_EVENTS, ERROR_CODES, SERVER_EVENTS } from '@battleship/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeGameSocket, placementSnapshot, provideFakeGameSocket } from '../../testing/fake-game-socket';
import { TRANSPORT_ERRORS } from './game-socket';
import { GameStateService } from './game-state';
import { RoomEntryService } from './room-entry';
import { ROOM_ENTRY_TEXT, roomEntryErrorMessage } from './room-entry.text';
import { SessionStore } from './session-store';
import { createRoomId, createPlayerSecret } from '../../testing/session-fixtures';

const ROOM_ID = createRoomId(0);
const NEXT_ROOM_ID = createRoomId(1);
const PLAYER_SECRET = createPlayerSecret();

let socket: FakeGameSocket;
let service: RoomEntryService;
let sessions: SessionStore;

beforeEach(() => {
  socket = new FakeGameSocket();
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket)] });
  service = TestBed.inject(RoomEntryService);
  sessions = TestBed.inject(SessionStore);
});

describe('RoomEntryService', () => {
  describe('create', () => {
    it('sends CREATE_ROOM and stores the credentials it returns', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: true, roomId: ROOM_ID, playerSecret: PLAYER_SECRET });

      await expect(service.create('Ada')).resolves.toEqual({ ok: true, roomId: ROOM_ID });

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Ada' });
      expect(sessions.get(ROOM_ID)).toEqual({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
    });

    it.each([ERROR_CODES.SERVER_FULL, TRANSPORT_ERRORS.NO_ACK])('passes on %s and stores nothing', async (error) => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error });

      await expect(service.create('Ada')).resolves.toEqual({ ok: false, error });

      expect(sessions.get(ROOM_ID)).toBeNull();
    });

    it('reconnects after NO_ACK only, so the handshake binds the socket to the room the client follows (#52, F1)', async () => {
      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: ERROR_CODES.SERVER_FULL });
      await service.create('Ada');
      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: TRANSPORT_ERRORS.NOT_CONNECTED });
      await service.create('Ada');
      expect(socket.reconnect).not.toHaveBeenCalled();

      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: TRANSPORT_ERRORS.NO_ACK });
      await service.create('Ada');

      expect(socket.reconnect).toHaveBeenCalledOnce();
    });
  });

  describe('join', () => {
    it('sends JOIN_ROOM and stores the credentials under the joined room', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: true, playerSecret: PLAYER_SECRET });

      await expect(service.join(ROOM_ID, 'Grace')).resolves.toEqual({ ok: true, roomId: ROOM_ID });

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.JOIN_ROOM, {
        roomId: ROOM_ID,
        nickname: 'Grace',
      });
      expect(sessions.get(ROOM_ID)).toEqual({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
    });

    it.each([ERROR_CODES.ROOM_NOT_FOUND, ERROR_CODES.ROOM_FULL, TRANSPORT_ERRORS.NOT_CONNECTED])(
      'passes on %s and stores nothing',
      async (error) => {
        socket.emitWithAck.mockResolvedValue({ ok: false, error });

        await expect(service.join(ROOM_ID, 'Grace')).resolves.toEqual({ ok: false, error });

        expect(sessions.get(ROOM_ID)).toBeNull();
        expect(socket.reconnect).not.toHaveBeenCalled();
      },
    );

    it('reconnects after NO_ACK (#52, F1)', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: TRANSPORT_ERRORS.NO_ACK });

      await expect(service.join(ROOM_ID, 'Grace')).resolves.toEqual({ ok: false, error: TRANSPORT_ERRORS.NO_ACK });

      expect(sessions.get(ROOM_ID)).toBeNull();
      expect(socket.reconnect).toHaveBeenCalledOnce();
    });
  });

  describe('reopen', () => {
    it('enters a stored room in a tab that is in no room, and reconnects so the handshake sends it (ADR-0069)', () => {
      sessions.save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      // A new tab: the credentials are in localStorage, the current room is not.
      sessionStorage.clear();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket)] });
      service = TestBed.inject(RoomEntryService);
      sessions = TestBed.inject(SessionStore);

      service.reopen(ROOM_ID);

      expect(sessions.current()).toEqual({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      expect(socket.reconnect).toHaveBeenCalledOnce();
    });

    it('does nothing without stored credentials, or in a tab already in a room', () => {
      service.reopen(ROOM_ID);
      sessions.save({ roomId: NEXT_ROOM_ID, playerSecret: PLAYER_SECRET });
      sessions.save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      service.reopen(NEXT_ROOM_ID);

      expect(sessions.current()?.roomId).toBe(ROOM_ID);
      expect(socket.reconnect).not.toHaveBeenCalled();
    });
  });
});

describe('roomEntryErrorMessage', () => {
  it('explains the failures the entry screens expect', () => {
    expect(roomEntryErrorMessage(ERROR_CODES.SERVER_FULL)).toMatch(/server is full/);
    expect(roomEntryErrorMessage(TRANSPORT_ERRORS.NO_ACK)).toMatch(/did not answer/);
  });

  it('falls back to a generic message', () => {
    expect(roomEntryErrorMessage(ERROR_CODES.INVALID_PAYLOAD)).toBe(ROOM_ENTRY_TEXT.unexpected);
  });
  describe('leave (#25)', () => {
    beforeEach(() => {
      sessions.save({ roomId: NEXT_ROOM_ID, playerSecret: createPlayerSecret() });
      sessions.save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      socket.fire(SERVER_EVENTS.STATE, placementSnapshot(ROOM_ID));
    });

    it('sends LEAVE_ROOM, then forgets the seat and the snapshot', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: true });

      await expect(service.leave(ROOM_ID)).resolves.toEqual({ ok: true });

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.LEAVE_ROOM, {});
      expect(sessions.get(ROOM_ID)).toBeNull();
      expect(sessions.current()).toBeNull();
      expect(sessions.get(NEXT_ROOM_ID)).not.toBeNull();
      expect(TestBed.inject(GameStateService).snapshot()).toBeNull();
      expect(socket.reconnect).not.toHaveBeenCalled();
    });

    it.each([ERROR_CODES.NOT_ALLOWED, TRANSPORT_ERRORS.NOT_CONNECTED])(
      'keeps the seat and the snapshot after %s',
      async (error) => {
        socket.emitWithAck.mockResolvedValue({ ok: false, error });

        await expect(service.leave(ROOM_ID)).resolves.toEqual({ ok: false, error });

        expect(sessions.current()).toEqual({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
        expect(TestBed.inject(GameStateService).snapshot()?.roomId).toBe(ROOM_ID);
        expect(socket.reconnect).not.toHaveBeenCalled();
      },
    );

    it('reconnects after NO_ACK, so the handshake tells whether the seat is still held', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: TRANSPORT_ERRORS.NO_ACK });

      await service.leave(ROOM_ID);

      expect(socket.reconnect).toHaveBeenCalledOnce();
      expect(sessions.get(ROOM_ID)).not.toBeNull();
    });
  });

  it("forgets a refused seat's snapshot of the room before joining it again (ADR-0075)", async () => {
    const gameState = TestBed.inject(GameStateService);
    socket.fire(SERVER_EVENTS.STATE, placementSnapshot(ROOM_ID));
    socket.emitWithAck.mockImplementation(() => {
      expect(gameState.snapshot()).toBeNull();
      return Promise.resolve({ ok: true, playerSecret: PLAYER_SECRET });
    });

    await service.join(ROOM_ID, 'Grace');

    expect(socket.emitWithAck).toHaveBeenCalledOnce();
  });

  it("keeps another room's snapshot when joining", async () => {
    const gameState = TestBed.inject(GameStateService);
    socket.fire(SERVER_EVENTS.STATE, placementSnapshot(NEXT_ROOM_ID));
    socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.ROOM_FULL });

    await service.join(ROOM_ID, 'Grace');

    expect(gameState.snapshot()?.roomId).toBe(NEXT_ROOM_ID);
  });
});
