import {
  CLIENT_EVENTS,
  createPlayerSecret,
  createSeededRng,
  DEFAULT_RULES,
  ERROR_CODES,
  GAME_OVER_REASONS,
  ORIENTATIONS,
  PLACEMENT_TIME_LIMIT_MS,
  PLACEMENT_VIOLATIONS,
  randomTargets,
  ROOM_PHASES,
  RULES_VIOLATIONS,
  SEATS,
  SERVER_EVENTS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  TARGET_VIOLATIONS,
  TIMEOUT_ACTIONS,
  toPlacedShip,
  type Coordinate,
  type GameRules,
  type RoomPhase,
  type ShotResult,
} from '@battleship/core';
import { describe, expect, it } from 'vitest';

import {
  applyCommand,
  type GameOverRoom,
  type NegotiationRoom,
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
  negotiationRoom,
  NOW,
  P1_SECRET,
  P2_SECRET,
  placeAndConfirm,
  placementRoom,
  ROOM_ID,
  waitingRoom,
} from './fixtures.js';

const JOIN: RoomCommand = {
  type: CLIENT_EVENTS.JOIN_ROOM,
  payload: { roomId: ROOM_ID, nickname: 'Carol' },
  playerSecret: createPlayerSecret(),
};

/** Plays a whole match, both players firing random unshot cells, and returns the final room. */
function playToGameOver(seed: number): { state: GameOverRoom; turns: number } {
  const rng = createSeededRng(seed);
  let state: RoomState = battleRoom();
  let turns = 0;
  while (state.phase === ROOM_PHASES.IN_PROGRESS) {
    const shooter = state.battle.currentTurn;
    const [target] = randomTargets(state.battle, 1, rng);
    if (target === undefined) {
      expect.fail('No cell left to fire at');
    }
    const result = expectAccepted(
      applyCommand(state, { type: CLIENT_EVENTS.FIRE, seat: shooter, payload: { targets: [target] } }, NOW),
    );
    expect(result.effects).toEqual([
      { type: SERVER_EVENTS.SHOT_RESOLVED, payload: { shooter, results: [expect.anything()] } },
    ]);
    state = result.state;
    turns++;
  }
  expect(state.phase).toBe(ROOM_PHASES.GAME_OVER);
  return { state: state as GameOverRoom, turns };
}

describe('createRoom', () => {
  it('opens a waiting room with the default rules and the creator as P1', () => {
    expect(waitingRoom()).toEqual({
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      roomId: ROOM_ID,
      rules: DEFAULT_RULES,
      rulesVersion: 0,
      players: { P1: { nickname: 'Alice', playerSecret: P1_SECRET }, P2: null },
      disconnectedAt: { P1: null, P2: null },
    });
  });
});

/** Rules every test edits to: every field changed but salvo, which is refused until #32 (ADR-0085). */
const EDITED_RULES: GameRules = {
  isExtraTurnOnHitEnabled: true,
  areAdjacentShipsAllowed: true,
  turnTimeLimitSeconds: 60,
  isSalvoModeEnabled: false,
  timeoutAction: TIMEOUT_ACTIONS.PASS_TURN,
};

/** Sends `UPDATE_RULES` from a seat. */
function updateRules(state: RoomState, seat: (typeof SEATS)[keyof typeof SEATS], rules: GameRules) {
  return applyCommand(state, { type: CLIENT_EVENTS.UPDATE_RULES, seat, payload: { rules } }, NOW);
}

/** Sends `CONFIRM_RULES` for a version from a seat. */
function confirmRules(state: RoomState, seat: (typeof SEATS)[keyof typeof SEATS], rulesVersion: number, now = NOW) {
  return applyCommand(state, { type: CLIENT_EVENTS.CONFIRM_RULES, seat, payload: { rulesVersion } }, now);
}

