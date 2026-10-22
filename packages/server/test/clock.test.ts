import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { systemClock } from '../src/clock.js';
import { FakeClock } from './fake-clock.js';

const START = 1_700_000_000_000;

describe('systemClock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the system time', () => {
    expect(systemClock.now()).toBe(START);
  });

  it('runs a task at its deadline, not before', () => {
    const task = vi.fn();
    systemClock.scheduleAt(START + 1_000, task);
    vi.advanceTimersByTime(999);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();
  });

  it('runs a task whose deadline has passed on the next tick, never synchronously', () => {
    const task = vi.fn();
    systemClock.scheduleAt(START - 5_000, task);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledOnce();
  });

  it('cancels a task', () => {
    const task = vi.fn();
    systemClock.scheduleAt(START + 1_000, task).cancel();
    vi.advanceTimersByTime(10_000);
    expect(task).not.toHaveBeenCalled();
  });

  it('leaves its timers unreferenced, so a pending TTL never keeps the process alive', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    systemClock.scheduleAt(START + 1_000, () => undefined);
    const handle = setTimeoutSpy.mock.results[0]?.value as NodeJS.Timeout;
    expect(handle.hasRef()).toBe(false);
  });
});

describe('FakeClock', () => {
  it('only moves when advanced', () => {
    const clock = new FakeClock(START);
    expect(clock.now()).toBe(START);
    clock.advance(250);
    expect(clock.now()).toBe(START + 250);
  });

  it('runs due tasks in deadline order, then scheduling order, each at its own time', () => {
    const clock = new FakeClock(START);
    const runs: [string, number][] = [];
    clock.scheduleAt(START + 200, () => runs.push(['late', clock.now()]));
    clock.scheduleAt(START + 100, () => runs.push(['early', clock.now()]));
    clock.scheduleAt(START + 100, () => runs.push(['early, second', clock.now()]));
    clock.scheduleAt(START + 300, () => runs.push(['not yet', clock.now()]));
    clock.advance(200);
    expect(runs).toEqual([
      ['early', START + 100],
      ['early, second', START + 100],
      ['late', START + 200],
    ]);
    expect(clock.pendingCount).toBe(1);
  });

  it('runs a task scheduled by a task when it falls due in the same advance', () => {
    const clock = new FakeClock(START);
    const runs: number[] = [];
    clock.scheduleAt(START + 100, () => {
      runs.push(clock.now());
      clock.scheduleAt(clock.now() + 100, () => runs.push(clock.now()));
      clock.scheduleAt(clock.now() + 1_000, () => runs.push(clock.now()));
    });
    clock.advance(500);
    expect(runs).toEqual([START + 100, START + 200]);
    expect(clock.now()).toBe(START + 500);
  });

  it('cancels a task', () => {
    const clock = new FakeClock(START);
    const task = vi.fn();
    clock.scheduleAt(START + 100, task).cancel();
    clock.advance(1_000);
    expect(task).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });

  it('throws instead of looping when a task keeps re-arming at a deadline already past', () => {
    const clock = new FakeClock(START);
    const rearm = (): void => {
      clock.scheduleAt(START, rearm);
    };
    clock.scheduleAt(START, rearm);
    expect(() => {
      clock.advance(0);
    }).toThrow(/runaway timer/);
  });
});
