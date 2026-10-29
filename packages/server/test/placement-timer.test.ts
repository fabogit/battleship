// The placement timer over real sockets: the start countdown, the deadline and its auto-completion, and the timers a
// freed seat or a closed room stops (docs/server.md#placement, ADR-0006, ADR-0090, ADR-0091).

import {
  CLIENT_EVENTS,
  completeFleet,
  createSeededRng,
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  FLEET,
  generateRoomId,
  PLACEMENT_TIME_LIMIT_MS,
  ROOM_PHASES,
  SEATS,
  START_COUNTDOWN_MS,
  validateFleet,
  type CommandEvent,
  type CommandPayload,
  type PlacedShip,
  type PlayerStateSnapshot,
} from '@battleship/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clock,
  closeServer,
  drop,
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
  stop,
  type Player,
} from './socket-harness.js';

afterEach(stop);

/**
 * Sends a command that must be accepted and reads the `STATE` it sends to both players.
 * @returns The sender's snapshot and the other player's.
 */
async function accepted<E extends CommandEvent>(
  from: Player,
  other: Player,
  event: E,
  payload: CommandPayload<E>,
): Promise<[PlayerStateSnapshot, PlayerStateSnapshot]> {
  expect(await send(from, event, payload)).toEqual({ ok: true });
  return [await from.inbox.state(), await other.inbox.state()];
}

/** Sends a player's draft: the whole fleet of their seed, or its first `count` ships. */
async function draft(from: Player, other: Player, seed: number, count = FLEET.length): Promise<PlacedShip[]> {
  const ships = placedFleet(seed).slice(0, count);
  await accepted(from, other, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(ships) });
  return ships;
}

/** Places and confirms both seeded fleets, `P2` last, and returns the snapshots of the second confirmation. */
async function bothConfirmed(p1: Player, p2: Player): Promise<[PlayerStateSnapshot, PlayerStateSnapshot]> {
  await draft(p1, p2, P1_FLEET_SEED);
  await accepted(p1, p2, CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
  await draft(p2, p1, P2_FLEET_SEED);
  const [p2State, p1State] = await accepted(p2, p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
  return [p1State, p2State];
}

/** The `Rng` of the test registry once it has drawn the first room's id: the fleets the deadline completes come next. */
function registryRngAfterOneRoom(): ReturnType<typeof createSeededRng> {
  const rng = createSeededRng(ROOM_SEED);
  generateRoomId(rng);
  return rng;
}

describe('the start countdown', () => {
  it('starts the match START_COUNTDOWN_MS after the second confirmation, not before', async () => {
    await start();
    const { p1, p2, roomId } = await placingPlayers();
    clock.advance(1_000);
    for (const snapshot of await bothConfirmed(p1, p2)) {
      expect(snapshot).toMatchObject({
        phase: ROOM_PHASES.PLACEMENT,
        placement: {
          hasConfirmed: { me: true, opponent: true },
          remainingMs: PLACEMENT_TIME_LIMIT_MS - 1_000,
          startCountdownMs: START_COUNTDOWN_MS,
        },
      });
    }

    clock.advance(START_COUNTDOWN_MS - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    clock.advance(1);
    for (const [{ inbox }, seed] of [
      [p1, P1_FLEET_SEED],
      [p2, P2_FLEET_SEED],
    ] as const) {
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.IN_PROGRESS,
        placement: null,
        battle: { currentTurn: SEATS.P1, myShips: placedFleet(seed), isPaused: false },
      });
    }
  });

  it('is cancelled by an unlock: its end passes without a start, and a new double confirmation starts another', async () => {
    await start();
    const { p1, p2, roomId } = await placingPlayers();
    await bothConfirmed(p1, p2);
    clock.advance(2_000);
    for (const snapshot of await accepted(p1, p2, CLIENT_EVENTS.UNLOCK_PLACEMENT, {})) {
      expect(snapshot.placement).toMatchObject({
        startCountdownMs: null,
        remainingMs: PLACEMENT_TIME_LIMIT_MS - 2_000,
      });
    }

    clock.advance(START_COUNTDOWN_MS);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    for (const snapshot of await accepted(p1, p2, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})) {
      expect(snapshot.placement?.startCountdownMs).toBe(START_COUNTDOWN_MS);
    }
    clock.advance(START_COUNTDOWN_MS);
    expect((await p1.inbox.state()).phase).toBe(ROOM_PHASES.IN_PROGRESS);
    expect((await p2.inbox.state()).phase).toBe(ROOM_PHASES.IN_PROGRESS);
  });

  it('restarts on a re-confirmation, capped by the deadline, and the confirmed fleets start the match', async () => {
    await start();
    const { p1, p2, roomId } = await placingPlayers();
    await bothConfirmed(p1, p2);
    await accepted(p2, p1, CLIENT_EVENTS.UNLOCK_PLACEMENT, {});
    clock.advance(PLACEMENT_TIME_LIMIT_MS - 2_000);
    for (const snapshot of await accepted(p2, p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})) {
      expect(snapshot.placement).toMatchObject({ remainingMs: 2_000, startCountdownMs: 2_000 });
    }

    clock.advance(1_999);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    clock.advance(1);
    expect((await p1.inbox.state()).battle?.myShips).toEqual(placedFleet(P1_FLEET_SEED));
    expect((await p2.inbox.state()).battle?.myShips).toEqual(placedFleet(P2_FLEET_SEED));
  });

  it('shows a player who reconnects during it the time left, and starts the match once it ends', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await placingPlayers();
    await bothConfirmed(p1, p2);
    await drop(p2, roomId, SEATS.P2);
    expect(await p1.inbox.state()).toMatchObject({
      opponent: { isConnected: false },
      placement: { startCountdownMs: START_COUNTDOWN_MS },
    });

    clock.advance(2_000);
    const back = await player(sessions.P2);
    expect(await back.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.PLACEMENT,
      placement: {
        myShips: placedFleet(P2_FLEET_SEED),
        hasConfirmed: { me: true, opponent: true },
        remainingMs: PLACEMENT_TIME_LIMIT_MS - 2_000,
        startCountdownMs: START_COUNTDOWN_MS - 2_000,
      },
    });
    expect((await p1.inbox.state()).opponent?.isConnected).toBe(true);

    clock.advance(START_COUNTDOWN_MS - 2_000);
    for (const { inbox } of [p1, back]) {
      expect(await inbox.state()).toMatchObject({ phase: ROOM_PHASES.IN_PROGRESS, battle: { isPaused: false } });
    }
  });
});

