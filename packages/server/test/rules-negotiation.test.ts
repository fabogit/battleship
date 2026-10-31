// Rules negotiation over real sockets (docs/server.md#rules-negotiation, ADR-0003, ADR-0004, ADR-0082, ADR-0083).

import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  ORIENTATIONS,
  ROOM_PHASES,
  SEATS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  TIMEOUT_ACTIONS,
  type GameRules,
} from '@battleship/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  agreeOnRules,
  app,
  clock,
  drop,
  expectNothingPending,
  P2_FLEET_SEED,
  placedFleet,
  placeFleets,
  placingPlayers,
  player,
  playToVictory,
  rooms,
  seatedPlayers,
  send,
  start,
  startedMatch,
  stop,
  TURN_MS,
  waterOf,
  type Player,
} from './socket-harness.js';

afterEach(stop);

/** Rules the tests edit to: every field changed but salvo, which is refused until #32 (ADR-0085). */
const EDITED_RULES: GameRules = {
  isExtraTurnOnHitEnabled: true,
  areAdjacentShipsAllowed: true,
  turnTimeLimitSeconds: 60,
  isSalvoModeEnabled: false,
  timeoutAction: TIMEOUT_ACTIONS.PASS_TURN,
};

/**
 * Sends an edit that must be accepted and reads the `STATE` it sends to both players.
 * @returns The version the ack gave the rules.
 */
async function edit(from: Player, other: Player, rules: GameRules): Promise<number> {
  const ack = (await send(from, CLIENT_EVENTS.UPDATE_RULES, { rules })) as { ok: boolean; rulesVersion: number };
  expect(ack.ok).toBe(true);
  await from.inbox.state();
  await other.inbox.state();
  return ack.rulesVersion;
}

describe('UPDATE_RULES', () => {
  it.each(Object.values(SEATS))(
    'from %s stores the rules, acks the new version and clears both confirmations on both sides',
    async (seat) => {
      await start();
      const { p1, p2 } = await seatedPlayers();
      const [editor, other] = seat === SEATS.P1 ? [p1, p2] : [p2, p1];
      expect(await send(other, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({ ok: true });
      await other.inbox.state();
      expect((await editor.inbox.state()).hasConfirmedRules).toEqual({ me: false, opponent: true });

      expect(await send(editor, CLIENT_EVENTS.UPDATE_RULES, { rules: EDITED_RULES })).toEqual({
        ok: true,
        rulesVersion: 1,
      });
      for (const { inbox } of [p1, p2]) {
        expect(await inbox.state()).toMatchObject({
          phase: ROOM_PHASES.RULES_NEGOTIATION,
          rules: EDITED_RULES,
          rulesVersion: 1,
          hasConfirmedRules: { me: false, opponent: false },
        });
      }
    },
  );

  it('refuses salvo with extra turn on hit with INVALID_RULES and sends nothing else', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    const rules = { ...EDITED_RULES, isSalvoModeEnabled: true };
    expect(await send(p1, CLIENT_EVENTS.UPDATE_RULES, { rules })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_RULES,
    });
    expect(rooms.get(roomId)).toMatchObject({ rules: DEFAULT_RULES, rulesVersion: 0 });
    await expectNothingPending(p2);
  });

  // ADR-0085: agreeing on salvo would make the shot engine throw inside a handler, which ends the server process.
  it('refuses salvo until #32: the rules and rulesVersion stay, and the server serves the next command', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    const version = await edit(p2, p1, EDITED_RULES);
    expect(
      await send(p1, CLIENT_EVENTS.UPDATE_RULES, { rules: { ...DEFAULT_RULES, isSalvoModeEnabled: true } }),
    ).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_RULES,
    });
    expect(rooms.get(roomId)).toMatchObject({ rules: EDITED_RULES, rulesVersion: version });

    // Both confirm the rules in place; the match starts and is played as usual.
    await agreeOnRules(p1, p2, version);
    for (const { inbox } of [p1, p2]) {
      await inbox.states(2);
    }
    await placeFleets(p1, p2);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.IN_PROGRESS);
    expect(app.server.listening).toBe(true);
  });

  // ADR-0082: the rules in place, sent again, are not an edit.
  it('keeps the version and the confirmations for an edit to the rules already in place', async () => {
    await start();
    const { p1, p2 } = await seatedPlayers();
    const version = await edit(p1, p2, EDITED_RULES);
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: version })).toEqual({ ok: true });
    await p1.inbox.state();
    await p2.inbox.state();

    expect(await send(p1, CLIENT_EVENTS.UPDATE_RULES, { rules: { ...EDITED_RULES } })).toEqual({
      ok: true,
      rulesVersion: version,
    });
    expect(await p1.inbox.state()).toMatchObject({
      rulesVersion: version,
      hasConfirmedRules: { me: false, opponent: true },
    });
  });
});

