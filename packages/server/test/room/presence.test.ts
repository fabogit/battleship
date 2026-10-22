import {
  CLIENT_EVENTS,
  createPlayerSecret,
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  GAME_OVER_REASONS,
  PLACEMENT_TIME_LIMIT_MS,
  ROOM_PHASES,
  SEATS,
} from '@battleship/core';
import { describe, expect, it } from 'vitest';

import {
  disconnectSeat,
  forfeitDeadline,
  forfeitSeat,
  leaveRoom,
  nextForfeit,
  reconnectSeat,
} from '../../src/room/presence.js';
import { applyCommand, endMatch, type BattleRoom, type RoomState } from '../../src/room/room.js';
import { projectSnapshot } from '../../src/room/snapshot.js';
import {
  apply,
  battleRoom,
  deepFreeze,
  expectAccepted,
  fleet,
  NOW,
  placeAndConfirm,
  placementRoom,
  ROOM_ID,
  waitingRoom,
} from './fixtures.js';

/** A match P1 won on its last shot, both players connected. */
function gameOverRoom(): RoomState {
  const state = battleRoom();
  return endMatch(state, state.battle, SEATS.P1, GAME_OVER_REASONS.FLEET_DESTROYED);
}

/** Sends `SET_PAUSED` from a seat. */
function setPaused(state: RoomState, seat: (typeof SEATS)[keyof typeof SEATS], isPaused: boolean) {
  return applyCommand(state, { type: CLIENT_EVENTS.SET_PAUSED, seat, payload: { isPaused } }, NOW);
}

describe('disconnectSeat', () => {
  it.each([
    [ROOM_PHASES.WAITING_FOR_OPPONENT, waitingRoom],
    [ROOM_PHASES.PLACEMENT, placementRoom],
    [ROOM_PHASES.GAME_OVER, gameOverRoom],
  ])('records the drop in %s and changes nothing else', (_phase, room) => {
    const state = deepFreeze(room());
    expect(disconnectSeat(state, SEATS.P1, NOW)).toEqual({ ...state, disconnectedAt: { P1: NOW, P2: null } });
  });

  it('pauses a match in progress', () => {
    const state = disconnectSeat(battleRoom(), SEATS.P2, NOW);
    expect(state).toMatchObject({ disconnectedAt: { P1: null, P2: NOW }, isPaused: true });
  });

  it('keeps the first drop time of a seat already away, and ignores an empty seat', () => {
    const away = disconnectSeat(placementRoom(), SEATS.P1, NOW);
    expect(disconnectSeat(away, SEATS.P1, NOW + 1_000)).toBe(away);
    const waiting = waitingRoom();
    expect(disconnectSeat(waiting, SEATS.P2, NOW)).toBe(waiting);
  });
});

describe('reconnectSeat', () => {
  it('stops the forfeit clock and resumes the match once both seats are back', () => {
    const away = disconnectSeat(battleRoom(), SEATS.P1, NOW);
    expect(reconnectSeat(away, SEATS.P1)).toMatchObject({ disconnectedAt: { P1: null, P2: null }, isPaused: false });
  });

  it('keeps the match paused while the opponent is still away', () => {
    const bothAway = disconnectSeat(disconnectSeat(battleRoom(), SEATS.P1, NOW), SEATS.P2, NOW + 1_000);
    expect(reconnectSeat(bothAway, SEATS.P2)).toMatchObject({ disconnectedAt: { P1: NOW, P2: null }, isPaused: true });
  });

  it('resumes a match the connected player had resumed by hand, then paused again', () => {
    const away = disconnectSeat(battleRoom(), SEATS.P2, NOW);
    const resumed = expectAccepted(setPaused(away, SEATS.P1, false)).state;
    expect(resumed).toMatchObject({ isPaused: false });
    const paused = expectAccepted(setPaused(resumed, SEATS.P1, true)).state;
    expect(reconnectSeat(paused, SEATS.P2)).toMatchObject({ isPaused: false });
  });

  it('leaves a connected seat as it is', () => {
    const state = placementRoom();
    expect(reconnectSeat(state, SEATS.P1)).toBe(state);
  });
});

