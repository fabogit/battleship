// The turn timer over real sockets: the first turn after the dice animation, both timeout actions, the AFK counts and
// the match ends they lead to, the pause, and a player who comes back mid-turn (docs/server.md#turns, ADR-0009,
// ADR-0074, ADR-0093, ADR-0099).

import {
  autoShotTargets,
  CLIENT_EVENTS,
  createSeededRng,
  DEFAULT_RULES,
  DICE_ANIMATION_MS,
  ERROR_CODES,
  GAME_OVER_REASONS,
  GAME_OVER_TTL_MS,
  generateRoomId,
  ROOM_CLOSED_REASONS,
  ROOM_PHASES,
  rollDice,
  SEATS,
  SHOT_OUTCOMES,
  START_COUNTDOWN_MS,
  TIMEOUT_ACTIONS,
  type Battle,
  type Coordinate,
  type GameRules,
  type Seat,
  type SessionCredentials,
} from '@battleship/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clock,
  drop,
  expectNothingPending,
  P1_FLEET_SEED,
  P2_FLEET_SEED,
  placedFleet,
  placements,
  placingPlayers,
  player,
  ROOM_SEED,
  rooms,
  send,
  start,
  startedMatch,
  stop,
  TURN_MS,
  waterOf,
  type Player,
  type StartedMatch,
} from './socket-harness.js';

afterEach(stop);

/** A turn under `DEFAULT_RULES`, in ms. */
const TURN_LIMIT_MS = DEFAULT_RULES.turnTimeLimitSeconds * 1_000;

/** The default rules, but a timed-out turn passes instead of firing. */
const PASS_TURN_RULES: GameRules = { ...DEFAULT_RULES, timeoutAction: TIMEOUT_ACTIONS.PASS_TURN };

/** A cell neither seeded fleet occupies: a miss for either player. */
const WATER: Coordinate = { x: 9, y: 9 };

/**
 * The match right after its dice animation, `P1` to fire (`ROOM_SEED`): the first turn's timer has started, and both
 * players have read the `STATE` that says so.
 * @param rules The rules of the match.
 * @returns The started match.
 */
async function firstTurn(rules: GameRules = DEFAULT_RULES): Promise<StartedMatch> {
  const match = await startedMatch(rules);
  clock.advance(DICE_ANIMATION_MS);
  for (const { inbox } of [match.p1, match.p2]) {
    expect((await inbox.state()).battle).toMatchObject({
      currentTurn: SEATS.P1,
      turnRemainingMs: rules.turnTimeLimitSeconds * 1_000,
    });
  }
  return match;
}

/**
 * The battle at the start of the server's first match: the seeded fleets, no shot, `P1` to fire.
 * @returns The battle as the room holds it.
 */
function firstBattle(): Battle {
  return {
    boards: {
      P1: { ships: placedFleet(P1_FLEET_SEED), shots: [] },
      P2: { ships: placedFleet(P2_FLEET_SEED), shots: [] },
    },
    currentTurn: SEATS.P1,
  };
}

/**
 * The target of `P1`'s first turn when it times out with `AUTO_RANDOM_SHOT`: the registry's `Rng` drew the room id and
 * rolled the dice before it (docs/server.md#testability).
 * @param draft The draft the room held.
 * @returns The targets the auto shot fires.
 */
function firstAutoShot(draft: readonly Coordinate[] = []): Coordinate[] {
  const rng = createSeededRng(ROOM_SEED);
  generateRoomId(rng);
  rollDice(rng);
  return autoShotTargets(firstBattle(), draft, 1, rng);
}

/**
 * A cell of a board that nobody has fired at yet, whatever the auto shots picked.
 * @param roomId The room in `IN_PROGRESS`.
 * @param board The seat whose board is fired at.
 * @returns The first unshot cell, row by row.
 */
