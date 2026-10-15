import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  CLIENT_EVENTS,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  ROOM_PHASES,
  SEATS,
  SERVER_EVENTS,
  type PlayerStateSnapshot,
  type PlayerView,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakeGameSocket,
  battleSnapshot,
  fromSeat,
  gameOverSnapshot,
  placementSnapshot,
  provideFakeGameSocket,
  waitingSnapshot,
} from '../../../testing/fake-game-socket';
import { createRoomId } from '../../../testing/session-fixtures';
import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { Presence } from './presence';
import { PRESENCE_TEXT } from './presence.text';

const ROOM_ID = createRoomId(0);

/** Grace, P2, without a socket for `elapsedMs` of her forfeit clock. */
function away(elapsedMs = 0): PlayerView {
  return {
    seat: SEATS.P2,
    nickname: 'Grace',
    isConnected: false,
    forfeitRemainingMs: DISCONNECT_FORFEIT_MS - elapsedMs,
  };
}

let socket: FakeGameSocket;
let fixture: ComponentFixture<Presence>;

beforeEach(async () => {
  socket = new FakeGameSocket();
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket)] });
  TestBed.inject(GameStateService);
  fixture = TestBed.createComponent(Presence);
  await fixture.whenStable();
});

afterEach(() => {
  TestBed.inject(GameStateService).clear();
  vi.useRealTimers();
});

/**
 * Delivers a snapshot and lets the banner render it.
 * @param snapshot The `STATE` payload.
 */
async function receive(snapshot: PlayerStateSnapshot): Promise<void> {
  socket.fire(SERVER_EVENTS.STATE, snapshot);
  await fixture.whenStable();
}

/** @returns The rendered banner. */
function banner(): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** @returns The text of the polite live region. */
function announcement(): string {
  return banner().querySelector('[aria-live="polite"]')?.textContent.trim() ?? '';
}

/** @returns The text of the forfeit countdown, or `undefined` without one. */
function timer(): string | undefined {
  return banner().querySelector('[role="timer"]')?.textContent.trim();
}

/**
 * Finds a button by its text.
 * @param label The button's text.
 * @returns The button, or `undefined`.
 */
function button(label: string): HTMLButtonElement | undefined {
  return [...banner().querySelectorAll('button')].find((element) => element.textContent.trim() === label);
}