describe('CONFIRM_RULES', () => {
  // The acceptance test of #26 (ADR-0004).
  it('answers STALE_RULES to B confirming the version A just replaced, then accepts the new one', async () => {
    await start();
    const { p1: a, p2: b, roomId } = await seatedPlayers();
    // B has read version 0 and confirms it; A's edit reaches the server first.
    expect(await send(a, CLIENT_EVENTS.UPDATE_RULES, { rules: EDITED_RULES })).toEqual({ ok: true, rulesVersion: 1 });
    expect(await send(b, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({
      ok: false,
      error: ERROR_CODES.STALE_RULES,
    });
    expect(rooms.get(roomId)).toMatchObject({ hasConfirmedRules: { P1: false, P2: false } });

    // The refusal sent nothing: B's next event is the STATE of A's edit, which B confirms.
    expect(await b.inbox.state()).toMatchObject({ rules: EDITED_RULES, rulesVersion: 1 });
    expect(await send(b, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 1 })).toEqual({ ok: true });
    expect((await b.inbox.state()).hasConfirmedRules).toEqual({ me: true, opponent: false });
  });

  it('answers STALE_RULES to a version the room never had', async () => {
    await start();
    const { p1 } = await seatedPlayers();
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 1 })).toEqual({
      ok: false,
      error: ERROR_CODES.STALE_RULES,
    });
  });

  it('accepts a repeated confirmation, which changes nothing', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({ ok: true });
    const confirmed = rooms.get(roomId);
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({ ok: true });
    expect(rooms.get(roomId)).toBe(confirmed);
    expect((await p2.inbox.states(2))?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
  });

  it('starts placement with the agreed rules once both confirmed the current version', async () => {
    await start();
    const { p1, p2 } = await seatedPlayers();
    const version = await edit(p2, p1, EDITED_RULES);
    await agreeOnRules(p1, p2, version);
    for (const { inbox } of [p1, p2]) {
      await inbox.state();
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.PLACEMENT,
        rules: EDITED_RULES,
        rulesVersion: version,
        hasConfirmedRules: { me: true, opponent: true },
      });
    }

    // The agreed rules allow touching ships, which the default rules refuse.
    const touching = [
      { type: SHIP_TYPES.DESTROYER, start: { x: 0, y: 0 }, orientation: ORIENTATIONS.HORIZONTAL },
      { type: SHIP_TYPES.SUBMARINE, start: { x: 0, y: 1 }, orientation: ORIENTATIONS.HORIZONTAL },
    ];
    expect(await send(p1, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: touching })).toEqual({ ok: true });
  });
});

describe('the agreed rules', () => {
  // The engine already resolves extra turn on hit in standard mode, so it stays allowed (ADR-0085).
  it('give the shooter another turn after a hit when extra turn on hit is on, and pass the turn after a miss', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    const rules = { ...DEFAULT_RULES, isExtraTurnOnHitEnabled: true };
    const version = await edit(p1, p2, rules);
    await agreeOnRules(p1, p2, version);
    await placeFleets(p1, p2);
    for (const { inbox } of [p1, p2]) {
      await inbox.states(6);
      expect((await inbox.dice()).starter).toBe(SEATS.P1);
      await inbox.state();
    }

    const [hit] = placedFleet(P2_FLEET_SEED).flatMap((ship) => ship.coordinates);
    const [miss] = waterOf(placedFleet(P2_FLEET_SEED));
    if (hit === undefined || miss === undefined) {
      expect.fail('no cell to fire at');
    }
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [hit] })).toEqual({ ok: true });
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).results[0]?.outcome).toBe(SHOT_OUTCOMES.HIT);
      expect((await inbox.state()).battle?.currentTurn).toBe(SEATS.P1);
    }
    clock.advance(TURN_MS);
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [miss] })).toEqual({ ok: true });
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).results[0]?.outcome).toBe(SHOT_OUTCOMES.MISS);
      expect((await inbox.state()).battle?.currentTurn).toBe(SEATS.P2);
    }
    expect(rooms.get(roomId)?.rules).toEqual(rules);
  });
});

