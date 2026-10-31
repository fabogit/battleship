import {
  BOARD_SIZE,
  CLIENT_EVENTS,
  createPlayerSecret,
  createSeededRng,
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  GAME_OVER_REASONS,
  GAME_OVER_TTL_MS,
  generateRoomId,
  MAX_ROOMS,
  parseSessionCredentials,
  PLACEMENT_TIME_LIMIT_MS,
  PROTOCOL_VERSION,
  REMATCH_CHOICES,
  ROOM_PHASES,
  SEATS,
  SERVER_EVENTS,
  SHOT_OUTCOMES,
  START_COUNTDOWN_MS,
  type CommandEvent,
  type CommandPayload,
  type PlayerStateSnapshot,
  type SessionCredentials,
} from '@battleship/core';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { COMMAND_EVENTS } from '../src/plugins/room-handlers.js';
import {
  ACK_TIMEOUT_MS,
  agreeOnRules,
  app,
  drop,
  expectNothingPending,
  baseUrl,
  clock,
  P1_FLEET_SEED,
  P2_FLEET_SEED,
  placedFleet,
  placements,
  placingPlayers,
  player,
  playToVictory,
  ROOM_SEED,
  rooms,
  seatedPlayers,
  send,
  sendRaw,
  start,
  startedMatch,
  stop,
  track,
  TURN_MS,
  waterOf,
  type ClientSocket,
  type Inbox,
  type Player,
} from './socket-harness.js';

/** Commands whose room logic lands later; refused with `NOT_ALLOWED` after their guard (ADR-0046). */
const NOT_YET_SUPPORTED: readonly { [E in CommandEvent]: readonly [E, CommandPayload<E>] }[CommandEvent][] = [
  [CLIENT_EVENTS.SURRENDER, {}],
  [CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.LEAVE }],
];

afterEach(stop);

/**
 * Opens a socket whose handshake the server must refuse.
 * @param auth The handshake `auth`, as a misbehaving or outdated client could send it.
 * @returns The `connect_error` message: the error code (ADR-0061).
 */
async function refusedHandshake(auth: object): Promise<string> {
  const socket: ClientSocket = track(connect(baseUrl, { transports: ['websocket'], reconnection: false, auth }));
  const error = await new Promise<Error>((resolve, reject) => {
    socket.once('connect_error', resolve);
    socket.once('connect', () => {
      reject(new Error('the handshake was accepted'));
    });
  });
  expect(socket.active).toBe(false);
  return error.message;
}

/**
 * Sends a command and records its ack in the sender's inbox, where it arrived among the events, so a test can read the
 * order of ack and events (ADR-0047). Read the reply with `inbox.ack()`.
 */
async function sendOnTimeline<E extends CommandEvent>(
  from: Player,
  event: E,
  payload: CommandPayload<E>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // The callback runs as the ack packet is read, in order with the events `onAny` sees; `emitWithAck` would resolve a
    // microtask later.
    (from.socket as Socket).timeout(ACK_TIMEOUT_MS).emit(event, payload, (error: Error | null, response: unknown) => {
      if (error !== null) {
        reject(error);
        return;
      }
      from.inbox.recordAck(response);
      resolve();
    });
  });
}

/**
 * Resolves with the reason of a client's next disconnection.
 * @param target The client the server should disconnect.
 */
function disconnection(target: Player): Promise<string> {
  return new Promise((resolve) => {
    target.socket.once('disconnect', resolve);
  });
}

/**
 * Reads a client's events up to the first `STATE` that matches, skipping everything before it.
 * @param inbox The client's inbox.
 * @param isWanted Tells the snapshot to stop at.
 * @returns That snapshot.
 */
async function skipToState(
  inbox: Inbox,
  isWanted: (snapshot: PlayerStateSnapshot) => boolean,
): Promise<PlayerStateSnapshot> {
  for (;;) {
    const message = await inbox.next();
    const snapshot = message.payload as PlayerStateSnapshot;
    if (message.event === SERVER_EVENTS.STATE && isWanted(snapshot)) {
      return snapshot;
    }
  }
}

