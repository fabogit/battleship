import { TestBed } from '@angular/core/testing';
import { CLIENT_EVENTS, ERROR_CODES } from '@battleship/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeGameSocket, provideFakeGameSocket } from '../../testing/fake-game-socket';
import { TRANSPORT_ERRORS } from './game-socket';
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
});
