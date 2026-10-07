import {
  createSeededRng,
  DEFAULT_RULES,
  PLACEMENT_TIME_LIMIT_MS,
  randomTargets,
  toPlacedShip,
  type Coordinate,
  type ShotResult,
} from '@battleship/core';
import { describe, expect, it } from 'vitest';

import {
  applyCommand,
  type GameOverRoom,
  type RoomCommand,
  type RoomState,
  type SeatCommand,
} from '../../src/room/room.js';
import {
  apply,
  battleRoom,
  cellsOf,
  deepFreeze,
  expectAccepted,
  fleet,
  NOW,
  P1_SECRET,
  P2_SECRET,
  placeAndConfirm,
  placementRoom,
  ROOM_ID,
  waitingRoom,
} from './fixtures.js';

const JOIN: RoomCommand = { type: 'JOIN_ROOM', payload: { roomId: ROOM_ID, nickname: 'Carol' }, playerSecret: 'x' };

/** Plays a whole match, both players firing random unshot cells, and returns the final room. */
function playToGameOver(seed: number): { state: GameOverRoom; turns: number } {
  const rng = createSeededRng(seed);
  let state: RoomState = battleRoom();
  let turns = 0;
  while (state.phase === 'IN_PROGRESS') {
    const shooter = state.battle.currentTurn;
    const [target] = randomTargets(state.battle, 1, rng);
    if (target === undefined) {
      expect.fail('No cell left to fire at');
    }
    const result = expectAccepted(
      applyCommand(state, { type: 'FIRE', seat: shooter, payload: { targets: [target] } }, NOW),
    );
    expect(result.effects).toEqual([{ type: 'SHOT_RESOLVED', payload: { shooter, results: [expect.anything()] } }]);
    state = result.state;
    turns++;
  }
  expect(state.phase).toBe('GAME_OVER');
  return { state: state as GameOverRoom, turns };
}

describe('createRoom', () => {
  it('opens a waiting room with the default rules and the creator as P1', () => {
    expect(waitingRoom()).toEqual({
      phase: 'WAITING_FOR_OPPONENT',
      roomId: ROOM_ID,
      rules: DEFAULT_RULES,
      rulesVersion: 0,
      players: { P1: { nickname: 'Alice', playerSecret: P1_SECRET }, P2: null },
    });
  });
});

describe('JOIN_ROOM', () => {
  it('seats the joiner as P2 and starts placement with a deadline', () => {
    const state = placementRoom(NOW);
    expect(state.players.P2).toEqual({ nickname: 'Bob', playerSecret: P2_SECRET });
    expect(state.fleets).toEqual({ P1: { ships: [], hasConfirmed: false }, P2: { ships: [], hasConfirmed: false } });
    expect(state.deadline).toBe(NOW + PLACEMENT_TIME_LIMIT_MS);
  });

  it.each([
    ['PLACEMENT', placementRoom],
    ['IN_PROGRESS', battleRoom],
    ['GAME_OVER', () => playToGameOver(7).state],
  ])('answers ROOM_FULL in %s', (_phase, room) => {
    expect(applyCommand(room(), JOIN, NOW)).toEqual({ ok: false, error: 'ROOM_FULL' });
  });
});