describe('a match between two real clients', () => {
  it('goes from create to join, rules, placement and battle until victory', async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);

    // Create: P1 gets the credentials in the ack and its first snapshot.
    const created = await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: '  Alice ' });
    const expectedRoomId = generateRoomId(createSeededRng(ROOM_SEED));
    expect(created).toEqual({ ok: true, roomId: expectedRoomId, playerSecret: expect.any(String) as unknown });
    const { roomId, playerSecret: p1Secret } = created as { roomId: string; playerSecret: string };
    expect(parseSessionCredentials({ roomId, playerSecret: p1Secret })).not.toBeNull();
    expect(await p1.inbox.state()).toMatchObject({
      roomId,
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      me: { seat: SEATS.P1, nickname: 'Alice' },
      opponent: null,
    });

    // Join: both get a rules negotiation snapshot with the room's rules, nobody confirmed.
    const joined = await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    expect(joined).toEqual({ ok: true, playerSecret: expect.any(String) as unknown });
    const p2Secret = (joined as { playerSecret: string }).playerSecret;
    expect(p2Secret).not.toBe(p1Secret);
    expect(parseSessionCredentials({ roomId, playerSecret: p2Secret })).not.toBeNull();
    const negotiationSnapshots = [await p1.inbox.state(), await p2.inbox.state()];
    for (const snapshot of negotiationSnapshots) {
      expect(snapshot).toMatchObject({
        phase: ROOM_PHASES.RULES_NEGOTIATION,
        rules: DEFAULT_RULES,
        rulesVersion: 0,
        hasConfirmedRules: { me: false, opponent: false },
        placement: null,
      });
      // Secrets only ever travel in their owner's ack.
      expect(JSON.stringify(snapshot)).not.toContain(p1Secret);
      expect(JSON.stringify(snapshot)).not.toContain(p2Secret);
    }
    expect(negotiationSnapshots.map((snapshot) => [snapshot.me.seat, snapshot.opponent?.nickname])).toEqual([
      [SEATS.P1, 'Bob'],
      [SEATS.P2, 'Alice'],
    ]);

    // Rules: P2's edit reaches both with a new version; each confirmation shows up on both sides.
    const rules = { ...DEFAULT_RULES, turnTimeLimitSeconds: 60 } as const;
    expect(await send(p2, CLIENT_EVENTS.UPDATE_RULES, { rules })).toEqual({ ok: true, rulesVersion: 1 });
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.state()).toMatchObject({ rules, rulesVersion: 1 });
    }
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 1 })).toEqual({ ok: true });
    expect((await p1.inbox.state()).hasConfirmedRules).toEqual({ me: true, opponent: false });
    expect((await p2.inbox.state()).hasConfirmedRules).toEqual({ me: false, opponent: true });

    // Both confirmed: both get a placement snapshot with the agreed rules and the deadline from the fixed clock.
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 1 })).toEqual({ ok: true });
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.PLACEMENT,
        rules,
        rulesVersion: 1,
        hasConfirmedRules: { me: true, opponent: true },
        placement: { myShips: [], hasConfirmed: { me: false, opponent: false }, remainingMs: PLACEMENT_TIME_LIMIT_MS },
      });
    }

    // Placement: P1's draft reaches P1 only; confirm and unlock show up on P2's side.
    const p1Fleet = placedFleet(P1_FLEET_SEED);
    const p2Fleet = placedFleet(P2_FLEET_SEED);
    expect(await send(p1, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(p1Fleet) })).toEqual({ ok: true });
    expect((await p1.inbox.state()).placement?.myShips).toEqual(p1Fleet);
    expect((await p2.inbox.state()).placement?.myShips).toEqual([]);

    expect(await send(p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
    expect((await p1.inbox.state()).placement?.hasConfirmed).toEqual({ me: true, opponent: false });
    expect((await p2.inbox.state()).placement?.hasConfirmed).toEqual({ me: false, opponent: true });

    expect(await send(p1, CLIENT_EVENTS.UNLOCK_PLACEMENT, {})).toEqual({ ok: true });
    expect((await p1.inbox.state()).placement?.hasConfirmed).toEqual({ me: false, opponent: false });
    expect((await p2.inbox.state()).placement?.hasConfirmed).toEqual({ me: false, opponent: false });

    expect(await send(p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
    expect(await send(p2, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(p2Fleet) })).toEqual({ ok: true });
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: true });
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.states(3)).toMatchObject({
        phase: ROOM_PHASES.PLACEMENT,
        placement: { hasConfirmed: { me: true, opponent: true }, startCountdownMs: START_COUNTDOWN_MS },
      });
    }
    // The start countdown ends: both get the dice roll, then the match starts with its starter to fire (ADR-0090,
    // ADR-0092).
    clock.advance(START_COUNTDOWN_MS);
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.dice()).toEqual({ rolls: [{ P1: 6, P2: 1 }], starter: SEATS.P1 });
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.IN_PROGRESS,
        placement: null,
        battle: { currentTurn: SEATS.P1, incomingShots: [], outgoingShots: [] },
      });
    }

    // Battle: P1 drafts, then fires at every cell of P2's fleet; P2 fires at water in between.
    const p1Targets = p2Fleet.flatMap((ship) => ship.coordinates);
    const p2Targets = waterOf(p1Fleet);
    let finalStates: PlayerStateSnapshot[] = [];
    for (const [turn, target] of p1Targets.entries()) {
      // P1 sends two events a turn, so a clock that never moved would trip the rate limit before victory.
      clock.advance(TURN_MS);
      expect(await send(p1, CLIENT_EVENTS.UPDATE_TARGETS, { targets: [target] })).toEqual({ ok: true });
      expect((await p1.inbox.state()).battle?.myDraftTargets).toEqual([target]);
      // The draft is the shooter's own: the opponent's snapshot never shows it.
      expect((await p2.inbox.state()).battle?.myDraftTargets).toEqual([]);

      // Each player gets SHOT_RESOLVED, then STATE (ADR-0047).
      expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [target] })).toEqual({ ok: true });
      for (const { inbox } of [p1, p2]) {
        const shot = await inbox.shot();
        expect(shot).toMatchObject({ shooter: SEATS.P1, results: [{ coordinate: target }] });
        expect(shot.results[0]?.outcome).not.toBe(SHOT_OUTCOMES.MISS);
      }
      const states = [await p1.inbox.state(), await p2.inbox.state()];
      if (turn === p1Targets.length - 1) {
        finalStates = states;
        break;
      }
      // P2 sees P1's shots on its own board; P1 sees them on P2's.
      expect(states[0]?.battle?.outgoingShots).toHaveLength(turn + 1);
      expect(states[1]?.battle?.incomingShots).toHaveLength(turn + 1);
      expect(states[1]?.battle?.currentTurn).toBe(SEATS.P2);

      const p2Target = p2Targets[turn];
      if (p2Target === undefined) {
        expect.fail('P2 ran out of water cells');
      }
      expect(await send(p2, CLIENT_EVENTS.FIRE, { targets: [p2Target] })).toEqual({ ok: true });
      for (const { inbox } of [p1, p2]) {
        expect(await inbox.shot()).toEqual({
          shooter: SEATS.P2,
          results: [{ coordinate: p2Target, outcome: SHOT_OUTCOMES.MISS }],
        });
        expect((await inbox.state()).battle?.currentTurn).toBe(SEATS.P1);
      }
    }

    // Game over: P1 won, and each side now sees the other's whole fleet.
    for (const snapshot of finalStates) {
      expect(snapshot).toMatchObject({
        phase: ROOM_PHASES.GAME_OVER,
        battle: null,
        gameOver: { winner: SEATS.P1, reason: GAME_OVER_REASONS.FLEET_DESTROYED },
      });
    }
    expect(finalStates[0]?.gameOver?.opponentShips).toEqual(p2Fleet);
    expect(finalStates[1]?.gameOver?.opponentShips).toEqual(p1Fleet);
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({
      ok: false,
      error: ERROR_CODES.WRONG_PHASE,
    });
  });
});

