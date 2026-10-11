import { Service, signal } from '@angular/core';
import type { SessionCredentials } from '@battleship/core';

/**
 * Keeps the credentials of the rooms this tab created or joined, one per room (docs/server.md#sessions--reconnection),
 * and which of them the tab is in now: the socket follows only the room of the last accepted command (ADR-0045). In
 * memory only: #21 stores them in `localStorage` with an expiry (ADR-0013) and sends them in the handshake, so until
 * then a reload forgets the seat. Reads are reactive, so views can tell a seated player from a visitor.
 */
@Service()
export class SessionStore {
  /** The credentials by room id; replaced, never mutated, so readers are notified. */
  private readonly sessions = signal<ReadonlyMap<string, SessionCredentials>>(new Map());
  /** The room of the last saved credentials; `null` before the first. */
  private readonly currentRoomId = signal<string | null>(null);

  /**
   * Stores the credentials returned by `CREATE_ROOM` or `JOIN_ROOM`, replacing any earlier ones for the same room, and
   * makes their room the current one.
   * @param credentials The room id and the seat's secret.
   */
  save(credentials: SessionCredentials): void {
    this.sessions.update((sessions) => new Map(sessions).set(credentials.roomId, credentials));
    this.currentRoomId.set(credentials.roomId);
  }

  /**
   * Looks up the credentials of a room; tracked when read inside a `computed` or a template.
   * @param roomId Any id, such as the one in the address.
   * @returns The stored credentials, or `null` when this tab holds no seat in that room.
   */
  get(roomId: string): SessionCredentials | null {
    return this.sessions().get(roomId) ?? null;
  }

  /**
   * Tells whether this tab held a seat in a room and has entered another room since: the server no longer sends it
   * that room's `STATE`. Tracked when read inside a `computed` or a template.
   * @param roomId Any id, such as the one in the address.
   * @returns Whether credentials are stored for the room but it is not the current one.
   */
  hasLeft(roomId: string): boolean {
    return this.get(roomId) !== null && this.currentRoomId() !== roomId;
  }
}
