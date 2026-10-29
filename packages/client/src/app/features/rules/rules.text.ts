import { ERROR_CODES, TIMEOUT_ACTIONS, type GameRules, type TimeoutAction } from '@battleship/core';

import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { RULES_EDITORS, RULES_NOTICE_KINDS, type RulesCommandError, type RulesNotice } from './rules-store';

/**
 * How the notice words one changed rule, after who changed it: one phrase per rule, salvo included, since another
 * client may offer what this one does not.
 */
export type RuleChangeWords = {
  readonly [K in keyof GameRules]: (value: GameRules[K]) => string;
};

/** The words of the rules screen. */
export interface RulesText {
  /** The page heading. */
  readonly heading: string;
  /**
   * Under the heading: who the rules are agreed with.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly intro: (nickname: string) => string;
  /** The legend of the rules fieldset. */
  readonly legend: string;
  /** The switch for `isExtraTurnOnHitEnabled`. */
  readonly extraTurn: string;
  /** The switch for `areAdjacentShipsAllowed`. */
  readonly adjacentShips: string;
  /** The legend of the turn time limit options. */
  readonly turnTimeLimit: string;
  /**
   * A turn time limit option as shown.
   * @param seconds The limit.
   * @returns The short form, e.g. `30 s`.
   */
  readonly seconds: (seconds: number) => string;
  /**
   * A turn time limit option as read, in place of the short form.
   * @param seconds The limit.
   * @returns The long form, e.g. `30 seconds`.
   */
  readonly secondsName: (seconds: number) => string;
  /** The legend of the timeout action options. */
  readonly timeoutAction: string;
  /** Each timeout action, as an option. */
  readonly timeoutActions: Readonly<Record<TimeoutAction, string>>;
  /** The accessible name of the list of confirmations. */
  readonly confirmationsLabel: string;
  /** How the player is named in the list of confirmations. */
  readonly you: string;
  /**
   * One player's line in the list of confirmations.
   * @param name `you`, or the opponent's nickname.
   * @param isConfirmed Whether that player confirmed the version on screen.
   * @returns The line.
   */
  readonly confirmation: (name: string, isConfirmed: boolean) => string;
  /** The confirm button. */
  readonly confirm: string;
  /** The confirm button's description, read with it and not shown: what an edit does to a confirmation. */
  readonly confirmHint: string;
  /** The confirm button while its command runs. */
  readonly confirming: string;
  /** The confirm button once the player confirmed the version on screen. */
  readonly confirmed: string;
  /** How the notice words each changed rule. */
  readonly changes: RuleChangeWords;
  /** The phrase of a new version whose rules equal the one before, e.g. after two edits that undo each other. */
  readonly changedRules: string;
  /**
   * Joins the phrases of the changed rules.
   * @param phrases One phrase per changed rule, at least one.
   * @returns The list, e.g. `a, b and c`.
   */
  readonly list: (phrases: readonly string[]) => string;
  /** The subject of an edit of the player's. */
  readonly youChanged: string;
  /** After an edit that cleared both confirmations. */
  readonly bothConfirmAgain: string;
  /** After an edit that cleared the player's confirmation. */
  readonly youConfirmAgain: string;
  /**
   * After an edit that cleared the opponent's confirmation.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentConfirmsAgain: (nickname: string) => string;
  /**
   * After the opponent confirmed the version on screen.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentConfirmed: (nickname: string) => string;
  /** A message for each failure the screen explains; the others get `unexpected`. */
  readonly errors: Readonly<Partial<Record<RulesCommandError, string>>>;
  /** For any failure without its own message. */
  readonly unexpected: string;
}

/**
 * English strings of the rules screen, in one typed object so that `I18nService` (ADR-0018) can supply them per locale
 * later.
 */
