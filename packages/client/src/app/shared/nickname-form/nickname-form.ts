import { Component, input, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, validate } from '@angular/forms/signals';
import { NICKNAME_MAX_LENGTH, parseNickname } from '@battleship/core';

import { NICKNAME_FORM_TEXT } from './nickname-form.text';

/** The form's model: the nickname as typed, untrimmed. */
interface NicknameModel {
  /** What the input holds. */
  readonly nickname: string;
}

/**
 * The nickname field with one submit button, shared by the home screen (create) and the join screen
 * (docs/client.md#routes--lobby-flow). It accepts exactly what core's `parseNickname` accepts and hands over the
 * trimmed nickname. The button stays focusable while the socket is not connected, but does nothing (ADR-0050).
 */
@Component({
  selector: 'app-nickname-form',
  imports: [FormField, FormRoot],
  templateUrl: './nickname-form.html',
  styleUrl: './nickname-form.css',
})
export class NicknameForm {
  /** The submit button's label, e.g. "Create room". */
  readonly submitLabel = input.required<string>();
  /** The submit button's label while `submitAction` runs, e.g. "Creating room…". */
  readonly submittingLabel = input.required<string>();
  /** Whether the socket is connected; until then a submit does nothing and a hint says why. */
  readonly isConnected = input.required<boolean>();
  /**
   * Runs on a valid submit while connected, with the trimmed nickname; the button reports it busy until the returned
   * promise settles.
   */
  readonly submitAction = input.required<(nickname: string) => Promise<void>>();

  /** The longest nickname, for the hint. */
  protected readonly maxLength = NICKNAME_MAX_LENGTH;
  /** The words of the form. */
  protected readonly text = NICKNAME_FORM_TEXT;

  /** What the input holds. */
  private readonly model = signal<NicknameModel>({ nickname: '' });

  /**
   * The form: `maxLength` puts `maxlength` on the input, `parseNickname` refuses an empty or blank nickname. A submit
   * marks the field touched, so its error shows from then on.
   */
  protected readonly nicknameForm = form(
    this.model,
    (path) => {
      maxLength(path.nickname, NICKNAME_MAX_LENGTH);
      validate(path.nickname, ({ value }) =>
        parseNickname(value()) === null ? { kind: 'nickname', message: this.text.invalid } : undefined,
      );
    },
    {
      submission: {
        action: async (field) => {
          const nickname = parseNickname(field.nickname().value());
          if (nickname !== null && this.isConnected()) {
            await this.submitAction()(nickname);
          }
        },
      },
    },
  );
}
