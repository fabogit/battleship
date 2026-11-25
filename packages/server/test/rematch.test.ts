// The rematch flow over Socket.io (docs/server.md#game-over--rematch, ADR-0123–ADR-0125): every pair of choices, the
// replies and their order, the timers each outcome starts or stops, and every race the issue lists (#36).

import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  DICE_ANIMATION_MS,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  GAME_OVER_REASONS,
  GAME_OVER_TTL_MS,
  NEGOTIATION_TTL_MS,
  PLACEMENT_TIME_LIMIT_MS,
  PROTOCOL_VERSION,
  REMATCH_CHOICES,
  ROOM_CLOSED_REASONS,
  ROOM_PHASES,
  SEATS,
  TIMEOUT_ACTIONS,
  WAITING_TTL_MS,
  type RecordedRematchChoice,
} from '@battleship/core';
import { io as connect } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  baseUrl,
  clock,
  drop,
  expectBothDone,
  expectNothingPending,
  player,
  rooms,
  send,
  sendOnTimeline,
  start,
  startedMatch,
  stop,
  track,
  type ClientSocket,
  type Player,
  type StartedMatch,
} from './socket-harness.js';

afterEach(stop);

/** Rules other than `DEFAULT_RULES`, which the finished match is played with at version 1. */
const EDITED_RULES = { ...DEFAULT_RULES, timeoutAction: TIMEOUT_ACTIONS.PASS_TURN };

/** How a seat leaves at game over: the `LEAVE` choice, or `LEAVE_ROOM`, which the client sends (ADR-0126). */
const LEAVES = [
  [
    'REMATCH_CHOICE LEAVE',
    (from: Player) => send(from, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.LEAVE }),
  ],
  ['LEAVE_ROOM', (from: Player) => send(from, CLIENT_EVENTS.LEAVE_ROOM, {})],
] as const;

/** Every pair of choices that plays again, with the phase it resolves into. */
const PLAY_AGAIN = [
  [REMATCH_CHOICES.SAME_RULES, REMATCH_CHOICES.SAME_RULES, ROOM_PHASES.PLACEMENT],
  [REMATCH_CHOICES.SAME_RULES, REMATCH_CHOICES.CHANGE_RULES, ROOM_PHASES.RULES_NEGOTIATION],
  [REMATCH_CHOICES.CHANGE_RULES, REMATCH_CHOICES.SAME_RULES, ROOM_PHASES.RULES_NEGOTIATION],
  [REMATCH_CHOICES.CHANGE_RULES, REMATCH_CHOICES.CHANGE_RULES, ROOM_PHASES.RULES_NEGOTIATION],
] as const;

/**
 * Two players whose match P2 surrendered, with the game-over snapshots read: the game-over TTL counts from now.
 * @param rules The rules of the match.
 */
async function finishedMatch(rules = DEFAULT_RULES): Promise<StartedMatch> {
  const match = await startedMatch(rules);
  expect(await send(match.p2, CLIENT_EVENTS.SURRENDER, {})).toEqual({ ok: true });
  for (const { inbox } of [match.p1, match.p2]) {
    expect((await inbox.state()).gameOver).toMatchObject({ winner: SEATS.P1, reason: GAME_OVER_REASONS.SURRENDER });
  }
  return match;
}

/** Sends a choice to play again and expects it acked. */
async function choose(from: Player, choice: RecordedRematchChoice): Promise<void> {
  expect(await send(from, CLIENT_EVENTS.REMATCH_CHOICE, { choice })).toEqual({ ok: true });
}

/** Opens a socket with a stored session the server must refuse, and returns the `connect_error` message. */
async function refusedSession(session: { roomId: string; playerSecret: string }): Promise<string> {
  const socket: ClientSocket = track(
    connect(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      auth: { protocolVersion: PROTOCOL_VERSION, session },
    }),
  );
  return new Promise((resolve) => {
    socket.once('connect_error', (error) => {
      resolve(error.message);
    });
  });
}

