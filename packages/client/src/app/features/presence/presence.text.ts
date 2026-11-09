import { ERROR_CODES } from '@battleship/core';

import { TRANSPORT_ERRORS } from '../../core/game-socket';
import type { PauseCommandError } from './presence';

/** The words of the opponent's presence banner. */
export interface PresenceText {
  /**
   * While the opponent's seat has no socket.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly away: (nickname: string) => string;
  /**
   * After the opponent's seat got a socket back, until the next snapshot.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly back: (nickname: string) => string;
  /**
   * After the opponent's seat was freed before the match, until someone takes it.
   * @param nickname The nickname of the player who left.
   * @returns The sentence.
   */
  readonly departed: (nickname: string) => string;
  /**
   * The opponent's forfeit countdown during the match. It follows `away`, which names them, and leaves the nickname out
   * so that it fits beside the button on a phone (ADR-0110).
   * @param time The remaining time, e.g. `2:41`.
   * @returns The sentence.
   */
  readonly forfeitsMatch: (time: string) => string;
  /**
   * The opponent's forfeit countdown before the match.
   * @param nickname The opponent's nickname.
   * @param time The remaining time, e.g. `2:41`.
   * @returns The sentence.
   */
  readonly freesSeat: (nickname: string, time: string) => string;
  /** While the match is paused (`battle.isPaused`). */
  readonly paused: string;
  /** While the opponent is away and the match runs. */
  readonly running: string;
  /** The name of the button pausing the match. */
  readonly pause: string;
  /** What the pause button shows: the start of its name (WCAG 2.5.3), short for the compact banner (ADR-0110). */
  readonly pauseLabel: string;
  /** The pause button while its command runs, shown and named alike. */
  readonly pausing: string;
  /** The name of the button resuming the match. */
  readonly resume: string;
  /** What the resume button shows: the start of its name (WCAG 2.5.3), short for the compact banner (ADR-0110). */
  readonly resumeLabel: string;
  /** The resume button while its command runs, shown and named alike. */
  readonly resuming: string;
  /** A message for each `SET_PAUSED` failure the banner explains; the others get `unexpected`. */
  readonly errors: Readonly<Partial<Record<PauseCommandError, string>>>;
  /** For any failure without its own message. */
  readonly unexpected: string;
}

/**
 * English strings of the presence banner, in one typed object so that `I18nService` (ADR-0018) can supply them per
 * locale later.
 */
export const PRESENCE_TEXT: PresenceText = {
  away: (nickname) => `${nickname} is disconnected.`,
  back: (nickname) => `${nickname} is back.`,
  departed: (nickname) => `${nickname} left the room, so their seat is free again.`,
  forfeitsMatch: (time) => `They forfeit in ${time}.`,
  freesSeat: (nickname, time) => `${nickname}'s seat is freed in ${time} unless they come back.`,
  paused: 'The match is paused.',
  running: 'The match is running.',
  pause: 'Pause match',
  pauseLabel: 'Pause',
  pausing: 'Pausing…',
  resume: 'Resume match',
  resumeLabel: 'Resume',
  resuming: 'Resuming…',
  errors: {
    [ERROR_CODES.NOT_ALLOWED]: 'Your opponent is back, so the match goes on.',
    [ERROR_CODES.WRONG_PHASE]: 'The match is over.',
    [ERROR_CODES.RATE_LIMITED]: 'Too many taps at once. Wait a moment and try again.',
    [ERROR_CODES.SERVER_ERROR]: 'The server ran into an error, so the match did not change. Try again.',
    [TRANSPORT_ERRORS.NOT_CONNECTED]: 'Not connected to the server. Try again once you are connected.',
    [TRANSPORT_ERRORS.NO_ACK]: 'The server did not answer. Try again.',
  },
  unexpected: 'Something went wrong. Try again.',
};

/**
 * Explains a failed `SET_PAUSED`.
 * @param error Why the command failed.
 * @param text The messages to pick from.
 * @returns The message for that failure, or the generic one.
 */
export function pauseErrorMessage(error: PauseCommandError, text: PresenceText = PRESENCE_TEXT): string {
  return text.errors[error] ?? text.unexpected;
}