describe('payload guards', () => {
  it.each(COMMAND_EVENTS)('refuse a malformed %s with INVALID_PAYLOAD', async (event) => {
    await start();
    const alice = await player();
    expect(await sendRaw(alice, event, { unexpected: true })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_PAYLOAD,
    });
  });

  it('run before the seat check', async () => {
    await start();
    const alice = await player();
    expect(await sendRaw(alice, CLIENT_EVENTS.FIRE, { targets: [{ x: BOARD_SIZE, y: 0 }] })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_PAYLOAD,
    });
  });

  // The characters of the M1 review (#52 F3) that the server used to relay byte for byte (ADR-0060).
  it.each([
    ['a zero-width space', '\u200B'],
    ['three zero-width spaces', '\u200B\u200B\u200B'],
    ['a word joiner', '\u2060'],
    ['a right-to-left override', '\u202Eevil'],
    ['NUL and BEL', 'a\u0000b\u0007'],
    ['a line feed', 'line1\nline2'],
    ['a soft hyphen', '\u00AD'],
    ['a braille blank', '\u2800'],
    ['a Hangul filler', '\u3164'],
    ['a lone surrogate', '\uD800'],
    ['a byte order mark', '\uFEFF'],
  ])('refuse a nickname with %s on CREATE_ROOM and JOIN_ROOM', async (_label, nickname) => {
    await start();
    const [alice, bob] = await Promise.all([player(), player()]);
    expect(await sendRaw(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_PAYLOAD,
    });
    expect(rooms.size).toBe(0);

    const created = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    expect(await sendRaw(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId: created.roomId, nickname })).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_PAYLOAD,
    });
    // The refused join left the seat free: Alice's first snapshot has no opponent, and a valid join still takes it.
    expect((await alice.inbox.state()).opponent).toBeNull();
    expect(await send(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId: created.roomId, nickname: 'Bob' })).toMatchObject({
      ok: true,
    });
    expect((await alice.inbox.state()).opponent?.nickname).toBe('Bob');
  });
});