function unshotCell(roomId: string, board: Seat): Coordinate {
  const room = rooms.get(roomId);
  const shots = room?.phase === ROOM_PHASES.IN_PROGRESS ? room.battle.boards[board].shots : [];
  const cell = waterOf([]).find(
    ({ x, y }) => !shots.some(({ coordinate }) => coordinate.x === x && coordinate.y === y),
  );
  if (cell === undefined) {
    expect.fail('no unshot cell');
  }
  return cell;
}

/**
 * Fires one shot and reads the `SHOT_RESOLVED` and `STATE` it sends to both players.
 * @param shooter The player whose turn it is.
 * @param other The other player.
 * @param target The cell to fire at.
 */
async function fire(shooter: Player, other: Player, target: Coordinate): Promise<void> {
  expect(await send(shooter, CLIENT_EVENTS.FIRE, { targets: [target] })).toEqual({ ok: true });
  for (const { inbox } of [shooter, other]) {
    await inbox.shot();
    await inbox.state();
  }
}

/**
 * Runs a turn's whole time out with an auto shot, and reads what it sends: `SHOT_RESOLVED`, then `STATE`.
 * @param players Both players.
 * @param seat The seat whose turn runs out.
 */
async function timeOutWithShot(players: readonly Player[], seat: Seat): Promise<void> {
  clock.advance(TURN_LIMIT_MS);
  for (const { inbox } of players) {
    expect((await inbox.shot()).shooter).toBe(seat);
    await inbox.state();
  }
}

describe('the turn timer (ADR-0093, ADR-0099)', () => {
  it('starts after the dice animation and times the first turn out turnTimeLimitSeconds later, not before', async () => {
    await start();
    const { p1, p2, roomId } = await firstTurn();
    clock.advance(TURN_LIMIT_MS - 1);
    expect(rooms.get(roomId)).toMatchObject({ battle: { currentTurn: SEATS.P1 } });
    clock.advance(1);
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).shooter).toBe(SEATS.P1);
      expect((await inbox.state()).battle).toMatchObject({ currentTurn: SEATS.P2, turnRemainingMs: TURN_LIMIT_MS });
    }
  });

  it('counts the next turn from a shot fired during the dice animation, which ends the first turn', async () => {
    await start();
    const { p1, p2 } = await startedMatch();
    clock.advance(DICE_ANIMATION_MS / 3);
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [WATER] })).toEqual({ ok: true });
    for (const { inbox } of [p1, p2]) {
      await inbox.shot();
      expect((await inbox.state()).battle).toMatchObject({ currentTurn: SEATS.P2, turnRemainingMs: TURN_LIMIT_MS });
    }
    // Nothing is sent when the animation ends: the next event is P2's timeout, a whole turn after the shot.
    clock.advance(TURN_LIMIT_MS - 1);
    clock.advance(1);
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).shooter).toBe(SEATS.P2);
      expect((await inbox.state()).battle?.currentTurn).toBe(SEATS.P1);
    }
  });

  it('refuses a shot from the player whose turn has just timed out: the timer ran first', async () => {
    await start();
    const { p1, p2 } = await firstTurn();
    await timeOutWithShot([p1, p2], SEATS.P1);
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [WATER] })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_YOUR_TURN,
    });
  });
});

