// The e2e server's clock (ADR-0082): real time plus an offset that journeys skip forward through the control route.

import type { Clock, Timer } from '@battleship/server/clock';

/**
 * How many tasks one `advance` may run before it gives up: far more than a journey schedules, so only a task that keeps
 * re-arming at a deadline already past reaches it.
 */
const MAX_TASKS_PER_ADVANCE = 1_000;

/** A pending task of a `SkipClock`. */
interface Scheduled {
  /** The deadline in the clock's epoch ms. */
  readonly at: number;
  /** Runs once, at the deadline or during the `advance` that skips past it. */
  readonly task: () => void;
}

/**
 * A `Clock` that runs in real time, so sockets, the rate limit and every timer behave as in production, and that a
 * journey can skip forward: `advance` moves `now()` and runs every task the skip passes, in deadline order, with `now()`
 * set to each task's deadline while it runs. Between skips its tasks fire on a real, unreferenced timer, like
 * `systemClock`'s.
 */
export class SkipClock implements Clock {
  /** How far the clock is ahead of `Date.now()`, in ms; grows with every `advance`, never shrinks. */
  #offset = 0;
  /** `now()` while `advance` runs a task: the task's deadline; `undefined` otherwise. */
  #pinnedNow: number | undefined;
  /** In scheduling order, which breaks ties between tasks due at the same time. */
  readonly #pending = new Set<Scheduled>();
  /** The real timer of the earliest pending task, if any. */
  #handle: NodeJS.Timeout | undefined;

  /**
   * The current time.
   * @returns Epoch ms: `Date.now()` plus every skip so far, or the deadline of the task `advance` is running.
   */
  now(): number {
    return this.#pinnedNow ?? Date.now() + this.#offset;
  }

  /**
   * Runs a task once, when the clock reaches a deadline, by real time passing or by a skip.
   * @param at The deadline in the clock's epoch ms; a time already past runs the task on the next timer tick.
   * @param task Called once with no arguments.
   * @returns A handle that cancels the task.
   */
  scheduleAt(at: number, task: () => void): Timer {
    const scheduled: Scheduled = { at, task };
    this.#pending.add(scheduled);
    this.#arm();
    return {
      cancel: () => {
        this.#pending.delete(scheduled);
        this.#arm();
      },
    };
  }

  /**
   * Skips the clock forward, running every task due by the new time; real time goes on from there.
   * @param ms How far to skip, in ms.
   * @returns The clock's time after the skip, in epoch ms.
   * @throws When more than `MAX_TASKS_PER_ADVANCE` tasks run: a runaway timer fails the journey instead of hanging the
   * server.
   */
  advance(ms: number): number {
    const end = this.now() + ms;
    let runs = 0;
    try {
      for (let next = this.#due(end); next !== undefined; next = this.#due(end)) {
        if (++runs > MAX_TASKS_PER_ADVANCE) {
          throw new Error(`runaway timer: more than ${String(MAX_TASKS_PER_ADVANCE)} tasks in one advance`);
        }
        this.#pending.delete(next);
        this.#pinnedNow = Math.max(this.#pinnedNow ?? this.now(), next.at);
        next.task();
      }
    } finally {
      this.#pinnedNow = undefined;
      this.#offset = end - Date.now();
      this.#arm();
    }
    return end;
  }

  /**
   * The earliest pending task due by a time.
   * @param end The time in the clock's epoch ms.
   * @returns The task, or `undefined` when none is due.
   */
  #due(end: number): Scheduled | undefined {
    let earliest: Scheduled | undefined;
    for (const scheduled of this.#pending) {
      if (scheduled.at <= end && (earliest === undefined || scheduled.at < earliest.at)) {
        earliest = scheduled;
      }
    }
    return earliest;
  }

  /** Points the real timer at the earliest pending task, replacing the one set before; clears it when none is left. */
  #arm(): void {
    clearTimeout(this.#handle);
    this.#handle = undefined;
    const earliest = this.#due(Infinity);
    if (earliest === undefined) {
      return;
    }
    this.#handle = setTimeout(
      () => {
        this.#fireDue();
      },
      Math.max(0, earliest.at - this.now()),
    );
    this.#handle.unref();
  }

  /**
   * Runs the earliest task real time has reached, then re-arms: one task per timer tick, as `setTimeout` would, so a
   * task that re-arms at a time already past cannot block the event loop.
   */
  #fireDue(): void {
    const next = this.#due(this.now());
    try {
      if (next !== undefined) {
        this.#pending.delete(next);
        next.task();
      }
    } finally {
      this.#arm();
    }
  }
}
