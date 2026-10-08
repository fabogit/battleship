import { TestBed } from '@angular/core/testing';
import { CLIENT_EVENTS, ERROR_CODES } from '@battleship/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeGameSocket, provideFakeGameSocket } from '../../testing/fake-game-socket';
import { TRANSPORT_ERRORS } from './game-socket';
import { RoomEntryService } from './room-entry';
import { ROOM_ENTRY_TEXT, roomEntryErrorMessage } from './room-entry.text';
import { SessionStore } from './session-store';

const ROOM_ID = 'ab23cd45';
// Generated, as the server does: a literal UUID named like a secret trips secret scanners.
const PLAYER_SECRET = crypto.randomUUID();

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
      },
    );
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