describe('AUTO_RANDOM_SHOT', () => {
  it('fires a random unshot cell for an empty draft, from the server Rng, and counts one AFK turn', async () => {
    await start();
    const { p1, p2 } = await firstTurn();
    const [target] = firstAutoShot();
    clock.advance(TURN_LIMIT_MS);
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.shot()).toEqual({
        shooter: SEATS.P1,
        results: [expect.objectContaining({ coordinate: target })],
      });
    }
    expect((await p1.inbox.state()).battle).toMatchObject({
      outgoingShots: [expect.objectContaining({ coordinate: target })],
      afkCount: { me: 1, opponent: 0 },
    });
    expect((await p2.inbox.state()).battle).toMatchObject({
      incomingShots: [expect.objectContaining({ coordinate: target })],
      afkCount: { me: 0, opponent: 1 },
    });
  });

  it('fires the draft the player left', async () => {
    await start();
    const { p1, p2 } = await firstTurn();
    expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: [{ x: 3, y: 3 }] })).toEqual({ ok: true });
    await p1.inbox.state();
    await p2.inbox.state();
    clock.advance(TURN_LIMIT_MS);
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).results).toEqual([expect.objectContaining({ coordinate: { x: 3, y: 3 } })]);
      expect((await inbox.state()).battle?.myDraftTargets).toEqual([]);
    }
  });

  it('fires the draft the room kept when a later draft was refused', async () => {
    await start();
    const { p1, p2 } = await firstTurn();
    expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: [{ x: 3, y: 3 }] })).toEqual({ ok: true });
    await p1.inbox.state();
    await p2.inbox.state();
    const tooMany = { targets: [WATER, { x: 3, y: 3 }] };
    expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, tooMany)).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_TARGETS,
    });
    clock.advance(TURN_LIMIT_MS);
    expect((await p1.inbox.shot()).results).toEqual([expect.objectContaining({ coordinate: { x: 3, y: 3 } })]);
  });

  it('fires at random when the only draft sent was refused', async () => {
    await start();
    const { p1, p2 } = await firstTurn();
    expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: [WATER, WATER] })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_TARGETS,
    });
    const [target] = firstAutoShot();
    clock.advance(TURN_LIMIT_MS);
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).results).toEqual([expect.objectContaining({ coordinate: target })]);
    }
  });

  it('can sink the last ship and win the match for the player who timed out', async () => {
    await start();
    const { p1, p2 } = await firstTurn();
    const p1Targets = placedFleet(P2_FLEET_SEED).flatMap((ship) => ship.coordinates);
    const p2Targets = waterOf(placedFleet(P1_FLEET_SEED));
    const last = p1Targets.pop();
    if (last === undefined) {
      expect.fail('no ship cell');
    }
    for (const [turn, target] of p1Targets.entries()) {
      clock.advance(TURN_MS);
      await fire(p1, p2, target);
      await fire(p2, p1, p2Targets[turn] ?? WATER);
    }
    expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: [last] })).toEqual({ ok: true });
    await p1.inbox.state();
    await p2.inbox.state();

    clock.advance(TURN_LIMIT_MS);
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).results).toEqual([
        expect.objectContaining({ coordinate: last, outcome: SHOT_OUTCOMES.SUNK }),
      ]);
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.GAME_OVER,
        gameOver: { winner: SEATS.P1, reason: GAME_OVER_REASONS.FLEET_DESTROYED },
      });
    }
  });
});

describe('PASS_TURN', () => {
  it('discards the draft and hands the turn over without a shot, counting one AFK turn', async () => {
    await start();
    const { p1, p2, roomId } = await firstTurn(PASS_TURN_RULES);
    expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: [{ x: 3, y: 3 }] })).toEqual({ ok: true });
    await p1.inbox.state();
    await p2.inbox.state();

    clock.advance(TURN_LIMIT_MS);
    // STATE comes first: no SHOT_RESOLVED for a passed turn.
    expect((await p1.inbox.state()).battle).toMatchObject({
      currentTurn: SEATS.P2,
      outgoingShots: [],
      myDraftTargets: [],
      turnRemainingMs: TURN_LIMIT_MS,
      afkCount: { me: 1, opponent: 0 },
    });
    expect((await p2.inbox.state()).battle).toMatchObject({ currentTurn: SEATS.P2, incomingShots: [] });
    expect(rooms.get(roomId)).toMatchObject({ draftTargets: [] });

    clock.advance(TURN_LIMIT_MS);
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.state()).battle).toMatchObject({
        currentTurn: SEATS.P1,
        incomingShots: [],
        outgoingShots: [],
      });
    }
  });
});

