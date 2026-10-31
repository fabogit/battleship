import {
  CLIENT_EVENTS,
  createPlayerSecret,
  createSeededRng,
  DEFAULT_RULES,
  DICE_ANIMATION_MS,
  ERROR_CODES,
  GAME_OVER_REASONS,
  completeFleet,
  MAX_CONSECUTIVE_AFK_TURNS,
  ORIENTATIONS,
  otherSeat,
  PLACEMENT_TIME_LIMIT_MS,
  PLACEMENT_VIOLATIONS,
  randomTargets,
  rollDice,
  ROOM_PHASES,
  RULES_VIOLATIONS,
  SEATS,
  SERVER_EVENTS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  START_COUNTDOWN_MS,
  TARGET_VIOLATIONS,
  TIMEOUT_ACTIONS,
  toPlacedShip,
  validateFleet,
  type Coordinate,
  type GameRules,
  type RoomPhase,
  type Seat,
  type ShotResult,
} from '@battleship/core';
import { describe, expect, it } from 'vitest';

import { disconnectSeat } from '../../src/room/presence.js';
import {
  applyCommand,
  endPlacement,
  nextTurnTimerAt,
  pauseTurnTimer,
  placementEndsAt,
  resumeTurnTimer,
  timeOutTurn,
  turnTimerEndsAt,
  type BattleRoom,
  type GameOverRoom,
  type NegotiationRoom,
  type PlacementRoom,
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
      countdownEndsAt: null,
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
});

/** P1's fleet confirmed and P2's complete draft placed, so P2's confirmation is the second one. */
function oneConfirmed(): RoomState {
  return apply(placeAndConfirm(placementRoom(), SEATS.P1, fleet(1)), {
    type: CLIENT_EVENTS.UPDATE_PLACEMENT,
    seat: SEATS.P2,
    payload: { ships: fleet(2) },
  });
}

const CONFIRM_P2: SeatCommand = { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat: SEATS.P2, payload: {} };
const UNLOCK_P1: SeatCommand = { type: CLIENT_EVENTS.UNLOCK_PLACEMENT, seat: SEATS.P1, payload: {} };
const CONFIRM_P1: SeatCommand = { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat: SEATS.P1, payload: {} };
/** The deadline of every `placementRoom()`. */
const DEADLINE = NOW + PLACEMENT_TIME_LIMIT_MS;

describe('the start countdown (ADR-0006, ADR-0090)', () => {
  it('starts on the second confirmation, START_COUNTDOWN_MS from it, and leaves the match to the timer', () => {
    const result = expectAccepted(applyCommand(oneConfirmed(), CONFIRM_P2, NOW + 1_000));
    expect(result.effects).toEqual([]);
    expect(result.state).toMatchObject({
      phase: ROOM_PHASES.PLACEMENT,
      countdownEndsAt: NOW + 1_000 + START_COUNTDOWN_MS,
    });
    expect(placementEndsAt(result.state as PlacementRoom)).toBe(NOW + 1_000 + START_COUNTDOWN_MS);
  });

  it('does not run while only one fleet is confirmed: placement ends at the deadline', () => {
    const state = oneConfirmed() as PlacementRoom;
    expect(state.countdownEndsAt).toBeNull();
    expect(placementEndsAt(state)).toBe(DEADLINE);
  });

  it('is capped by the deadline', () => {
    const state = apply(oneConfirmed(), CONFIRM_P2, DEADLINE - 2_000);
    expect(state).toMatchObject({ countdownEndsAt: DEADLINE });
  });

  it('is cancelled by an unlock from either player', () => {
    const counting = apply(oneConfirmed(), CONFIRM_P2, NOW + 1_000);
    for (const seat of Object.values(SEATS)) {
      const unlocked = apply(counting, { type: CLIENT_EVENTS.UNLOCK_PLACEMENT, seat, payload: {} });
      expect(unlocked).toMatchObject({ countdownEndsAt: null, fleets: { [seat]: { hasConfirmed: false } } });
      expect(placementEndsAt(unlocked as PlacementRoom)).toBe(DEADLINE);
    }
  });

  it('restarts from the new confirmation, still capped by the deadline', () => {
    const counting = apply(oneConfirmed(), CONFIRM_P2, NOW + 1_000);
    const unlocked = apply(counting, UNLOCK_P1, NOW + 3_000);
    expect(apply(unlocked, CONFIRM_P1, NOW + 4_000)).toMatchObject({
      countdownEndsAt: NOW + 4_000 + START_COUNTDOWN_MS,
    });
    expect(apply(unlocked, CONFIRM_P1, DEADLINE - 1_000)).toMatchObject({ countdownEndsAt: DEADLINE });
  });

  it('is not moved by a repeated confirmation', () => {
    const counting = apply(oneConfirmed(), CONFIRM_P2, NOW + 1_000);
    expect(expectAccepted(applyCommand(counting, CONFIRM_P2, NOW + 2_000)).state).toBe(counting);
  });

  it('lets a confirmation that reaches the room at the deadline win, with a countdown of zero', () => {
    const late = apply(oneConfirmed(), CONFIRM_P2, DEADLINE);
    expect(late).toMatchObject({ countdownEndsAt: DEADLINE });
    const ended = endPlacement(late as PlacementRoom, DEADLINE, createSeededRng(0));
    expect(ended?.completedSeats).toEqual([]);
    expect(ended?.state.battle.boards.P2.ships).toEqual(fleet(2).map(toPlacedShip));
  });
});

