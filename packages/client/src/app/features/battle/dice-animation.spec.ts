import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DICE_ANIMATION_MS, SEATS, SERVER_EVENTS, SHOT_OUTCOMES, type DiceRolledPayload } from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakeGameSocket,
  battleSnapshot,
  placementSnapshot,
  provideFakeGameSocket,
} from '../../../testing/fake-game-socket';
import { createRoomId } from '../../../testing/session-fixtures';
import { GameStateService } from '../../core/game-state';
import { PREFERS_REDUCED_MOTION } from '../../shared/reduced-motion';
import { DiceAnimation, diceFrames } from './dice-animation';

const ROOM_ID = createRoomId(0);
/** One round: Ada (`P1`) 5, Grace 3. */
const ADA_STARTS: DiceRolledPayload = { rolls: [{ P1: 5, P2: 3 }], starter: SEATS.P1 };
/** A tie at 4, then Grace (`P2`) 6 against 2. */
const TIE_THEN_GRACE: DiceRolledPayload = {
  rolls: [
    { P1: 4, P2: 4 },
    { P1: 2, P2: 6 },
  ],
  starter: SEATS.P2,
};

let socket: FakeGameSocket;
let prefersReducedMotion: ReturnType<typeof signal<boolean>>;
let dice: DiceAnimation;

/**
 * Starts a match as the server does: `DICE_ROLLED`, then the `STATE` with the dice animation's `null` turn time.
 * @param roll The roll.
 */
function startMatch(roll: DiceRolledPayload): void {
  socket.fire(SERVER_EVENTS.DICE_ROLLED, roll);
  socket.fire(SERVER_EVENTS.STATE, battleSnapshot(ROOM_ID, { currentTurn: roll.starter, turnRemainingMs: null }));
  TestBed.tick();
}

/**
 * Lets time pass and runs the effects.
 * @param ms How long, in ms.
 */
function wait(ms: number): void {
  vi.advanceTimersByTime(ms);
  TestBed.tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  socket = new FakeGameSocket();
  prefersReducedMotion = signal(false);
  TestBed.configureTestingModule({
    providers: [
      provideFakeGameSocket(socket),
      DiceAnimation,
      { provide: PREFERS_REDUCED_MOTION, useValue: prefersReducedMotion },
    ],
  });
  TestBed.inject(GameStateService);
  socket.fire(SERVER_EVENTS.STATE, placementSnapshot(ROOM_ID));
  dice = TestBed.inject(DiceAnimation);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('diceFrames', () => {
  it('tumbles, then shows the faces, over half of the time each', () => {
    expect(diceFrames(ADA_STARTS.rolls, 3_000)).toEqual([
      { round: 0, roll: { P1: 5, P2: 3 }, isRolling: true, isLast: true, startsAtMs: 0 },
      { round: 0, roll: { P1: 5, P2: 3 }, isRolling: false, isLast: true, startsAtMs: 1_500 },
    ]);
  });

  it('shares the time between the rounds, every tie before its re-roll', () => {
    const frames = diceFrames(TIE_THEN_GRACE.rolls, 3_000);

    expect(frames.map(({ round, isRolling, isLast, startsAtMs }) => [round, isRolling, isLast, startsAtMs])).toEqual([
      [0, true, false, 0],
      [0, false, false, 750],
      [1, true, true, 1_500],
      [1, false, true, 2_250],
    ]);
  });
});

describe('DiceAnimation', () => {
  it('has nothing to play before a roll', () => {
    expect(dice.frame()).toBeNull();
    expect(dice.isPlaying()).toBe(false);
  });

  it('plays the tie, the re-roll and the result within DICE_ANIMATION_MS, then stops playing', () => {
    startMatch(TIE_THEN_GRACE);
    expect(dice.frame()).toMatchObject({ round: 0, isRolling: true });
    expect(dice.isPlaying()).toBe(true);

    wait(750);
    expect(dice.frame()).toMatchObject({ round: 0, isRolling: false, isLast: false, roll: { P1: 4, P2: 4 } });

    wait(750);
    expect(dice.frame()).toMatchObject({ round: 1, isRolling: true });

    wait(750);
    expect(dice.frame()).toMatchObject({ round: 1, isRolling: false, isLast: true, roll: { P1: 2, P2: 6 } });
    expect(dice.isPlaying()).toBe(true);

    wait(DICE_ANIMATION_MS - 2_250 - 1);
    expect(dice.isPlaying()).toBe(true);
    wait(1);
    expect(dice.isPlaying()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the result until the first turn timer starts, then shows nothing', () => {
    startMatch(ADA_STARTS);
    wait(DICE_ANIMATION_MS + 200);

    // The server's STATE at the end of the animation is late: the dice stay.
    expect(dice.frame()).toMatchObject({ isRolling: false, isLast: true });

    socket.fire(SERVER_EVENTS.STATE, battleSnapshot(ROOM_ID, { turnRemainingMs: 30_000 }));
    expect(dice.frame()).toBeNull();
  });

  it('joins the animation where it is when the roll arrived earlier', () => {
    socket.fire(SERVER_EVENTS.DICE_ROLLED, ADA_STARTS);
    vi.advanceTimersByTime(2_000);
    socket.fire(SERVER_EVENTS.STATE, battleSnapshot(ROOM_ID, { turnRemainingMs: null }));
    TestBed.tick();

    expect(dice.frame()).toMatchObject({ isRolling: false });
    wait(999);
    expect(dice.isPlaying()).toBe(true);
    wait(1);
    expect(dice.isPlaying()).toBe(false);
  });

  it('ends at the first shot, which the starter may fire before the animation is over', () => {
    startMatch(ADA_STARTS);

    socket.fire(
      SERVER_EVENTS.STATE,
      battleSnapshot(ROOM_ID, {
        currentTurn: SEATS.P2,
        outgoingShots: [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.MISS }],
        turnRemainingMs: 30_000,
      }),
    );

    expect(dice.frame()).toBeNull();
    expect(dice.isPlaying()).toBe(false);
  });

  it('shows the result at once, without holding the turn, when the player asks for reduced motion', () => {
    prefersReducedMotion.set(true);
    startMatch(TIE_THEN_GRACE);

    expect(dice.frame()).toMatchObject({ round: 1, isRolling: false, isLast: true, roll: { P1: 2, P2: 6 } });
    expect(dice.isPlaying()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('has nothing to play after a reload, where the snapshot says who starts but brings no dice (ADR-0106)', () => {
    socket.fire(SERVER_EVENTS.STATE, battleSnapshot(ROOM_ID, { turnRemainingMs: null }));
    TestBed.tick();

    expect(dice.frame()).toBeNull();
    expect(dice.isPlaying()).toBe(false);
  });
});