describe('AFK (ADR-0009)', () => {
  it('sets the count back to zero when the player fires', async () => {
    await start();
    const { p1, p2, roomId } = await firstTurn();
    const p2Water = waterOf(placedFleet(P1_FLEET_SEED));
    await timeOutWithShot([p1, p2], SEATS.P1);
    await fire(p2, p1, p2Water[0] ?? WATER);
    await timeOutWithShot([p1, p2], SEATS.P1);
    await fire(p2, p1, p2Water[1] ?? WATER);
    expect(rooms.get(roomId)).toMatchObject({ afkCount: { P1: 2, P2: 0 } });

    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [unshotCell(roomId, SEATS.P2)] })).toEqual({ ok: true });
    await p1.inbox.shot();
    expect((await p1.inbox.state()).battle?.afkCount).toEqual({ me: 0, opponent: 0 });
    await p2.inbox.shot();
    await p2.inbox.state();
    await fire(p2, p1, p2Water[2] ?? WATER);
    // A third timeout in all, but only the first in a row: the match goes on.
    await timeOutWithShot([p1, p2], SEATS.P1);
    expect(rooms.get(roomId)).toMatchObject({ phase: ROOM_PHASES.IN_PROGRESS, afkCount: { P1: 1, P2: 0 } });
  });

  it('ends the match with AFK_FORFEIT at the third timeout in a row, without firing it', async () => {
    await start();
    const { p1, p2, roomId } = await firstTurn();
    const p2Water = waterOf(placedFleet(P1_FLEET_SEED));
    await timeOutWithShot([p1, p2], SEATS.P1);
    await fire(p2, p1, p2Water[0] ?? WATER);
    await timeOutWithShot([p1, p2], SEATS.P1);
    await fire(p2, p1, p2Water[1] ?? WATER);

    clock.advance(TURN_LIMIT_MS);
    // STATE comes first: the third timeout fires no shot.
    expect(await p1.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.GAME_OVER,
      gameOver: { winner: SEATS.P2, reason: GAME_OVER_REASONS.AFK_FORFEIT },
    });
    expect((await p2.inbox.state()).gameOver).toMatchObject({
      winner: SEATS.P2,
      reason: GAME_OVER_REASONS.AFK_FORFEIT,
    });
    expect(rooms.get(roomId)).toMatchObject({ battle: { boards: { P2: { shots: { length: 2 } } } } });

    // The game-over TTL runs as after any match.
    clock.advance(GAME_OVER_TTL_MS - 1);
    expect(rooms.get(roomId)).toBeDefined();
    clock.advance(1);
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.GAME_OVER_TTL });
    }
  });

  it('ends the match with AFK_FORFEIT while the opponent has timed out fewer than MAX − 1 turns in a row', async () => {
    await start();
    const { p1, p2 } = await firstTurn();
    await timeOutWithShot([p1, p2], SEATS.P1);
    await fire(p2, p1, WATER);
    await timeOutWithShot([p1, p2], SEATS.P1);
    await timeOutWithShot([p1, p2], SEATS.P2);
    clock.advance(TURN_LIMIT_MS);
    expect((await p1.inbox.state()).gameOver).toMatchObject({
      winner: SEATS.P2,
      reason: GAME_OVER_REASONS.AFK_FORFEIT,
    });
  });

  it('ends the match ABANDONED, with no winner, when both players stopped playing', async () => {
    await start();
    const { p1, p2 } = await firstTurn();
    for (const seat of [SEATS.P1, SEATS.P2, SEATS.P1, SEATS.P2]) {
      await timeOutWithShot([p1, p2], seat);
    }
    clock.advance(TURN_LIMIT_MS);
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.GAME_OVER,
        gameOver: { winner: null, reason: GAME_OVER_REASONS.ABANDONED },
      });
    }
  });

  it('counts the turns of a player who is away once the match is resumed', async () => {
    await start();
    const { p1, p2, roomId } = await firstTurn();
    await fire(p1, p2, WATER);
    await drop(p2, roomId, SEATS.P2);
    expect((await p1.inbox.state()).battle).toMatchObject({ isPaused: true, turnRemainingMs: TURN_LIMIT_MS });
    expect(await send(p1, CLIENT_EVENTS.SET_PAUSED, { isPaused: false })).toEqual({ ok: true });
    await p1.inbox.state();

    clock.advance(TURN_LIMIT_MS);
    expect((await p1.inbox.shot()).shooter).toBe(SEATS.P2);
    expect((await p1.inbox.state()).battle).toMatchObject({
      currentTurn: SEATS.P1,
      incomingShots: [expect.anything()],
      afkCount: { me: 0, opponent: 1 },
    });
  });
});

