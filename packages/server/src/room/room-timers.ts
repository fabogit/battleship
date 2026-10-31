// The timers attached to open rooms (ADR-0065): at most one per room and kind, all stopped with the room.

import type { Clock, Timer } from '../clock.js';

/** What a room timer is for. The turn timer (#30) joins this set when it lands. */
export const ROOM_TIMER_KINDS = {
  /**
   * Forfeits the seat away longest, `DISCONNECT_FORFEIT_MS` after it lost its last socket; one timer per room, at the
   * earliest deadline of its two seats (docs/server.md#seat-presence, ADR-0072).
   */
  DISCONNECT_FORFEIT: 'DISCONNECT_FORFEIT',
  /** Removes a room `GAME_OVER_TTL_MS` after its match ended (docs/server.md#room-lifecycle). */
  GAME_OVER: 'GAME_OVER',
  /**
   * Ends placement and starts the match: at the end of the start countdown while both fleets are confirmed, at the
   * deadline otherwise, where unconfirmed fleets are completed first (docs/server.md#placement, ADR-0090).
   */
  PLACEMENT: 'PLACEMENT',
  /**
   * Removes a room nobody joins, `WAITING_TTL_MS` after it entered `WAITING_FOR_OPPONENT`: at creation, or when a seat
   * was freed before the match (docs/server.md#room-lifecycle, ADR-0096).
   */
  WAITING_FOR_OPPONENT: 'WAITING_FOR_OPPONENT',
} as const;

/** One of the `ROOM_TIMER_KINDS`. */
export type RoomTimerKind = (typeof ROOM_TIMER_KINDS)[keyof typeof ROOM_TIMER_KINDS];

/**
 * The pending timers of every room, keyed by room id and kind, over an injected `Clock`. Starting a kind that is
 * already running replaces it, so a room never has two timers of one kind; a timer is forgotten before its task runs,
 * so the task may start the same kind again (a repeating timer).
 */
export class RoomTimers {
  /** Where deadlines are scheduled. */
  readonly #clock: Clock;
  /** The pending timers, by room id, then by kind. */
  readonly #timers = new Map<string, Map<RoomTimerKind, Timer>>();

  /**
   * Starts with no timers.
   * @param clock The server's clock; tests pass a fake one.
   */
  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /**
   * Schedules a room's timer of one kind, cancelling the one it replaces.
   * @param roomId The room the timer belongs to.
   * @param kind What the timer is for.
   * @param at The deadline in epoch ms.
   * @param task Runs once at the deadline unless the timer is stopped or replaced first.
   */
  start(roomId: string, kind: RoomTimerKind, at: number, task: () => void): void {
    this.stop(roomId, kind);
    let kinds = this.#timers.get(roomId);
    if (kinds === undefined) {
      kinds = new Map();
      this.#timers.set(roomId, kinds);
    }
    kinds.set(
      kind,
      this.#clock.scheduleAt(at, () => {
        this.#forget(roomId, kind);
        task();
      }),
    );
  }

  /**
   * Whether a room has a pending timer of one kind.
   * @param roomId The room to look at; any string is safe.
   * @param kind The kind of timer.
   * @returns `true` from `start` until the timer runs or is stopped.
   */
  isRunning(roomId: string, kind: RoomTimerKind): boolean {
    return this.#timers.get(roomId)?.has(kind) ?? false;
  }

  /**
   * Cancels a room's timer of one kind; nothing happens when none is pending.
   * @param roomId The room the timer belongs to.
   * @param kind The kind of timer.
   */
  stop(roomId: string, kind: RoomTimerKind): void {
    this.#timers.get(roomId)?.get(kind)?.cancel();
    this.#forget(roomId, kind);
  }

  /**
   * Cancels every timer of a room, as when the room is removed.
   * @param roomId The room whose timers stop.
   */
  stopRoom(roomId: string): void {
    for (const timer of this.#timers.get(roomId)?.values() ?? []) {
      timer.cancel();
    }
    this.#timers.delete(roomId);
  }

  /** Cancels every timer of every room, as when the server closes. */
  stopAll(): void {
    for (const roomId of [...this.#timers.keys()]) {
      this.stopRoom(roomId);
    }
  }

  /**
   * Drops a room's timer of one kind from the map, and the room's entry once it has no timer left.
   * @param roomId The room the timer belongs to.
   * @param kind The kind of timer that ran or was cancelled.
   */
  #forget(roomId: string, kind: RoomTimerKind): void {
    const kinds = this.#timers.get(roomId);
    kinds?.delete(kind);
    if (kinds?.size === 0) {
      this.#timers.delete(roomId);
    }
  }
}