describe('forfeit clock', () => {
  it('runs DISCONNECT_FORFEIT_MS from the drop in every phase but GAME_OVER', () => {
    for (const room of [waitingRoom, placementRoom, battleRoom]) {
      expect(forfeitDeadline(disconnectSeat(room(), SEATS.P1, NOW), SEATS.P1)).toBe(NOW + DISCONNECT_FORFEIT_MS);
    }
    expect(forfeitDeadline(disconnectSeat(gameOverRoom(), SEATS.P1, NOW), SEATS.P1)).toBeNull();
    expect(forfeitDeadline(placementRoom(), SEATS.P1)).toBeNull();
  });

  it('keeps running through a pause and a manual resume', () => {
    const away = disconnectSeat(battleRoom(), SEATS.P2, NOW);
    const resumed = expectAccepted(setPaused(away, SEATS.P1, false)).state;
    expect(nextForfeit(away)).toEqual({ seat: SEATS.P2, at: NOW + DISCONNECT_FORFEIT_MS });
    expect(nextForfeit(resumed)).toEqual({ seat: SEATS.P2, at: NOW + DISCONNECT_FORFEIT_MS });
  });

  it('picks the seat away longest, P1 on a tie', () => {
    const p2First = disconnectSeat(disconnectSeat(placementRoom(), SEATS.P2, NOW), SEATS.P1, NOW + 1);
    expect(nextForfeit(p2First)).toEqual({ seat: SEATS.P2, at: NOW + DISCONNECT_FORFEIT_MS });
    const tie = disconnectSeat(disconnectSeat(placementRoom(), SEATS.P2, NOW), SEATS.P1, NOW);
    expect(nextForfeit(tie)?.seat).toBe(SEATS.P1);
    expect(nextForfeit(placementRoom())).toBeNull();
  });
});

describe('forfeitSeat', () => {
  it('closes a waiting room whose only player forfeits', () => {
    expect(forfeitSeat(disconnectSeat(waitingRoom(), SEATS.P1, NOW), SEATS.P1)).toBeNull();
  });

  it.each(Object.values(SEATS))(
    'sends the other player back to WAITING_FOR_OPPONENT in their own seat when %s forfeits placement',
    (seat) => {
      const stayer = seat === SEATS.P1 ? SEATS.P2 : SEATS.P1;
      const placed = placeAndConfirm(placementRoom(), stayer, fleet(2));
      const state = forfeitSeat(disconnectSeat(placed, seat, NOW), seat);
      expect(state).toEqual({
        phase: ROOM_PHASES.WAITING_FOR_OPPONENT,
        roomId: ROOM_ID,
        rules: DEFAULT_RULES,
        rulesVersion: 0,
        players: { [seat]: null, [stayer]: placed.players[stayer] },
        disconnectedAt: { P1: null, P2: null },
      });
    },
  );

  it('keeps the forfeit clock of a player left behind who is away too', () => {
    const bothAway = disconnectSeat(disconnectSeat(placementRoom(), SEATS.P1, NOW), SEATS.P2, NOW + 1_000);
    const state = forfeitSeat(bothAway, SEATS.P1);
    expect(state?.disconnectedAt).toEqual({ P1: null, P2: NOW + 1_000 });
    expect(state === null ? null : forfeitSeat(state, SEATS.P2)).toBeNull();
  });

  it.each(Object.values(SEATS))('ends a match %s forfeits with DISCONNECT_FORFEIT, the opponent winning', (seat) => {
    const away = disconnectSeat(battleRoom(), seat, NOW);
    expect(forfeitSeat(away, seat)).toEqual({
      phase: ROOM_PHASES.GAME_OVER,
      roomId: ROOM_ID,
      rules: DEFAULT_RULES,
      rulesVersion: 0,
      players: away.players,
      disconnectedAt: away.disconnectedAt,
      battle: (away as BattleRoom).battle,
      winner: seat === SEATS.P1 ? SEATS.P2 : SEATS.P1,
      reason: GAME_OVER_REASONS.DISCONNECT_FORFEIT,
    });
  });

  it('gives the win to the opponent even when they are away too', () => {
    const bothAway = disconnectSeat(disconnectSeat(battleRoom(), SEATS.P1, NOW), SEATS.P2, NOW + 1_000);
    expect(forfeitSeat(bothAway, SEATS.P1)).toMatchObject({ phase: ROOM_PHASES.GAME_OVER, winner: SEATS.P2 });
  });
});

describe('a seat freed before the match', () => {
  it('goes to the next joiner, P1 included', () => {
    const left = leaveRoom(placementRoom(), SEATS.P1);
    if (!left.ok || left.state === null) {
      expect.fail('the seat was not freed');
    }
    const secret = createPlayerSecret();
    const joined = apply(
      left.state,
      { type: CLIENT_EVENTS.JOIN_ROOM, payload: { roomId: ROOM_ID, nickname: 'Carol' }, playerSecret: secret },
      NOW + 1_000,
    );
    expect(joined).toMatchObject({
      phase: ROOM_PHASES.PLACEMENT,
      players: { P1: { nickname: 'Carol', playerSecret: secret }, P2: { nickname: 'Bob' } },
      deadline: NOW + 1_000 + PLACEMENT_TIME_LIMIT_MS,
    });
  });
});