describe('command acks', () => {
  it('carry SERVER_FULL once MAX_ROOMS rooms are open', async () => {
    await start();
    for (let index = 0; index < MAX_ROOMS; index++) {
      rooms.createRoom({ nickname: `Player ${String(index)}` });
    }
    const alice = await player();
    expect(await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Late' })).toEqual({
      ok: false,
      error: ERROR_CODES.SERVER_FULL,
    });
  });

  it('carry ROOM_NOT_FOUND and ROOM_FULL from the registry and room logic', async () => {
    await start();
    const { roomId } = await seatedPlayers();
    const third = await player();
    expect(await send(third, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Carol' })).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_FULL,
    });
    const unknownRoomId = generateRoomId(createSeededRng(ROOM_SEED + 1));
    expect(await send(third, CLIENT_EVENTS.JOIN_ROOM, { roomId: unknownRoomId, nickname: 'Carol' })).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_NOT_FOUND,
    });
  });

  it('refuse a seat command from a socket without a seat with NOT_ALLOWED', async () => {
    await start();
    const alice = await player();
    expect(await send(alice, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
  });

  it.each(NOT_YET_SUPPORTED)('refuse %s with NOT_ALLOWED until its room logic lands', async (event, payload) => {
    await start();
    const { p1 } = await seatedPlayers();
    expect(await sendRaw(p1, event, payload)).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
  });

  it('refuse joining the other seat of the room the socket sits in', async () => {
    await start();
    const alice = await player();
    const { roomId } = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    expect(await send(alice, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Alice' })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
  });

  it('send nothing for a refused command', async () => {
    await start();
    const { p1, p2 } = await startedMatch();
    expect(await send(p2, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_YOUR_TURN,
    });
    // Events on one socket arrive in order: the next ones each player reads come from the accepted shot.
    await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] });
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).shooter).toBe(SEATS.P1);
      expect((await inbox.state()).battle?.currentTurn).toBe(SEATS.P2);
    }
  });

  it('arrive before the STATE of a created room', async () => {
    await start();
    const alice = await player();
    await sendOnTimeline(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    expect(await alice.inbox.ack()).toMatchObject({ ok: true });
    expect((await alice.inbox.state()).phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
  });

  it('arrive before the STATE of a joined room', async () => {
    await start();
    const [alice, bob] = await Promise.all([player(), player()]);
    const { roomId } = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    await alice.inbox.state();
    await sendOnTimeline(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' });
    expect(await bob.inbox.ack()).toMatchObject({ ok: true });
    expect((await bob.inbox.state()).phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
  });

  it("arrive before the shooter's SHOT_RESOLVED and STATE", async () => {
    await start();
    const { p1 } = await startedMatch();
    await sendOnTimeline(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] });
    expect(await p1.inbox.ack()).toEqual({ ok: true });
    expect((await p1.inbox.shot()).shooter).toBe(SEATS.P1);
    expect((await p1.inbox.state()).battle?.currentTurn).toBe(SEATS.P2);
  });

  it('ignore a command sent without an ack', async () => {
    await start();
    const alice = await player();
    (alice.socket as Socket).emit(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' });
    // Still served, and the command above created nothing.
    expect(await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })).toMatchObject({ ok: true });
    expect(rooms.size).toBe(1);
  });
});