export const RULES_TEXT: RulesText = {
  heading: 'Match rules',
  intro: (nickname) => `Agree on the rules with ${nickname}.`,
  legend: 'Rules',
  extraTurn: 'Extra turn on hit',
  adjacentShips: 'Ships may touch',
  turnTimeLimit: 'Time per turn',
  seconds: (seconds) => `${String(seconds)} s`,
  secondsName: (seconds) => `${String(seconds)} seconds`,
  timeoutAction: 'When time runs out',
  timeoutActions: {
    [TIMEOUT_ACTIONS.AUTO_RANDOM_SHOT]: 'Random shot',
    [TIMEOUT_ACTIONS.PASS_TURN]: 'Pass the turn',
  },
  confirmationsLabel: 'Confirmations',
  you: 'You',
  confirmation: (name, isConfirmed) => `${name}: ${isConfirmed ? 'confirmed' : 'not confirmed yet'}`,
  confirm: 'Confirm rules',
  confirmHint: 'Any change to the rules asks you both to confirm again.',
  confirming: 'Confirming…',
  confirmed: 'Rules confirmed',
  changes: {
    isExtraTurnOnHitEnabled: (isEnabled) => `turned extra turn on hit ${isEnabled ? 'on' : 'off'}`,
    areAdjacentShipsAllowed: (areAllowed) => (areAllowed ? 'allowed ships to touch' : 'stopped ships from touching'),
    turnTimeLimitSeconds: (seconds) => `set the time per turn to ${String(seconds)} seconds`,
    isSalvoModeEnabled: (isEnabled) => `turned salvo ${isEnabled ? 'on' : 'off'}`,
    timeoutAction: (action) =>
      action === TIMEOUT_ACTIONS.PASS_TURN
        ? 'chose to pass the turn when time runs out'
        : 'chose a random shot when time runs out',
  },
  changedRules: 'changed the rules',
  list: (phrases) =>
    phrases.length === 1 ? (phrases[0] ?? '') : `${phrases.slice(0, -1).join(', ')} and ${phrases.at(-1) ?? ''}`,
  youChanged: 'You',
  bothConfirmAgain: 'You both need to confirm again.',
  youConfirmAgain: 'You need to confirm again.',
  opponentConfirmsAgain: (nickname) => `${nickname} needs to confirm again.`,
  opponentConfirmed: (nickname) => `${nickname} confirmed the rules.`,
  errors: {
    [ERROR_CODES.STALE_RULES]: 'The rules changed just before you confirmed. Check them and confirm again.',
    [ERROR_CODES.INVALID_RULES]: "The server refused these rules. The screen shows the room's rules again.",
    [ERROR_CODES.WRONG_PHASE]: 'The rules are settled and can no longer change.',
    [ERROR_CODES.RATE_LIMITED]: 'Too many changes at once. Wait a moment and try again.',
    [TRANSPORT_ERRORS.NOT_CONNECTED]: 'Not connected to the server. Try again once it is connected.',
    [TRANSPORT_ERRORS.NO_ACK]: 'The server did not answer. Try again.',
  },
  unexpected: 'Something went wrong. Try again.',
};

/**
 * Words a rules notice for the screen's live region (ADR-0088): who changed what, and whose confirmation it cleared.
 * @param notice What the latest snapshot changed.
 * @param nickname The opponent's nickname.
 * @param text The words to use.
 * @returns The sentences.
 */
export function rulesNoticeMessage(notice: RulesNotice, nickname: string, text: RulesText = RULES_TEXT): string {
  if (notice.kind === RULES_NOTICE_KINDS.OPPONENT_CONFIRMED) {
    return text.opponentConfirmed(nickname);
  }
  const phrases = (Object.keys(notice.changes) as (keyof GameRules)[]).flatMap((field) => {
    const value = notice.changes[field];
    return value === undefined ? [] : [changePhrase(field, value, text.changes)];
  });
  const subject = notice.editor === RULES_EDITORS.ME ? text.youChanged : nickname;
  const edit = `${subject} ${phrases.length === 0 ? text.changedRules : text.list(phrases)}.`;
  const { me, opponent } = notice.cleared;
  const again =
    me && opponent
      ? text.bothConfirmAgain
      : me
        ? text.youConfirmAgain
        : opponent
          ? text.opponentConfirmsAgain(nickname)
          : null;
  return again === null ? edit : `${edit} ${again}`;
}

/**
 * Words one changed rule with the phrase for its field.
 * @param field Which rule changed.
 * @param value Its new value.
 * @param words The phrase of every rule.
 * @returns The phrase, e.g. `set the time per turn to 60 seconds`.
 */
function changePhrase<K extends keyof GameRules>(field: K, value: GameRules[K], words: RuleChangeWords): string {
  return words[field](value);
}

/**
 * Explains a failed rules command.
 * @param error Why the command failed.
 * @param text The messages to pick from.
 * @returns The message for that failure, or the generic one.
 */
export function rulesErrorMessage(error: RulesCommandError, text: RulesText = RULES_TEXT): string {
  return text.errors[error] ?? text.unexpected;
}