describe('placement', () => {
  it('stores a valid draft with derived coordinates', () => {
    const state = apply(placementRoom(), {
      type: 'UPDATE_PLACEMENT',
      seat: 'P1',
      payload: { ships: [{ type: 'DESTROYER', start: { x: 0, y: 0 }, orientation: 'VERTICAL' }] },
    });
    expect(state.phase === 'PLACEMENT' && state.fleets.P1).toEqual({
      ships: [
        {
          type: 'DESTROYER',
          start: { x: 0, y: 0 },
          orientation: 'VERTICAL',
          coordinates: [
            { x: 0, y: 0 },
            { x: 0, y: 1 },
          ],
        },
      ],
      hasConfirmed: false,
    });
  });

  it('refuses an invalid draft with INVALID_PLACEMENT and the violation', () => {
    const result = applyCommand(
      placementRoom(),
      {
        type: 'UPDATE_PLACEMENT',
        seat: 'P1',
        payload: { ships: [{ type: 'CARRIER', start: { x: 8, y: 0 }, orientation: 'HORIZONTAL' }] },
      },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: 'INVALID_PLACEMENT', violation: 'OUT_OF_BOUNDS' });
  });

  it('refuses to confirm an incomplete fleet', () => {
    const result = applyCommand(placementRoom(), { type: 'CONFIRM_PLACEMENT', seat: 'P1', payload: {} }, NOW);
    expect(result).toEqual({ ok: false, error: 'INVALID_PLACEMENT', violation: 'INCOMPLETE_FLEET' });
  });

  it('locks a confirmed fleet until it is unlocked', () => {
    const confirmed = placeAndConfirm(placementRoom(), 'P1', fleet(1));
    const update: SeatCommand = { type: 'UPDATE_PLACEMENT', seat: 'P1', payload: { ships: fleet(3) } };
    expect(applyCommand(confirmed, update, NOW)).toEqual({ ok: false, error: 'PLACEMENT_LOCKED' });

    const unlocked = apply(confirmed, { type: 'UNLOCK_PLACEMENT', seat: 'P1', payload: {} });
    expect(unlocked.phase === 'PLACEMENT' && unlocked.fleets.P1.hasConfirmed).toBe(false);
    const updated = apply(unlocked, update);
    expect(updated.phase === 'PLACEMENT' && updated.fleets.P1.ships.map((ship) => ship.start)).toEqual(
      fleet(3).map((ship) => ship.start),
    );
  });

  it('accepts a repeated confirm or unlock without changing the room', () => {
    const confirmed = placeAndConfirm(placementRoom(), 'P1', fleet(1));
    expect(
      expectAccepted(applyCommand(confirmed, { type: 'CONFIRM_PLACEMENT', seat: 'P1', payload: {} }, NOW)),
    ).toEqual({ ok: true, state: confirmed, effects: [] });
    const draft = placementRoom();
    expect(expectAccepted(applyCommand(draft, { type: 'UNLOCK_PLACEMENT', seat: 'P2', payload: {} }, NOW)).state).toBe(
      draft,
    );
  });

  it('starts the battle when both fleets are confirmed, P1 first, with no effect', () => {
    const p1Confirmed = placeAndConfirm(placementRoom(), 'P1', fleet(1));
    const placed = apply(p1Confirmed, { type: 'UPDATE_PLACEMENT', seat: 'P2', payload: { ships: fleet(2) } });
    const result = expectAccepted(applyCommand(placed, { type: 'CONFIRM_PLACEMENT', seat: 'P2', payload: {} }, NOW));
    expect(result.effects).toEqual([]);
    expect(result.state).toMatchObject({ phase: 'IN_PROGRESS', battle: { currentTurn: 'P1' }, draftTargets: [] });
    expect(result.state.phase === 'IN_PROGRESS' && result.state.battle.boards).toEqual({
      P1: { ships: fleet(1).map(toPlacedShip), shots: [] },
      P2: { ships: fleet(2).map(toPlacedShip), shots: [] },
    });
  });
});

