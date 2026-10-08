/** The words of the home screen. */
export interface HomeText {
  /** The page heading. */
  readonly heading: string;
  /** Under the heading: how a match starts. */
  readonly intro: string;
  /** The submit button. */
  readonly create: string;
  /** The submit button while the room is being created. */
  readonly creating: string;
}

/**
 * English strings of the home screen, in one typed object so that `I18nService` (ADR-0018) can supply them per locale
 * later.
 */
export const HOME_TEXT: HomeText = {
  heading: 'Play Battleship with a friend',
  intro: 'Choose a nickname and create a room, then send its link to your opponent.',
  create: 'Create room',
  creating: 'Creating room…',
};