describe('the end of placement (ADR-0090, ADR-0091)', () => {
  it('waits for the countdown, then starts the battle with the confirmed fleets, P1 first, completing none', () => {
    const counting = apply(oneConfirmed(), CONFIRM_P2, NOW + 1_000) as PlacementRoom;
    const endsAt = NOW + 1_000 + START_COUNTDOWN_MS;
    expect(endPlacement(counting, endsAt - 1, createSeededRng(0))).toBeNull();
    const ended = endPlacement(counting, endsAt, createSeededRng(0));
    expect(ended?.completedSeats).toEqual([]);
    expect(ended?.state).toMatchObject({
      phase: ROOM_PHASES.IN_PROGRESS,
      battle: { currentTurn: SEATS.P1 },
      draftTargets: [],
      isPaused: false,
    });
    expect(ended?.state.battle.boards).toEqual({
      P1: { ships: fleet(1).map(toPlacedShip), shots: [] },
      P2: { ships: fleet(2).map(toPlacedShip), shots: [] },
    });
  });

  it('waits for the deadline while a fleet is unconfirmed', () => {
    expect(endPlacement(placementRoom(), DEADLINE - 1, createSeededRng(0))).toBeNull();
  });

  it('completes an unconfirmed fleet from its draft at the deadline and keeps the confirmed one', () => {
    const carrier = { type: SHIP_TYPES.CARRIER, start: cell(2, 3), orientation: ORIENTATIONS.VERTICAL };
    const drafted = apply(placeAndConfirm(placementRoom(), SEATS.P1, fleet(1)), {
      type: CLIENT_EVENTS.UPDATE_PLACEMENT,
      seat: SEATS.P2,
      payload: { ships: [carrier] },
    }) as PlacementRoom;
    const ended = endPlacement(drafted, DEADLINE, createSeededRng(5));
    expect(ended?.completedSeats).toEqual([SEATS.P2]);
    expect(ended?.state.battle.boards.P1.ships).toEqual(fleet(1).map(toPlacedShip));
    const completed = ended?.state.battle.boards.P2.ships ?? [];
    expect(completed).toEqual(completeFleet([carrier], DEFAULT_RULES, createSeededRng(5)));
    expect(completed).toContainEqual(toPlacedShip(carrier));
    expect(validateFleet(completed, DEFAULT_RULES).ok).toBe(true);
  });

  it('completes from the last accepted draft: a refused update leaves it as it was', () => {
    const carrier = { type: SHIP_TYPES.CARRIER, start: cell(0, 0), orientation: ORIENTATIONS.HORIZONTAL };
    const drafted = apply(placementRoom(), {
      type: CLIENT_EVENTS.UPDATE_PLACEMENT,
      seat: SEATS.P1,
      payload: { ships: [carrier] },
    });
    const offBoard = { type: SHIP_TYPES.CARRIER, start: cell(8, 0), orientation: ORIENTATIONS.HORIZONTAL };
    expect(
      applyCommand(
        drafted,
        { type: CLIENT_EVENTS.UPDATE_PLACEMENT, seat: SEATS.P1, payload: { ships: [offBoard] } },
        NOW,
      ),
    ).toMatchObject({ ok: false, error: ERROR_CODES.INVALID_PLACEMENT });
    const ended = endPlacement(drafted as PlacementRoom, DEADLINE, createSeededRng(5));
    expect(ended?.state.battle.boards.P1.ships).toContainEqual(toPlacedShip(carrier));
  });

  it('keeps a complete draft that was never confirmed as it is', () => {
    const drafted = apply(placementRoom(), {
      type: CLIENT_EVENTS.UPDATE_PLACEMENT,
      seat: SEATS.P1,
      payload: { ships: fleet(1) },
    }) as PlacementRoom;
    const ended = endPlacement(drafted, DEADLINE, createSeededRng(5));
    expect(ended?.completedSeats).toEqual([SEATS.P1, SEATS.P2]);
    expect(ended?.state.battle.boards.P1.ships).toEqual(fleet(1).map(toPlacedShip));
  });

  it('completes both fleets, P1 first, from one Rng, the same for the same seed', () => {
    const ended = endPlacement(placementRoom(), DEADLINE, createSeededRng(9));
    expect(ended?.completedSeats).toEqual([SEATS.P1, SEATS.P2]);
    const rng = createSeededRng(9);
    const expected = { P1: completeFleet([], DEFAULT_RULES, rng), P2: completeFleet([], DEFAULT_RULES, rng) };
    expect(ended?.state.battle.boards).toEqual({
      P1: { ships: expected.P1, shots: [] },
      P2: { ships: expected.P2, shots: [] },
    });
    expect(endPlacement(placementRoom(), DEADLINE, createSeededRng(9))).toEqual(ended);
  });

  it('completes under the agreed rules', () => {
    const edited = expectAccepted(updateRules(negotiationRoom(), SEATS.P1, EDITED_RULES)).state;
    const agreed = expectAccepted(confirmRules(expectAccepted(confirmRules(edited, SEATS.P1, 1)).state, SEATS.P2, 1));
    const placement = agreed.state as PlacementRoom;
    const ended = endPlacement(placement, placement.deadline, createSeededRng(3));
    expect(ended?.state.rules).toEqual(EDITED_RULES);
    expect(ended?.state.battle.boards.P1.ships).toEqual(completeFleet([], EDITED_RULES, createSeededRng(3)));
  });
});

