// Salvo mode over real sockets: the rules negotiated with salvo on, multi-target drafts and shots, the allowance
// shrinking as the shooter's ships sink, and a timed-out salvo turn (docs/server.md#turns, ADR-0112, ADR-0113).

import {
  autoShotTargets,
  CLIENT_EVENTS,
  createSeededRng,
  DEFAULT_RULES,
  DICE_ANIMATION_MS,
  ERROR_CODES,
  generateRoomId,
  rollDice,
  SEATS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  type Battle,
  type Coordinate,
  type GameRules,
  type PlacedShip,
} from '@battleship/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clock,
  P1_FLEET_SEED,
  P2_FLEET_SEED,
  placedFleet,
  ROOM_SEED,
  send,
  start,
  startedMatch,
  stop,
  waterOf,
  type Player,
  type StartedMatch,
} from './socket-harness.js';

afterEach(stop);

/** `DEFAULT_RULES` with salvo mode on. */
const SALVO_RULES: GameRules = { ...DEFAULT_RULES, isSalvoModeEnabled: true };

/** A turn under `SALVO_RULES`, in ms: the same limit as a single-shot turn (ADR-0114). */
const TURN_LIMIT_MS = SALVO_RULES.turnTimeLimitSeconds * 1_000;

/**
 * The salvo match right after its dice animation, `P1` to fire (`ROOM_SEED`), both players told it may fire five
 * targets.
 * @returns The started match.
 */
async function firstSalvoTurn(): Promise<StartedMatch> {
  const match = await startedMatch(SALVO_RULES);
  clock.advance(DICE_ANIMATION_MS);
  for (const { inbox } of [match.p1, match.p2]) {
    expect((await inbox.state()).battle).toMatchObject({ currentTurn: SEATS.P1, shotsAllowed: 5 });
  }
  return match;
}

/**
 * The cells of one ship of a seeded fleet.
 * @param fleet The fleet.
 * @param type The ship's type.
 * @returns Its cells, bow first.
 */
function cellsOfShip(fleet: readonly PlacedShip[], type: PlacedShip['type']): Coordinate[] {
  const ship = fleet.find((placed) => placed.type === type);
  if (ship === undefined) {
    expect.fail(`no ${type} in the fleet`);
  }
  return [...ship.coordinates];
}

/**
 * Fires a salvo and checks that both players get one `SHOT_RESOLVED` with every result, then a `STATE` with the next
 * shooter and its allowance.
 * @param shooter The player whose turn it is.
 * @param other The other player.
 * @param targets The salvo, in firing order.
 * @param next The seat that fires next and the allowance both players are told.
 * @returns The results, as both players got them.
 */
async function fireSalvo(
  shooter: Player,
  other: Player,
  targets: readonly Coordinate[],
  next: { currentTurn: string; shotsAllowed: number },
): Promise<unknown[]> {
  expect(await send(shooter, CLIENT_EVENTS.FIRE, { targets: [...targets] })).toEqual({ ok: true });
  const received: unknown[][] = [];
  for (const { inbox } of [shooter, other]) {
    const shot = await inbox.shot();
    expect(shot.results.map((result) => result.coordinate)).toEqual(targets);
    received.push([...shot.results]);
    expect((await inbox.state()).battle).toMatchObject(next);
  }
  expect(received[1]).toEqual(received[0]);
  return received[0] ?? [];
}

describe('a salvo match between two real clients', () => {
  it("agrees on salvo, drafts and fires five targets, and allows one fewer once a shooter's ship is sunk", async () => {
    await start();
    // `startedMatch` sends UPDATE_RULES with salvo on, and checks the ack: `{ ok: true, rulesVersion: 1 }`.
    const { p1, p2 } = await firstSalvoTurn();
    const p2Fleet = placedFleet(P2_FLEET_SEED);
    const p1Fleet = placedFleet(P1_FLEET_SEED);
    const p2Destroyer = cellsOfShip(p2Fleet, SHIP_TYPES.DESTROYER);
    const p1Destroyer = cellsOfShip(p1Fleet, SHIP_TYPES.DESTROYER);
    const p1Salvo = [...p2Destroyer, ...waterOf(p2Fleet).slice(0, 3)];

    // A partial draft, kept for the active player only.
    expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: p1Salvo.slice(0, 2) })).toEqual({ ok: true });
    expect((await p1.inbox.state()).battle?.myDraftTargets).toEqual(p1Salvo.slice(0, 2));
    expect((await p2.inbox.state()).battle?.myDraftTargets).toEqual([]);

    // Too few targets is the turn's rule (INVALID_TARGETS); more than the fleet is the payload guard's (INVALID_PAYLOAD).
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: p1Salvo.slice(0, 4) })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_TARGETS,
    });
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [...p1Salvo, { x: 9, y: 9 }] })).toMatchObject({
      ok: false,
      error: ERROR_CODES.INVALID_PAYLOAD,
    });

    // The salvo sinks P2's destroyer, so P2, whose turn comes, has four ships and four targets.
    const results = await fireSalvo(p1, p2, p1Salvo, { currentTurn: SEATS.P2, shotsAllowed: 4 });
    expect(results).toEqual([
      { coordinate: p2Destroyer[0], outcome: SHOT_OUTCOMES.HIT },
      expect.objectContaining({ coordinate: p2Destroyer[1], outcome: SHOT_OUTCOMES.SUNK }),
      ...p1Salvo.slice(2).map((coordinate) => ({ coordinate, outcome: SHOT_OUTCOMES.MISS })),
    ]);

    // P2 sinks P1's destroyer: P1 has four ships left, so four targets.
    const p2Salvo = [...p1Destroyer, ...waterOf(p1Fleet).slice(0, 2)];
    await fireSalvo(p2, p1, p2Salvo, { currentTurn: SEATS.P1, shotsAllowed: 4 });
    expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: waterOf(p2Fleet).slice(3, 8) })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_TARGETS,
    });
    await fireSalvo(p1, p2, waterOf(p2Fleet).slice(3, 7), { currentTurn: SEATS.P2, shotsAllowed: 4 });
  });

  it('fires a partial draft at the timeout, then random targets, in one SHOT_RESOLVED', async () => {
    await start();
    const { p1, p2 } = await firstSalvoTurn();
    const draft = [
      { x: 9, y: 9 },
      { x: 0, y: 0 },
    ];
    expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: draft })).toEqual({ ok: true });
    await p1.inbox.state();
    await p2.inbox.state();

    // The registry's `Rng` drew the room id and rolled the dice before the auto shot (docs/server.md#testability).
    const rng = createSeededRng(ROOM_SEED);
    generateRoomId(rng);
    rollDice(rng);
    const battle: Battle = {
      boards: {
        P1: { ships: placedFleet(P1_FLEET_SEED), shots: [] },
        P2: { ships: placedFleet(P2_FLEET_SEED), shots: [] },
      },
      currentTurn: SEATS.P1,
    };
    const expected = autoShotTargets(battle, draft, 5, rng);
    expect(expected.slice(0, 2)).toEqual(draft);

    clock.advance(TURN_LIMIT_MS);
    for (const { inbox } of [p1, p2]) {
      const shot = await inbox.shot();
      expect(shot.shooter).toBe(SEATS.P1);
      expect(shot.results.map((result) => result.coordinate)).toEqual(expected);
      expect((await inbox.state()).battle).toMatchObject({ currentTurn: SEATS.P2, shotsAllowed: 5 });
    }
  });
});
