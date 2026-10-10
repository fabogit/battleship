import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  GAME_OVER_REASONS,
  ORIENTATIONS,
  PLACEMENT_TIME_LIMIT_MS,
  ROOM_PHASES,
  SEATS,
  SERVER_EVENTS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  START_COUNTDOWN_MS,
  toPlacedShip,
  type BattleSnapshot,
  type GameOverSnapshot,
  type PlacementSnapshot,
  type PlayerStateSnapshot,
  type PlayerView,
  type ShotResolvedPayload,
  type ShotResult,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameSocketService } from './game-socket';
import { COUNTDOWN_TICK_MS, GameStateService } from './game-state';

const ME: PlayerView = { seat: SEATS.P1, nickname: 'Ada', isConnected: true, forfeitRemainingMs: null };
const OPPONENT: PlayerView = { seat: SEATS.P2, nickname: 'Grace', isConnected: true, forfeitRemainingMs: null };
const OPPONENT_AWAY: PlayerView = { ...OPPONENT, isConnected: false, forfeitRemainingMs: DISCONNECT_FORFEIT_MS };

const MY_SHIPS = [
  toPlacedShip({ type: SHIP_TYPES.DESTROYER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.HORIZONTAL }),
  toPlacedShip({ type: SHIP_TYPES.CARRIER, start: { x: 0, y: 2 }, orientation: ORIENTATIONS.VERTICAL }),
];
const SUNK_DESTROYER = toPlacedShip({
  type: SHIP_TYPES.DESTROYER,
  start: { x: 5, y: 5 },
  orientation: ORIENTATIONS.VERTICAL,
});
const OUTGOING: readonly ShotResult[] = [
  { coordinate: { x: 9, y: 9 }, outcome: SHOT_OUTCOMES.MISS },
  { coordinate: { x: 5, y: 5 }, outcome: SHOT_OUTCOMES.HIT },
  { coordinate: { x: 5, y: 6 }, outcome: SHOT_OUTCOMES.SUNK, sunkShip: SUNK_DESTROYER },
];
const INCOMING: readonly ShotResult[] = [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.HIT }];

function waiting(): PlayerStateSnapshot {
  return {
    roomId: 'abcd2345',
    phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
    me: ME,
    opponent: null,
    rules: DEFAULT_RULES,
    rulesVersion: 0,
    hasConfirmedRules: { me: false, opponent: false },
    placement: null,
    battle: null,
    gameOver: null,
  };
}

function placement(overrides: Partial<PlacementSnapshot> = {}): PlayerStateSnapshot {
  return {
    ...waiting(),
    phase: ROOM_PHASES.PLACEMENT,
    opponent: OPPONENT,
    hasConfirmedRules: { me: true, opponent: true },
    placement: {
      myShips: MY_SHIPS,
      hasConfirmed: { me: false, opponent: false },
      remainingMs: PLACEMENT_TIME_LIMIT_MS,
      startCountdownMs: null,
      ...overrides,
    },
  };
}

function battle(overrides: Partial<BattleSnapshot> = {}, opponent: PlayerView = OPPONENT): PlayerStateSnapshot {
  return {
    ...waiting(),
    phase: ROOM_PHASES.IN_PROGRESS,
    opponent,
    hasConfirmedRules: { me: true, opponent: true },
    battle: {
      myShips: MY_SHIPS,
      incomingShots: INCOMING,
      outgoingShots: OUTGOING,
      currentTurn: SEATS.P1,
      shotsAllowed: 1,
      myDraftTargets: [{ x: 3, y: 3 }],
      turnRemainingMs: 30_000,
      isPaused: false,
      afkCount: { me: 0, opponent: 0 },
      ...overrides,
    },
  };
}

function gameOver(overrides: Partial<GameOverSnapshot> = {}): PlayerStateSnapshot {
  return {
    ...waiting(),
    phase: ROOM_PHASES.GAME_OVER,
    opponent: OPPONENT,
    hasConfirmedRules: { me: true, opponent: true },
    gameOver: {
      winner: SEATS.P1,
      reason: GAME_OVER_REASONS.FLEET_DESTROYED,
      opponentShips: [SUNK_DESTROYER],
      rematch: { me: null, opponent: null },
      ...overrides,
    },
  };
}

let receiveState: ((snapshot: PlayerStateSnapshot) => void) | undefined;
let receiveShots: ((payload: ShotResolvedPayload) => void) | undefined;
let state: GameStateService;

/** Delivers a `STATE` as the server would. */
function receive(snapshot: PlayerStateSnapshot): void {
  if (receiveState === undefined) {
    throw new Error('GameStateService is not listening to STATE');
  }
  receiveState(snapshot);
}

