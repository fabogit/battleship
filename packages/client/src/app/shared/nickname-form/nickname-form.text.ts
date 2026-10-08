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
  readonly invalid: string;
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
  invalid: 'Enter a nickname.',
  waitingForServer: 'Available once the server is connected.',
};
