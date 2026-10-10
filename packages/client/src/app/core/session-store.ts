import { Service, signal } from '@angular/core';
import type { SessionCredentials } from '@battleship/core';

/**
 * Keeps the credentials of the rooms this tab created or joined, one per room (docs/server.md#sessions--reconnection).
 * In memory only: #21 stores them in `localStorage` with an expiry (ADR-0013) and sends them in the handshake, so until
 * then a reload forgets the seat. Reads are reactive, so views can tell a seated player from a visitor.
 */
@Service()
export class SessionStore {
  /** The credentials by room id; replaced, never mutated, so readers are notified. */
  private readonly sessions = signal<ReadonlyMap<string, SessionCredentials>>(new Map());

  /**
   * Stores the credentials returned by `CREATE_ROOM` or `JOIN_ROOM`, replacing any earlier ones for the same room.
   * @param credentials The room id and the seat's secret.
   */
  save(credentials: SessionCredentials): void {
    this.sessions.update((sessions) => new Map(sessions).set(credentials.roomId, credentials));
  }

  /**
   * Looks up the credentials of a room; tracked when read inside a `computed` or a template.
   * @param roomId Any id, such as the one in the address.
   * @returns The stored credentials, or `null` when this tab holds no seat in that room.
   */
  get(roomId: string): SessionCredentials | null {
    return this.sessions().get(roomId) ?? null;
  }
}