describe('seat binding', () => {
  it('moves a socket that creates a second room out of the first', async () => {
    await start();
    const [p1, p2] = await Promise.all([player(), player()]);
    const first = (await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    await send(p2, CLIENT_EVENTS.JOIN_ROOM, { roomId: first.roomId, nickname: 'Bob' });
    const second = (await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    expect((await p1.inbox.state()).roomId).toBe(first.roomId);
    expect((await p1.inbox.state()).roomId).toBe(first.roomId);
    expect((await p1.inbox.state()).roomId).toBe(second.roomId);

    // P1's seat in the first room stays taken, away (ADR-0072); its commands now go to the second room, still waiting
    // for an opponent, and the first room's STATE no longer reaches it.
    expect((await p2.inbox.state()).phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    expect((await p2.inbox.state()).opponent?.isConnected).toBe(false);
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({ ok: false, error: ERROR_CODES.WRONG_PHASE });
    const third = (await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    expect((await p1.inbox.state()).roomId).toBe(third.roomId);
  });
});

describe('room isolation', () => {
  it('keeps a shot from a player in another room', async () => {
    await start();
    const { p1, p2 } = await startedMatch();
    const bystander = await player();
    await send(bystander, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Carol' });
    await bystander.inbox.state();

    await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] });
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).shooter).toBe(SEATS.P1);
      await inbox.state();
    }

    await expectNothingPending(bystander);
  });

  it('keeps a shot from a player who left the room for a new one', async () => {
    await start();
    const { p1, p2 } = await startedMatch();
    const { roomId } = (await send(p2, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Bob' })) as { roomId: string };
    expect((await p2.inbox.state()).roomId).toBe(roomId);

    // P2's seat stays taken, away like after a disconnection (ADR-0072), so P1 still fires in the first room.
    expect((await p1.inbox.state()).opponent).toMatchObject({ isConnected: false });
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({ ok: true });
    expect((await p1.inbox.shot()).shooter).toBe(SEATS.P1);
    await p1.inbox.state();

    await expectNothingPending(p2);
  });
});

describe('handshake', () => {
  it.each([
    ['no auth', {}],
    ['another protocol version', { protocolVersion: PROTOCOL_VERSION - 1 }],
    // The version is checked first, so an outdated client is told to reload even with a session it lost.
    [
      'another protocol version and a malformed session',
      { protocolVersion: PROTOCOL_VERSION - 1, session: { roomId: 'not an id' } },
    ],
  ])('refuses %s with PROTOCOL_MISMATCH', async (_label, auth) => {
    await start();
    expect(await refusedHandshake(auth)).toBe(ERROR_CODES.PROTOCOL_MISMATCH);
  });

  it('refuses a malformed, unknown or wrong session with SESSION_INVALID and leaves the seat alone', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await startedMatch();
    const otherRoomId = generateRoomId(createSeededRng(ROOM_SEED + 1));
    for (const session of [
      null,
      { roomId },
      { ...sessions.P1, playerSecret: sessions.P1.playerSecret.toUpperCase() },
      { roomId, playerSecret: createPlayerSecret() },
      { roomId: otherRoomId, playerSecret: sessions.P1.playerSecret },
    ]) {
      expect(await refusedHandshake({ protocolVersion: PROTOCOL_VERSION, session })).toBe(ERROR_CODES.SESSION_INVALID);
    }
    // P1's socket still holds the seat.
    expect(p1.socket.connected).toBe(true);
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({ ok: true });
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.shot()).shooter).toBe(SEATS.P1);
      await inbox.state();
    }
  });

  it.each(Object.values(SEATS))(
    'rebinds a reconnecting %s to its seat and resumes the match, the opponent seeing the drop and the return',
    async (seat) => {
      await start();
      const { p1, p2, roomId, sessions } = await startedMatch();
      const [leaving, staying] = seat === SEATS.P1 ? [p1, p2] : [p2, p1];
      const left = disconnection(leaving);
      leaving.socket.close();
      expect(await left).toBe('io client disconnect');
      expect(await staying.inbox.state()).toMatchObject({
        opponent: { seat, isConnected: false, forfeitRemainingMs: DISCONNECT_FORFEIT_MS },
        battle: { isPaused: true },
      });

      clock.advance(60_000);
      const back = await player(sessions[seat]);
      expect(await back.inbox.state()).toMatchObject({
        roomId,
        phase: ROOM_PHASES.IN_PROGRESS,
        me: { seat, isConnected: true, forfeitRemainingMs: null },
        opponent: { isConnected: true },
        battle: { currentTurn: SEATS.P1, incomingShots: [], outgoingShots: [], isPaused: false },
      });
      expect(await staying.inbox.state()).toMatchObject({
        opponent: { seat, isConnected: true, forfeitRemainingMs: null },
        battle: { isPaused: false },
      });

      // The rebound socket plays the seat, and gets the room's events again.
      const shooter = seat === SEATS.P1 ? back : staying;
      expect(await send(shooter, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({ ok: true });
      for (const { inbox } of [back, staying]) {
        expect((await inbox.shot()).shooter).toBe(SEATS.P1);
        expect((await inbox.state()).battle?.currentTurn).toBe(SEATS.P2);
      }
      await expectNothingPending(staying);
    },
  );

  it.each(Object.values(SEATS))(
    'lets the latest connection win: a zombie %s socket gets SESSION_REPLACED and is disconnected',
    async (seat) => {
      await start();
      const { p1, p2, roomId, sessions } = await startedMatch();
      const [zombie, opponent] = seat === SEATS.P1 ? [p1, p2] : [p2, p1];
      const replaced = disconnection(zombie);

      // The zombie never left: a backgrounded tab whose socket the server still thinks is alive (ADR-0014).
      const fresh = await player(sessions[seat]);
      expect(await fresh.inbox.state()).toMatchObject({ me: { seat, isConnected: true }, battle: { isPaused: false } });
      expect(await zombie.inbox.next()).toEqual({ event: SERVER_EVENTS.SESSION_REPLACED, payload: {} });
      expect(await replaced).toBe('io server disconnect');
      // The replaced socket was not the seat's last one, so the seat never dropped (ADR-0072): no pause, no clock.
      expect(rooms.get(roomId)).toMatchObject({ disconnectedAt: { P1: null, P2: null }, isPaused: false });

      // The seat is the fresh socket's now: the room's events reach it, and the zombie gets nothing more. The opponent's
      // next events are the shot's: no STATE told it of a drop.
      const shooter = seat === SEATS.P1 ? fresh : opponent;
      expect(await send(shooter, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({ ok: true });
      for (const { inbox } of [fresh, opponent]) {
        expect((await inbox.shot()).shooter).toBe(SEATS.P1);
        await inbox.state();
      }
      expect(app.io.of('/').sockets.size).toBe(2);
    },
  );

  it('sends a socket that rebinds after the final shot a GAME_OVER STATE with both boards', async () => {
    await start();
    const { p1, p2, sessions } = await startedMatch();
    const fired = await playToVictory(p1, p2);
    const fleets = { P1: placedFleet(P1_FLEET_SEED), P2: placedFleet(P2_FLEET_SEED) };

    for (const seat of Object.values(SEATS)) {
      const opponentSeat = seat === SEATS.P1 ? SEATS.P2 : SEATS.P1;
      const snapshot = await (await player(sessions[seat])).inbox.state();
      expect(snapshot).toMatchObject({ phase: ROOM_PHASES.GAME_OVER, me: { seat }, battle: null });
      const gameOver = snapshot.gameOver;
      expect(gameOver).toMatchObject({ winner: SEATS.P1, reason: GAME_OVER_REASONS.FLEET_DESTROYED });
      expect(gameOver?.myShips).toEqual(fleets[seat]);
      expect(gameOver?.opponentShips).toEqual(fleets[opponentSeat]);
      // Every shot on both boards, the winning one included, in firing order: P1 hit, P2 missed.
      const winnerShots = seat === SEATS.P1 ? gameOver?.outgoingShots : gameOver?.incomingShots;
      const loserShots = seat === SEATS.P1 ? gameOver?.incomingShots : gameOver?.outgoingShots;
      expect(winnerShots?.map((shot) => shot.coordinate)).toEqual(fired.P1);
      expect(loserShots?.map((shot) => shot.coordinate)).toEqual(fired.P2);
      expect(winnerShots?.every((shot) => shot.outcome !== SHOT_OUTCOMES.MISS)).toBe(true);
      expect(winnerShots?.at(-1)?.sunkShip).toBeDefined();
      expect(loserShots?.every((shot) => shot.outcome === SHOT_OUTCOMES.MISS)).toBe(true);
    }
  });
});

describe('seat presence', () => {
  // The common mobile case (docs/server.md#room-creation--joining): the creator switches app to share the link.
  it('lets a friend join while the creator is away, and both agree on the rules once the creator is back', async () => {
    await start();
    const alice = await player();
    const created = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as SessionCredentials;
    await alice.inbox.state();
    await drop(alice, created.roomId, SEATS.P1);

    clock.advance(30_000);
    const bob = await player();
    expect(await send(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId: created.roomId, nickname: 'Bob' })).toMatchObject({
      ok: true,
    });
    expect(await bob.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.RULES_NEGOTIATION,
      me: { seat: SEATS.P2, isConnected: true },
      opponent: {
        seat: SEATS.P1,
        nickname: 'Alice',
        isConnected: false,
        forfeitRemainingMs: DISCONNECT_FORFEIT_MS - 30_000,
      },
    });

    clock.advance(30_000);
    const back = await player({ roomId: created.roomId, playerSecret: created.playerSecret });
    expect(await back.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.RULES_NEGOTIATION,
      me: { seat: SEATS.P1, isConnected: true, forfeitRemainingMs: null },
      opponent: { seat: SEATS.P2, nickname: 'Bob', isConnected: true },
    });
    expect(await bob.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.RULES_NEGOTIATION,
      opponent: { seat: SEATS.P1, isConnected: true, forfeitRemainingMs: null },
    });

    // The seat is kept for good: the old deadline passes without a forfeit, and both agree and place their fleets.
    clock.advance(DISCONNECT_FORFEIT_MS);
    expect(rooms.get(created.roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    await agreeOnRules(back, bob);
    for (const [from, seed] of [
      [back, P1_FLEET_SEED],
      [bob, P2_FLEET_SEED],
    ] as const) {
      expect(await send(from, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(placedFleet(seed)) })).toEqual({
        ok: true,
      });
    }
  });

  it('tells the opponent when a seat drops in placement and when it comes back, with the forfeit time left', async () => {
    await start();
    const { p1, p2, sessions } = await placingPlayers();
    p2.socket.close();
    expect((await p1.inbox.state()).opponent).toEqual({
      seat: SEATS.P2,
      nickname: 'Bob',
      isConnected: false,
      forfeitRemainingMs: DISCONNECT_FORFEIT_MS,
    });

    // Placement ends before the forfeit could (PLACEMENT_TIME_LIMIT_MS < DISCONNECT_FORFEIT_MS), so come back sooner.
    clock.advance(30_000);
    const back = await player(sessions.P2);
    expect((await back.inbox.state()).me).toMatchObject({ seat: SEATS.P2, isConnected: true });
    expect((await p1.inbox.state()).opponent).toMatchObject({ isConnected: true, forfeitRemainingMs: null });
    expect(await send(back, CLIENT_EVENTS.CONFIRM_PLACEMENT, {})).toEqual({
      ok: false,
      error: ERROR_CODES.INVALID_PLACEMENT,
    });
  });

  it('starts the match paused when a player is away at the end of the countdown', async () => {
    await start();
    const { p1, p2, roomId } = await placingPlayers();
    for (const [from, seed] of [
      [p1, P1_FLEET_SEED],
      [p2, P2_FLEET_SEED],
    ] as const) {
      await send(from, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(placedFleet(seed)) });
    }
    await send(p1, CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
    await p2.inbox.states(3);
    await drop(p1, roomId, SEATS.P1);
    await p2.inbox.state();

    await send(p2, CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
    expect((await p2.inbox.state()).placement?.startCountdownMs).toBe(START_COUNTDOWN_MS);
    clock.advance(START_COUNTDOWN_MS);
    expect((await p2.inbox.dice()).starter).toBe(SEATS.P1);
    expect(await p2.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.IN_PROGRESS,
      opponent: { isConnected: false, forfeitRemainingMs: DISCONNECT_FORFEIT_MS - START_COUNTDOWN_MS },
      battle: { isPaused: true },
    });
  });

  it('shows a player away at game over without a forfeit clock, and keeps their seat until the TTL', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await startedMatch();
    await playToVictory(p1, p2);
    await skipToState(p1.inbox, (snapshot) => snapshot.phase === ROOM_PHASES.GAME_OVER);
    p2.socket.close();
    expect(await p1.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.GAME_OVER,
      opponent: { isConnected: false, forfeitRemainingMs: null },
    });

    // Past the forfeit time, but the game-over TTL is shorter: the seat is still P2's until the room expires.
    clock.advance(GAME_OVER_TTL_MS - 1);
    expect(rooms.get(roomId)?.disconnectedAt.P2).not.toBeNull();
    const back = await player(sessions.P2);
    expect((await back.inbox.state()).gameOver?.reason).toBe(GAME_OVER_REASONS.FLEET_DESTROYED);
    expect((await p1.inbox.state()).opponent).toMatchObject({ isConnected: true });
  });
});

