import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  ERROR_CODES,
  GAME_OVER_REASONS,
  otherSeat,
  PLACEMENT_TIME_LIMIT_MS,
  REMATCH_CHOICES,
  ROOM_PHASES,
  SEATS,
  TIMEOUT_ACTIONS,
  type RecordedRematchChoice,
  type RematchChoice,
  type Seat,
} from '@battleship/core';
import { describe, expect, it } from 'vitest';

import { disconnectSeat, leaveRoom, nextForfeit, reconnectSeat } from '../../src/room/presence.js';
import { chooseRematch, type RematchChosen } from '../../src/room/rematch.js';
import {
  endMatch,
  recordRematchChoice,
  surrender,
  type GameOverRoom,
  type NegotiationRoom,
  type RoomState,
} from '../../src/room/room.js';
import { projectSnapshot } from '../../src/room/snapshot.js';
import {
  apply,
  battleRoom,
  battleRoomWith,
  deepFreeze,
  endPlacementNow,
  fleet,
  negotiationRoom,
  NOW,
  placeAndConfirm,
  placementRoom,
  ROOM_ID,
  waitingRoom,
} from './fixtures.js';

/** When the rematch choices land, later than the end of the match. */
const LATER = NOW + 30_000;

/** Rules other than `DEFAULT_RULES`, agreed on at version 1. */
const EDITED_RULES = { ...DEFAULT_RULES, timeoutAction: TIMEOUT_ACTIONS.PASS_TURN };

/** A match P1 won on its last shot, both players connected, played with `DEFAULT_RULES` at version 0. */
function gameOverRoom(): GameOverRoom {
  const state = battleRoom();
  return endMatch(state, state.battle, SEATS.P1, GAME_OVER_REASONS.FLEET_DESTROYED);
}

/** A match P2 surrendered, played with `EDITED_RULES` at version 1. */
function editedGameOverRoom(): GameOverRoom {
  return surrender(battleRoomWith(EDITED_RULES), SEATS.P2);
}

/** Expects a choice to be accepted. */
function expectChosen(result: ReturnType<typeof chooseRematch>): RematchChosen {
  if (!result.ok) {
    expect.fail(`Expected the choice to be accepted, got ${result.error}`);
  }
  return result;
}

/** Applies a choice that must be accepted and returns the room after it. */
function choose(state: RoomState, seat: Seat, choice: RematchChoice, now = LATER): RoomState {
  return expectChosen(chooseRematch(state, seat, choice, now)).state;
}

/** Every pair of choices that plays again, with the phase it resolves into. */
const PLAY_AGAIN: readonly [
  RecordedRematchChoice,
  RecordedRematchChoice,
  typeof ROOM_PHASES.PLACEMENT | typeof ROOM_PHASES.RULES_NEGOTIATION,
][] = [
  [REMATCH_CHOICES.SAME_RULES, REMATCH_CHOICES.SAME_RULES, ROOM_PHASES.PLACEMENT],
  [REMATCH_CHOICES.SAME_RULES, REMATCH_CHOICES.CHANGE_RULES, ROOM_PHASES.RULES_NEGOTIATION],
  [REMATCH_CHOICES.CHANGE_RULES, REMATCH_CHOICES.SAME_RULES, ROOM_PHASES.RULES_NEGOTIATION],
  [REMATCH_CHOICES.CHANGE_RULES, REMATCH_CHOICES.CHANGE_RULES, ROOM_PHASES.RULES_NEGOTIATION],
];

describe('endMatch', () => {
  it('starts GAME_OVER with no rematch choice', () => {
    expect(gameOverRoom().rematch).toEqual({ P1: null, P2: null });
    expect(editedGameOverRoom().rematch).toEqual({ P1: null, P2: null });
  });
});

