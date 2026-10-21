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
  /** The button opening the system share sheet on phones and tablets, the share dialog elsewhere. */
  readonly share: string;
  /** The button copying the link. */
  readonly copy: string;
  /** After a successful copy. */
  readonly copied: string;
  /** When the clipboard refused the link. */
  readonly copyFailed: string;
  /** The heading of the share dialog. */
  readonly dialogHeading: string;
  /** Under the dialog heading: what the code and the link are for. */
  readonly dialogIntro: string;
  /**
   * The accessible name of the QR code: what a camera would read.
   * @param url The room link the code holds.
   * @returns The name.
   */
  readonly codeLabel: (url: string) => string;
  /** The dialog button opening the system share sheet, where the browser has one. */
  readonly otherApps: string;
  /** The button closing the dialog. */
  readonly close: string;
  /** When the system share sheet did not open. */
  readonly sheetFailed: string;
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
  dialogHeading: 'Share the room link',
  dialogIntro: 'Scan the code with a phone to open the room there, or copy the link and send it.',
  codeLabel: (url) => `QR code of the room link, ${url}`,
  otherApps: 'Other apps…',
  close: 'Close',
  sheetFailed: 'This browser could not open its share options. Scan the code or copy the link instead.',
  shareTitle: 'Battleship',
  shareMessage: 'Join my Battleship match:',
};