describe('JOIN_ROOM', () => {
  it("seats the joiner as P2 and starts rules negotiation on the room's rules, nobody confirmed", () => {
    expect(negotiationRoom()).toEqual({
      phase: ROOM_PHASES.RULES_NEGOTIATION,
      roomId: ROOM_ID,
      rules: DEFAULT_RULES,
      rulesVersion: 0,
      players: {
        P1: { nickname: 'Alice', playerSecret: P1_SECRET },
        P2: { nickname: 'Bob', playerSecret: P2_SECRET },
      },
      disconnectedAt: { P1: null, P2: null },
      hasConfirmedRules: { P1: false, P2: false },
    });
  });

  it.each([
    [ROOM_PHASES.RULES_NEGOTIATION, negotiationRoom],
    [ROOM_PHASES.PLACEMENT, placementRoom],
    [ROOM_PHASES.IN_PROGRESS, battleRoom],
    [ROOM_PHASES.GAME_OVER, () => playToGameOver(7).state],
  ])('answers ROOM_FULL in %s', (_phase, room) => {
    expect(applyCommand(room(), JOIN, NOW)).toEqual({ ok: false, error: ERROR_CODES.ROOM_FULL });
  });
});

describe('rules negotiation', () => {
  it.each(Object.values(SEATS))(
    'lets %s edit: the rules are stored, rulesVersion bumped and both confirmations cleared',
    (seat) => {
      const confirmed = expectAccepted(confirmRules(negotiationRoom(), SEATS.P1, 0)).state;
      const result = expectAccepted(updateRules(confirmed, seat, EDITED_RULES));
      expect(result.effects).toEqual([]);
      expect(result.state).toEqual({
        ...confirmed,
        rules: EDITED_RULES,
        rulesVersion: 1,
        hasConfirmedRules: { P1: false, P2: false },
      });
      // Every edit counts, from either player.
      const again = expectAccepted(updateRules(result.state, SEATS.P1, DEFAULT_RULES)).state;
      expect(again).toMatchObject({ rules: DEFAULT_RULES, rulesVersion: 2 });
    },
  );

  it('refuses salvo with extra turn on hit with INVALID_RULES and the violation', () => {
    const rules = { ...DEFAULT_RULES, isSalvoModeEnabled: true, isExtraTurnOnHitEnabled: true };
    expect(updateRules(negotiationRoom(), SEATS.P2, rules)).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_RULES,
      violation: RULES_VIOLATIONS.SALVO_WITH_EXTRA_TURN,
    });
  });

  // ADR-0085: the shot engine throws on salvo until #32, so no room may agree on it.
  it('refuses salvo alone with INVALID_RULES and SALVO_NOT_IMPLEMENTED until #32', () => {
    expect(updateRules(negotiationRoom(), SEATS.P1, { ...DEFAULT_RULES, isSalvoModeEnabled: true })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_RULES,
      violation: RULES_VIOLATIONS.SALVO_NOT_IMPLEMENTED,
    });
  });

  // ADR-0082: an edit that changes nothing is not an edit, so a confirmation of the same rules stands.
  it('accepts an edit to the rules already in place without changing the room', () => {
    const edited = expectAccepted(updateRules(negotiationRoom(), SEATS.P1, EDITED_RULES)).state;
    const confirmed = expectAccepted(confirmRules(edited, SEATS.P2, 1)).state;
    const result = expectAccepted(updateRules(confirmed, SEATS.P1, { ...EDITED_RULES }));
    expect(result.state).toBe(confirmed);
    expect(result.state).toMatchObject({ rulesVersion: 1, hasConfirmedRules: { P1: false, P2: true } });
  });

  it('records one confirmation and waits for the other', () => {
    const result = expectAccepted(confirmRules(negotiationRoom(), SEATS.P2, 0));
    expect(result.state).toEqual({ ...negotiationRoom(), hasConfirmedRules: { P1: false, P2: true } });
  });

  // ADR-0004, the acceptance test of #26: A edits while B confirms the version it saw.
  it("answers STALE_RULES to B's confirmation of the version A's edit replaced", () => {
    const edited = expectAccepted(updateRules(negotiationRoom(), SEATS.P1, EDITED_RULES)).state;
    expect(confirmRules(edited, SEATS.P2, 0)).toEqual({ ok: false, error: ERROR_CODES.STALE_RULES });
    expect(confirmRules(edited, SEATS.P2, 2)).toEqual({ ok: false, error: ERROR_CODES.STALE_RULES });
    expect(expectAccepted(confirmRules(edited, SEATS.P2, 1)).state).toMatchObject({
      hasConfirmedRules: { P1: false, P2: true },
    });
  });

  it('answers STALE_RULES to a stale confirmation even from a seat that confirmed the current version', () => {
    const edited = expectAccepted(updateRules(negotiationRoom(), SEATS.P1, EDITED_RULES)).state;
    const confirmed = expectAccepted(confirmRules(edited, SEATS.P2, 1)).state;
    expect(confirmRules(confirmed, SEATS.P2, 0)).toEqual({ ok: false, error: ERROR_CODES.STALE_RULES });
  });

  // ADR-0082: a double tap is not an error, as for CONFIRM_PLACEMENT.
  it('accepts a repeated confirmation without changing the room', () => {
    const confirmed = expectAccepted(confirmRules(negotiationRoom(), SEATS.P1, 0)).state;
    expect(expectAccepted(confirmRules(confirmed, SEATS.P1, 0)).state).toBe(confirmed);
  });

  it('starts placement with the agreed rules once both confirmed the current version, the deadline from then', () => {
    const edited = expectAccepted(updateRules(negotiationRoom(), SEATS.P2, EDITED_RULES)).state;
    const first = expectAccepted(confirmRules(edited, SEATS.P2, 1)).state;
    const result = expectAccepted(confirmRules(first, SEATS.P1, 1, NOW + 5_000));
    expect(result.effects).toEqual([]);
    expect(result.state).toEqual({
      phase: ROOM_PHASES.PLACEMENT,
      roomId: ROOM_ID,
      rules: EDITED_RULES,
      rulesVersion: 1,
      players: (edited as NegotiationRoom).players,
      disconnectedAt: { P1: null, P2: null },
      fleets: { P1: { ships: [], hasConfirmed: false }, P2: { ships: [], hasConfirmed: false } },
      deadline: NOW + 5_000 + PLACEMENT_TIME_LIMIT_MS,
    });
  });

  it('places fleets under the agreed rules', () => {
    // Two ships side by side break the default rules, not the edited ones that allow adjacency.
    const touching = [
      { type: SHIP_TYPES.DESTROYER, start: cell(0, 0), orientation: ORIENTATIONS.HORIZONTAL },
      { type: SHIP_TYPES.SUBMARINE, start: cell(0, 1), orientation: ORIENTATIONS.HORIZONTAL },
    ];
    const edited = expectAccepted(updateRules(negotiationRoom(), SEATS.P1, EDITED_RULES)).state;
    const agreed = expectAccepted(confirmRules(expectAccepted(confirmRules(edited, SEATS.P1, 1)).state, SEATS.P2, 1));
    const command = { type: CLIENT_EVENTS.UPDATE_PLACEMENT, seat: SEATS.P1, payload: { ships: touching } } as const;
    expect(applyCommand(agreed.state, command, NOW).ok).toBe(true);
    expect(applyCommand(placementRoom(), command, NOW)).toMatchObject({
      ok: false,
      error: ERROR_CODES.INVALID_PLACEMENT,
    });
  });
});