describe('the rules commands outside negotiation', () => {
  const commands = [
    [CLIENT_EVENTS.UPDATE_RULES, { rules: EDITED_RULES }],
    [CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 }],
  ] as const;

  it.each(commands)('refuse %s with NOT_ALLOWED from a socket without a seat', async (event, payload) => {
    await start();
    expect(await send(await player(), event, payload)).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
  });

  it.each(commands)('refuse %s with WRONG_PHASE before and after negotiation', async (event, payload) => {
    await start();
    const alice = await player();
    await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    const wrongPhase = { ok: false, error: ERROR_CODES.WRONG_PHASE };
    expect(await send(alice, event, payload)).toEqual(wrongPhase);

    const placing = await placingPlayers();
    expect(await send(placing.p2, event, payload)).toEqual(wrongPhase);

    // The registry drew three room ids before this roll, so P2 starts.
    const { p1, p2, roomId, dice } = await startedMatch();
    expect(dice.starter).toBe(SEATS.P2);
    expect(await send(p1, event, payload)).toEqual(wrongPhase);
    await playToVictory(p1, p2, dice.starter);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.GAME_OVER);
    expect(await send(p2, event, payload)).toEqual(wrongPhase);
  });
});

// ADR-0083: rules negotiation is pre-game (ADR-0073); the edited rules and their version outlive the seat.
describe('a seat freed during negotiation', () => {
  it('by LEAVE_ROOM sends the other player back to WAITING_FOR_OPPONENT with the edited rules', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    const version = await edit(p1, p2, EDITED_RULES);
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: version })).toEqual({ ok: true });
    await p2.inbox.state();

    expect(await send(p2, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    await p1.inbox.state();
    expect(await p1.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      opponent: null,
      rules: EDITED_RULES,
      rulesVersion: version,
      hasConfirmedRules: { me: false, opponent: false },
    });

    // The next joiner negotiates from there; nobody's confirmation carried over.
    const carol = await player();
    expect(await send(carol, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Carol' })).toMatchObject({ ok: true });
    expect(await carol.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.RULES_NEGOTIATION,
      me: { seat: SEATS.P2, nickname: 'Carol' },
      rules: EDITED_RULES,
      rulesVersion: version,
      hasConfirmedRules: { me: false, opponent: false },
    });
  });

  it('by a forfeit sends the other player back to WAITING_FOR_OPPONENT with the edited rules', async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    const version = await edit(p2, p1, EDITED_RULES);
    await drop(p2, roomId, SEATS.P2);
    expect((await p1.inbox.state()).opponent).toMatchObject({ isConnected: false });

    clock.advance(DISCONNECT_FORFEIT_MS - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    clock.advance(1);
    expect(await p1.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      opponent: null,
      rules: EDITED_RULES,
      rulesVersion: version,
    });
  });
});

describe('a reconnecting player', () => {
  it.each(Object.values(SEATS))(
    'gets the rules, their version and both confirmations in the snapshot of %s',
    async (seat) => {
      await start();
      const { p1, p2, roomId, sessions } = await seatedPlayers();
      const version = await edit(p1, p2, EDITED_RULES);
      expect(await send(p2, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: version })).toEqual({ ok: true });
      await p1.inbox.state();
      await p2.inbox.state();

      await drop(seat === SEATS.P1 ? p1 : p2, roomId, seat);
      const back = await player(sessions[seat]);
      expect(await back.inbox.state()).toMatchObject({
        phase: ROOM_PHASES.RULES_NEGOTIATION,
        me: { seat },
        rules: EDITED_RULES,
        rulesVersion: version,
        hasConfirmedRules: seat === SEATS.P2 ? { me: true, opponent: false } : { me: false, opponent: true },
      });
      // The confirmation survived the drop: the other player's confirmation of the same version starts placement.
      const other = seat === SEATS.P1 ? back : p1;
      expect(await send(other, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: version })).toEqual({ ok: true });
      expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    },
  );
});
