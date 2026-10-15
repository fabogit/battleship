/** The words of the screens that replace the page when the server ends the connection for good. */
export interface ConnectionScreenText {
  /** The heading after `PROTOCOL_MISMATCH`. */
  readonly outdatedHeading: string;
  /** Why the page cannot go on after `PROTOCOL_MISMATCH`, and what to do. */
  readonly outdatedReason: string;
  /** The button reloading the page. */
  readonly reload: string;
  /** The heading after `SESSION_REPLACED`. */
  readonly replacedHeading: string;
  /** What happened after `SESSION_REPLACED`. */
  readonly replacedReason: string;
  /** What "Play here" does. */
  readonly replacedHint: string;
  /** The button taking the seat back. */
  readonly playHere: string;
}

/**
 * English strings of the connection screens, in one typed object so that `I18nService` (ADR-0018) can supply them per
 * locale later.
 */
export const CONNECTION_SCREEN_TEXT: ConnectionScreenText = {
  outdatedHeading: 'Please reload the page',
  outdatedReason:
    'The game was updated while this page was open, and the server no longer accepts this version. Reload the page to get the new one. If this message comes back, wait a minute and reload again.',
  reload: 'Reload',
  replacedHeading: 'This match is open somewhere else',
  replacedReason: 'You opened this room in another tab or on another device, so the match moved there.',
  replacedHint: 'Playing here takes the match back, and the other tab or device stops.',
  playHere: 'Play here',
};