describe('placement', () => {
  it('stores a valid draft with derived coordinates', () => {
    const state = apply(placementRoom(), {
      type: CLIENT_EVENTS.UPDATE_PLACEMENT,
      seat: SEATS.P1,
      payload: { ships: [{ type: SHIP_TYPES.DESTROYER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.VERTICAL }] },
    });
    expect(state.phase === ROOM_PHASES.PLACEMENT && state.fleets.P1).toEqual({
      ships: [
        {
          type: SHIP_TYPES.DESTROYER,
          start: { x: 0, y: 0 },
          orientation: ORIENTATIONS.VERTICAL,
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
        type: CLIENT_EVENTS.UPDATE_PLACEMENT,
        seat: SEATS.P1,
        payload: { ships: [{ type: SHIP_TYPES.CARRIER, start: { x: 8, y: 0 }, orientation: ORIENTATIONS.HORIZONTAL }] },
      },
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_PLACEMENT,
      violation: PLACEMENT_VIOLATIONS.OUT_OF_BOUNDS,
    });
  });

  it('refuses to confirm an incomplete fleet', () => {
    const result = applyCommand(
      placementRoom(),
      { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat: SEATS.P1, payload: {} },
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_PLACEMENT,
      violation: PLACEMENT_VIOLATIONS.INCOMPLETE_FLEET,
    });
  });

  it('locks a confirmed fleet until it is unlocked', () => {
    const confirmed = placeAndConfirm(placementRoom(), SEATS.P1, fleet(1));
    const update: SeatCommand = { type: CLIENT_EVENTS.UPDATE_PLACEMENT, seat: SEATS.P1, payload: { ships: fleet(3) } };
    expect(applyCommand(confirmed, update, NOW)).toEqual({ ok: false, error: ERROR_CODES.PLACEMENT_LOCKED });

    const unlocked = apply(confirmed, { type: CLIENT_EVENTS.UNLOCK_PLACEMENT, seat: SEATS.P1, payload: {} });
    expect(unlocked.phase === ROOM_PHASES.PLACEMENT && unlocked.fleets.P1.hasConfirmed).toBe(false);
    const updated = apply(unlocked, update);
    expect(updated.phase === ROOM_PHASES.PLACEMENT && updated.fleets.P1.ships.map((ship) => ship.start)).toEqual(
      fleet(3).map((ship) => ship.start),
    );
  });

  it('accepts a repeated confirm or unlock without changing the room', () => {
    const confirmed = placeAndConfirm(placementRoom(), SEATS.P1, fleet(1));
    expect(
      expectAccepted(
        applyCommand(confirmed, { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat: SEATS.P1, payload: {} }, NOW),
      ),
    ).toEqual({ ok: true, state: confirmed, effects: [] });
    const draft = placementRoom();
    expect(
      expectAccepted(applyCommand(draft, { type: CLIENT_EVENTS.UNLOCK_PLACEMENT, seat: SEATS.P2, payload: {} }, NOW))
        .state,
    ).toBe(draft);
  });

  it('starts the battle when both fleets are confirmed, P1 first, with no effect', () => {
    const p1Confirmed = placeAndConfirm(placementRoom(), SEATS.P1, fleet(1));
    const placed = apply(p1Confirmed, {
      type: CLIENT_EVENTS.UPDATE_PLACEMENT,
      seat: SEATS.P2,
      payload: { ships: fleet(2) },
    });
    const result = expectAccepted(
      applyCommand(placed, { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat: SEATS.P2, payload: {} }, NOW),
    );
    expect(result.effects).toEqual([]);
    expect(result.state).toMatchObject({
      phase: ROOM_PHASES.IN_PROGRESS,
      battle: { currentTurn: SEATS.P1 },
      draftTargets: [],
    });
    expect(result.state.phase === ROOM_PHASES.IN_PROGRESS && result.state.battle.boards).toEqual({
      P1: { ships: fleet(1).map(toPlacedShip), shots: [] },
      P2: { ships: fleet(2).map(toPlacedShip), shots: [] },
    });
  });
});