describe('the pause (ADR-0074)', () => {
  it('freezes the turn timer while a seat is away, and resumes it with the time left when it comes back', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await firstTurn();
    clock.advance(10_000);
    await drop(p1, roomId, SEATS.P1);
    expect((await p2.inbox.state()).battle).toMatchObject({ isPaused: true, turnRemainingMs: TURN_LIMIT_MS - 10_000 });

    clock.advance(60_000);
    const back = await player(sessions.P1);
    for (const { inbox } of [back, p2]) {
      expect((await inbox.state()).battle).toMatchObject({ isPaused: false, turnRemainingMs: TURN_LIMIT_MS - 10_000 });
    }
    clock.advance(TURN_LIMIT_MS - 10_000 - 1);
    expect(rooms.get(roomId)).toMatchObject({ battle: { currentTurn: SEATS.P1 } });
    clock.advance(1);
    for (const { inbox } of [back, p2]) {
      expect((await inbox.shot()).shooter).toBe(SEATS.P1);
    }
  });

  it('freezes and restarts it with SET_PAUSED from the connected player', async () => {
    await start();
    const { p1, p2, roomId } = await firstTurn();
    clock.advance(10_000);
    await drop(p2, roomId, SEATS.P2);
    await p1.inbox.state();

    expect(await send(p1, CLIENT_EVENTS.SET_PAUSED, { isPaused: false })).toEqual({ ok: true });
    expect((await p1.inbox.state()).battle).toMatchObject({ isPaused: false, turnRemainingMs: TURN_LIMIT_MS - 10_000 });
    clock.advance(5_000);
    expect(await send(p1, CLIENT_EVENTS.SET_PAUSED, { isPaused: true })).toEqual({ ok: true });
    expect((await p1.inbox.state()).battle).toMatchObject({ isPaused: true, turnRemainingMs: TURN_LIMIT_MS - 15_000 });

    clock.advance(60_000);
    expect(await send(p1, CLIENT_EVENTS.SET_PAUSED, { isPaused: false })).toEqual({ ok: true });
    expect((await p1.inbox.state()).battle).toMatchObject({ isPaused: false, turnRemainingMs: TURN_LIMIT_MS - 15_000 });
    clock.advance(TURN_LIMIT_MS - 15_000 - 1);
    expect(rooms.get(roomId)).toMatchObject({ battle: { currentTurn: SEATS.P1 } });
    clock.advance(1);
    expect((await p1.inbox.shot()).shooter).toBe(SEATS.P1);
  });

  it('gives a turn fired into during the pause its whole time, frozen until the resume', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await firstTurn();
    await drop(p2, roomId, SEATS.P2);
    await p1.inbox.state();
    clock.advance(10_000);
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [WATER] })).toEqual({ ok: true });
    await p1.inbox.shot();
    expect((await p1.inbox.state()).battle).toMatchObject({ isPaused: true, turnRemainingMs: TURN_LIMIT_MS });

    clock.advance(60_000);
    const back = await player(sessions.P2);
    expect((await back.inbox.state()).battle).toMatchObject({ currentTurn: SEATS.P2, turnRemainingMs: TURN_LIMIT_MS });
    await p1.inbox.state();
    clock.advance(TURN_LIMIT_MS);
    expect((await back.inbox.shot()).shooter).toBe(SEATS.P2);
  });
});

