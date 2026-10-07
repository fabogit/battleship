import {
  CLIENT_EVENTS,
  createSeededRng,
  DEFAULT_RULES,
  GAME_OVER_REASONS,
  PLACEMENT_TIME_LIMIT_MS,
  randomTargets,
  ROOM_PHASES,
  SEATS,
  type Coordinate,
  type PlayerStateSnapshot,
  type Seat,
} from '@battleship/core';
import { describe, expect, it } from 'vitest';

import { otherSeat, type RoomState } from '../../src/room/room.js';
import { projectSnapshot } from '../../src/room/snapshot.js';
import {
  apply,
  battleRoom,
  cellsOf,
  fleet,
  NOW,
  P1_SECRET,
  P2_SECRET,
  placeAndConfirm,
  placementRoom,
  ROOM_ID,
  waitingRoom,
} from './fixtures.js';

/** Fields that describe the receiver's own board, where coordinates say nothing about the opponent's fleet. */
const OWN_BOARD_FIELDS = new Set(['myShips', 'incomingShots']);

function cellKey({ x, y }: Coordinate): string {
  return `${String(x)},${String(y)}`;
}

/** Every coordinate a snapshot carries outside the receiver's own board. */
function coordinatesAboutOpponent(value: unknown): Coordinate[] {
  if (Array.isArray(value)) {
    return value.flatMap(coordinatesAboutOpponent);
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const entries = Object.entries(value);
  const own = entries.length === 2 && 'x' in value && 'y' in value ? [value as Coordinate] : [];
  return [
    ...own,
    ...entries.filter(([key]) => !OWN_BOARD_FIELDS.has(key)).flatMap(([, child]) => coordinatesAboutOpponent(child)),
  ];
}

/**
 * Checks fog-of-war for one receiver: no cell of an opponent ship the receiver has not hit appears anywhere outside
 * their own board, and no secret appears at all.
 */
function expectFogOfWar(state: RoomState, seat: Seat): PlayerStateSnapshot {
  const snapshot = projectSnapshot(state, seat, NOW);
  const json = JSON.stringify(snapshot);
  expect(json).not.toContain(P1_SECRET);
  expect(json).not.toContain(P2_SECRET);
  if (state.phase === ROOM_PHASES.IN_PROGRESS) {
    const opponentBoard = state.battle.boards[otherSeat(seat)];
    const shot = new Set(opponentBoard.shots.map(({ coordinate }) => cellKey(coordinate)));
    const hidden = new Set(
      cellsOf(opponentBoard.ships)
        .map(cellKey)
        .filter((key) => !shot.has(key)),
    );
    const leaked = coordinatesAboutOpponent(snapshot).filter((coordinate) => hidden.has(cellKey(coordinate)));
    expect(leaked).toEqual([]);
  }
  return snapshot;
}

describe('projectSnapshot', () => {
  it('shows a waiting room to its creator, with no opponent', () => {
    expect(projectSnapshot(waitingRoom(), SEATS.P1, NOW)).toEqual({
      roomId: ROOM_ID,
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      me: { seat: SEATS.P1, nickname: 'Alice', isConnected: true, forfeitRemainingMs: null },
      opponent: null,
      rules: DEFAULT_RULES,
      rulesVersion: 0,
      hasConfirmedRules: { me: false, opponent: false },
      placement: null,
      battle: null,
      gameOver: null,
    });
  });

  it('throws for an empty seat', () => {
    expect(() => projectSnapshot(waitingRoom(), SEATS.P2, NOW)).toThrow(/Seat P2 .* is empty/);
  });

  it('shows only the receiver’s own fleet during placement', () => {
    const state = placeAndConfirm(
      apply(placementRoom(NOW), {
        type: CLIENT_EVENTS.UPDATE_PLACEMENT,
        seat: SEATS.P2,
        payload: { ships: fleet(2).slice(0, 3) },
      }),
      SEATS.P1,
      fleet(1),
    );
    const later = NOW + 10_000;
    const p2 = projectSnapshot(state, SEATS.P2, later);
    expect(p2).toMatchObject({
      phase: ROOM_PHASES.PLACEMENT,
      me: { seat: SEATS.P2, nickname: 'Bob' },
      opponent: { seat: SEATS.P1, nickname: 'Alice' },
      hasConfirmedRules: { me: true, opponent: true },
      battle: null,
      gameOver: null,
    });
    expect(p2.placement).toEqual({
      myShips: state.phase === ROOM_PHASES.PLACEMENT ? state.fleets.P2.ships : [],
      hasConfirmed: { me: false, opponent: true },
      remainingMs: PLACEMENT_TIME_LIMIT_MS - 10_000,
      startCountdownMs: null,
    });
    expect(coordinatesAboutOpponent(p2)).toEqual([]);
    expect(projectSnapshot(state, SEATS.P1, NOW + PLACEMENT_TIME_LIMIT_MS + 1).placement?.remainingMs).toBe(0);
  });

  it('shows the draft targets to the active player only', () => {
    const state = apply(battleRoom(), {
      type: CLIENT_EVENTS.UPDATE_TARGETS,
      seat: SEATS.P1,
      payload: { targets: [{ x: 2, y: 3 }] },
    });
    expect(projectSnapshot(state, SEATS.P1, NOW).battle).toMatchObject({
      currentTurn: SEATS.P1,
      shotsAllowed: 1,
      myDraftTargets: [{ x: 2, y: 3 }],
      turnRemainingMs: null,
      isPaused: false,
      afkCount: { me: 0, opponent: 0 },
    });
    expect(projectSnapshot(state, SEATS.P2, NOW).battle?.myDraftTargets).toEqual([]);
  });

  it('splits the boards into own fleet, incoming and outgoing shots', () => {
    const state = apply(
      apply(battleRoom(), { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [{ x: 9, y: 9 }] } }),
      {
        type: CLIENT_EVENTS.FIRE,
        seat: SEATS.P2,
        payload: { targets: [{ x: 0, y: 0 }] },
      },
    );
    if (state.phase !== ROOM_PHASES.IN_PROGRESS) {
      expect.fail('The match should still be on');
    }
    const p1 = projectSnapshot(state, SEATS.P1, NOW).battle;
    expect(p1?.myShips).toBe(state.battle.boards.P1.ships);
    expect(p1?.incomingShots).toEqual(state.battle.boards.P1.shots);
    expect(p1?.outgoingShots).toEqual(state.battle.boards.P2.shots);
    expect(p1?.outgoingShots.map((shot) => shot.coordinate)).toEqual([{ x: 9, y: 9 }]);
  });

  it('never shows un-hit opponent ships before game over, then reveals them', () => {
    const rng = createSeededRng(42);
    let state: RoomState = battleRoom();
    while (state.phase === ROOM_PHASES.IN_PROGRESS) {
      for (const seat of Object.values(SEATS)) {
        expectFogOfWar(state, seat);
      }
      const shooter = state.battle.currentTurn;
      state = apply(state, {
        type: CLIENT_EVENTS.FIRE,
        seat: shooter,
        payload: { targets: randomTargets(state.battle, 1, rng) },
      });
    }
    expect(state.phase).toBe(ROOM_PHASES.GAME_OVER);
    if (state.phase !== ROOM_PHASES.GAME_OVER) {
      return;
    }
    for (const seat of Object.values(SEATS)) {
      const snapshot = expectFogOfWar(state, seat);
      expect(snapshot.battle).toBeNull();
      expect(snapshot.gameOver).toEqual({
        winner: state.winner,
        reason: GAME_OVER_REASONS.FLEET_DESTROYED,
        opponentShips: state.battle.boards[otherSeat(seat)].ships,
        rematch: { me: null, opponent: null },
      });
    }
  });
});
