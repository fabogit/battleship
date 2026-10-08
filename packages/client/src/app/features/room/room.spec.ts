import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  CLIENT_EVENTS,
  ERROR_CODES,
  PLACEMENT_TIME_LIMIT_MS,
  ROOM_PHASES,
  SEATS,
  SERVER_EVENTS,
  type PlayerStateSnapshot,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGameSocket, provideFakeGameSocket, waitingSnapshot } from '../../../testing/fake-game-socket';
import { routes } from '../../app.routes';
import { GameStateService } from '../../core/game-state';
import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { ROOM_ENTRY_TEXT } from '../../core/room-entry.text';
import { SessionStore } from '../../core/session-store';
import { LOBBY_TEXT } from '../lobby/lobby.text';
import { ROOM_VIEWS } from './room';
import { ROOM_TEXT } from './room.text';

const ROOM_ID = 'ab23cd45';
// Generated, as the server does: a literal UUID named like a secret trips secret scanners.
const PLAYER_SECRET = crypto.randomUUID();

/**
 * The room right after the joiner took the seat, seen by the joiner. Until rules negotiation lands (#26) the server
 * moves straight to `PLACEMENT` (docs/server.md#room-creation--joining).
 * @returns The snapshot.
 */
function joinedSnapshot(): PlayerStateSnapshot {
  const waiting = waitingSnapshot(ROOM_ID, 'Ada');
  return {
    ...waiting,
    phase: ROOM_PHASES.PLACEMENT,
    me: { seat: SEATS.P2, nickname: 'Grace', isConnected: true, forfeitRemainingMs: null },
    opponent: { ...waiting.me },
    hasConfirmedRules: { me: true, opponent: true },
    placement: {
      myShips: [],
      hasConfirmed: { me: false, opponent: false },
      remainingMs: PLACEMENT_TIME_LIMIT_MS,
      startCountdownMs: null,
    },
  };
}

let socket: FakeGameSocket;
let harness: RouterTestingHarness;

beforeEach(async () => {
  socket = new FakeGameSocket();
  TestBed.configureTestingModule({
    providers: [provideFakeGameSocket(socket), provideRouter(routes, withComponentInputBinding())],
  });
  // Created up front, as the app does through the shell, so it listens to `STATE` from the start.
  TestBed.inject(GameStateService);
  harness = await RouterTestingHarness.create();
});

afterEach(() => {
  // The placement snapshot starts the countdown ticker.
  TestBed.inject(GameStateService).clear();
});

/** @returns The rendered page. */
function page(): HTMLElement {
  return harness.routeNativeElement as HTMLElement;
}

/** @returns The page heading's text. */
function heading(): string | undefined {
  return page().querySelector('h1')?.textContent.trim();
}

/**
 * Types a nickname and presses "Join room".
 * @param nickname What the player types.
 */
async function join(nickname: string): Promise<void> {
  const input = page().querySelector('input');
  if (input === null) {
    throw new Error('No nickname field');
  }
  input.value = nickname;
  input.dispatchEvent(new Event('input'));
  page().querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  await harness.fixture.whenStable();
}

/**
 * Delivers a snapshot and lets the page render it.
 * @param snapshot The `STATE` payload.
 */
async function receive(snapshot: PlayerStateSnapshot): Promise<void> {
  socket.fire(SERVER_EVENTS.STATE, snapshot);
  await harness.fixture.whenStable();
}

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('ROOM_VIEWS', () => {
  it('pins the values', () => {
    expect(Object.values(ROOM_VIEWS)).toEqual(['join', 'entering', 'lobby', 'match', 'not-found', 'full']);
  });
});

describe('Room', () => {
  describe('as the joiner', () => {
    beforeEach(async () => {
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
    });

    it('asks for a nickname to take the free seat', () => {
      expect(heading()).toBe(ROOM_TEXT.joinHeading);
      expect(page().textContent).toContain(ROOM_ID);
      expect(page().querySelector('button[type="submit"]')?.textContent.trim()).toBe(ROOM_TEXT.join);
    });

    it('joins with the trimmed nickname, then follows the snapshot', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: true, playerSecret: PLAYER_SECRET });

      await join(' Grace ');

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.JOIN_ROOM, {
        roomId: ROOM_ID,
        nickname: 'Grace',
      });
      await vi.waitFor(() => {
        expect(page().textContent).toContain(ROOM_TEXT.entering);
      });

      await receive(joinedSnapshot());

      expect(heading()).toBe(ROOM_TEXT.matchHeading);
      expect(page().textContent).toContain(ROOM_TEXT.opponentIs('Ada'));
    });

    it('shows a not-found screen with a way home for ROOM_NOT_FOUND', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.ROOM_NOT_FOUND });

      await join('Grace');

      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.notFoundHeading);
      });
      expect(page().querySelector('a')?.getAttribute('href')).toBe('/');
      expect(page().querySelector('input')).toBeNull();
    });

    it('shows a full-room screen with a way home for ROOM_FULL', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.ROOM_FULL });

      await join('Grace');

      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.fullHeading);
      });
      expect(page().textContent).toContain(ROOM_TEXT.fullReason);
      expect(page().querySelector('a')?.textContent).toBe(ROOM_TEXT.createOwn);
    });

    it('keeps the form and explains any other failure', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: TRANSPORT_ERRORS.NO_ACK });

      await join('Grace');

      await vi.waitFor(() => {
        expect(page().querySelector('[role="alert"]')?.textContent).toBe(ROOM_ENTRY_TEXT.errors.NO_ACK);
      });
      expect(heading()).toBe(ROOM_TEXT.joinHeading);
    });

    it('forgets a failed join when the address names another room', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.ROOM_NOT_FOUND });
      await join('Grace');
      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.notFoundHeading);
      });

      await harness.navigateByUrl('/r/zz23cd45');

      expect(heading()).toBe(ROOM_TEXT.joinHeading);
    });

    it("ignores another room's snapshot", async () => {
      await receive(waitingSnapshot('zz23cd45'));

      expect(heading()).toBe(ROOM_TEXT.joinHeading);
    });
  });

  describe('as the creator', () => {
    beforeEach(async () => {
      TestBed.inject(SessionStore).save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
    });

    it('waits for the first snapshot, then shows the waiting screen with the room link', async () => {
      expect(page().textContent).toContain(ROOM_TEXT.entering);

      await receive(waitingSnapshot(ROOM_ID, 'Ada'));

      expect(heading()).toBe(LOBBY_TEXT.heading);
      expect(page().textContent).toContain(LOBBY_TEXT.playingAs('Ada'));
      expect(page().querySelector<HTMLInputElement>('input#room-link')?.value).toMatch(new RegExp(`/r/${ROOM_ID}$`));
    });

    it('moves on when the opponent joins', async () => {
      await receive(waitingSnapshot(ROOM_ID, 'Ada'));

      const joined = joinedSnapshot();
      await receive({ ...joined, me: joined.opponent ?? joined.me, opponent: joined.me });

      expect(heading()).toBe(ROOM_TEXT.matchHeading);
      expect(page().textContent).toContain(ROOM_TEXT.opponentIs('Grace'));
    });
  });

  it.each(['abc', 'AB23CD45', 'ab23cd4o'])('shows not-found for the malformed room id %s', async (roomId) => {
    await harness.navigateByUrl(`/r/${roomId}`);

    expect(heading()).toBe(ROOM_TEXT.notFoundHeading);
    expect(socket.emitWithAck).not.toHaveBeenCalled();
  });
});