describe('SET_PAUSED', () => {
  it('is refused with NOT_ALLOWED while the opponent is connected, and WRONG_PHASE outside a match', async () => {
    await start();
    const { p1 } = await seatedPlayers();
    expect(await send(p1, CLIENT_EVENTS.SET_PAUSED, { isPaused: true })).toEqual({
      ok: false,
      error: ERROR_CODES.WRONG_PHASE,
    });
    await start();
    const match = await startedMatch();
    for (const isPaused of [true, false]) {
      expect(await send(match.p1, CLIENT_EVENTS.SET_PAUSED, { isPaused })).toEqual({
        ok: false,
        error: ERROR_CODES.NOT_ALLOWED,
      });
    }
  });

  it('lets the connected player resume and pause again while the opponent is away', async () => {
    await start();
    const { p1, p2 } = await startedMatch();
    p2.socket.close();
    expect((await p1.inbox.state()).battle?.isPaused).toBe(true);

    for (const isPaused of [false, true]) {
      await sendOnTimeline(p1, CLIENT_EVENTS.SET_PAUSED, { isPaused });
      expect(await p1.inbox.ack()).toEqual({ ok: true });
      expect(await p1.inbox.state()).toMatchObject({ battle: { isPaused }, opponent: { isConnected: false } });
    }
    // A resumed match still plays: the turn is P1's, and only the turn timer (#30) would stop while paused.
    await send(p1, CLIENT_EVENTS.SET_PAUSED, { isPaused: false });
    await p1.inbox.state();
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({ ok: true });
  });
});

