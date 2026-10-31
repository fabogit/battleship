import { describe, expect, it, vi } from 'vitest';

import { ROOM_TIMER_KINDS, RoomTimers } from '../../src/room/room-timers.js';
import { FakeClock } from '../fake-clock.js';
import { NOW } from './fixtures.js';

const ROOM = 'room-a';
const OTHER_ROOM = 'room-b';

function setup(): { clock: FakeClock; timers: RoomTimers } {
  const clock = new FakeClock(NOW);
  return { clock, timers: new RoomTimers(clock) };
}

describe('RoomTimers', () => {
  // Written out on purpose (ADR-0043): the kinds appear in the logs ("Room expired").
  it('pins the ROOM_TIMER_KINDS values', () => {
    expect(Object.values(ROOM_TIMER_KINDS)).toEqual(['DISCONNECT_FORFEIT', 'GAME_OVER', 'PLACEMENT']);
  });

  it('runs a timer at its deadline and then forgets it', () => {
    const { clock, timers } = setup();
    const task = vi.fn();
    timers.start(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT, NOW + 1_000, task);
    expect(timers.isRunning(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT)).toBe(true);
    clock.advance(999);
    expect(task).not.toHaveBeenCalled();
    clock.advance(1);
    expect(task).toHaveBeenCalledOnce();
    expect(timers.isRunning(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT)).toBe(false);
  });

  it('replaces a running timer of the same room and kind', () => {
    const { clock, timers } = setup();
    const first = vi.fn();
    const second = vi.fn();
    timers.start(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT, NOW + 1_000, first);
    timers.start(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT, NOW + 2_000, second);
    clock.advance(5_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(clock.pendingCount).toBe(0);
  });

  it('keeps kinds and rooms apart', () => {
    const { clock, timers } = setup();
    const runs: string[] = [];
    timers.start(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT, NOW + 100, () => runs.push('a forfeit'));
    timers.start(ROOM, ROOM_TIMER_KINDS.GAME_OVER, NOW + 200, () => runs.push('a game over'));
    timers.start(OTHER_ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT, NOW + 300, () => runs.push('b forfeit'));
    timers.stop(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT);
    expect(timers.isRunning(ROOM, ROOM_TIMER_KINDS.GAME_OVER)).toBe(true);
    clock.advance(1_000);
    expect(runs).toEqual(['a game over', 'b forfeit']);
  });

  it('stops every timer of one room, and of every room', () => {
    const { clock, timers } = setup();
    const task = vi.fn();
    timers.start(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT, NOW + 100, task);
    timers.start(ROOM, ROOM_TIMER_KINDS.GAME_OVER, NOW + 100, task);
    timers.start(OTHER_ROOM, ROOM_TIMER_KINDS.GAME_OVER, NOW + 100, task);
    timers.stopRoom(ROOM);
    expect(timers.isRunning(ROOM, ROOM_TIMER_KINDS.GAME_OVER)).toBe(false);
    expect(timers.isRunning(OTHER_ROOM, ROOM_TIMER_KINDS.GAME_OVER)).toBe(true);
    timers.stopAll();
    clock.advance(1_000);
    expect(task).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });

  it('lets a task start its own kind again', () => {
    const { clock, timers } = setup();
    const runs: number[] = [];
    const task = (): void => {
      runs.push(clock.now());
      if (runs.length < 3) {
        timers.start(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT, clock.now() + 100, task);
      }
    };
    timers.start(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT, NOW + 100, task);
    clock.advance(150);
    // The timer that ran is forgotten before its task, so the one the task started counts as running.
    expect(timers.isRunning(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT)).toBe(true);
    clock.advance(850);
    expect(runs).toEqual([NOW + 100, NOW + 200, NOW + 300]);
    expect(timers.isRunning(ROOM, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT)).toBe(false);
  });

  it('ignores stopping what is not running', () => {
    const { timers } = setup();
    expect(() => {
      timers.stop(ROOM, ROOM_TIMER_KINDS.GAME_OVER);
      timers.stopRoom(OTHER_ROOM);
    }).not.toThrow();
  });
});
