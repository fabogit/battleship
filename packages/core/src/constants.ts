// Fixed values shared by server and client (docs/domain.md#constants).

/**
 * Bumped on any breaking protocol change; checked in the Socket.io handshake (ADR-0017). 2: the game-over snapshot
 * carries both final boards (ADR-0064). 3: `JOIN_ROOM` opens rules negotiation instead of placement (ADR-0084). 4: a room
 * the server closes tells the sockets still in it with `ROOM_CLOSED` (ADR-0097).
 */
export const PROTOCOL_VERSION = 4;

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

/**
 * Maximum absence of a seated player, in any phase but `GAME_OVER`, before they forfeit (ADR-0008, ADR-0072). With
 * `GAME_OVER_TTL_MS` it bounds how long a room nobody sits in stays open (ADR-0073), which must stay below Render's
 * 15 min spin-down.
 */
export const DISCONNECT_FORFEIT_MS = 180_000;

/** Lifetime of a room idle in `GAME_OVER` without a rematch agreement. */
export const GAME_OVER_TTL_MS = 120_000;

/**
 * Lifetime of a room in `WAITING_FOR_OPPONENT` that nobody joins, counted from each entry into that phase (ADR-0096):
 * long enough to share the link and wait for a friend, short enough that a waiting room cannot hold its place under
 * `MAX_ROOMS` for long.
 */
export const WAITING_TTL_MS = 600_000;

/** Nicknames are trimmed, non-empty and rendered as text only. Counted in UTF-16 code units, like HTML `maxlength`. */
export const NICKNAME_MAX_LENGTH = 20;

/** Characters in a room id. */
export const ROOM_ID_LENGTH = 8;

/**
 * Characters a room id is drawn from: digits and lowercase letters without `0`, `1`, `i`, `l` and `o`, which are easily
 * confused; all of them are safe in a URL path.
 */
export const ROOM_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** New rooms are rejected with `SERVER_FULL` above this. */
export const MAX_ROOMS = 50;

/** Events a single socket may send per second. */
export const RATE_LIMIT_EVENTS_PER_SECOND = 20;

/** Client-side expiry of stored session credentials (ADR-0013). */
export const SESSION_STORE_TTL_MS = 86_400_000;