describe('a match that starts paused (ADR-0093)', () => {
  /**
   * A match whose placement ends while `P1` is away, so it starts paused; `P2` has read the dice and the snapshot.
   * @returns `P2`, the room and `P1`'s session.
   */
  async function pausedStart(): Promise<{ p2: Player; roomId: string; session: SessionCredentials }> {
    const { p1, p2, roomId, sessions } = await placingPlayers();
    for (const [from, seed] of [
      [p1, P1_FLEET_SEED],
      [p2, P2_FLEET_SEED],
    ] as const) {
      expect(await send(from, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(placedFleet(seed)) })).toEqual({
        ok: true,
      });
      expect(await send(from, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
    }
    await p2.inbox.states(4);
    await drop(p1, roomId, SEATS.P1);
    await p2.inbox.state();
    clock.advance(START_COUNTDOWN_MS);
    await p2.inbox.dice();
    expect((await p2.inbox.state()).battle).toMatchObject({ isPaused: true, turnRemainingMs: null });
    return { p2, roomId, session: sessions.P1 };
  }

  it('holds the first turn timer frozen with its whole time, which runs from the resume', async () => {
    await start();
    const { p2, roomId, session } = await pausedStart();
    clock.advance(DICE_ANIMATION_MS);
    // The animation is never paused: its end still starts the first turn's timer, frozen.
    expect((await p2.inbox.state()).battle).toMatchObject({ isPaused: true, turnRemainingMs: TURN_LIMIT_MS });

    clock.advance(60_000);
    const back = await player(session);
    for (const { inbox } of [back, p2]) {
      expect((await inbox.state()).battle).toMatchObject({ isPaused: false, turnRemainingMs: TURN_LIMIT_MS });
    }
    clock.advance(TURN_LIMIT_MS - 1);
    expect(rooms.get(roomId)).toMatchObject({ battle: { currentTurn: SEATS.P1 }, afkCount: { P1: 0, P2: 0 } });
    clock.advance(1);
    expect((await p2.inbox.shot()).shooter).toBe(SEATS.P1);
  });

  it('starts the first turn timer at the end of the animation when the resume comes before it', async () => {
    await start();
    const { p2, roomId, session } = await pausedStart();
    clock.advance(DICE_ANIMATION_MS / 3);
    const back = await player(session);
    for (const { inbox } of [back, p2]) {
      expect((await inbox.state()).battle).toMatchObject({ isPaused: false, turnRemainingMs: null });
    }
    clock.advance(DICE_ANIMATION_MS - DICE_ANIMATION_MS / 3);
    for (const { inbox } of [back, p2]) {
      expect((await inbox.state()).battle).toMatchObject({ isPaused: false, turnRemainingMs: TURN_LIMIT_MS });
    }
    clock.advance(TURN_LIMIT_MS - 1);
    expect(rooms.get(roomId)).toMatchObject({ battle: { currentTurn: SEATS.P1 } });
    clock.advance(1);
    expect((await p2.inbox.shot()).shooter).toBe(SEATS.P1);
  });
});

describe('a player who comes back mid-turn', () => {
  it('gets the turn time left at that moment, with nothing sent to the opponent', async () => {
    await start();
    const { p1, sessions } = await firstTurn();
    clock.advance(12_345);
    // A second tab takes the seat over; the seat never drops, so the match does not pause.
    const tab = await player(sessions.P2);
    expect((await tab.inbox.state()).battle).toMatchObject({
      currentTurn: SEATS.P1,
      isPaused: false,
      turnRemainingMs: TURN_LIMIT_MS - 12_345,
      afkCount: { me: 0, opponent: 0 },
    });
    await expectNothingPending(p1);
  });
});