describe('battle', () => {
  it('stores the active player draft and clears it after the shot', () => {
    const drafted = apply(battleRoom(), {
      type: CLIENT_EVENTS.UPDATE_TARGETS,
      seat: SEATS.P1,
      payload: { targets: [{ x: 4, y: 4 }] },
    });
    expect(drafted.phase === ROOM_PHASES.IN_PROGRESS && drafted.draftTargets).toEqual([{ x: 4, y: 4 }]);
    const emptied = apply(drafted, { type: CLIENT_EVENTS.UPDATE_TARGETS, seat: SEATS.P1, payload: { targets: [] } });
    expect(emptied.phase === ROOM_PHASES.IN_PROGRESS && emptied.draftTargets).toEqual([]);

    const fired = apply(drafted, { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [{ x: 4, y: 4 }] } });
    expect(fired.phase === ROOM_PHASES.IN_PROGRESS && fired.draftTargets).toEqual([]);
  });

  it('refuses a draft with more targets than the allowance', () => {
    const targets = [cell(0, 0), cell(1, 0)];
    const result = applyCommand(
      battleRoom(),
      { type: CLIENT_EVENTS.UPDATE_TARGETS, seat: SEATS.P1, payload: { targets } },
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_TARGETS,
      violation: TARGET_VIOLATIONS.WRONG_TARGET_COUNT,
    });
  });

  it('refuses a cell already shot, as a draft and as a shot', () => {
    const afterTwoTurns = apply(
      apply(battleRoom(), { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [cell(5, 5)] } }),
      {
        type: CLIENT_EVENTS.FIRE,
        seat: SEATS.P2,
        payload: { targets: [cell(0, 0)] },
      },
    );
    for (const type of [CLIENT_EVENTS.UPDATE_TARGETS, CLIENT_EVENTS.FIRE] as const) {
      expect(applyCommand(afterTwoTurns, { type, seat: SEATS.P1, payload: { targets: [cell(5, 5)] } }, NOW)).toEqual({
        ok: false,
        error: ERROR_CODES.INVALID_TARGETS,
        violation: TARGET_VIOLATIONS.ALREADY_TARGETED,
      });
    }
  });

  it('turns a refused resolveTurn into INVALID_TARGETS', () => {
    const result = applyCommand(
      battleRoom(),
      { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [] } },
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_TARGETS,
      violation: TARGET_VIOLATIONS.WRONG_TARGET_COUNT,
    });
  });

  it('fires, emits SHOT_RESOLVED and hands the turn over', () => {
    const p2Cell = cellsOf(battleRoom().battle.boards.P2.ships)[0] ?? cell(0, 0);
    const result = expectAccepted(
      applyCommand(battleRoom(), { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [p2Cell] } }, NOW),
    );
    const expected: ShotResult = { coordinate: p2Cell, outcome: SHOT_OUTCOMES.HIT };
    expect(result.effects).toEqual([
      { type: SERVER_EVENTS.SHOT_RESOLVED, payload: { shooter: SEATS.P1, results: [expected] } },
    ]);
    expect(result.state).toMatchObject({ phase: ROOM_PHASES.IN_PROGRESS, battle: { currentTurn: SEATS.P2 } });
  });
});

