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
