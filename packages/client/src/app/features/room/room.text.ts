import { ERROR_CODES } from '@battleship/core';

import type { RoomEntryError } from '../../core/room-entry';
import { SEAT_LOSSES, type SeatLoss } from './seat-loss';

/** What the room page says about a seat the server refused (`SESSION_INVALID`), for one `SeatLoss`. */
export interface SeatLossText {
  /** The heading. */
  readonly heading: string;
  /**
   * What happened and what the player can do.
   * @param forfeitMinutes `DISCONNECT_FORFEIT_MS` in minutes.
   * @param gameOverMinutes `GAME_OVER_TTL_MS` in minutes.
   * @returns The explanation.
   */
  readonly reason: (forfeitMinutes: number, gameOverMinutes: number) => string;
}

/** The words of the room page, apart from the views it hosts. */
export interface RoomText {
  /** The heading of the join view. */
  readonly joinHeading: string;
  /**
   * Under the join heading.
   * @param roomId The id from the address, shown so the player can tell which room invited them.
   * @returns The invitation, ending with what to do.
   */
  readonly joinIntro: (roomId: string) => string;
  /** The join button. */
  readonly join: string;
  /** The join button while the seat is being taken. */
  readonly joining: string;
  /** While the room's first snapshot is on its way. */
  readonly entering: string;
  /** The heading of the view for a room the tab has left. */
  readonly leftHeading: string;
  /** Why a room the tab has left cannot be played here. */
  readonly leftReason: string;
  /** The heading of the not-found view. */
  readonly notFoundHeading: string;
  /** Why a room may not be found. */
  readonly notFoundReason: string;
  /** The heading of the full-room view. */
  readonly fullHeading: string;
  /** Why the room is full. */
  readonly fullReason: string;
  /** The link back to the home screen. */
  readonly createOwn: string;
  /** For a seat the server refused, by what the page could tell of the cause (ADR-0076). */
  readonly seatLosses: Readonly<Record<SeatLoss, SeatLossText>>;
  /** The button giving up the seat before the match. */
  readonly leave: string;
  /** The leave button while its command runs. */
  readonly leaving: string;
  /** The leave button's description, read with it and not shown (ADR-0080). */
  readonly leaveHint: string;
  /** A message for each `LEAVE_ROOM` failure the room page explains itself; the others get the room-entry messages. */
  readonly leaveErrors: Readonly<Partial<Record<RoomEntryError, string>>>;
}

/**
 * English strings of the room page, in one typed object so that `I18nService` (ADR-0018) can supply them per locale
 * later.
 */
export const ROOM_TEXT: RoomText = {
  joinHeading: 'Join a match',
  joinIntro: (roomId) => `You have been invited to room ${roomId}. Choose a nickname to take the free seat.`,
  join: 'Join room',
  joining: 'Joining room…',
  entering: 'Entering the room…',
  leftHeading: 'You left this room',
  leftReason: 'You have entered another room since, so this page no longer follows this one.',
  notFoundHeading: 'Room not found',
  notFoundReason:
    'The link may be mistyped, or the room has closed: rooms do not survive a server restart and close a few minutes after their players have left.',
  fullHeading: 'This room is full',
  fullReason: 'Two players are already in this room.',
  createOwn: 'Create a new room',
  seatLosses: {
    [SEAT_LOSSES.RESTARTED]: {
      heading: 'The server restarted',
      reason: () =>
        "Rooms live in the server's memory, so this match was lost in the restart. Create a new room and send the new link to your opponent.",
    },
    [SEAT_LOSSES.CLOSED]: {
      heading: 'This room has closed',
      reason: (_forfeitMinutes, gameOverMinutes) =>
        `The match was over, and a room closes ${String(gameOverMinutes)} minutes after its match ends.`,
    },
    [SEAT_LOSSES.GIVEN_UP]: {
      heading: 'You lost your seat',
      reason: (forfeitMinutes) =>
        `You were away for more than ${String(forfeitMinutes)} minutes, or you left the room, so your seat was given up. If the room is still waiting for a player, you can join it again.`,
    },
    [SEAT_LOSSES.UNKNOWN]: {
      heading: 'You are no longer in this room',
      reason: (forfeitMinutes) =>
        `The server may have restarted, the room may have closed, or your seat was given up after ${String(forfeitMinutes)} minutes away. If the room is still waiting for a player, you can join it again.`,
    },
  },
  leave: 'Leave room',
  leaving: 'Leaving…',
  leaveHint: 'Your seat is freed for someone else, and you go back to the home screen.',
  leaveErrors: {
    [ERROR_CODES.NOT_ALLOWED]: 'The match has started, so the room can no longer be left.',
  },
};