describe('leaveRoom', () => {
  it('closes a waiting room its only player leaves', () => {
    expect(leaveRoom(waitingRoom(), SEATS.P1)).toEqual({ ok: true, state: null });
  });

  it('frees the seat at once in placement, like a forfeit', () => {
    const state = placementRoom();
    expect(leaveRoom(state, SEATS.P2)).toEqual({ ok: true, state: forfeitSeat(state, SEATS.P2) });
  });

  it.each([
    [ROOM_PHASES.IN_PROGRESS, battleRoom],
    [ROOM_PHASES.GAME_OVER, gameOverRoom],
  ])('answers NOT_ALLOWED in %s until surrender and rematch land', (_phase, room) => {
    expect(leaveRoom(room(), SEATS.P1)).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
  });
});

describe('SET_PAUSED', () => {
  it('answers NOT_ALLOWED while the opponent is connected', () => {
    expect(setPaused(battleRoom(), SEATS.P1, true)).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
    expect(setPaused(battleRoom(), SEATS.P1, false)).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
  });

  it('answers NOT_ALLOWED to the player who is away, even with the opponent away too', () => {
    const away = disconnectSeat(battleRoom(), SEATS.P2, NOW);
    expect(setPaused(away, SEATS.P2, false)).toEqual({ ok: false, error: ERROR_CODES.NOT_ALLOWED });
  });

  it('lets the connected player resume and pause while the opponent is away', () => {
    const away = disconnectSeat(battleRoom(), SEATS.P1, NOW);
    const resumed = expectAccepted(setPaused(away, SEATS.P2, false)).state;
    expect(resumed).toMatchObject({ isPaused: false });
    expect(expectAccepted(setPaused(resumed, SEATS.P2, true)).state).toMatchObject({ isPaused: true });
  });

  it('accepts the state the match is already in without changing the room', () => {
    const away = disconnectSeat(battleRoom(), SEATS.P1, NOW);
    expect(expectAccepted(setPaused(away, SEATS.P2, true)).state).toBe(away);
  });

  it('leaves the turn playable: pause freezes the turn timer, not the shots', () => {
    const paused = disconnectSeat(battleRoom(), SEATS.P2, NOW);
    const fired = apply(paused, { type: CLIENT_EVENTS.FIRE, seat: SEATS.P1, payload: { targets: [{ x: 0, y: 0 }] } });
    expect(fired).toMatchObject({ isPaused: true, battle: { currentTurn: SEATS.P2 } });
  });
});

describe('a match that starts with a player away', () => {
  it('starts paused, with the forfeit clock still counting from the drop', () => {
    const p1Confirmed = placeAndConfirm(placementRoom(), SEATS.P1, fleet(1));
    const placed = apply(p1Confirmed, {
      type: CLIENT_EVENTS.UPDATE_PLACEMENT,
      seat: SEATS.P2,
      payload: { ships: fleet(2) },
    });
    const p1Away = disconnectSeat(placed, SEATS.P1, NOW);
    const started = apply(p1Away, { type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat: SEATS.P2, payload: {} });
    expect(started).toMatchObject({ phase: ROOM_PHASES.IN_PROGRESS, isPaused: true, disconnectedAt: { P1: NOW } });
  });

  it('starts running when both are connected', () => {
    expect(battleRoom().isPaused).toBe(false);
  });
});

describe('presence in the snapshot', () => {
  it('shows the opponent away with the forfeit time left, and the match paused', () => {
    const away = disconnectSeat(battleRoom(), SEATS.P2, NOW);
    const snapshot = projectSnapshot(away, SEATS.P1, NOW + 60_000);
    expect(snapshot.me).toMatchObject({ isConnected: true, forfeitRemainingMs: null });
    expect(snapshot.opponent).toMatchObject({
      isConnected: false,
      forfeitRemainingMs: DISCONNECT_FORFEIT_MS - 60_000,
    });
    expect(snapshot.battle?.isPaused).toBe(true);
  });

  it('never shows a negative forfeit time', () => {
    const away = disconnectSeat(placementRoom(), SEATS.P2, NOW);
    expect(projectSnapshot(away, SEATS.P1, NOW + 2 * DISCONNECT_FORFEIT_MS).opponent?.forfeitRemainingMs).toBe(0);
  });

  it('shows a player away at game over without a forfeit time', () => {
    const away = disconnectSeat(gameOverRoom(), SEATS.P2, NOW);
    expect(projectSnapshot(away, SEATS.P1, NOW).opponent).toMatchObject({
      isConnected: false,
      forfeitRemainingMs: null,
    });
  });
});