describe('disconnect forfeit', () => {
  it.each([
    ['paused', false],
    ['resumed by the connected player', true],
  ] as const)(
    'ends a match %s with DISCONNECT_FORFEIT DISCONNECT_FORFEIT_MS after the drop',
    async (_label, isResumed) => {
      await start();
      const { p1, p2, roomId, sessions } = await startedMatch();
      p2.socket.close();
      await p1.inbox.state();
      if (isResumed) {
        clock.advance(10_000);
        await send(p1, CLIENT_EVENTS.SET_PAUSED, { isPaused: false });
        expect((await p1.inbox.state()).opponent?.forfeitRemainingMs).toBe(DISCONNECT_FORFEIT_MS - 10_000);
      }

      clock.advance(DISCONNECT_FORFEIT_MS - (isResumed ? 10_000 : 0) - 1);
      expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.IN_PROGRESS);
      clock.advance(1);
      expect(await p1.inbox.state()).toMatchObject({
        phase: ROOM_PHASES.GAME_OVER,
        gameOver: { winner: SEATS.P1, reason: GAME_OVER_REASONS.DISCONNECT_FORFEIT },
        opponent: { isConnected: false, forfeitRemainingMs: null },
      });

      // The loser can still come back to see the result until the room expires.
      const back = await player(sessions.P2);
      expect((await back.inbox.state()).gameOver).toMatchObject({
        winner: SEATS.P1,
        reason: GAME_OVER_REASONS.DISCONNECT_FORFEIT,
      });
      await expectNothingPending(back);
    },
  );

  it('stops when the player comes back in time', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await startedMatch();
    p2.socket.close();
    await p1.inbox.state();
    clock.advance(DISCONNECT_FORFEIT_MS - 1);
    await player(sessions.P2);
    await p1.inbox.state();
    clock.advance(10 * DISCONNECT_FORFEIT_MS);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.IN_PROGRESS);
  });

  it('sends the other player back to WAITING_FOR_OPPONENT when a seat is forfeited in placement', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await seatedPlayers();
    // P1 confirms the rules and drops; P2 confirms late enough that P1's forfeit falls before the placement deadline.
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({ ok: true });
    await p2.inbox.state();
    p1.socket.close();
    await p2.inbox.state();
    const beforeForfeit = 10_000;
    clock.advance(DISCONNECT_FORFEIT_MS - PLACEMENT_TIME_LIMIT_MS + beforeForfeit);
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 0 })).toEqual({ ok: true });
    expect((await p2.inbox.state()).placement?.remainingMs).toBe(PLACEMENT_TIME_LIMIT_MS);
    await send(p2, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(placedFleet(P2_FLEET_SEED)) });
    await p2.inbox.state();

    clock.advance(PLACEMENT_TIME_LIMIT_MS - beforeForfeit);
    expect(await p2.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      me: { seat: SEATS.P2, nickname: 'Bob', isConnected: true },
      opponent: null,
      rules: DEFAULT_RULES,
      placement: null,
    });
    expect(await refusedHandshake({ protocolVersion: PROTOCOL_VERSION, session: sessions.P1 })).toBe(
      ERROR_CODES.SESSION_INVALID,
    );

    // The free seat is P1's: the next joiner takes it, and the rules are agreed on again before a new placement.
    const carol = await player();
    expect(await send(carol, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Carol' })).toMatchObject({ ok: true });
    expect(await carol.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.RULES_NEGOTIATION,
      me: { seat: SEATS.P1, nickname: 'Carol' },
      opponent: { seat: SEATS.P2, nickname: 'Bob' },
      hasConfirmedRules: { me: false, opponent: false },
    });
    expect(await p2.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.RULES_NEGOTIATION,
      opponent: { seat: SEATS.P1, nickname: 'Carol' },
    });
    // The freed seat stopped the placement timer: the old deadline passes without ending anything.
    clock.advance(beforeForfeit);
    await agreeOnRules(carol, p2);
    await carol.inbox.states(2);
    expect(await p2.inbox.states(2)).toMatchObject({
      phase: ROOM_PHASES.PLACEMENT,
      placement: { myShips: [], remainingMs: PLACEMENT_TIME_LIMIT_MS },
    });
  });
});

