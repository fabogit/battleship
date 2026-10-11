/** The words of the nickname form. */
export interface NicknameFormText {
  /** The field's label. */
  readonly label: string;
  /**
   * The hint under the field.
   * @param maxLength The longest nickname, `NICKNAME_MAX_LENGTH`.
   * @returns The hint.
   */
  readonly hint: (maxLength: number) => string;
  /** Shown once a submit found the field empty or blank. */
  readonly empty: string;
  /** Shown once a submit found a character the guard refuses: invisible, control or blank-looking (ADR-0060). */
  readonly unsupportedCharacters: string;
  /** Next to the submit button while the socket is not connected. */
  readonly waitingForServer: string;
}

/**
 * English strings of the nickname form, in one typed object so that `I18nService` (ADR-0018) can supply them per
 * locale later.
 */
export const NICKNAME_FORM_TEXT: NicknameFormText = {
  label: 'Your nickname',
  hint: (maxLength) => `1 to ${String(maxLength)} characters, shown to your opponent.`,
  empty: 'Enter a nickname.',
  unsupportedCharacters:
    'Use letters, numbers, punctuation or emoji. Invisible and control characters are not allowed.',
  waitingForServer: 'Available once the server is connected.',
};
