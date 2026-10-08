/** The words of the waiting screen. */
export interface LobbyText {
  /** The page heading. */
  readonly heading: string;
  /**
   * Who the player is in this room.
   * @param nickname The player's nickname.
   * @returns The sentence.
   */
  readonly playingAs: (nickname: string) => string;
  /** What to do with the link. */
  readonly instructions: string;
  /** The label of the field holding the link. */
  readonly linkLabel: string;
  /** The button opening the system share sheet. */
  readonly share: string;
  /** The button copying the link. */
  readonly copy: string;
  /** After a successful copy. */
  readonly copied: string;
  /** When the clipboard refused the link. */
  readonly copyFailed: string;
  /** The title passed to the share sheet. */
  readonly shareTitle: string;
  /** The message passed to the share sheet, before the link. */
  readonly shareMessage: string;
}

/**
 * English strings of the waiting screen, in one typed object so that `I18nService` (ADR-0018) can supply them per
 * locale later.
 */
export const LOBBY_TEXT: LobbyText = {
  heading: 'Waiting for your opponent',
  playingAs: (nickname) => `You are playing as ${nickname}.`,
  instructions: 'Send this link to a friend. The match starts when they join.',
  linkLabel: 'Room link',
  share: 'Share link',
  copy: 'Copy link',
  copied: 'Link copied.',
  copyFailed: 'Could not copy the link. Select it above and copy it by hand.',
  shareTitle: 'Battleship',
  shareMessage: 'Join my Battleship match:',
};