describe('REMATCH_CHOICE to play again (ADR-0123, ADR-0124)', () => {
  it.each(
    Object.values(SEATS).flatMap((seat) =>
      [REMATCH_CHOICES.SAME_RULES, REMATCH_CHOICES.CHANGE_RULES].map((choice) => [seat, choice] as const),
    ),
  )('keeps the first choice, %s %s, in GAME_OVER, and the snapshot shows it to both seats', (seat, choice) => {
    const state = gameOverRoom();
    const chosen = expectChosen(chooseRematch(state, seat, choice, LATER));
    expect(chosen).toEqual({
      ok: true,
      hasLeft: false,
      state: { ...state, rematch: { [seat]: choice, [otherSeat(seat)]: null } },
    });
    expect(projectSnapshot(chosen.state, seat, LATER).gameOver?.rematch).toEqual({ me: choice, opponent: null });
    expect(projectSnapshot(chosen.state, otherSeat(seat), LATER).gameOver?.rematch).toEqual({
      me: null,
      opponent: choice,
    });
  });

  it.each(PLAY_AGAIN)('resolves P1 %s and P2 %s into %s, in either order', (p1Choice, p2Choice, phase) => {
    for (const [first, second] of [
      [SEATS.P1, SEATS.P2],
      [SEATS.P2, SEATS.P1],
    ] as const) {
      const choices = { P1: p1Choice, P2: p2Choice };
      const once = choose(gameOverRoom(), first, choices[first], NOW);
      expect(once.phase).toBe(ROOM_PHASES.GAME_OVER);
      expect(choose(once, second, choices[second]).phase).toBe(phase);
    }
  });

  it('starts PLACEMENT on both SAME_RULES with empty fleets and a new deadline, carrying players, rules and version (ADR-0125)', () => {
    const state = editedGameOverRoom();
    const resolved = choose(
      choose(state, SEATS.P1, REMATCH_CHOICES.SAME_RULES, NOW),
      SEATS.P2,
      REMATCH_CHOICES.SAME_RULES,
    );
    expect(resolved).toEqual({
      phase: ROOM_PHASES.PLACEMENT,
      roomId: ROOM_ID,
      rules: EDITED_RULES,
      rulesVersion: 1,
      players: state.players,
      disconnectedAt: { P1: null, P2: null },
      fleets: { P1: { ships: [], hasConfirmed: false }, P2: { ships: [], hasConfirmed: false } },
      deadline: LATER + PLACEMENT_TIME_LIMIT_MS,
      countdownEndsAt: null,
    });
    expect(projectSnapshot(resolved, SEATS.P1, LATER)).toMatchObject({
      gameOver: null,
      battle: null,
      placement: { myShips: [], hasConfirmed: { me: false, opponent: false }, remainingMs: PLACEMENT_TIME_LIMIT_MS },
    });
  });

  it('opens RULES_NEGOTIATION on any CHANGE_RULES with the rules and version in place and nobody confirmed (ADR-0004)', () => {
    const state = editedGameOverRoom();
    const resolved = choose(
      choose(state, SEATS.P1, REMATCH_CHOICES.CHANGE_RULES),
      SEATS.P2,
      REMATCH_CHOICES.SAME_RULES,
    );
    expect(resolved).toEqual({
      phase: ROOM_PHASES.RULES_NEGOTIATION,
      roomId: ROOM_ID,
      rules: EDITED_RULES,
      rulesVersion: 1,
      players: state.players,
      disconnectedAt: { P1: null, P2: null },
      hasConfirmedRules: { P1: false, P2: false },
    });
    expect(projectSnapshot(resolved, SEATS.P2, LATER)).toMatchObject({
      rulesVersion: 1,
      hasConfirmedRules: { me: false, opponent: false },
    });
    // The version did not move, so both confirmations of it start placement, and no older version could.
    const confirm = (room: RoomState, seat: Seat): RoomState =>
      apply(room, { type: CLIENT_EVENTS.CONFIRM_RULES, seat, payload: { rulesVersion: 1 } }, LATER);
    expect(confirm(confirm(resolved, SEATS.P1), SEATS.P2)).toMatchObject({
      phase: ROOM_PHASES.PLACEMENT,
      rules: EDITED_RULES,
      rulesVersion: 1,
    });
  });

  it('starts a new match from the rematch placement with no shot, no AFK count and no pause', () => {
    const resolved = choose(
      choose(gameOverRoom(), SEATS.P1, REMATCH_CHOICES.SAME_RULES),
      SEATS.P2,
      REMATCH_CHOICES.SAME_RULES,
    );
    const battle = endPlacementNow(placeAndConfirm(placeAndConfirm(resolved, SEATS.P1, fleet(3)), SEATS.P2, fleet(4)));
    expect(battle).toMatchObject({
      phase: ROOM_PHASES.IN_PROGRESS,
      battle: { boards: { P1: { shots: [] }, P2: { shots: [] } } },
      draftTargets: [],
      afkCount: { P1: 0, P2: 0 },
      isPaused: false,
    });
  });

  it('acks the same choice again without changing the room', () => {
    const once = choose(gameOverRoom(), SEATS.P1, REMATCH_CHOICES.SAME_RULES);
    const again = expectChosen(chooseRematch(once, SEATS.P1, REMATCH_CHOICES.SAME_RULES, LATER + 1));
    expect(again.hasLeft).toBe(false);
    expect(again.state).toBe(once);
  });

  it('lets a seat change its choice until the other one chooses', () => {
    const changed = choose(
      choose(gameOverRoom(), SEATS.P1, REMATCH_CHOICES.CHANGE_RULES),
      SEATS.P1,
      REMATCH_CHOICES.SAME_RULES,
    );
    expect(changed).toMatchObject({
      phase: ROOM_PHASES.GAME_OVER,
      rematch: { P1: REMATCH_CHOICES.SAME_RULES, P2: null },
    });
    expect(choose(changed, SEATS.P2, REMATCH_CHOICES.SAME_RULES).phase).toBe(ROOM_PHASES.PLACEMENT);
  });

  it('never mutates the room', () => {
    const state = deepFreeze(choose(gameOverRoom(), SEATS.P1, REMATCH_CHOICES.SAME_RULES));
    const before = structuredClone(state);
    for (const choice of Object.values(REMATCH_CHOICES)) {
      expectChosen(chooseRematch(state, SEATS.P2, choice, LATER));
    }
    expect(state).toEqual(before);
  });
});

