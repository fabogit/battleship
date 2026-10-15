import { Service, signal } from '@angular/core';
import { SESSION_STORE_TTL_MS, isRoomId, parseSessionCredentials, type SessionCredentials } from '@battleship/core';

/** Prefix of the `localStorage` key of one room's credentials, followed by the room id (ADR-0069). */
export const SESSION_KEY_PREFIX = 'battleship:session:';

/** The `sessionStorage` key of the room this tab is in now (ADR-0069). */
export const CURRENT_ROOM_KEY = 'battleship:current-room';

/** The credentials of one room as `localStorage` holds them, JSON-encoded. */
interface StoredSession extends SessionCredentials {
  /** `Date.now()` after which the entry is dropped, in ms: `SESSION_STORE_TTL_MS` after it was saved (ADR-0013). */
  readonly expiresAt: number;
}

/** What the store remembers of credentials the server refused (`SESSION_INVALID`), for the room page (ADR-0075). */
export interface RefusedSeat {
  /**
   * When the refused credentials were saved, which is when their seat was taken, in epoch ms; `null` when the store no
   * longer held them. A server that started after it cannot have known the room: it restarted (ADR-0075).
   */
  readonly seatTakenAt: number | null;
}

/**
 * Keeps the credentials of the rooms this browser created or joined, one `localStorage` entry per room with an expiry
 * (ADR-0013), and which of them this tab is in now, in `sessionStorage` (ADR-0069). The socket follows only the room of
 * the last accepted command (ADR-0045), and the handshake sends that room's credentials
 * (docs/server.md#sessions--reconnection). Both are read once, when the app starts, and treated as untrusted: a
 * malformed or expired entry is removed. Storage that throws (blocked, full) leaves the store working in memory for the
 * tab. Reads are reactive, so views can tell a seated player from a visitor.
 */
@Service()
export class SessionStore {
  /** The credentials by room id, as read at start and saved since; replaced, never mutated. */
  private readonly sessions = signal<ReadonlyMap<string, StoredSession>>(readSessions());
  /** The room this tab is in now; `null` in a tab that has not created, joined or reopened a room. */
  private readonly currentRoomId = signal<string | null>(readCurrentRoomId());
  /** Rooms whose credentials the server refused (`SESSION_INVALID`) since the app started, with what is known of them. */
  private readonly refusedSeats = signal<ReadonlyMap<string, RefusedSeat>>(new Map());

  /**
   * Stores the credentials returned by `CREATE_ROOM` or `JOIN_ROOM` for `SESSION_STORE_TTL_MS`, replacing any earlier
   * ones for the same room, and makes their room the current one.
   * @param credentials The room id and the seat's secret.
   */
  save(credentials: SessionCredentials): void {
    const session: StoredSession = { ...credentials, expiresAt: Date.now() + SESSION_STORE_TTL_MS };
    writeItem(localStorageOrNull(), sessionKey(session.roomId), JSON.stringify(session));
    this.sessions.update((sessions) => new Map(sessions).set(session.roomId, session));
    this.setCurrentRoomId(session.roomId);
  }

  /**
   * Looks up the credentials of a room; tracked when read inside a `computed` or a template.
   * @param roomId Any id, such as the one in the address.
   * @returns The stored credentials, or `null` when this browser holds no unexpired seat in that room.
   */
  get(roomId: string): SessionCredentials | null {
    const session = this.sessions().get(roomId);
    return session === undefined || session.expiresAt <= Date.now()
      ? null
      : { roomId: session.roomId, playerSecret: session.playerSecret };
  }

  /**
   * Reads the credentials the handshake sends: those of the current room, while they have not expired.
   * @returns The credentials, or `null` when this tab is in no room.
   */
  current(): SessionCredentials | null {
    const roomId = this.currentRoomId();
    return roomId === null ? null : this.get(roomId);
  }

  /**
   * Makes a room the current one in a tab that is in no room yet, such as a new tab opened on a room link: the
   * handshake then sends its credentials. A tab that is in another room stays there (`hasLeft`).
   * @param roomId Any id, such as the one in the address.
   * @returns Whether the room became the current one: credentials are stored for it and the tab was in no room.
   */
  enter(roomId: string): boolean {
    if (this.currentRoomId() !== null || this.get(roomId) === null) {
      return false;
    }
    this.setCurrentRoomId(roomId);
    return true;
  }

  /**
   * Tells whether this tab held a seat in a room and has entered another room since: the server no longer sends it
   * that room's `STATE`. Tracked when read inside a `computed` or a template.
   * @param roomId Any id, such as the one in the address.
   * @returns Whether credentials are stored for the room and the tab is in another one.
   */
  hasLeft(roomId: string): boolean {
    const currentRoomId = this.currentRoomId();
    return this.get(roomId) !== null && currentRoomId !== null && currentRoomId !== roomId;
  }

  /**
   * Drops the credentials of a room after the server refused them with `SESSION_INVALID`: the room is gone, or no seat
   * holds the secret. The tab is then in no room, and `refusal` remembers when the seat had been taken.
   * @param roomId The room of the refused credentials.
   */
  refuse(roomId: string): void {
    const session = this.sessions().get(roomId);
    const seatTakenAt = session === undefined ? null : session.expiresAt - SESSION_STORE_TTL_MS;
    this.forget(roomId);
    this.refusedSeats.update((seats) => new Map(seats).set(roomId, { seatTakenAt }));
  }