describe('a full match', () => {
  it('is played through the transition function to FLEET_DESTROYED', () => {
    const { state, turns } = playToGameOver(42);
    const loser = state.winner === SEATS.P1 ? SEATS.P2 : SEATS.P1;
    const loserBoard = state.battle.boards[loser];
    expect(state.reason).toBe(GAME_OVER_REASONS.FLEET_DESTROYED);
    expect(loserBoard.shots.at(-1)?.outcome).toBe(SHOT_OUTCOMES.SUNK);
    expect(loserBoard.shots.filter((shot) => shot.outcome !== SHOT_OUTCOMES.MISS)).toHaveLength(17);
    expect(
      state.battle.boards[state.winner].shots.filter((shot) => shot.outcome !== SHOT_OUTCOMES.MISS).length,
    ).toBeLessThan(17);
    expect(turns).toBe(state.battle.boards.P1.shots.length + state.battle.boards.P2.shots.length);
    // Standard rules without extra turn: turns alternate, and P1 opened.
    expect(state.battle.boards.P2.shots.length - state.battle.boards.P1.shots.length).toBe(
      state.winner === SEATS.P1 ? 1 : 0,
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
      state = apply(state, { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [target] } });
      if (index < targets.length - 1) {
        expect(state.phase).toBe(ROOM_PHASES.IN_PROGRESS);
        state = apply(state, {
          type: CLIENT_EVENTS.FIRE,
          seat: SEATS.P2,
          payload: { targets: [misses[index] ?? cell(0, 0)] },
        });
      }
    }
    expect(state).toMatchObject({
      phase: ROOM_PHASES.GAME_OVER,
      winner: SEATS.P1,
      reason: GAME_OVER_REASONS.FLEET_DESTROYED,
    });
  });
});