describe('REMATCH_CHOICE to play again', () => {
  it('acks a first choice, then sends both seats the choices in GAME_OVER, the TTL still running', async () => {
    await start();
    const { p1, p2, roomId } = await finishedMatch();
    clock.advance(GAME_OVER_TTL_MS - 1);
    await sendOnTimeline(p2, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.CHANGE_RULES });
    expect(await p2.inbox.ack()).toEqual({ ok: true });
    expect((await p2.inbox.state()).gameOver?.rematch).toEqual({ me: REMATCH_CHOICES.CHANGE_RULES, opponent: null });
    expect((await p1.inbox.state()).gameOver?.rematch).toEqual({ me: null, opponent: REMATCH_CHOICES.CHANGE_RULES });
    // A choice does not restart the game-over TTL.
    clock.advance(1);
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.GAME_OVER_TTL });
    }
  });

  it.each(PLAY_AGAIN)(
    'resolves P1 %s and P2 %s into %s: the ack, then one STATE each, and the game-over TTL stops',
    async (p1Choice, p2Choice, phase) => {
      await start();
      const { p1, p2, roomId } = await finishedMatch();
      await choose(p1, p1Choice);
      await p1.inbox.state();
      await p2.inbox.state();
      await sendOnTimeline(p2, CLIENT_EVENTS.REMATCH_CHOICE, { choice: p2Choice });
      expect(await p2.inbox.ack()).toEqual({ ok: true });
      for (const [{ inbox }, seat] of [
        [p1, SEATS.P1],
        [p2, SEATS.P2],
      ] as const) {
        expect(await inbox.state()).toMatchObject({
          phase,
          me: { seat, isConnected: true },
          opponent: { isConnected: true, forfeitRemainingMs: null },
          battle: null,
          gameOver: null,
        });
      }
      expect(rooms.get(roomId)?.phase).toBe(phase);
      // The game-over TTL would have closed the room by now; only the new phase's own timers ran (a placement ends
      // before it).
      clock.advance(GAME_OVER_TTL_MS);
      expect(rooms.get(roomId)?.phase).not.toBe(ROOM_PHASES.GAME_OVER);
      expect(rooms.get(roomId)?.players).toMatchObject({ P1: { nickname: 'Alice' }, P2: { nickname: 'Bob' } });
    },
  );

  it('starts placement on both SAME_RULES with empty drafts, and the placement timer starts the next match', async () => {
    await start();
    const { p1, p2, roomId } = await finishedMatch(EDITED_RULES);
    await choose(p1, REMATCH_CHOICES.SAME_RULES);
    await choose(p2, REMATCH_CHOICES.SAME_RULES);
    for (const { inbox } of [p1, p2]) {
      await inbox.state();
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.PLACEMENT,
        rules: EDITED_RULES,
        rulesVersion: 1,
        hasConfirmedRules: { me: true, opponent: true },
        placement: {
          myShips: [],
          hasConfirmed: { me: false, opponent: false },
          remainingMs: PLACEMENT_TIME_LIMIT_MS,
          startCountdownMs: null,
        },
      });
    }
    // Nobody places: the deadline completes both fleets and rolls the dice for a new match, with no shot fired yet.
    clock.advance(PLACEMENT_TIME_LIMIT_MS);
    for (const { inbox } of [p1, p2]) {
      await inbox.dice();
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.IN_PROGRESS,
        battle: { incomingShots: [], outgoingShots: [], afkCount: { me: 0, opponent: 0 }, isPaused: false },
      });
    }
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.IN_PROGRESS);
  });

  it('opens a negotiation on CHANGE_RULES at the same version, nobody confirmed, which that version then closes', async () => {
    await start();
    const { p1, p2, roomId } = await finishedMatch(EDITED_RULES);
    await choose(p1, REMATCH_CHOICES.CHANGE_RULES);
    await choose(p2, REMATCH_CHOICES.SAME_RULES);
    for (const { inbox } of [p1, p2]) {
      await inbox.state();
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.RULES_NEGOTIATION,
        rules: EDITED_RULES,
        rulesVersion: 1,
        hasConfirmedRules: { me: false, opponent: false },
        placement: null,
      });
    }
    // A negotiation TTL starts with the phase, from the resolution.
    clock.advance(NEGOTIATION_TTL_MS - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
    expect(await send(p1, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 1 })).toEqual({ ok: true });
    expect(await send(p2, CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 1 })).toEqual({ ok: true });
    for (const { inbox } of [p1, p2]) {
      await inbox.state();
      expect((await inbox.state()).phase).toBe(ROOM_PHASES.PLACEMENT);
    }
    clock.advance(1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
  });

  it('acks the same choice again and sends the unchanged choices, and a seat may change its choice', async () => {
    await start();
    const { p1, p2, roomId } = await finishedMatch();
    await choose(p1, REMATCH_CHOICES.SAME_RULES);
    await p1.inbox.state();
    await p2.inbox.state();
    await sendOnTimeline(p1, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.SAME_RULES });
    expect(await p1.inbox.ack()).toEqual({ ok: true });
    expect((await p1.inbox.state()).gameOver?.rematch).toEqual({ me: REMATCH_CHOICES.SAME_RULES, opponent: null });
    expect((await p2.inbox.state()).gameOver?.rematch).toEqual({ me: null, opponent: REMATCH_CHOICES.SAME_RULES });

    await choose(p1, REMATCH_CHOICES.CHANGE_RULES);
    expect((await p2.inbox.state()).gameOver?.rematch).toEqual({ me: null, opponent: REMATCH_CHOICES.CHANGE_RULES });
    await p1.inbox.state();
    await choose(p2, REMATCH_CHOICES.SAME_RULES);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.RULES_NEGOTIATION);
  });

  it('is NOT_ALLOWED without a seat and WRONG_PHASE before game over, LEAVE included, and frees no seat', async () => {
    await start();
    for (const choice of Object.values(REMATCH_CHOICES)) {
      expect(await send(await player(), CLIENT_EVENTS.REMATCH_CHOICE, { choice })).toEqual({
        ok: false,
        error: ERROR_CODES.NOT_ALLOWED,
      });
    }
    const { p1, p2, roomId } = await startedMatch();
    for (const from of [p1, p2]) {
      for (const choice of Object.values(REMATCH_CHOICES)) {
        expect(await send(from, CLIENT_EVENTS.REMATCH_CHOICE, { choice })).toEqual({
          ok: false,
          error: ERROR_CODES.WRONG_PHASE,
        });
      }
    }
    expect(rooms.get(roomId)).toMatchObject({ phase: ROOM_PHASES.IN_PROGRESS, players: { P1: {}, P2: {} } });
  });
});

