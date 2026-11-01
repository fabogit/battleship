/** Milliseconds in a second. */
const MS_PER_SECOND = 1_000;

/** Seconds in a minute. */
const SECONDS_PER_MINUTE = 60;

/** Milliseconds in a minute. */
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * Counts the seconds a countdown still shows: rounded up, so it reads 0 only once the time is over.
 * @param remainingMs Time left, in ms; negative values count as zero.
 * @returns Whole seconds left.
 */
export function remainingSeconds(remainingMs: number): number {
  return Math.ceil(Math.max(0, remainingMs) / MS_PER_SECOND);
}

/**
 * Formats a countdown the way clocks show it.
 * @param remainingMs Time left, in ms; negative values count as zero.
 * @returns Minutes and two-digit seconds, rounded up to the second, e.g. `1:00` for 59.2 s and `0:00` at the end.
 */
export function formatCountdown(remainingMs: number): string {
  const seconds = remainingSeconds(remainingMs);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${String(minutes)}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

/**
 * Words a duration in minutes, for messages such as "kept for 3 minutes" over `DISCONNECT_FORFEIT_MS`.
 * @param ms A duration, in ms.
 * @returns The whole minutes in it, rounded down: exact for the timing constants, which are whole minutes.
 */
export function wholeMinutes(ms: number): number {
  return Math.floor(ms / MS_PER_MINUTE);
}

/** The most time a countdown can have left when it starts warning that it is running out, in ms (ADR-0108). */
export const LOW_TIME_MS = 10_000;

/**
 * Tells whether a countdown is in its low-time warning (ADR-0108): its last `LOW_TIME_MS`, or its last third when the
 * whole countdown is shorter than three times that, so a 15-second turn warns over its last 5 seconds.
 * @param remainingMs Time left, in ms.
 * @param limitMs The countdown's whole time, e.g. the turn's `turnTimeLimitSeconds` in ms.
 * @returns Whether the time left is at or under the threshold; it starts as the countdown reads `0:10` (or `0:05`).
 */
export function isLowTime(remainingMs: number, limitMs: number): boolean {
  return remainingMs <= Math.min(LOW_TIME_MS, limitMs / 3);
}
