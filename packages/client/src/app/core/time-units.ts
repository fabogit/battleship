/**
 * Milliseconds in a second: the rules and `GET /health` count in seconds, the client's timers and countdowns in ms.
 * Kept in `core/` so the services and `shared/` share one copy.
 */
export const MS_PER_SECOND = 1_000;