describe('leaving at game over (ADR-0123)', () => {
  it.each(LEAVES)(
    '%s frees the seat at once: the ack, the other player waits with the same link, the session is gone',
    async (_label, leave) => {
      await start();
      const { p1, p2, roomId, sessions } = await finishedMatch();
      await choose(p2, REMATCH_CHOICES.SAME_RULES);
      await p1.inbox.state();
      await p2.inbox.state();
      expect(await leave(p1)).toEqual({ ok: true });
      expect(await p2.inbox.state()).toMatchObject({
        roomId,
        phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
        me: { seat: SEATS.P2, nickname: 'Bob', isConnected: true },
        opponent: null,
        gameOver: null,
      });
      expect(await send(p1, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.SAME_RULES })).toEqual({
        ok: false,
        error: ERROR_CODES.NOT_ALLOWED,
      });
      expect(await refusedSession(sessions.P1)).toBe(ERROR_CODES.SESSION_INVALID);
      await expectNothingPending(p1);

      // The freed seat is P1's, for the next joiner; the game-over TTL stopped, and the waiting TTL counts from now.
      clock.advance(GAME_OVER_TTL_MS);
      expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
      clock.advance(WAITING_TTL_MS - GAME_OVER_TTL_MS - 1);
      const carol = await player();
      expect(await send(carol, CLIENT_EVENTS.JOIN_ROOM, { roomId, nickname: 'Carol' })).toMatchObject({ ok: true });
      expect(await carol.inbox.state()).toMatchObject({
        phase: ROOM_PHASES.RULES_NEGOTIATION,
        me: { seat: SEATS.P1, nickname: 'Carol' },
        opponent: { seat: SEATS.P2, nickname: 'Bob' },
      });
    },
  );

  it('expires the waiting room WAITING_TTL_MS after the leave when nobody joins', async () => {
    await start();
    const { p1, p2, roomId } = await finishedMatch();
    clock.advance(GAME_OVER_TTL_MS - 1);
    expect(await send(p2, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    expect((await p1.inbox.state()).phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    clock.advance(WAITING_TTL_MS - 1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    clock.advance(1);
    expect(await p1.inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.WAITING_TTL });
  });

  it('runs the forfeit clock of a player left behind who is away again from their drop (the forfeit bound)', async () => {
    await start();
    const { p1, p2, roomId } = await startedMatch();
    await drop(p2, roomId, SEATS.P2);
    await p1.inbox.state();
    clock.advance(DISCONNECT_FORFEIT_MS - 10_000);
    expect(await send(p1, CLIENT_EVENTS.SURRENDER, {})).toEqual({ ok: true });
    await p1.inbox.state();
    expect(await send(p1, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    expect(rooms.get(roomId)).toMatchObject({ phase: ROOM_PHASES.WAITING_FOR_OPPONENT, players: { P1: null } });
    clock.advance(10_000 - 1);
    expect(rooms.get(roomId)).toBeDefined();
    clock.advance(1);
    expect(rooms.get(roomId)).toBeUndefined();
    expect(rooms.size).toBe(0);
  });
});

describe('rematch races (#36)', () => {
  it('SAME_RULES from both seats at once resolves once: each player gets the GAME_OVER STATE, then PLACEMENT', async () => {
    await start();
    const { p1, p2, roomId } = await finishedMatch();
    const acks = await Promise.all([
      send(p1, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.SAME_RULES }),
      send(p2, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.SAME_RULES }),
    ]);
    expect(acks).toEqual([{ ok: true }, { ok: true }]);
    for (const { inbox } of [p1, p2]) {
      expect((await inbox.state()).phase).toBe(ROOM_PHASES.GAME_OVER);
      expect((await inbox.state()).phase).toBe(ROOM_PHASES.PLACEMENT);
    }
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    await expectBothDone(p1, p2);
  });

  // The server runs a command to its end before it reads the next one, so two choices in flight are handled one after
  // the other; each order is pinned here.
  it.each([REMATCH_CHOICES.SAME_RULES, REMATCH_CHOICES.CHANGE_RULES])(
    '%s handled before the other seat leaves: both acked, and the chooser waits in WAITING_FOR_OPPONENT',
    async (choice) => {
      await start();
      const { p1, p2, roomId } = await finishedMatch();
      await choose(p1, choice);
      expect(await send(p2, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.LEAVE })).toEqual({ ok: true });
      expect((await p1.inbox.state()).gameOver?.rematch).toEqual({ me: choice, opponent: null });
      expect(await p1.inbox.state()).toMatchObject({ phase: ROOM_PHASES.WAITING_FOR_OPPONENT, me: { seat: SEATS.P1 } });
      expect(rooms.get(roomId)).toMatchObject({ phase: ROOM_PHASES.WAITING_FOR_OPPONENT, players: { P2: null } });
    },
  );

  it.each([REMATCH_CHOICES.SAME_RULES, REMATCH_CHOICES.CHANGE_RULES])(
    '%s handled after the other seat left is WRONG_PHASE, and the chooser keeps their seat',
    async (choice) => {
      await start();
      const { p1, p2, roomId } = await finishedMatch();
      expect(await send(p2, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.LEAVE })).toEqual({ ok: true });
      await p1.inbox.state();
      expect(await send(p1, CLIENT_EVENTS.REMATCH_CHOICE, { choice })).toEqual({
        ok: false,
        error: ERROR_CODES.WRONG_PHASE,
      });
      expect(rooms.get(roomId)).toMatchObject({
        phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
        players: { P1: { nickname: 'Alice' }, P2: null },
      });
      await expectNothingPending(p2);
    },
  );

  it('LEAVE_ROOM from both seats at once frees both seats and closes the room once', async () => {
    const lines: { msg: string; roomId?: string }[] = [];
    await start({
      logger: {
        level: 'info',
        stream: {
          write: (line: string) => {
            lines.push(JSON.parse(line) as { msg: string });
          },
        },
      },
    });
    const { p1, p2, roomId } = await finishedMatch();
    const acks = await Promise.all([send(p1, CLIENT_EVENTS.LEAVE_ROOM, {}), send(p2, CLIENT_EVENTS.LEAVE_ROOM, {})]);
    expect(acks).toEqual([{ ok: true }, { ok: true }]);
    expect(rooms.get(roomId)).toBeUndefined();
    expect(rooms.size).toBe(0);
    expect(lines.filter((line) => line.msg === 'Room closed' && line.roomId === roomId)).toHaveLength(1);
    expect(lines.filter((line) => line.msg === 'Seat left' && line.roomId === roomId)).toHaveLength(2);
  });

  it('REMATCH_CHOICE LEAVE then LEAVE_ROOM from the other seat closes the room; a second LEAVE choice is WRONG_PHASE', async () => {
    await start();
    const first = await finishedMatch();
    expect(await send(first.p1, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.LEAVE })).toEqual({ ok: true });
    await first.p2.inbox.state();
    expect(await send(first.p2, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.LEAVE })).toEqual({
      ok: false,
      error: ERROR_CODES.WRONG_PHASE,
    });
    expect(rooms.get(first.roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    expect(await send(first.p2, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: true });
    expect(rooms.get(first.roomId)).toBeUndefined();
  });

  it('a choice that resolves just before the game-over TTL wins: no ROOM_CLOSED, and no second STATE', async () => {
    await start();
    const { p1, p2, roomId } = await finishedMatch();
    await choose(p1, REMATCH_CHOICES.SAME_RULES);
    clock.advance(GAME_OVER_TTL_MS - 1);
    await choose(p2, REMATCH_CHOICES.SAME_RULES);
    for (const { inbox } of [p1, p2]) {
      await inbox.state();
      expect((await inbox.state()).phase).toBe(ROOM_PHASES.PLACEMENT);
    }
    clock.advance(1);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.PLACEMENT);
    await expectBothDone(p1, p2);
  });

  it('the game-over TTL that runs first wins: ROOM_CLOSED, then a late choice is NOT_ALLOWED, with no STATE', async () => {
    await start();
    const { p1, p2, roomId } = await finishedMatch();
    await choose(p1, REMATCH_CHOICES.SAME_RULES);
    await p1.inbox.state();
    await p2.inbox.state();
    clock.advance(GAME_OVER_TTL_MS);
    for (const { inbox } of [p1, p2]) {
      expect(await inbox.roomClosed()).toEqual({ roomId, reason: ROOM_CLOSED_REASONS.GAME_OVER_TTL });
    }
    expect(await send(p2, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.SAME_RULES })).toEqual({
      ok: false,
      error: ERROR_CODES.NOT_ALLOWED,
    });
    expect(await send(p1, CLIENT_EVENTS.LEAVE_ROOM, {})).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
    for (const target of [p1, p2]) {
      await expectNothingPending(target);
    }
  });

  it('a choice kept for a seat that dropped resolves on its return, with no forfeit clock in the new placement', async () => {
    await start();
    const { p1, p2, roomId, sessions } = await finishedMatch();
    await choose(p2, REMATCH_CHOICES.SAME_RULES);
    await p1.inbox.state();
    await p2.inbox.state();
    await drop(p2, roomId, SEATS.P2);
    expect(await p1.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.GAME_OVER,
      opponent: { isConnected: false, forfeitRemainingMs: null },
      gameOver: { rematch: { me: null, opponent: REMATCH_CHOICES.SAME_RULES } },
    });
    clock.advance(30_000);
    await choose(p1, REMATCH_CHOICES.SAME_RULES);
    expect(await p1.inbox.state()).toMatchObject({
      phase: ROOM_PHASES.GAME_OVER,
      gameOver: { rematch: { me: REMATCH_CHOICES.SAME_RULES, opponent: REMATCH_CHOICES.SAME_RULES } },
    });

    clock.advance(30_000);
    const back = await player(sessions.P2);
    for (const { inbox } of [p1, back]) {
      expect(await inbox.state()).toMatchObject({
        phase: ROOM_PHASES.PLACEMENT,
        opponent: { isConnected: true, forfeitRemainingMs: null },
        placement: { remainingMs: PLACEMENT_TIME_LIMIT_MS },
      });
    }
    expect(rooms.get(roomId)?.disconnectedAt).toEqual({ P1: null, P2: null });
    expect(rooms.nextForfeit(roomId)).toBeUndefined();
    // Past the old drop's forfeit and the game-over TTL: the placement deadline starts the match with both seats.
    clock.advance(PLACEMENT_TIME_LIMIT_MS + DICE_ANIMATION_MS);
    expect(rooms.get(roomId)).toMatchObject({
      phase: ROOM_PHASES.IN_PROGRESS,
      players: { P1: { nickname: 'Alice' }, P2: { nickname: 'Bob' } },
    });
  });

  it('a choice from a socket that moved on to another room is answered there, never by the match it left', async () => {
    await start();
    const { p1, p2, roomId } = await finishedMatch();
    const created = (await send(p1, CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Alice' })) as { roomId: string };
    expect((await p1.inbox.state()).roomId).toBe(created.roomId);
    expect((await p2.inbox.state()).opponent).toMatchObject({ isConnected: false });

    for (const choice of Object.values(REMATCH_CHOICES)) {
      expect(await send(p1, CLIENT_EVENTS.REMATCH_CHOICE, { choice })).toEqual({
        ok: false,
        error: ERROR_CODES.WRONG_PHASE,
      });
    }
    expect(rooms.get(roomId)).toMatchObject({
      phase: ROOM_PHASES.GAME_OVER,
      rematch: { P1: null, P2: null },
      players: { P1: { nickname: 'Alice' }, P2: { nickname: 'Bob' } },
    });
    expect(rooms.get(created.roomId)?.phase).toBe(ROOM_PHASES.WAITING_FOR_OPPONENT);
    await expectNothingPending(p2);
  });

  it.each(PLAY_AGAIN)(
    'after P1 %s and P2 %s resolved into %s, a late LEAVE choice is WRONG_PHASE and frees no seat',
    async (p1Choice, p2Choice) => {
      await start();
      const { p1, p2, roomId } = await finishedMatch();
      await choose(p1, p1Choice);
      await choose(p2, p2Choice);
      const phase = rooms.get(roomId)?.phase;
      for (const from of [p1, p2]) {
        expect(await send(from, CLIENT_EVENTS.REMATCH_CHOICE, { choice: REMATCH_CHOICES.LEAVE })).toEqual({
          ok: false,
          error: ERROR_CODES.WRONG_PHASE,
        });
      }
      expect(rooms.get(roomId)).toMatchObject({
        phase,
        players: { P1: { nickname: 'Alice' }, P2: { nickname: 'Bob' } },
      });
    },
  );
});