describe('battle', () => {
  it('stores the active player draft and clears it after the shot', () => {
    const drafted = apply(battleRoom(), { type: 'UPDATE_TARGETS', seat: 'P1', payload: { targets: [{ x: 4, y: 4 }] } });
    expect(drafted.phase === 'IN_PROGRESS' && drafted.draftTargets).toEqual([{ x: 4, y: 4 }]);
    const emptied = apply(drafted, { type: 'UPDATE_TARGETS', seat: 'P1', payload: { targets: [] } });
    expect(emptied.phase === 'IN_PROGRESS' && emptied.draftTargets).toEqual([]);

    const fired = apply(drafted, { type: 'FIRE', seat: 'P1', payload: { targets: [{ x: 4, y: 4 }] } });
    expect(fired.phase === 'IN_PROGRESS' && fired.draftTargets).toEqual([]);
  });

  it('refuses a draft with more targets than the allowance', () => {
    const targets = [cell(0, 0), cell(1, 0)];
    const result = applyCommand(battleRoom(), { type: 'UPDATE_TARGETS', seat: 'P1', payload: { targets } }, NOW);
    expect(result).toEqual({ ok: false, error: 'INVALID_TARGETS', violation: 'WRONG_TARGET_COUNT' });
  });

  it('refuses a cell already shot, as a draft and as a shot', () => {
    const afterTwoTurns = apply(apply(battleRoom(), { type: 'FIRE', seat: 'P1', payload: { targets: [cell(5, 5)] } }), {
      type: 'FIRE',
      seat: 'P2',
      payload: { targets: [cell(0, 0)] },
    });
    for (const type of ['UPDATE_TARGETS', 'FIRE'] as const) {
      expect(applyCommand(afterTwoTurns, { type, seat: 'P1', payload: { targets: [cell(5, 5)] } }, NOW)).toEqual({
        ok: false,
        error: 'INVALID_TARGETS',
        violation: 'ALREADY_TARGETED',
      });
    }
  });

  it('turns a refused resolveTurn into INVALID_TARGETS', () => {
    const result = applyCommand(battleRoom(), { type: 'FIRE', seat: 'P1', payload: { targets: [] } }, NOW);
    expect(result).toEqual({ ok: false, error: 'INVALID_TARGETS', violation: 'WRONG_TARGET_COUNT' });
  });

  it('fires, emits SHOT_RESOLVED and hands the turn over', () => {
    const p2Cell = cellsOf(battleRoom().battle.boards.P2.ships)[0] ?? cell(0, 0);
    const result = expectAccepted(
      applyCommand(battleRoom(), { type: 'FIRE', seat: 'P1', payload: { targets: [p2Cell] } }, NOW),
    );
    const expected: ShotResult = { coordinate: p2Cell, outcome: 'HIT' };
    expect(result.effects).toEqual([{ type: 'SHOT_RESOLVED', payload: { shooter: 'P1', results: [expected] } }]);
    expect(result.state).toMatchObject({ phase: 'IN_PROGRESS', battle: { currentTurn: 'P2' } });
  });
});

describe('a full match', () => {
  it('is played through the transition function to FLEET_DESTROYED', () => {
    const { state, turns } = playToGameOver(42);
    const loser = state.winner === 'P1' ? 'P2' : 'P1';
    const loserBoard = state.battle.boards[loser];
    expect(state.reason).toBe('FLEET_DESTROYED');
    expect(loserBoard.shots.at(-1)?.outcome).toBe('SUNK');
    expect(loserBoard.shots.filter((shot) => shot.outcome !== 'MISS')).toHaveLength(17);
    expect(state.battle.boards[state.winner].shots.filter((shot) => shot.outcome !== 'MISS').length).toBeLessThan(17);
    expect(turns).toBe(state.battle.boards.P1.shots.length + state.battle.boards.P2.shots.length);
    // Standard rules without extra turn: turns alternate, and P1 opened.
    expect(state.battle.boards.P2.shots.length - state.battle.boards.P1.shots.length).toBe(
      state.winner === 'P1' ? 1 : 0,
    );
  });

  it('is repeatable with a fixed seed', () => {
    expect(playToGameOver(42)).toEqual(playToGameOver(42));
  });

  it('ends the match on the shot that sinks the last ship, P1 firing only at ships', () => {
    let state: RoomState = battleRoom();
    const targets = cellsOf(battleRoom().battle.boards.P2.ships);
    const misses = Array.from({ length: 100 }, (_, index) => cell(index % 10, Math.floor(index / 10))).filter(
      (candidate) =>
        !cellsOf(battleRoom().battle.boards.P1.ships).some((c) => c.x === candidate.x && c.y === candidate.y),
    );
    for (const [index, target] of targets.entries()) {
      state = apply(state, { type: 'FIRE', seat: 'P1', payload: { targets: [target] } });
      if (index < targets.length - 1) {
        expect(state.phase).toBe('IN_PROGRESS');
        state = apply(state, { type: 'FIRE', seat: 'P2', payload: { targets: [misses[index] ?? cell(0, 0)] } });
      }
    }
    expect(state).toMatchObject({ phase: 'GAME_OVER', winner: 'P1', reason: 'FLEET_DESTROYED' });
  });
});