describe('LEAVE_ROOM', () => {
  it('frees the seat at once before the match: the other player waits again, and the session is gone', async () => {
    await start();
    const { p1, p2, sessions } = await seatedPlayers();
    await sendOnTimeline(p2, CLIENT_EVENTS.LEAVE_ROOM, {});
    expect(await p2.inbox.ack()).toEqual({ ok: true });
    expect(await p1.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
      me: { seat: SEATS.P1 },
      opponent: null,
    });

    // The leaver's socket has no seat any more, and its session no longer opens one.
    expect(await send(p2, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: [] })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
    expect(await refusedHandshake({ protocolVersion: PROTOCOL_VERSION, session: sessions.P2 })).toBe(
      ERROR_CODES.SESSION_INVALID,
    );
    await expectNothingPending(p2);
    await expectNothingPending(p1);
  });

  it('closes a waiting room its creator leaves', async () => {
    await start();
    const alice = await player();
    const { roomId } = (await send(alice, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    await alice.inbox.state();
    expect(await send(alice, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    expect(rooms.get(roomId)).toBeUndefined();
    expect(rooms.size).toBe(0);
    const bob = await player();
    expect(await send(bob, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Bob' })).toEqual({
      ok: false,
      error: ERROR_CODES.ROOM_NOT_FOUND,
    });
    await expectNothingPending(alice);
  });

  it('is refused with NOT_ALLOWED without a seat, during the match and at game over', async () => {
    await start();
    expect(await send(await player(), CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
    const { p1, p2, roomId } = await startedMatch();
    expect(await send(p1, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
    await playToVictory(p1, p2);
    expect(await send(p2, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.GAME_OVER);
  });

  it("keeps the next match's shots from the leaver", async () => {
    await start();
    const { p1, p2, roomId } = await seatedPlayers();
    expect(await send(p2, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    await p1.inbox.state();
    const carol = await player();
    expect(await send(carol, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Carol' })).toMatchObject({ ok: true });
    await agreeOnRules(p1, carol);
    for (const [from, seed] of [
      [p1, P1_FLEET_SEED],
      [carol, P2_FLEET_SEED],
    ] as const) {
      await send(from, CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: placements(placedFleet(seed)) });
      await send(from, CLIENT_EVENTS.CONFIRM_PLACEMENT, {});
    }
    clock.advance(START_COUNTDOWN_MS);
    expect(await send(p1, CLIENT_EVENTS.FIRE, { targets: [{ x: 0, y: 0 }] })).toEqual({ ok: true });
    // The shot went out before the server read the probe below, so on the leaver's connection it would come first.
    await expectNothingPending(p2);
  });
});