  /**
   * Drops the credentials of a room the player left with `LEAVE_ROOM`: the server freed the seat, so its secret is
   * worthless (docs/server.md#leaving). The tab is then in no room, if it was in this one.
   * @param roomId The room left.
   */
  forget(roomId: string): void {
    removeItem(localStorageOrNull(), sessionKey(roomId));
    this.sessions.update((sessions) => {
      const remaining = new Map(sessions);
      remaining.delete(roomId);
      return remaining;
    });
    if (this.currentRoomId() === roomId) {
      this.setCurrentRoomId(null);
    }
  }

  /**
   * Tells whether the server refused this room's credentials since the app started. Tracked when read inside a
   * `computed` or a template.
   * @param roomId Any id, such as the one in the address.
   * @returns Whether `refuse` was called for the room.
   */
  wasRefused(roomId: string): boolean {
    return this.refusedSeats().has(roomId);
  }

  /**
   * Looks up a refusal of this room's credentials since the app started. Tracked when read inside a `computed` or a
   * template.
   * @param roomId Any id, such as the one in the address.
   * @returns What `refuse` remembered, or `null` when the room's credentials were not refused.
   */
  refusal(roomId: string): RefusedSeat | null {
    return this.refusedSeats().get(roomId) ?? null;
  }

  /**
   * Sets the current room in memory and in `sessionStorage`.
   * @param roomId The room, or `null` for none.
   */
  private setCurrentRoomId(roomId: string | null): void {
    if (roomId === null) {
      removeItem(sessionStorageOrNull(), CURRENT_ROOM_KEY);
    } else {
      writeItem(sessionStorageOrNull(), CURRENT_ROOM_KEY, roomId);
    }
    this.currentRoomId.set(roomId);
  }
}

/**
 * Builds the `localStorage` key of a room's credentials.
 * @param roomId A well-formed room id.
 * @returns `SESSION_KEY_PREFIX` followed by the id.
 */
function sessionKey(roomId: string): string {
  return `${SESSION_KEY_PREFIX}${roomId}`;
}

/**
 * Reads every credentials entry from `localStorage`, removing the malformed and expired ones.
 * @returns The valid entries by room id; empty when storage is unavailable.
 */
function readSessions(): ReadonlyMap<string, StoredSession> {
  const sessions = new Map<string, StoredSession>();
  const storage = localStorageOrNull();
  if (storage === null) {
    return sessions;
  }
  try {
    // Collected first: removing an entry while walking the keys would shift their indexes.
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => key?.startsWith(SESSION_KEY_PREFIX) === true,
    );
    for (const key of keys) {
      const session = parseStoredSession(key.slice(SESSION_KEY_PREFIX.length), storage.getItem(key));
      if (session === null) {
        storage.removeItem(key);
      } else {
        sessions.set(session.roomId, session);
      }
    }
  } catch {
    // Storage that throws while it is read keeps what was read so far.
  }
  return sessions;
}

/**
 * Parses one credentials entry, written by this app or by anyone with access to the browser.
 * @param roomId The room id read from the entry's key.
 * @param value The entry's raw value.
 * @returns The entry, or `null` when it is not JSON, not exactly `{ roomId, playerSecret, expiresAt }` with the key's
 * room id, or expired; an expiry further away than `SESSION_STORE_TTL_MS` counts as malformed.
 */
function parseStoredSession(roomId: string, value: string | null): StoredSession | null {
  let parsed: unknown;
  try {
    parsed = value === null ? null : JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const { expiresAt, ...credentials } = parsed as Record<string, unknown>;
  const session = parseSessionCredentials(credentials);
  const now = Date.now();
  const isExpiryValid = typeof expiresAt === 'number' && expiresAt > now && expiresAt <= now + SESSION_STORE_TTL_MS;
  return session !== null && session.roomId === roomId && isExpiryValid ? { ...session, expiresAt } : null;
}

/**
 * Reads the current room from `sessionStorage`, removing a malformed value.
 * @returns A well-formed room id, or `null`.
 */
function readCurrentRoomId(): string | null {
  const storage = sessionStorageOrNull();
  try {
    const roomId = storage?.getItem(CURRENT_ROOM_KEY) ?? null;
    if (roomId !== null && !isRoomId(roomId)) {
      storage?.removeItem(CURRENT_ROOM_KEY);
      return null;
    }
    return roomId;
  } catch {
    return null;
  }
}

/**
 * Writes an item, ignoring storage that throws (blocked, or full): the store then keeps it in memory only.
 * @param storage `localStorage` or `sessionStorage`, or `null` when unavailable.
 * @param key Where to write.
 * @param value What to write.
 */
function writeItem(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Kept in memory for the tab.
  }
}

/**
 * Removes an item, ignoring storage that throws.
 * @param storage `localStorage` or `sessionStorage`, or `null` when unavailable.
 * @param key What to remove.
 */
function removeItem(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage that cannot be written holds nothing of this tab's.
  }
}

/**
 * Reaches `localStorage`, which throws on access when the browser blocks site data.
 * @returns `localStorage`, or `null` when it is blocked.
 */
function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reaches `sessionStorage`, which throws on access when the browser blocks site data.
 * @returns `sessionStorage`, or `null` when it is blocked.
 */
function sessionStorageOrNull(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}
