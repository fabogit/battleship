// The server's only source of time and timers (ADR-0065): production reads the system clock, tests drive a fake one.

/** A task scheduled with `Clock.scheduleAt`. */
export interface Timer {
  /** Stops the task from running; does nothing once it has run or was cancelled. */
  cancel(): void;
}

/**
 * Current time and one-shot timers, injected into `createServer` so that every deadline and TTL can be tested without
 * real waits (docs/server.md#testability). Times are epoch ms, like the deadlines room logic stores.
 */
export interface Clock {
  /** Current time in epoch ms. */
  now(): number;
  /**
   * Runs a task once, when the clock reaches a deadline.
   * @param at The deadline in epoch ms, at most about 24 days ahead (`setTimeout`'s limit); a time already past runs
   * the task as soon as possible, never synchronously.
   * @param task Called once with no arguments; an exception it throws is not caught.
   * @returns A handle that cancels the task.
   */
  scheduleAt(at: number, task: () => void): Timer;
}

/**
 * The real clock: `Date.now` and `setTimeout`. Its timers are unreferenced, so a pending TTL never keeps the process
 * alive after a graceful shutdown (ADR-0027).
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  scheduleAt: (at, task) => {
    const handle = setTimeout(task, Math.max(0, at - Date.now()));
    handle.unref();
    return {
      cancel: () => {
        clearTimeout(handle);
      },
    };
  },
};
