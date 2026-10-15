/**
 * What the room page can tell about a seat the server refused with `SESSION_INVALID` (ADR-0075). The code says only
 * that the room is gone or no seat holds the secret; the page tells more from what it knows.
 */
export const SEAT_LOSSES = {
  /** The server started after the seat was taken: rooms live in its memory, so a restart lost the room. */
  RESTARTED: 'restarted',
  /** This tab saw the match end: the room expired `GAME_OVER_TTL_MS` after it. */
  CLOSED: 'closed',
  /**
   * The server has run since the seat was taken: the seat was freed by the disconnect forfeit or by `LEAVE_ROOM`, or
   * the room closed; it may still wait for a player.
   */
  GIVEN_UP: 'given-up',
  /** The server's start time is unknown (`/health` did not answer, or has not yet): any of the above. */
  UNKNOWN: 'unknown',
} as const;

/** One of the `SEAT_LOSSES`. */
export type SeatLoss = (typeof SEAT_LOSSES)[keyof typeof SEAT_LOSSES];

/** What the room page knows when the server refuses a seat. */
export interface SeatLossClues {
  /** Whether the room's latest snapshot in this tab was `GAME_OVER`. */
  readonly hasSeenGameOver: boolean;
  /** When the refused seat was taken, in epoch ms (`RefusedSeat.seatTakenAt`); `null` when unknown. */
  readonly seatTakenAt: number | null;
  /** When the server answering now started, in epoch ms (`ServerWakeService.startedAt`); `null` when unknown. */
  readonly serverStartedAt: number | null;
}

/**
 * Tells why a seat was refused, as far as the clues allow (ADR-0075). Both times are on this device's clock, so its
 * offset from the server's does not matter.
 * @param clues What the room page knows.
 * @returns `CLOSED` after a match this tab saw end; otherwise `RESTARTED` or `GIVEN_UP` by comparing the server's start
 * with the seat's, and `UNKNOWN` when either time is missing.
 */
export function classifySeatLoss(clues: SeatLossClues): SeatLoss {
  const { hasSeenGameOver, seatTakenAt, serverStartedAt } = clues;
  if (hasSeenGameOver) {
    return SEAT_LOSSES.CLOSED;
  }
  if (seatTakenAt === null || serverStartedAt === null) {
    return SEAT_LOSSES.UNKNOWN;
  }
  return serverStartedAt > seatTakenAt ? SEAT_LOSSES.RESTARTED : SEAT_LOSSES.GIVEN_UP;
}