describe('a rematch with a seat away (ADR-0124)', () => {
  /** P2 chose, then dropped at `NOW`; P1 is connected. */
  function p2ChoseThenDropped(choice: RecordedRematchChoice): RoomState {
    return disconnectSeat(choose(gameOverRoom(), SEATS.P2, choice, NOW), SEATS.P2, NOW);
  }

  it('keeps both choices and stays in GAME_OVER while a seat is away', () => {
    const waiting = choose(p2ChoseThenDropped(REMATCH_CHOICES.SAME_RULES), SEATS.P1, REMATCH_CHOICES.SAME_RULES);
    expect(waiting).toMatchObject({
      phase: ROOM_PHASES.GAME_OVER,
      rematch: { P1: REMATCH_CHOICES.SAME_RULES, P2: REMATCH_CHOICES.SAME_RULES },
      disconnectedAt: { P1: null, P2: NOW },
    });
    // No forfeit clock runs at game over, so nothing frees the absent seat.
    expect(nextForfeit(waiting)).toBeNull();
  });

  it('resolves on the return of the absent seat, the placement deadline counting from it, with no forfeit clock', () => {
    const waiting = choose(p2ChoseThenDropped(REMATCH_CHOICES.SAME_RULES), SEATS.P1, REMATCH_CHOICES.SAME_RULES);
    const back = reconnectSeat(waiting, SEATS.P2, LATER + 5_000);
    expect(back).toMatchObject({
      phase: ROOM_PHASES.PLACEMENT,
      disconnectedAt: { P1: null, P2: null },
      deadline: LATER + 5_000 + PLACEMENT_TIME_LIMIT_MS,
    });
    expect(nextForfeit(back)).toBeNull();
  });

  it('lets the connected seat change its choice while the other is away, and resolves on what is kept then', () => {
    const waiting = choose(p2ChoseThenDropped(REMATCH_CHOICES.SAME_RULES), SEATS.P1, REMATCH_CHOICES.SAME_RULES);
    const changed = choose(waiting, SEATS.P1, REMATCH_CHOICES.CHANGE_RULES);
    expect(changed).toMatchObject({ phase: ROOM_PHASES.GAME_OVER, rematch: { P1: REMATCH_CHOICES.CHANGE_RULES } });
    expect(reconnectSeat(changed, SEATS.P2, LATER).phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
  });

  it('stays in GAME_OVER on a return while a choice is missing, the choice made kept', () => {
    const back = reconnectSeat(p2ChoseThenDropped(REMATCH_CHOICES.CHANGE_RULES), SEATS.P2, LATER);
    expect(back).toMatchObject({
      phase: ROOM_PHASES.GAME_OVER,
      rematch: { P1: null, P2: REMATCH_CHOICES.CHANGE_RULES },
      disconnectedAt: { P1: null, P2: null },
    });
  });

  it('needs both seats back when both are away', () => {
    const bothChose = choose(p2ChoseThenDropped(REMATCH_CHOICES.SAME_RULES), SEATS.P1, REMATCH_CHOICES.SAME_RULES);
    const bothAway = disconnectSeat(bothChose, SEATS.P1, LATER);
    const oneBack = reconnectSeat(bothAway, SEATS.P2, LATER + 1);
    expect(oneBack.phase).toBe(ROOM_PHASES.GAME_OVER);
    expect(reconnectSeat(oneBack, SEATS.P1, LATER + 2).phase).toBe(ROOM_PHASES.PLACEMENT);
  });
});

describe('REMATCH_CHOICE LEAVE (ADR-0123)', () => {
  it.each(Object.values(SEATS))('frees the seat of %s at once, as LEAVE_ROOM does at game over', (seat) => {
    const state = gameOverRoom();
    const stayer = otherSeat(seat);
    const left = expectChosen(chooseRematch(state, seat, REMATCH_CHOICES.LEAVE, LATER));
    expect(left).toEqual({
      ok: true,
      hasLeft: true,
      state: {
        phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
        roomId: ROOM_ID,
        rules: DEFAULT_RULES,
        rulesVersion: 0,
        players: { [seat]: null, [stayer]: state.players[stayer] },
        disconnectedAt: { P1: null, P2: null },
      },
    });
    expect(leaveRoom(state, seat)).toEqual({ ok: true, state: left.state });
  });

  it("drops the other player's choice and keeps the rules and version for the next joiner", () => {
    const chosen = choose(editedGameOverRoom(), SEATS.P1, REMATCH_CHOICES.SAME_RULES);
    expect(choose(chosen, SEATS.P2, REMATCH_CHOICES.LEAVE)).toEqual({
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      roomId: ROOM_ID,
      rules: EDITED_RULES,
      rulesVersion: 1,
      players: { P1: chosen.players.P1, P2: null },
      disconnectedAt: { P1: null, P2: null },
    });
  });

  it('frees the seat even when the other player is away, whose forfeit clock runs again from their drop', () => {
    const away = disconnectSeat(gameOverRoom(), SEATS.P2, NOW);
    const left = choose(away, SEATS.P1, REMATCH_CHOICES.LEAVE);
    expect(left).toMatchObject({ phase: ROOM_PHASES.WAITING_FOR_OPPONENT, disconnectedAt: { P1: null, P2: NOW } });
    expect(nextForfeit(left)).toMatchObject({ seat: SEATS.P2, at: NOW + 180_000 });
  });

  it('is LEAVE from a seat that is away too, when its choice reaches the server late: the seat is freed all the same', () => {
    const away = disconnectSeat(gameOverRoom(), SEATS.P1, NOW);
    expect(choose(away, SEATS.P1, REMATCH_CHOICES.LEAVE)).toMatchObject({
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      players: { P1: null },
      disconnectedAt: { P1: null, P2: null },
    });
  });
});

describe('REMATCH_CHOICE outside GAME_OVER', () => {
  it.each([
    [ROOM_PHASES.WAITING_FOR_OPPONENT, waitingRoom],
    [ROOM_PHASES.RULES_NEGOTIATION, negotiationRoom],
    [ROOM_PHASES.PLACEMENT, placementRoom],
    [ROOM_PHASES.IN_PROGRESS, battleRoom],
  ])('is WRONG_PHASE in %s for every choice, LEAVE included', (_phase, room) => {
    for (const choice of Object.values(REMATCH_CHOICES)) {
      expect(chooseRematch(room(), SEATS.P1, choice, LATER)).toEqual({ ok: false, error: ERROR_CODES.WRONG_PHASE });
    }
  });

  it.each(PLAY_AGAIN)(
    'after P1 %s and P2 %s resolved into %s, a late choice from either seat is WRONG_PHASE and frees no seat',
    (p1Choice, p2Choice) => {
      const resolved = choose(choose(gameOverRoom(), SEATS.P1, p1Choice), SEATS.P2, p2Choice);
      for (const seat of Object.values(SEATS)) {
        for (const choice of Object.values(REMATCH_CHOICES)) {
          expect(chooseRematch(resolved, seat, choice, LATER)).toEqual({ ok: false, error: ERROR_CODES.WRONG_PHASE });
        }
      }
    },
  );

  it('is WRONG_PHASE for the player left behind once the other left, so both LEAVE choices free one seat', () => {
    const left = choose(gameOverRoom(), SEATS.P1, REMATCH_CHOICES.LEAVE);
    expect(chooseRematch(left, SEATS.P2, REMATCH_CHOICES.LEAVE, LATER)).toEqual({
      ok: false,
      error: ERROR_CODES.WRONG_PHASE,
    });
    // LEAVE_ROOM still frees the last seat, and the room closes.
    expect(leaveRoom(left, SEATS.P2)).toEqual({ ok: true, state: null });
  });
});

describe('recordRematchChoice', () => {
  it('returns the same room for a choice already in place, even when the other seat chose too and is away', () => {
    const state: GameOverRoom = {
      ...gameOverRoom(),
      rematch: { P1: REMATCH_CHOICES.SAME_RULES, P2: REMATCH_CHOICES.CHANGE_RULES },
      disconnectedAt: { P1: null, P2: NOW },
    };
    expect(recordRematchChoice(state, SEATS.P1, REMATCH_CHOICES.SAME_RULES, LATER)).toBe(state);
  });

  it('builds the negotiation from the GAME_OVER room only, nothing of the match carried', () => {
    const state = editedGameOverRoom();
    const resolved = recordRematchChoice(
      { ...state, rematch: { P1: REMATCH_CHOICES.CHANGE_RULES, P2: null } },
      SEATS.P2,
      REMATCH_CHOICES.CHANGE_RULES,
      LATER,
    ) as NegotiationRoom;
    expect(Object.keys(resolved).sort()).toEqual(
      ['disconnectedAt', 'hasConfirmedRules', 'phase', 'players', 'roomId', 'rules', 'rulesVersion'].sort(),
    );
  });
});