describe('Presence', () => {
  it('shows nothing while the opponent is connected', async () => {
    await receive(battleSnapshot(ROOM_ID));

    expect(announcement()).toBe('');
    expect(timer()).toBeUndefined();
    expect(banner().querySelector('button')).toBeNull();
    // The live region is there before anything is announced, so the first change is read out.
    expect(banner().querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  describe('in battle', () => {
    it('announces the drop, the pause, and counts down to the forfeit of the match', async () => {
      await receive(battleSnapshot(ROOM_ID));
      // Rendered with detectChanges: whenStable waits on the scheduler's timers, which fake timers hold.
      vi.useFakeTimers();

      socket.fire(SERVER_EVENTS.STATE, { ...battleSnapshot(ROOM_ID, { isPaused: true }), opponent: away(10_000) });
      fixture.detectChanges();

      expect(announcement()).toContain(PRESENCE_TEXT.away('Grace'));
      expect(announcement()).toContain(PRESENCE_TEXT.paused);
      expect(timer()).toBe(PRESENCE_TEXT.forfeitsMatch('Grace', '2:50'));

      vi.advanceTimersByTime(5_000);
      fixture.detectChanges();
      expect(timer()).toBe(PRESENCE_TEXT.forfeitsMatch('Grace', '2:45'));
    });

    it('pauses with SET_PAUSED while the match runs, and shows the command waiting', async () => {
      await receive({ ...battleSnapshot(ROOM_ID, { isPaused: false }), opponent: away() });
      expect(announcement()).toContain(PRESENCE_TEXT.running);
      let answer: (value: { ok: true }) => void = () => undefined;
      socket.emitWithAck.mockReturnValue(new Promise((resolve) => (answer = resolve)));

      button(PRESENCE_TEXT.pause)?.click();
      await fixture.whenStable();

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.SET_PAUSED, { isPaused: true });
      const pausing = button(PRESENCE_TEXT.pausing);
      expect(pausing?.getAttribute('aria-disabled')).toBe('true');
      pausing?.click();
      expect(socket.emitWithAck).toHaveBeenCalledOnce();

      answer({ ok: true });
      await receive({ ...battleSnapshot(ROOM_ID, { isPaused: true }), opponent: away() });

      expect(announcement()).toContain(PRESENCE_TEXT.paused);
      expect(button(PRESENCE_TEXT.resume)?.getAttribute('aria-disabled')).toBeNull();
    });

    it('resumes with SET_PAUSED while paused', async () => {
      await receive({ ...battleSnapshot(ROOM_ID, { isPaused: true }), opponent: away() });
      socket.emitWithAck.mockResolvedValue({ ok: true });

      button(PRESENCE_TEXT.resume)?.click();

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.SET_PAUSED, { isPaused: false });
      expect(button(PRESENCE_TEXT.pause)).toBeUndefined();
    });

    it.each([
      [ERROR_CODES.NOT_ALLOWED, PRESENCE_TEXT.errors.NOT_ALLOWED],
      [TRANSPORT_ERRORS.NO_ACK, PRESENCE_TEXT.errors.NO_ACK],
      [ERROR_CODES.INVALID_PAYLOAD, PRESENCE_TEXT.unexpected],
    ])('explains a refused SET_PAUSED (%s) in an alert', async (error, message) => {
      await receive({ ...battleSnapshot(ROOM_ID, { isPaused: true }), opponent: away() });
      socket.emitWithAck.mockResolvedValue({ ok: false, error });

      button(PRESENCE_TEXT.resume)?.click();

      await vi.waitFor(() => {
        expect(banner().querySelector('[role="alert"]')?.textContent).toBe(message);
      });
    });

    it('announces the return until the next snapshot, and offers no control any more', async () => {
      await receive({ ...battleSnapshot(ROOM_ID, { isPaused: true }), opponent: away() });

      await receive(battleSnapshot(ROOM_ID));

      expect(announcement()).toBe(PRESENCE_TEXT.back('Grace'));
      expect(timer()).toBeUndefined();
      expect(banner().querySelector('button')).toBeNull();

      await receive(battleSnapshot(ROOM_ID, { currentTurn: SEATS.P2 }));
      expect(announcement()).toBe('');
    });

    it('works from the joiner seat as well', async () => {
      const snapshot = fromSeat(SEATS.P2, battleSnapshot(ROOM_ID, { isPaused: true }));
      await receive({ ...snapshot, opponent: { ...away(), seat: SEATS.P1 } });

      expect(announcement()).toContain(PRESENCE_TEXT.away('Grace'));
      expect(button(PRESENCE_TEXT.resume)).toBeDefined();
    });
  });

  describe('before the match', () => {
    it('counts down to the freed seat in placement, without a pause control', async () => {
      await receive({ ...placementSnapshot(ROOM_ID), opponent: away(60_000) });

      expect(announcement()).toBe(PRESENCE_TEXT.away('Grace'));
      expect(timer()).toBe(PRESENCE_TEXT.freesSeat('Grace', '2:00'));
      expect(banner().querySelector('button')).toBeNull();
    });

    it('counts down on the waiting screen too, which shows rules negotiation until #27', async () => {
      await receive({
        ...placementSnapshot(ROOM_ID),
        phase: ROOM_PHASES.RULES_NEGOTIATION,
        placement: null,
        opponent: away(),
      });

      expect(timer()).toBe(PRESENCE_TEXT.freesSeat('Grace', '3:00'));
    });

    it('says who left when their seat is freed, until someone takes it (ADR-0073)', async () => {
      await receive({ ...placementSnapshot(ROOM_ID), opponent: away(DISCONNECT_FORFEIT_MS - 1_000) });

      await receive(waitingSnapshot(ROOM_ID));
      expect(announcement()).toBe(PRESENCE_TEXT.departed('Grace'));
      expect(timer()).toBeUndefined();

      // Another snapshot of the empty seat, e.g. after a reconnection, keeps the notice.
      await receive(waitingSnapshot(ROOM_ID));
      expect(announcement()).toBe(PRESENCE_TEXT.departed('Grace'));

      const next = placementSnapshot(ROOM_ID);
      await receive({ ...next, opponent: next.opponent && { ...next.opponent, nickname: 'Linus' } });
      expect(announcement()).toBe('');
    });

    it("forgets who left when the snapshot is another room's", async () => {
      await receive(placementSnapshot(ROOM_ID));
      await receive(waitingSnapshot(createRoomId(1)));

      expect(announcement()).toBe('');
    });
  });

  it('says the opponent is disconnected at game over, with no countdown or control', async () => {
    await receive({ ...gameOverSnapshot(ROOM_ID), opponent: { ...away(), forfeitRemainingMs: null } });

    expect(announcement()).toBe(PRESENCE_TEXT.away('Grace'));
    expect(timer()).toBeUndefined();
    expect(banner().querySelector('button')).toBeNull();
  });
});