describe('the placement deadline', () => {
  it('completes an unconfirmed fleet from its draft with the server Rng, locks it and starts the match', async () => {
    await start();
    const { p1, p2, roomId } = await placingPlayers();
    await draft(p1, p2, P1_FLEET_SEED);
    await accepted(p1, p2, CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
    const partial = await draft(p2, p1, P2_FLEET_SEED, 2);

    clock.advance(PLACEMENT_TIME_LIMIT_MS - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    clock.advance(1);
    expect((await p1.inbox.state()).battle).toMatchObject({
      myShips: placedFleet(P1_FLEET_SEED),
      currentTurn: SEATS.P1,
      isPaused: false,
    });
    const completed = (await p2.inbox.state()).battle?.myShips ?? [];
    expect(completed).toEqual(completeFleet(partial, DEFAULT_RULES, registryRngAfterOneRoom()));
    expect(completed).toEqual(expect.arrayContaining(partial));
    expect(validateFleet(completed, DEFAULT_RULES).ok).toBe(true);
  });

  it('completes both fleets, P1 first, when nobody confirmed', async () => {
    await start();
    const { p1, p2 } = await placingPlayers();
    const partial = await draft(p1, p2, P1_FLEET_SEED, 1);

    clock.advance(PLACEMENT_TIME_LIMIT_MS);
    const rng = registryRngAfterOneRoom();
    expect((await p1.inbox.state()).battle?.myShips).toEqual(completeFleet(partial, DEFAULT_RULES, rng));
    expect((await p2.inbox.state()).battle?.myShips).toEqual(completeFleet([], DEFAULT_RULES, rng));
  });

  it('completes the fleet of a player who is away; the match starts paused and their forfeit clock runs on', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await placingPlayers();
    const partial = await draft(p1, p2, P1_FLEET_SEED, 3);
    await draft(p2, p1, P2_FLEET_SEED);
    await accepted(p2, p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
    clock.advance(10_000);
    await drop(p1, roomId, SEATS.P1);
    await p2.inbox.state();

    clock.advance(PLACEMENT_TIME_LIMIT_MS - 10_000);
    expect(await p2.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.IN_PROGRESS,
      opponent: { isConnected: false, forfeitRemainingMs: DISCONNECT_FORFEIT_MS - (PLACEMENT_TIME_LIMIT_MS - 10_000) },
      battle: { isPaused: true, myShips: placedFleet(P2_FLEET_SEED) },
    });

    const back = await player(sessions.P1);
    const snapshot = await back.inbox.state();
    expect(snapshot.battle).toMatchObject({ isPaused: false, currentTurn: SEATS.P1 });
    expect(snapshot.battle?.myShips).toEqual(expect.arrayContaining(partial));
    expect(validateFleet(snapshot.battle?.myShips ?? [], DEFAULT_RULES).ok).toBe(true);
  });
});

describe('the placement timer', () => {
  it('stops when a seat is freed during the countdown: the other player waits again and nothing starts', async () => {
    await start();
    const { p1, p2, roomId } = await placingPlayers();
    await bothConfirmed(p1, p2);
    expect(await send(p2, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    expect(await p1.inbox.state()).toMatchObject({ phase: ROOM_PHASES.WAITING_FOR_OPPONENT, placement: null });
    expect(clock.pendingCount).toBe(0);

    clock.advance(PLACEMENT_TIME_LIMIT_MS);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
  });

  it('stops with a room that closes during placement', async () => {
    await start();
    const { p1, p2, roomId } = await placingPlayers();
    await draft(p1, p2, P1_FLEET_SEED);
    expect(await send(p1, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    await p2.inbox.state();
    expect(await send(p2, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    expect(rooms.get(roomId)).toBeUndefined();
    expect(clock.pendingCount).toBe(0);
    clock.advance(PLACEMENT_TIME_LIMIT_MS);
  });

  it('stops when the server closes during the countdown', async () => {
    await start();
    const { p1, p2 } = await placingPlayers();
    await bothConfirmed(p1, p2);
    expect(clock.pendingCount).toBe(1);
    await closeServer();
    expect(clock.pendingCount).toBe(0);
  });
});