describe('rematch logs', () => {
  /** Starts the harness server with its Pino lines collected in memory. */
  async function startLogged(): Promise<{ msg: string; roomId?: string; phase?: string }[]> {
    const lines: { msg: string; roomId?: string; phase?: string }[] = [];
    await start({
      logger: {
        level: 'info',
        stream: {
          write: (line: string) => {
            lines.push(JSON.parse(line) as { msg: string });
          },
        },
      },
    });
    return lines;
  }

  it('record the change of phase a choice resolves', async () => {
    const lines = await startLogged();
    const { p1, p2, roomId } = await finishedMatch();
    await choose(p1, REMATCH_CHOICES.CHANGE_RULES);
    await choose(p2, REMATCH_CHOICES.CHANGE_RULES);
    expect(lines).toContainEqual(
      expect.objectContaining({ msg: 'Room phase changed', roomId, phase: ROOM_PHASES.RULES_NEGOTIATION }),
    );
  });

  it('record the change of phase a return resolves', async () => {
    const lines = await startLogged();
    const { p1, p2, roomId, sessions } = await finishedMatch();
    await choose(p2, REMATCH_CHOICES.SAME_RULES);
    await drop(p2, roomId, SEATS.P2);
    await choose(p1, REMATCH_CHOICES.SAME_RULES);
    expect(rooms.get(roomId)?.phase).toBe(ROOM_PHASES.GAME_OVER);
    await player(sessions.P2);
    await vi.waitFor(() => {
      expect(lines).toContainEqual(
        expect.objectContaining({ msg: 'Room phase changed', roomId, phase: ROOM_PHASES.PLACEMENT }),
      );
    });
  });
});