describe('the dice roll (ADR-0002, ADR-0092, ADR-0093)', () => {
  /** When the start countdown of `bothConfirmed()` ends. */
  const STARTS_AT = NOW + START_COUNTDOWN_MS;

  /** Both fleets confirmed at `NOW`, so placement ends with the start countdown and no fleet is completed. */
  function bothConfirmed(): PlacementRoom {
    return placeAndConfirm(placeAndConfirm(placementRoom(), SEATS.P1, fleet(1)), SEATS.P2, fleet(2)) as PlacementRoom;
  }

  /** Ends the placement of `bothConfirmed()` on time with a seeded `Rng`. */
  function started(seed: number, now = STARTS_AT): { state: BattleRoom; dice: ReturnType<typeof rollDice> } {
    const ended = endPlacement(bothConfirmed(), now, createSeededRng(seed));
    if (ended === null) {
      expect.fail('Expected placement to end');
    }
    return ended;
  }

  it('rolls again after a tie, and the higher face of the decisive round fires first', () => {
    expect(started(1).dice).toEqual({
      rolls: [
        { P1: 5, P2: 5 },
        { P1: 6, P2: 4 },
      ],
      starter: SEATS.P1,
    });
    expect(started(1).state.battle.currentTurn).toBe(SEATS.P1);
    expect(started(8).dice).toEqual({
      rolls: [
        { P1: 3, P2: 3 },
        { P1: 3, P2: 4 },
      ],
      starter: SEATS.P2,
    });
    expect(started(8).state.battle.currentTurn).toBe(SEATS.P2);
  });

  it('gives the first turn to P1 or to P2, as the dice say', () => {
    expect(started(0)).toMatchObject({
      dice: { rolls: [{ P1: 6, P2: 4 }], starter: SEATS.P1 },
      state: { battle: { currentTurn: SEATS.P1 } },
    });
    const p2First = started(5);
    expect(p2First).toMatchObject({
      dice: { rolls: [{ P1: 1, P2: 3 }], starter: SEATS.P2 },
      state: { battle: { currentTurn: SEATS.P2 } },
    });
    const target = { targets: [cell(0, 0)] };
    expect(
      applyCommand(p2First.state, { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: target }, STARTS_AT),
    ).toEqual({ ok: false, error: ERROR_CODES.NOT_YOUR_TURN });
    const fired = expectAccepted(
      applyCommand(p2First.state, { type: CLIENT_EVENTS.FIRE, seat: SEATS.P2, payload: target }, STARTS_AT),
    );
    expect(fired.effects).toMatchObject([{ type: SERVER_EVENTS.SHOT_RESOLVED, payload: { shooter: SEATS.P2 } }]);
  });

  it('rolls after the fleets are completed, from the same Rng', () => {
    const ended = endPlacement(placementRoom(), DEADLINE, createSeededRng(9));
    const rng = createSeededRng(9);
    completeFleet([], DEFAULT_RULES, rng);
    completeFleet([], DEFAULT_RULES, rng);
    const dice = rollDice(rng);
    expect(ended?.dice).toEqual(dice);
    expect(ended?.state.battle.currentTurn).toBe(dice.starter);
  });

  it('starts the first turn timer DICE_ANIMATION_MS after the roll, however late the timer ran', () => {
    expect(started(0).state.turnTimerStartsAt).toBe(STARTS_AT + DICE_ANIMATION_MS);
    expect(started(0, STARTS_AT + 500).state.turnTimerStartsAt).toBe(STARTS_AT + 500 + DICE_ANIMATION_MS);
    expect(started(0).state).toMatchObject({ turnTimeLeftMs: 30_000, afkCount: { P1: 0, P2: 0 } });
  });

  it('lets the starter draft and fire while the dice animation plays, which starts the next turn timer at once', () => {
    const { state } = started(5);
    const during = STARTS_AT + 1;
    const drafted = apply(
      state,
      { type: CLIENT_EVENTS.UPDATE_TARGETS, seat: SEATS.P2, payload: { targets: [cell(1, 1)] } },
      during,
    );
    const fired = apply(
      drafted,
      { type: CLIENT_EVENTS.FIRE, seat: SEATS.P2, payload: { targets: [cell(1, 1)] } },
      during,
    );
    expect(fired).toMatchObject({
      battle: { currentTurn: SEATS.P1 },
      turnTimerStartsAt: during,
      turnTimeLeftMs: 30_000,
    });
  });

  it('rolls for a match that starts paused, a player being away', () => {
    const p1Away = disconnectSeat(bothConfirmed(), SEATS.P1, NOW + 1_000);
    const ended = endPlacement(p1Away as PlacementRoom, STARTS_AT, createSeededRng(8));
    expect(ended?.dice).toEqual(rollDice(createSeededRng(8)));
    expect(ended?.state).toMatchObject({
      isPaused: true,
      battle: { currentTurn: SEATS.P2 },
      turnTimerStartsAt: STARTS_AT + DICE_ANIMATION_MS,
      turnTimeLeftMs: 30_000,
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

describe('the turn timer (ADR-0009, ADR-0074, ADR-0093, ADR-0099)', () => {
  /** A turn under `DEFAULT_RULES`, in ms. */
  const TURN_LIMIT_MS = DEFAULT_RULES.turnTimeLimitSeconds * 1_000;

  /** The first turn of `battleRoom()`: who fires, the other seat, when the timer starts and when it ends. */
  function firstTurn(): { state: BattleRoom; seat: Seat; opponent: Seat; startsAt: number; endsAt: number } {
    const state = battleRoom();
    const seat = state.battle.currentTurn;
    return {
      state,
      seat,
      opponent: otherSeat(seat),
      startsAt: state.turnTimerStartsAt,
      endsAt: state.turnTimerStartsAt + TURN_LIMIT_MS,
    };
  }

  it('runs at the end of the dice animation, then at the end of the turn while the match runs', () => {
    const { state, startsAt, endsAt } = firstTurn();
    expect(turnTimerEndsAt(state)).toBe(endsAt);
    expect(nextTurnTimerAt(state, startsAt - 1)).toBe(startsAt);
    expect(nextTurnTimerAt(state, startsAt)).toBe(endsAt);
    const paused = pauseTurnTimer(state, startsAt - 1);
    // The end of the animation is marked even while paused; after it, nothing runs until the resume.
    expect(nextTurnTimerAt(paused, startsAt - 1)).toBe(startsAt);
    expect(nextTurnTimerAt(paused, startsAt)).toBeNull();
  });

  it('freezes the time left at a pause and restarts it from the resume', () => {
    const { state, startsAt } = firstTurn();
    const paused = pauseTurnTimer(state, startsAt + 10_000);
    expect(paused).toMatchObject({ isPaused: true, turnTimeLeftMs: TURN_LIMIT_MS - 10_000 });
    expect(pauseTurnTimer(paused, startsAt + 20_000)).toBe(paused);
    const resumed = resumeTurnTimer(paused, startsAt + 70_000);
    expect(resumed).toMatchObject({ isPaused: false, turnTimerStartsAt: startsAt + 70_000 });
    expect(turnTimerEndsAt(resumed)).toBe(startsAt + 70_000 + TURN_LIMIT_MS - 10_000);
    expect(resumeTurnTimer(resumed, startsAt + 80_000)).toBe(resumed);
  });

  it('keeps the whole time and the end of the dice animation through a pause during it', () => {
    const { state, startsAt } = firstTurn();
    const paused = pauseTurnTimer(state, startsAt - 2_000);
    expect(paused).toMatchObject({ turnTimeLeftMs: TURN_LIMIT_MS, turnTimerStartsAt: startsAt });
    expect(resumeTurnTimer(paused, startsAt - 1_000)).toMatchObject({ turnTimerStartsAt: startsAt });
    expect(resumeTurnTimer(paused, startsAt + 5_000)).toMatchObject({ turnTimerStartsAt: startsAt + 5_000 });
  });

  it('times nothing out before the end of the turn, nor while the match is paused', () => {
    const { state, endsAt } = firstTurn();
    expect(timeOutTurn(state, endsAt - 1, createSeededRng(1))).toBeNull();
    expect(timeOutTurn(pauseTurnTimer(state, endsAt - 1), endsAt + 60_000, createSeededRng(1))).toBeNull();
  });

  it('fires the draft at the end of the turn, counts one AFK turn and starts the next turn at once', () => {
    const { state, seat, opponent, endsAt } = firstTurn();
    const drafted = apply(state, { type: CLIENT_EVENTS.UPDATE_TARGETS, seat, payload: { targets: [cell(3, 3)] } });
    const timedOut = timeOutTurn(drafted as BattleRoom, endsAt, createSeededRng(1));
    expect(timedOut).toMatchObject({
      seat,
      afkCount: 1,
      action: TIMEOUT_ACTIONS.AUTO_RANDOM_SHOT,
      effects: [
        { type: SERVER_EVENTS.SHOT_RESOLVED, payload: { shooter: seat, results: [{ coordinate: cell(3, 3) }] } },
      ],
      state: {
        phase: ROOM_PHASES.IN_PROGRESS,
        battle: { currentTurn: opponent },
        draftTargets: [],
        turnTimerStartsAt: endsAt,
        turnTimeLeftMs: TURN_LIMIT_MS,
        afkCount: { [seat]: 1, [opponent]: 0 },
      },
    });
  });

  it('fires a random unshot cell from the Rng for an empty draft', () => {
    const { state, endsAt } = firstTurn();
    const timedOut = timeOutTurn(state, endsAt, createSeededRng(4));
    const [target] = randomTargets(state.battle, 1, createSeededRng(4));
    expect(timedOut?.effects[0]?.payload.results).toEqual([expect.objectContaining({ coordinate: target })]);
  });

  it('passes the turn under PASS_TURN: no shot, the draft discarded', () => {
    const { state, seat, opponent, endsAt } = firstTurn();
    const passing = { ...state, rules: { ...DEFAULT_RULES, timeoutAction: TIMEOUT_ACTIONS.PASS_TURN } };
    const drafted = apply(passing, { type: CLIENT_EVENTS.UPDATE_TARGETS, seat, payload: { targets: [cell(3, 3)] } });
    expect(timeOutTurn(drafted as BattleRoom, endsAt, createSeededRng(1))).toEqual({
      seat,
      afkCount: 1,
      action: TIMEOUT_ACTIONS.PASS_TURN,
      effects: [],
      state: {
        ...passing,
        battle: { ...state.battle, currentTurn: opponent },
        turnTimerStartsAt: endsAt,
        afkCount: { [seat]: 1, [opponent]: 0 },
      },
    });
  });

  it('keeps the turn after an auto shot that hits, with extra turn on hit', () => {
    const { state, seat, endsAt } = firstTurn();
    const extraTurn = { ...state, rules: { ...DEFAULT_RULES, isExtraTurnOnHitEnabled: true } };
    const shipCell = state.battle.boards[otherSeat(seat)].ships[0]?.coordinates[0] ?? cell(0, 0);
    const drafted = apply(extraTurn, { type: CLIENT_EVENTS.UPDATE_TARGETS, seat, payload: { targets: [shipCell] } });
    expect(timeOutTurn(drafted as BattleRoom, endsAt, createSeededRng(1))?.state).toMatchObject({
      battle: { currentTurn: seat },
      turnTimerStartsAt: endsAt,
      afkCount: { [seat]: 1 },
    });
  });

  it('counts a FIRE handled after the deadline, before the timer ran, which then finds nothing to time out', () => {
    const { state, seat, opponent, endsAt } = firstTurn();
    const late = endsAt + 5;
    const fired = apply(state, { type: CLIENT_EVENTS.FIRE, seat, payload: { targets: [cell(9, 9)] } }, late);
    expect(fired).toMatchObject({ battle: { currentTurn: opponent }, turnTimerStartsAt: late });
    expect(timeOutTurn(fired as BattleRoom, late, createSeededRng(1))).toBeNull();
  });

  it('sets the AFK count back to zero on the seat’s FIRE only, not on a draft', () => {
    const { state, seat, opponent } = firstTurn();
    const idle = { ...state, afkCount: { [seat]: 2, [opponent]: 1 } as Record<Seat, number> };
    const drafted = apply(idle, { type: CLIENT_EVENTS.UPDATE_TARGETS, seat, payload: { targets: [cell(9, 9)] } });
    expect(drafted).toMatchObject({ afkCount: { [seat]: 2, [opponent]: 1 } });
    const fired = apply(drafted, { type: CLIENT_EVENTS.FIRE, seat, payload: { targets: [cell(9, 9)] } });
    expect(fired).toMatchObject({ afkCount: { [seat]: 0, [opponent]: 1 } });
  });

  it.each([
    [0, GAME_OVER_REASONS.AFK_FORFEIT],
    [MAX_CONSECUTIVE_AFK_TURNS - 2, GAME_OVER_REASONS.AFK_FORFEIT],
    [MAX_CONSECUTIVE_AFK_TURNS - 1, GAME_OVER_REASONS.ABANDONED],
  ] as const)(
    'ends the match at MAX_CONSECUTIVE_AFK_TURNS, the opponent at %i: %s, without the timeout action',
    (opponentCount, reason) => {
      const { state, seat, opponent, endsAt } = firstTurn();
      const idle = {
        ...state,
        afkCount: { [seat]: MAX_CONSECUTIVE_AFK_TURNS - 1, [opponent]: opponentCount } as Record<Seat, number>,
      };
      const timedOut = timeOutTurn(idle, endsAt, createSeededRng(1));
      expect(timedOut).toMatchObject({ seat, afkCount: MAX_CONSECUTIVE_AFK_TURNS, action: null, effects: [] });
      expect(timedOut?.state).toMatchObject({
        phase: ROOM_PHASES.GAME_OVER,
        winner: reason === GAME_OVER_REASONS.ABANDONED ? null : opponent,
        reason,
      });
      // No shot was fired: the boards are the ones the turn started with.
      expect(timedOut?.state.battle).toBe(state.battle);
    },
  );

  it('gives a turn started by a shot during a pause its whole time, frozen until the resume', () => {
    const { state, seat, startsAt } = firstTurn();
    const paused = pauseTurnTimer(state, startsAt + 10_000);
    const fired = apply(
      paused,
      { type: CLIENT_EVENTS.FIRE, seat, payload: { targets: [cell(9, 9)] } },
      startsAt + 12_000,
    );
    expect(fired).toMatchObject({
      isPaused: true,
      turnTimerStartsAt: startsAt + 12_000,
      turnTimeLeftMs: TURN_LIMIT_MS,
    });
    expect(resumeTurnTimer(fired as BattleRoom, startsAt + 50_000)).toMatchObject({
      turnTimerStartsAt: startsAt + 50_000,
    });
  });

  it('pauses and resumes with SET_PAUSED at the time of the command', () => {
    const { state, seat, opponent, startsAt } = firstTurn();
    const away = disconnectSeat(state, opponent, startsAt + 10_000);
    expect(away).toMatchObject({ isPaused: true, turnTimeLeftMs: TURN_LIMIT_MS - 10_000 });
    const resumed = apply(
      away,
      { type: CLIENT_EVENTS.SET_PAUSED, seat, payload: { isPaused: false } },
      startsAt + 40_000,
    );
    expect(resumed).toMatchObject({ isPaused: false, turnTimerStartsAt: startsAt + 40_000 });
    const paused = apply(
      resumed,
      { type: CLIENT_EVENTS.SET_PAUSED, seat, payload: { isPaused: true } },
      startsAt + 45_000,
    );
    expect(paused).toMatchObject({ isPaused: true, turnTimeLeftMs: TURN_LIMIT_MS - 15_000 });
  });

  it('never mutates the room', () => {
    const { state, seat, endsAt } = firstTurn();
    const drafted = deepFreeze(
      apply(state, { type: CLIENT_EVENTS.UPDATE_TARGETS, seat, payload: { targets: [cell(3, 3)] } }) as BattleRoom,
    );
    const copy = structuredClone(drafted);
    timeOutTurn(drafted, endsAt, createSeededRng(1));
    pauseTurnTimer(drafted, endsAt - 1);
    expect(drafted).toEqual(copy);
  });
});

describe('a full match', () => {
  it('is played through the transition function to FLEET_DESTROYED', () => {
    const { state, turns } = playToGameOver(42);
    if (state.winner === null) {
      expect.fail('Expected a winner');
    }
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