/** Delivers a `SHOT_RESOLVED` as the server would. */
function resolve(payload: ShotResolvedPayload): void {
  if (receiveShots === undefined) {
    throw new Error('GameStateService is not listening to SHOT_RESOLVED');
  }
  receiveShots(payload);
}

beforeEach(() => {
  vi.useFakeTimers();
  receiveState = undefined;
  receiveShots = undefined;
  const socket = {
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      if (event === SERVER_EVENTS.STATE) {
        receiveState = listener;
        return () => {
          receiveState = undefined;
        };
      }
      if (event === SERVER_EVENTS.SHOT_RESOLVED) {
        receiveShots = listener;
        return () => {
          receiveShots = undefined;
        };
      }
      return () => undefined;
    }),
  };
  TestBed.configureTestingModule({ providers: [{ provide: GameSocketService, useValue: socket }] });
  state = TestBed.inject(GameStateService);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GameStateService', () => {
  describe('views', () => {
    it('has nothing to show before the first snapshot', () => {
      expect(state.snapshot()).toBeNull();
      expect(state.phase()).toBeNull();
      expect(state.isMyTurn()).toBe(false);
      expect(state.myFleet()).toBeNull();
      expect(state.trackingBoard()).toBeNull();
      expect(state.canPause()).toBe(false);
      expect(state.canResume()).toBe(false);
      expect(state.hasWon()).toBeNull();
    });

    it('stores every snapshot the server sends', () => {
      const snapshot = waiting();

      receive(snapshot);

      expect(state.snapshot()).toBe(snapshot);
      expect(state.phase()).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
      expect(state.myFleet()).toBeNull();
      expect(state.trackingBoard()).toBeNull();
    });

    it('shows the draft fleet without shots during placement', () => {
      receive(placement());

      expect(state.myFleet()).toEqual({ ships: MY_SHIPS, shots: [] });
      expect(state.trackingBoard()).toBeNull();
      expect(state.isMyTurn()).toBe(false);
    });

    it('shows both boards in battle, with only the sunk ships of the opponent', () => {
      receive(battle());

      expect(state.myFleet()).toEqual({ ships: MY_SHIPS, shots: INCOMING });
      expect(state.trackingBoard()).toEqual({
        ships: [SUNK_DESTROYER],
        shots: OUTGOING,
        draftTargets: [{ x: 3, y: 3 }],
      });
    });

    it('tells whose turn it is', () => {
      receive(battle({ currentTurn: SEATS.P1 }));
      expect(state.isMyTurn()).toBe(true);

      receive(battle({ currentTurn: SEATS.P2, myDraftTargets: [] }));
      expect(state.isMyTurn()).toBe(false);
    });

    it('allows pausing and resuming only while the opponent is disconnected', () => {
      receive(battle());
      expect([state.canPause(), state.canResume()]).toEqual([false, false]);

      receive(battle({ isPaused: false }, OPPONENT_AWAY));
      expect([state.canPause(), state.canResume()]).toEqual([true, false]);

      receive(battle({ isPaused: true }, OPPONENT_AWAY));
      expect([state.canPause(), state.canResume()]).toEqual([false, true]);

      receive({ ...placement(), opponent: OPPONENT_AWAY });
      expect([state.canPause(), state.canResume()]).toEqual([false, false]);
    });

    it('reveals the opponent fleet without shots at game over when the battle was not seen here', () => {
      receive(gameOver());

      expect(state.myFleet()).toBeNull();
      expect(state.trackingBoard()).toEqual({ ships: [SUNK_DESTROYER], shots: [], draftTargets: [] });
    });

    it('keeps both boards for game over, with the shot that ended the match', () => {
      const finalShot: ShotResult = { coordinate: { x: 4, y: 4 }, outcome: SHOT_OUTCOMES.MISS };
      receive(battle());
      resolve({ shooter: SEATS.P2, results: [finalShot] });

      receive(gameOver({ winner: SEATS.P2 }));

      expect(state.myFleet()).toEqual({ ships: MY_SHIPS, shots: [...INCOMING, finalShot] });
      expect(state.trackingBoard()).toEqual({ ships: [SUNK_DESTROYER], shots: OUTGOING, draftTargets: [] });
    });

    it("adds the receiver's own final shot to the revealed fleet", () => {
      const finalShot: ShotResult = { coordinate: { x: 5, y: 7 }, outcome: SHOT_OUTCOMES.MISS };
      receive(battle());
      resolve({ shooter: SEATS.P1, results: [finalShot] });

      receive(gameOver());

      expect(state.trackingBoard()?.shots).toEqual([...OUTGOING, finalShot]);
      expect(state.myFleet()?.shots).toEqual(INCOMING);
    });

    it('lets each battle snapshot replace the shots added since the previous one', () => {
      receive(battle({ outgoingShots: [] }));
      resolve({ shooter: SEATS.P1, results: OUTGOING });

      receive(battle());
      receive(gameOver());

      expect(state.trackingBoard()?.shots).toEqual(OUTGOING);
    });

    it("forgets the battle record in another phase or another room's game over", () => {
      receive(battle());
      receive({ ...gameOver(), roomId: 'wxyz6789' });
      expect(state.myFleet()).toBeNull();

      receive(battle());
      receive(placement());
      receive(gameOver());
      expect(state.myFleet()).toBeNull();
      expect(state.trackingBoard()?.shots).toEqual([]);

      resolve({ shooter: SEATS.P1, results: OUTGOING });
      expect(state.trackingBoard()?.shots).toEqual([]);
    });

    it('tells whether the receiver won', () => {
      receive(gameOver({ winner: SEATS.P1 }));
      expect(state.hasWon()).toBe(true);

      receive(gameOver({ winner: SEATS.P2, reason: GAME_OVER_REASONS.SURRENDER }));
      expect(state.hasWon()).toBe(false);

      receive(gameOver({ winner: null, reason: GAME_OVER_REASONS.ABANDONED }));
      expect(state.hasWon()).toBe(false);
    });

    it('forgets the snapshot on clear()', () => {
      receive(battle());

      state.clear();

      expect(state.snapshot()).toBeNull();
      expect(state.turnRemainingMs()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      receive(gameOver());
      expect(state.myFleet()).toBeNull();
    });
  });

  describe('countdowns', () => {
    it('counts the turn down locally from the remaining time in the snapshot', () => {
      receive(battle({ turnRemainingMs: 30_000 }));
      expect(state.turnRemainingMs()).toBe(30_000);

      vi.advanceTimersByTime(1_000);
      expect(state.turnRemainingMs()).toBe(29_000);

      vi.advanceTimersByTime(COUNTDOWN_TICK_MS);
      expect(state.turnRemainingMs()).toBe(28_750);
    });

    it('re-syncs to every snapshot instead of trusting the local count', () => {
      receive(battle({ turnRemainingMs: 30_000 }));
      vi.advanceTimersByTime(3_000);
      expect(state.turnRemainingMs()).toBe(27_000);

      // The server's clock ran faster: its next snapshot wins.
      receive(battle({ turnRemainingMs: 25_000 }));
      expect(state.turnRemainingMs()).toBe(25_000);

      vi.advanceTimersByTime(1_000);
      expect(state.turnRemainingMs()).toBe(24_000);
    });

    it('stops at zero and stops ticking', () => {
      receive(battle({ turnRemainingMs: 1_000 }));

      vi.advanceTimersByTime(5_000);

      expect(state.turnRemainingMs()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('holds the turn still while paused, but not the forfeit clock', () => {
      receive(battle({ turnRemainingMs: 12_000, isPaused: true }, OPPONENT_AWAY));

      vi.advanceTimersByTime(10_000);

      expect(state.turnRemainingMs()).toBe(12_000);
      expect(state.opponentForfeitRemainingMs()).toBe(DISCONNECT_FORFEIT_MS - 10_000);
    });

    it('has no turn countdown during the dice animation', () => {
      receive(battle({ turnRemainingMs: null }));

      expect(state.turnRemainingMs()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('runs the placement deadline and the start countdown side by side', () => {
      receive(placement({ remainingMs: 20_000, startCountdownMs: START_COUNTDOWN_MS }));

      vi.advanceTimersByTime(2_000);

      expect(state.placementRemainingMs()).toBe(18_000);
      expect(state.startCountdownMs()).toBe(START_COUNTDOWN_MS - 2_000);
      expect(state.turnRemainingMs()).toBeNull();
    });

    it('drops countdowns that the next snapshot no longer carries', () => {
      receive(placement({ startCountdownMs: START_COUNTDOWN_MS }));

      // The opponent unlocked their fleet: the start countdown is cancelled.
      receive(placement({ startCountdownMs: null }));

      expect(state.startCountdownMs()).toBeNull();
      expect(state.placementRemainingMs()).toBe(PLACEMENT_TIME_LIMIT_MS);
    });

    it('does not tick when no countdown is running', () => {
      receive(waiting());

      expect(state.opponentForfeitRemainingMs()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('stops listening and ticking when the injector is destroyed', () => {
    receive(battle());

    TestBed.resetTestingModule();

    expect(receiveState).toBeUndefined();
    expect(receiveShots).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
