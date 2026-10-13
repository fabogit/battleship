// The sliding window behind the per-socket rate limit (docs/server.md#hardening, ADR-0066).

/** Admits at most a fixed number of events in any window of a fixed length. */
export interface RateLimiter {
  /**
   * Counts an event if the window has room for it.
   * @param now The event's time in epoch ms, from the server's clock.
   * @returns `true` when the event is admitted and counted; `false` when it would exceed the limit, and is not counted.
   */
  tryAcquire(now: number): boolean;
}

/**
 * Creates a sliding-window limiter: an event is admitted when fewer than `limit` admitted events happened in the
 * `windowMs` before it, so no window of that length ever holds more than `limit` of them. It keeps the times of the
 * last `limit` admitted events in a ring; refused events are not counted, so a client that slows down gets through as
 * soon as the window allows. When the clock goes back (a system clock adjustment), the history is dropped rather than
 * holding events back until the clock catches up.
 * @param limit Admitted events per window, at least 1.
 * @param windowMs The window's length in ms.
 * @returns A limiter with an empty history.
 */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  /** Times of the last admitted events, oldest at `next` once the ring is full. */
  const times: number[] = [];
  /** Where the next admitted time goes; also the oldest entry once the ring is full. */
  let next = 0;
  /** The latest admitted time, to notice the clock going back. */
  let latest = -Infinity;

  return {
    tryAcquire: (now) => {
      if (now < latest) {
        times.length = 0;
        next = 0;
      }
      const oldest = times.length < limit ? undefined : times[next];
      if (oldest !== undefined && now - oldest < windowMs) {
        return false;
      }
      times[next] = now;
      next = (next + 1) % limit;
      latest = now;
      return true;
    },
  };
}
