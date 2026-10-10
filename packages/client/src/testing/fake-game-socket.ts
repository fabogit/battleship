import { signal, type Provider } from '@angular/core';
import {
  DEFAULT_RULES,
  GAME_OVER_REASONS,
  PLACEMENT_TIME_LIMIT_MS,
  ROOM_PHASES,
  SEATS,
  type BattleSnapshot,
  type GameOverSnapshot,
  type PlacementSnapshot,
  type PlayerStateSnapshot,
  type ServerToClientEvents,
} from '@battleship/core';
import { vi } from 'vitest';

import { CONNECTION_STATUSES, GameSocketService, type ConnectionStatus } from '../app/core/game-socket';

/** A server-event listener, widened so one map can hold every event's listeners. */
type AnyListener = (payload: never) => void;

/**
 * Stands in for `GameSocketService` in component and service tests: `status` is a writable signal, `emitWithAck` a mock
 * the test resolves, and `fire` delivers a server event to the listeners registered with `on`.
 */
export class FakeGameSocket {
  /** Connected by default; tests set it to see the waiting states. */
  readonly status = signal<ConnectionStatus>(CONNECTION_STATUSES.CONNECTED);
  /** Records calls; does not change `status`. */
  readonly connect = vi.fn<() => void>();
  /** Resolve it with `mockResolvedValue` to answer a command. */
  readonly emitWithAck = vi.fn<GameSocketService['emitWithAck']>();
  /** Listeners by event name. */
  private readonly listeners = new Map<string, Set<AnyListener>>();

  /**
   * Registers a listener, like `GameSocketService.on`.
   * @param event The server event.
   * @param listener Called by `fire`.
   * @returns Removes the listener.
   */
  on<E extends keyof ServerToClientEvents>(event: E, listener: ServerToClientEvents[E]): () => void {
    const listeners = this.listeners.get(event) ?? new Set<AnyListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  /**
   * Delivers a server event to its listeners, as the server would.
   * @param event The server event.
   * @param payload Its payload.
   */
  fire<E extends keyof ServerToClientEvents>(event: E, payload: Parameters<ServerToClientEvents[E]>[0]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (payload: Parameters<ServerToClientEvents[E]>[0]) => void)(payload);
    }
  }
}

/**
 * Provides a fake in place of `GameSocketService`.
 * @param fake The fake the test drives.
 * @returns The provider.
 */
export function provideFakeGameSocket(fake: FakeGameSocket): Provider {
  return { provide: GameSocketService, useValue: fake };
}

/**
 * A snapshot of a room waiting for its second player, seen by its creator.
 * @param roomId Any well-formed id; specs use the one their route or store expects.
 * @param nickname The creator's nickname.
 * @returns A new snapshot on every call, from the creator's side (`me` is `P1`).
 */
export function waitingSnapshot(roomId: string, nickname = 'Ada'): PlayerStateSnapshot {
  return {
    roomId,
    phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
    me: { seat: SEATS.P1, nickname, isConnected: true, forfeitRemainingMs: null },
    opponent: null,
    rules: DEFAULT_RULES,
    rulesVersion: 0,
    hasConfirmedRules: { me: false, opponent: false },
    placement: null,
    battle: null,
    gameOver: null,
  };
}

/**
 * A snapshot of a room in `PLACEMENT`, seen by its creator Ada playing against Grace; both fleets start empty and
 * unconfirmed.
 * @param roomId Any well-formed id; specs use the one their route or store expects.
 * @param placement Fields of the `PLACEMENT` part to override.
 * @returns A new snapshot on every call, from the creator's side (`me` is `P1`).
 */
export function placementSnapshot(roomId: string, placement: Partial<PlacementSnapshot> = {}): PlayerStateSnapshot {
  return {
    ...waitingSnapshot(roomId, 'Ada'),
    phase: ROOM_PHASES.PLACEMENT,
    opponent: { seat: SEATS.P2, nickname: 'Grace', isConnected: true, forfeitRemainingMs: null },
    hasConfirmedRules: { me: true, opponent: true },
    placement: {
      myShips: [],
      hasConfirmed: { me: false, opponent: false },
      remainingMs: PLACEMENT_TIME_LIMIT_MS,
      startCountdownMs: null,
      ...placement,
    },
  };
}

/**
 * A snapshot of a room in `IN_PROGRESS`, seen by its creator Ada playing against Grace: no shots yet, Ada's turn.
 * @param roomId Any well-formed id; specs use the one their route or store expects.
 * @param battle Fields of the `IN_PROGRESS` part to override.
 * @returns A new snapshot on every call, from the creator's side (`me` is `P1`).
 */
export function battleSnapshot(roomId: string, battle: Partial<BattleSnapshot> = {}): PlayerStateSnapshot {
  return {
    ...placementSnapshot(roomId),
    phase: ROOM_PHASES.IN_PROGRESS,
    placement: null,
    battle: {
      myShips: [],
      incomingShots: [],
      outgoingShots: [],
      currentTurn: SEATS.P1,
      shotsAllowed: 1,
      myDraftTargets: [],
      turnRemainingMs: null,
      isPaused: false,
      afkCount: { me: 0, opponent: 0 },
      ...battle,
    },
  };
}

/**
 * A snapshot of a room in `GAME_OVER`, seen by its creator Ada: by default she sank Grace's fleet, which is empty.
 * @param roomId Any well-formed id; specs use the one their route or store expects.
 * @param gameOver Fields of the `GAME_OVER` part to override.
 * @returns A new snapshot on every call, from the creator's side (`me` is `P1`).
 */
export function gameOverSnapshot(roomId: string, gameOver: Partial<GameOverSnapshot> = {}): PlayerStateSnapshot {
  return {
    ...placementSnapshot(roomId),
    phase: ROOM_PHASES.GAME_OVER,
    placement: null,
    gameOver: {
      winner: SEATS.P1,
      reason: GAME_OVER_REASONS.FLEET_DESTROYED,
      opponentShips: [],
      rematch: { me: null, opponent: null },
      ...gameOver,
    },
  };
}
