// The dice roll over real sockets: `DICE_ROLLED` with every round to both players before the `STATE` that starts the
// match, the starter's first turn, and what a player who comes back during the dice animation gets
// (docs/server.md#placement, ADR-0002, ADR-0092, ADR-0093, ADR-0094).

import {
  CLIENT_EVENTS,
  createSeededRng,
  DICE_ANIMATION_MS,
  ERROR_CODES,
  generateRoomId,
  ROOM_PHASES,
  rollDice,
  SEATS,
  START_COUNTDOWN_MS,
  type DiceRolledPayload,
  type Seat,
} from '@battleship/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clock,
  drop,
  expectNothingPending,
  P1_FLEET_SEED,
  P2_FLEET_SEED,
  placedFleet,
  placeFleets,
  placements,
  placingPlayers,
  player,
  rooms,
  send,
  start,
  startedMatch,
  stop,
} from './socket-harness.js';

afterEach(stop);

/**
 * The roll a seeded registry makes after drawing some room ids and completing no fleet.
 * @param seed The registry's seed.
 * @param roomCount How many room ids it drew before the match started.
 * @returns What `DICE_ROLLED` carries.
 */
function expectedDice(seed: number, roomCount = 1): DiceRolledPayload {
  const rng = createSeededRng(seed);
  for (let room = 0; room < roomCount; room++) {
    generateRoomId(rng);
  }
  return rollDice(rng);
}

describe('the dice roll', () => {
  it.each([
    [17, SEATS.P2],
    [4, SEATS.P1],
  ] as const)(
    'with seed %i sends a tie and the decisive round to both players before the STATE, and %s fires first',
    async (seed: number, starter: Seat) => {
      const dice = expectedDice(seed);
      expect(dice.rolls).toHaveLength(2);
      expect(dice.rolls[0]?.P1).toBe(dice.rolls[0]?.P2);
      expect(dice.starter).toBe(starter);

      await start({ seed });
      const { p1, p2 } = await placingPlayers();
      await placeFleets(p1, p2);
      for (const { inbox } of [p1, p2]) {
        await inbox.states(4);
        expect(await inbox.dice()).toEqual(dice);
        expect(await inbox.state()).toMatchObject({
          phase: ROOM_PHASES.IN_PROGRESS,
          battle: { currentTurn: starter, turnRemainingMs: null },
        });
      }

      const [first, second] = starter === SEATS.P1 ? [p1, p2] : [p2, p1];
      const target = { targets: [{ x: 9, y: 9 }] };
      expect(await send(second, CLIENT_EVENTS.FIRE, target)).toEqual({ ok: false, error: ERROR_CODES.NOT_YOUR_TURN });
      // The dice animation is the starter's turn already: the shot is accepted before DICE_ANIMATION_MS.
      expect(await send(first, CLIENT_EVENTS.FIRE, target)).toEqual({ ok: true });
      for (const { inbox } of [p1, p2]) {
        expect((await inbox.shot()).shooter).toBe(starter);
        expect((await inbox.state()).battle?.currentTurn).toBe(starter === SEATS.P1 ? SEATS.P2 : SEATS.P1);
      }
    },
  );

  it('reaches the players of its own room only', async () => {
    await start();
    const outsider = await player();
    expect(await send(outsider, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Carol' })).toMatchObject({ ok: true });
    await outsider.inbox.state();
    const { dice } = await startedMatch();
    expect(dice).toEqual(expectedDice(7, 2));
    await expectNothingPending(outsider);
  });

  it('sends nothing more when the dice animation ends: the turn timer (#30) will start then', async () => {
    await start();
    const { p1, p2, roomId } = await startedMatch();
    const room = rooms.get(roomId);
    expect(room).toMatchObject({ phase: ROOM_PHASES.IN_PROGRESS, firstTurnStartsAt: clock.now() + DICE_ANIMATION_MS });
    clock.advance(DICE_ANIMATION_MS);
    expect(rooms.get(roomId)).toBe(room);
    expect(clock.pendingCount).toBe(0);
    // The next event either player gets is the shot's: nothing went out when the animation ended.
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 9, y: 9 }] })).toEqual({ ok: true });
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).shooter).toBe(SEATS.P1);
      expect((await inbox.state()).battle?.turnRemainingMs).toBeNull();
    }
  });
});

describe('a player who comes back during the dice animation (ADR-0094)', () => {
  it('gets the snapshot of the started match, without the roll, and its turn time still null', async () => {
    await start();
    const { p1, p2, roomId, sessions, dice } = await startedMatch();
    await drop(p2, roomId, SEATS.P2);
    expect((await p1.inbox.state()).battle?.isPaused).toBe(true);

    clock.advance(DICE_ANIMATION_MS / 3);
    const back = await player(sessions.P2);
    expect(await back.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.IN_PROGRESS,
      me: { seat: SEATS.P2, isConnected: true },
      battle: {
        currentTurn: dice.starter,
        turnRemainingMs: null,
        isPaused: false,
        myShips: placedFleet(P2_FLEET_SEED),
      },
    });
    expect((await p1.inbox.state()).battle?.isPaused).toBe(false);
    await expectNothingPending(back);
  });

  it('who was away when the match started paused gets no roll either: the snapshot names the starter', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await placingPlayers();
    for (const [from, seed] of [
      [p1, P1_FLEET_SEED],
      [p2, P2_FLEET_SEED],
    ] as const) {
      expect(await send(from, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(placedFleet(seed)) })).toEqual({
        ok: true,
      });
    }
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
    await p2.inbox.states(3);
    await drop(p1, roomId, SEATS.P1);
    await p2.inbox.state();
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
    await p2.inbox.state();

    clock.advance(START_COUNTDOWN_MS);
    const dice = await p2.inbox.dice();
    expect(dice).toEqual(expectedDice(7));
    expect(await p2.inbox.state()).toMatchObject({ battle: { currentTurn: dice.starter, isPaused: true } });

    clock.advance(DICE_ANIMATION_MS / 3);
    const back = await player(sessions.P1);
    expect(await back.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.IN_PROGRESS,
      battle: { currentTurn: dice.starter, turnRemainingMs: null, isPaused: false },
    });
    await expectNothingPending(back);
  });
});
