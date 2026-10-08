import { ERROR_CODES } from '@battleship/core';

import { TRANSPORT_ERRORS } from './game-socket';
import type { RoomEntryError } from './room-entry';

/** The messages shown when creating or joining a room fails. */
export interface RoomEntryText {
  /** A message for each failure the home and join screens explain; the others get `unexpected`. */
  readonly errors: Readonly<Partial<Record<RoomEntryError, string>>>;
  /** For any failure without its own message. */
  readonly unexpected: string;
}

/**
 * English messages for failed room entries, in one typed object so that `I18nService` (ADR-0018) can supply them per
 * locale later. `ROOM_NOT_FOUND` and `ROOM_FULL` are not here: they replace the join form with a screen of their own.
 */
export const ROOM_ENTRY_TEXT: RoomEntryText = {
  errors: {
    [ERROR_CODES.SERVER_FULL]: 'The server is full right now. Try again in a few minutes.',
    [ERROR_CODES.RATE_LIMITED]: 'Too many requests. Wait a moment and try again.',
    [TRANSPORT_ERRORS.NOT_CONNECTED]: 'Not connected to the server yet. Try again once it is connected.',
    [TRANSPORT_ERRORS.NO_ACK]: 'The server did not answer. Try again.',
  },
  unexpected: 'Something went wrong. Try again.',
};

/**
 * Explains a failed room entry.
 * @param error Why the command failed.
 * @param text The messages to pick from.
 * @returns The message for that failure, or the generic one.
 */
export function roomEntryErrorMessage(error: RoomEntryError, text: RoomEntryText = ROOM_ENTRY_TEXT): string {
  return text.errors[error] ?? text.unexpected;
}