describe('refusals', () => {
  const seatCommands: SeatCommand[] = [
    { type: CLIENT_EVENTS.UPDATE_RULES, seat: SEATS.P1, payload: { rules: EDITED_RULES } },
    { type: CLIENT_EVENTS.CONFIRM_RULES, seat: SEATS.P1, payload: { rulesVersion: 0 } },
    { type: CLIENT_EVENTS.UPDATE_PLACEMENT, seat: SEATS.P1, payload: { ships: [] } },
    { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat: SEATS.P1, payload: {} },
    { type: CLIENT_EVENTS.UNLOCK_PLACEMENT, seat: SEATS.P1, payload: {} },
    { type: CLIENT_EVENTS.UPDATE_TARGETS, seat: SEATS.P1, payload: { targets: [] } },
    { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [cell(0, 0)] } },
    { type: CLIENT_EVENTS.SET_PAUSED, seat: SEATS.P1, payload: { isPaused: true } },
  ];
  // The seat commands each phase accepts; every other one is WRONG_PHASE there.
  const acceptedIn: Record<RoomPhase, ReadonlySet<string>> = {
    WAITING_FOR_OPPONENT: new Set(),
    RULES_NEGOTIATION: new Set([CLIENT_EVENTS.UPDATE_RULES, CLIENT_EVENTS.CONFIRM_RULES]),
    PLACEMENT: new Set([
      CLIENT_EVENTS.UPDATE_PLACEMENT,
      CLIENT_EVENTS.CONFIRM_PLACEMENT,
      CLIENT_EVENTS.UNLOCK_PLACEMENT,
    ]),
    IN_PROGRESS: new Set([CLIENT_EVENTS.UPDATE_TARGETS, CLIENT_EVENTS.FIRE, CLIENT_EVENTS.SET_PAUSED]),
    GAME_OVER: new Set(),
  };
  const rooms: [RoomPhase, () => RoomState][] = [
    [ROOM_PHASES.WAITING_FOR_OPPONENT, waitingRoom],
    [ROOM_PHASES.RULES_NEGOTIATION, negotiationRoom],
    [ROOM_PHASES.PLACEMENT, placementRoom],
    [ROOM_PHASES.IN_PROGRESS, battleRoom],
    [ROOM_PHASES.GAME_OVER, () => playToGameOver(7).state],
  ];
  const wrongPhaseCases = rooms.flatMap(([phase, room]) =>
    seatCommands
      .filter((command) => !acceptedIn[phase].has(command.type))
      .map((command) => [command.type, phase, room, command] as const),
  );

  it.each(wrongPhaseCases)('answers WRONG_PHASE to %s in %s', (_type, _phase, room, command) => {
    expect(applyCommand(room(), command, NOW)).toEqual({ ok: false, error: ERROR_CODES.WRONG_PHASE });
  });

  it.each([CLIENT_EVENTS.UPDATE_TARGETS, CLIENT_EVENTS.FIRE] as const)(
    'answers NOT_YOUR_TURN to %s from the waiting player',
    (type) => {
      const result = applyCommand(battleRoom(), { type, seat: SEATS.P2, payload: { targets: [cell(0, 0)] } }, NOW);
      expect(result).toEqual({ ok: false, error: ERROR_CODES.NOT_YOUR_TURN });
    },
  );

  const refused: [string, () => RoomState, RoomCommand][] = [
    ['JOIN_ROOM in a full room', placementRoom, JOIN],
    [
      ERROR_CODES.WRONG_PHASE,
      waitingRoom,
      { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [cell(0, 0)] } },
    ],
    [
      ERROR_CODES.INVALID_RULES,
      negotiationRoom,
      {
        type: CLIENT_EVENTS.UPDATE_RULES,
        seat: SEATS.P1,
        payload: { rules: { ...EDITED_RULES, isSalvoModeEnabled: true } },
      },
    ],
    [
      ERROR_CODES.STALE_RULES,
      negotiationRoom,
      { type: CLIENT_EVENTS.CONFIRM_RULES, seat: SEATS.P2, payload: { rulesVersion: 1 } },
    ],
    [
      ERROR_CODES.NOT_YOUR_TURN,
      battleRoom,
      { type: CLIENT_EVENTS.FIRE, seat: SEATS.P2, payload: { targets: [cell(0, 0)] } },
    ],
    [
      ERROR_CODES.INVALID_PLACEMENT,
      placementRoom,
      {
        type: CLIENT_EVENTS.UPDATE_PLACEMENT,
        seat: SEATS.P1,
        payload: { ships: [...fleet(1).slice(0, 1), ...fleet(1).slice(0, 1)] },
      },
    ],
    [
      ERROR_CODES.PLACEMENT_LOCKED,
      () => placeAndConfirm(placementRoom(), SEATS.P2, fleet(2)),
      { type: CLIENT_EVENTS.UPDATE_PLACEMENT, seat: SEATS.P2, payload: { ships: [] } },
    ],
    [
      ERROR_CODES.INVALID_TARGETS,
      battleRoom,
      { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [cell(0, 0), cell(1, 1)] } },
    ],
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
    expectAccepted(
      applyCommand(state, { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [cell(3, 3)] } }, NOW),
    );
    expect(state).toEqual(before);
  });
});

function cell(x: number, y: number): Coordinate {
  return { x, y };
}
