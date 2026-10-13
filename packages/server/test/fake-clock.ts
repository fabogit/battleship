import type { Clock, Timer } from '../src/clock.js';

/** A pending task of a `FakeClock`. */
interface Scheduled {
  readonly at: number;
  readonly task: () => void;
}

/**
 * A `Clock` that only moves when a test says so (ADR-0065): `advance` runs every task that falls due, in deadline
 * order, with `now()` set to each task's deadline while it runs. Tasks scheduled by a task run in the same `advance`
 * when they fall due within it.
 */
export class FakeClock implements Clock {
  #now: number;
  /** In scheduling order, which breaks ties between tasks due at the same time. */
  readonly #pending = new Set<Scheduled>();

  constructor(start: number) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  scheduleAt(at: number, task: () => void): Timer {
    const scheduled: Scheduled = { at, task };
    this.#pending.add(scheduled);
    return {
      cancel: () => {
        this.#pending.delete(scheduled);
      },
    };
  }

  /** How many tasks wait to run. */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Moves the clock forward, running every task due by the new time. */
  advance(ms: number): void {
    const end = this.#now + ms;
    for (let next = this.#due(end); next !== undefined; next = this.#due(end)) {
      this.#pending.delete(next);
      this.#now = Math.max(this.#now, next.at);
      next.task();
    }
    this.#now = end;
  }

  /** The earliest task due by `end`, if any. */
  #due(end: number): Scheduled | undefined {
    let earliest: Scheduled | undefined;
    for (const scheduled of this.#pending) {
      if (scheduled.at <= end && (earliest === undefined || scheduled.at < earliest.at)) {
        earliest = scheduled;
      }
    }
    return earliest;
  }
}