describe('refusals', () => {
  const seatCommands: SeatCommand[] = [
    { type: 'UPDATE_PLACEMENT', seat: 'P1', payload: { ships: [] } },
    { type: 'CONFIRM_PLACEMENT', seat: 'P1', payload: {} },
    { type: 'UNLOCK_PLACEMENT', seat: 'P1', payload: {} },
    { type: 'UPDATE_TARGETS', seat: 'P1', payload: { targets: [] } },
    { type: 'FIRE', seat: 'P1', payload: { targets: [cell(0, 0)] } },
  ];
  const placementCommands = new Set(['UPDATE_PLACEMENT', 'CONFIRM_PLACEMENT', 'UNLOCK_PLACEMENT']);
  const rooms: [string, () => RoomState][] = [
    ['WAITING_FOR_OPPONENT', waitingRoom],
    ['PLACEMENT', placementRoom],
    ['IN_PROGRESS', battleRoom],
    ['GAME_OVER', () => playToGameOver(7).state],
  ];
  const wrongPhaseCases = rooms.flatMap(([phase, room]) =>
    seatCommands
      .filter((command) =>
        phase === 'PLACEMENT'
          ? !placementCommands.has(command.type)
          : phase === 'IN_PROGRESS'
            ? placementCommands.has(command.type)
            : true,
      )
      .map((command) => [command.type, phase, room, command] as const),
  );

  it.each(wrongPhaseCases)('answers WRONG_PHASE to %s in %s', (_type, _phase, room, command) => {
    expect(applyCommand(room(), command, NOW)).toEqual({ ok: false, error: 'WRONG_PHASE' });
  });

  it.each(['UPDATE_TARGETS', 'FIRE'] as const)('answers NOT_YOUR_TURN to %s from the waiting player', (type) => {
    const result = applyCommand(battleRoom(), { type, seat: 'P2', payload: { targets: [cell(0, 0)] } }, NOW);
    expect(result).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  const refused: [string, () => RoomState, RoomCommand][] = [
    ['JOIN_ROOM in a full room', placementRoom, JOIN],
    ['WRONG_PHASE', waitingRoom, { type: 'FIRE', seat: 'P1', payload: { targets: [cell(0, 0)] } }],
    ['NOT_YOUR_TURN', battleRoom, { type: 'FIRE', seat: 'P2', payload: { targets: [cell(0, 0)] } }],
    [
      'INVALID_PLACEMENT',
      placementRoom,
      { type: 'UPDATE_PLACEMENT', seat: 'P1', payload: { ships: [...fleet(1).slice(0, 1), ...fleet(1).slice(0, 1)] } },
    ],
    [
      'PLACEMENT_LOCKED',
      () => placeAndConfirm(placementRoom(), 'P2', fleet(2)),
      { type: 'UPDATE_PLACEMENT', seat: 'P2', payload: { ships: [] } },
    ],
    ['INVALID_TARGETS', battleRoom, { type: 'FIRE', seat: 'P1', payload: { targets: [cell(0, 0), cell(1, 1)] } }],
  ];

  it.each(refused)('leaves the room unchanged on %s', (_label, room, command) => {
    const state = deepFreeze(room());
    const before = structuredClone(state);
    const result = applyCommand(state, command, NOW);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('state');
    expect(state).toEqual(before);
  });

  it('never mutates the room on accepted commands either', () => {
    const state = deepFreeze(battleRoom());
    const before = structuredClone(state);
    expectAccepted(applyCommand(state, { type: 'FIRE', seat: 'P1', payload: { targets: [cell(3, 3)] } }, NOW));
    expect(state).toEqual(before);
  });
});

function cell(x: number, y: number): Coordinate {
  return { x, y };
}
