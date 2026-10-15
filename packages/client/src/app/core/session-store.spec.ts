import { TestBed } from '@angular/core/testing';
import { computed } from '@angular/core';
import { SESSION_STORE_TTL_MS } from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_ROOM_KEY, SESSION_KEY_PREFIX, SessionStore } from './session-store';
import { createRoomId, createPlayerSecret } from '../../testing/session-fixtures';

const ROOM_ID = createRoomId(0);
const NEXT_ROOM_ID = createRoomId(1);
const OTHER_ROOM_ID = createRoomId(2);
const FIRST_SECRET = createPlayerSecret();
const SECOND_SECRET = createPlayerSecret();

let store: SessionStore;

beforeEach(() => {
  store = TestBed.inject(SessionStore);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Starts the app again in the same tab, as a reload does: `sessionStorage` and `localStorage` are kept. */
function reload(): void {
  TestBed.resetTestingModule();
  store = TestBed.inject(SessionStore);
}

/** Opens the app in a new tab of the same browser: `localStorage` is kept, `sessionStorage` starts empty. */
function openNewTab(): void {
  sessionStorage.clear();
  reload();
}

/**
 * Reads a room's credentials entry as `localStorage` holds it.
 * @param roomId The room.
 * @returns The raw value, or `null`.
 */
function storedEntry(roomId: string): string | null {
  return localStorage.getItem(`${SESSION_KEY_PREFIX}${roomId}`);
}

// Written out on purpose (ADR-0043): renaming a constant is a refactor, changing a stored key is not.
describe('storage keys', () => {
  it('pins the values (ADR-0069)', () => {
    expect([SESSION_KEY_PREFIX, CURRENT_ROOM_KEY]).toEqual(['battleship:session:', 'battleship:current-room']);
  });
});

describe('SessionStore', () => {
  describe('in memory', () => {
    it('holds no session at first', () => {
      expect(store.get(ROOM_ID)).toBeNull();
      expect(store.current()).toBeNull();
    });

    it('keeps one session per room, the latest one winning', () => {
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      store.save({ roomId: NEXT_ROOM_ID, playerSecret: FIRST_SECRET });
      store.save({ roomId: ROOM_ID, playerSecret: SECOND_SECRET });

      expect(store.get(ROOM_ID)).toEqual({ roomId: ROOM_ID, playerSecret: SECOND_SECRET });
      expect(store.get(NEXT_ROOM_ID)).toEqual({ roomId: NEXT_ROOM_ID, playerSecret: FIRST_SECRET });
      expect(store.current()).toEqual({ roomId: ROOM_ID, playerSecret: SECOND_SECRET });
    });

    it('tells a room left for another one from the room entered last', () => {
      expect(store.hasLeft(ROOM_ID)).toBe(false);

      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      expect(store.hasLeft(ROOM_ID)).toBe(false);

      store.save({ roomId: NEXT_ROOM_ID, playerSecret: SECOND_SECRET });
      expect(store.hasLeft(ROOM_ID)).toBe(true);
      expect(store.hasLeft(NEXT_ROOM_ID)).toBe(false);
      expect(store.hasLeft(OTHER_ROOM_ID)).toBe(false);
      expect(store.current()).toEqual({ roomId: NEXT_ROOM_ID, playerSecret: SECOND_SECRET });
    });

    it('notifies reactive readers', () => {
      const hasSeat = computed(() => store.get(ROOM_ID) !== null);
      expect(hasSeat()).toBe(false);

      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });

      expect(hasSeat()).toBe(true);
    });
  });

  describe('across reloads and tabs (ADR-0069)', () => {
    it('stores the credentials with their expiry in localStorage and the current room in sessionStorage', () => {
      vi.useFakeTimers({ now: 1_000 });

      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });

      expect(JSON.parse(storedEntry(ROOM_ID) ?? 'null')).toEqual({
        roomId: ROOM_ID,
        playerSecret: FIRST_SECRET,
        expiresAt: 1_000 + SESSION_STORE_TTL_MS,
      });
      expect(sessionStorage.getItem(CURRENT_ROOM_KEY)).toBe(ROOM_ID);
    });

    it('restores the seat and the current room after a reload', () => {
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });

      reload();

      expect(store.get(ROOM_ID)).toEqual({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      expect(store.current()).toEqual({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
    });

    it('still tells a left room apart after a reload', () => {
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      store.save({ roomId: NEXT_ROOM_ID, playerSecret: SECOND_SECRET });

      reload();

      expect(store.hasLeft(ROOM_ID)).toBe(true);
      expect(store.current()?.roomId).toBe(NEXT_ROOM_ID);
    });

    it('starts a new tab in no room, which enters the first stored room it opens', () => {
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      store.save({ roomId: NEXT_ROOM_ID, playerSecret: SECOND_SECRET });

      openNewTab();

      expect(store.current()).toBeNull();
      expect(store.hasLeft(ROOM_ID)).toBe(false);
      expect(store.enter(OTHER_ROOM_ID)).toBe(false);
      expect(store.enter(ROOM_ID)).toBe(true);
      expect(store.current()).toEqual({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      expect(sessionStorage.getItem(CURRENT_ROOM_KEY)).toBe(ROOM_ID);
      // Once in a room, the tab stays there: the other room counts as left.
      expect(store.enter(NEXT_ROOM_ID)).toBe(false);
      expect(store.hasLeft(NEXT_ROOM_ID)).toBe(true);
    });
  });

  describe('expiry (ADR-0013)', () => {
    it('forgets credentials SESSION_STORE_TTL_MS after they were saved', () => {
      vi.useFakeTimers({ now: 1_000 });
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });

      vi.setSystemTime(1_000 + SESSION_STORE_TTL_MS - 1);
      expect(store.get(ROOM_ID)).not.toBeNull();

      vi.setSystemTime(1_000 + SESSION_STORE_TTL_MS);
      expect(store.get(ROOM_ID)).toBeNull();
      expect(store.current()).toBeNull();
      expect(store.hasLeft(ROOM_ID)).toBe(false);
    });

    it('removes expired entries from localStorage when the app starts', () => {
      vi.useFakeTimers({ now: 1_000 });
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      vi.setSystemTime(1_000 + SESSION_STORE_TTL_MS);

      reload();

      expect(store.get(ROOM_ID)).toBeNull();
      expect(storedEntry(ROOM_ID)).toBeNull();
    });
  });

  describe('untrusted storage', () => {
    /** @returns A well-formed entry for `ROOM_ID`, expiring in a minute. */
    function valid(): Record<string, unknown> {
      return { roomId: ROOM_ID, playerSecret: FIRST_SECRET, expiresAt: Date.now() + 60_000 };
    }

    it.each<[string, () => string]>([
      ['that is not JSON', () => '{roomId'],
      ['that is JSON null', () => 'null'],
      ['that is an array', () => JSON.stringify([ROOM_ID, FIRST_SECRET])],
      ['without an expiry', () => JSON.stringify({ roomId: ROOM_ID, playerSecret: FIRST_SECRET })],
      ['with an extra field', () => JSON.stringify({ ...valid(), seat: 'P1' })],
      ['under the key of another room', () => JSON.stringify({ ...valid(), roomId: NEXT_ROOM_ID })],
      ['with a malformed secret', () => JSON.stringify({ ...valid(), playerSecret: 'not-a-secret' })],
      ['with an expiry that is not a number', () => JSON.stringify({ ...valid(), expiresAt: String(Date.now() + 1) })],
      ['that has expired', () => JSON.stringify({ ...valid(), expiresAt: Date.now() })],
      [
        'with an expiry beyond SESSION_STORE_TTL_MS',
        () => JSON.stringify({ ...valid(), expiresAt: Date.now() + SESSION_STORE_TTL_MS + 60_000 }),
      ],
    ])('drops an entry %s', (_, value) => {
      localStorage.setItem(`${SESSION_KEY_PREFIX}${ROOM_ID}`, value());
      sessionStorage.setItem(CURRENT_ROOM_KEY, ROOM_ID);

      reload();

      expect(store.get(ROOM_ID)).toBeNull();
      expect(store.current()).toBeNull();
      expect(storedEntry(ROOM_ID)).toBeNull();
    });

    it('keeps a well-formed entry and leaves the keys of others alone', () => {
      localStorage.setItem(`${SESSION_KEY_PREFIX}${ROOM_ID}`, JSON.stringify(valid()));
      localStorage.setItem('someone-else', 'x');

      reload();

      expect(store.get(ROOM_ID)).toEqual({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      expect(localStorage.getItem('someone-else')).toBe('x');
    });

    it('drops a malformed current room', () => {
      localStorage.setItem(`${SESSION_KEY_PREFIX}${ROOM_ID}`, JSON.stringify(valid()));
      // A letter outside ROOM_ID_ALPHABET.
      sessionStorage.setItem(CURRENT_ROOM_KEY, `${ROOM_ID.slice(0, -1)}o`);

      reload();

      expect(store.current()).toBeNull();
      expect(sessionStorage.getItem(CURRENT_ROOM_KEY)).toBeNull();
      expect(store.enter(ROOM_ID)).toBe(true);
    });

    it('works in memory for the tab when the browser refuses storage', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Blocked', 'SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Full', 'QuotaExceededError');
      });
      reload();

      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });

      expect(store.current()).toEqual({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
    });
  });

  describe('refuse', () => {
    it('drops the refused credentials, leaves the room and remembers the refusal', () => {
      store.save({ roomId: NEXT_ROOM_ID, playerSecret: SECOND_SECRET });
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      const wasRefused = computed(() => store.wasRefused(ROOM_ID));
      expect(wasRefused()).toBe(false);

      store.refuse(ROOM_ID);

      expect(wasRefused()).toBe(true);
      expect(store.get(ROOM_ID)).toBeNull();
      expect(store.current()).toBeNull();
      expect(storedEntry(ROOM_ID)).toBeNull();
      expect(sessionStorage.getItem(CURRENT_ROOM_KEY)).toBeNull();
      expect(store.wasRefused(NEXT_ROOM_ID)).toBe(false);
      expect(store.get(NEXT_ROOM_ID)).not.toBeNull();
    });

    it('keeps the current room when another room is refused', () => {
      store.save({ roomId: NEXT_ROOM_ID, playerSecret: SECOND_SECRET });
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });

      store.refuse(NEXT_ROOM_ID);

      expect(store.current()?.roomId).toBe(ROOM_ID);
    });
  });
  describe('refusal and forget (#25, ADR-0076)', () => {
    it('remembers when the refused seat was taken', () => {
      vi.useFakeTimers();
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
      const takenAt = Date.now();
      vi.advanceTimersByTime(60_000);

      store.refuse(ROOM_ID);

      expect(store.refusal(ROOM_ID)).toEqual({ seatTakenAt: takenAt });
      expect(store.refusal(NEXT_ROOM_ID)).toBeNull();
    });

    it('remembers a refusal of credentials it no longer held, without a time', () => {
      store.refuse(ROOM_ID);

      expect(store.refusal(ROOM_ID)).toEqual({ seatTakenAt: null });
    });

    it('drops the credentials of a room left with LEAVE_ROOM, and leaves the room, without a refusal', () => {
      store.save({ roomId: NEXT_ROOM_ID, playerSecret: SECOND_SECRET });
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });

      store.forget(ROOM_ID);

      expect(store.get(ROOM_ID)).toBeNull();
      expect(localStorage.getItem(`${SESSION_KEY_PREFIX}${ROOM_ID}`)).toBeNull();
      expect(store.current()).toBeNull();
      expect(sessionStorage.getItem(CURRENT_ROOM_KEY)).toBeNull();
      expect(store.wasRefused(ROOM_ID)).toBe(false);
      expect(store.get(NEXT_ROOM_ID)).not.toBeNull();
    });

    it('keeps the current room when another room is forgotten', () => {
      store.save({ roomId: NEXT_ROOM_ID, playerSecret: SECOND_SECRET });
      store.save({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });

      store.forget(NEXT_ROOM_ID);

      expect(store.current()).toEqual({ roomId: ROOM_ID, playerSecret: FIRST_SECRET });
    });
  });
});
