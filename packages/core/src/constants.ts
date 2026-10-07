// Fixed values shared by server and client (docs/domain.md#constants).

/** Bumped on any breaking protocol change; checked in the Socket.io handshake (ADR-0017). */
export const PROTOCOL_VERSION = 1;

/** Side length of the square board, in cells. */
export const BOARD_SIZE = 10;

/** Time each player has to place their fleet. Re-evaluate after mobile playtesting. */
export const PLACEMENT_TIME_LIMIT_MS = 60_000;

/** Countdown once both fleets are ready; capped by the remaining placement time. */
export const START_COUNTDOWN_MS = 5_000;

/** Delay before the first turn timer starts, while the dice roll plays out (ADR-0002). */
export const DICE_ANIMATION_MS = 3_000;

/** Turns a player may time out in a row before forfeiting (ADR-0009). Fixed, not negotiable. */
export const MAX_CONSECUTIVE_AFK_TURNS = 3;

/** Maximum absence of a seated player, in any phase, before they forfeit (ADR-0008). */
export const DISCONNECT_FORFEIT_MS = 180_000;

/**
 * Lifetime of a room with no connected player. Must stay ≥ DISCONNECT_FORFEIT_MS (a lone creator sharing the link
 * leaves the room empty) and below Render's 15 min spin-down.
 */
export const EMPTY_ROOM_TTL_MS = 300_000;

/** Lifetime of a room idle in `GAME_OVER` without a rematch agreement. */
export const GAME_OVER_TTL_MS = 120_000;

/** Nicknames are trimmed, non-empty and rendered as text only. */
export const NICKNAME_MAX_LENGTH = 20;

/** New rooms are rejected with `SERVER_FULL` above this. */
export const MAX_ROOMS = 50;

/** Events a single socket may send per second. */
export const RATE_LIMIT_EVENTS_PER_SECOND = 20;

/** Client-side expiry of stored session credentials (ADR-0013). */
export const SESSION_STORE_TTL_MS = 86_400_000;
