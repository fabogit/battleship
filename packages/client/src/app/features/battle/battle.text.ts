import {
  ERROR_CODES,
  GAME_OVER_REASONS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  TARGET_VIOLATIONS,
  type GameOverReason,
  type ShipType,
  type ShotOutcome,
} from '@battleship/core';

import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { formatCoordinate } from '../../shared/board-grid/coordinates';
import { BATTLE_FEEDBACK, type BattleCommandError, type BattleFeedback } from './battle-store';
import type { TargetRefusal } from './target-draft';

/** The words of the battle and game-over view. */
export interface BattleText {
  /** The player's own board: its heading, accessible name and toggle button. */
  readonly myFleet: string;
  /** The tracking board: its heading, accessible name and toggle button. */
  readonly enemyWaters: string;
  /** The accessible name of the toggle between the boards. */
  readonly boardToggle: string;
  /** The heading during the player's turn. */
  readonly myTurn: string;
  /**
   * The heading during the opponent's turn.
   * @param nickname The opponent's nickname.
   * @returns The heading.
   */
  readonly opponentTurn: (nickname: string) => string;
  /** Under the heading during the player's turn. */
  readonly myTurnHint: string;
  /**
   * Under the heading during the opponent's turn.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentTurnHint: (nickname: string) => string;
  /**
   * The turn's deadline, while the snapshot carries one.
   * @param time The remaining time, e.g. `0:25`.
   * @returns The sentence.
   */
  readonly timeLeft: (time: string) => string;
  /**
   * While the opponent's socket is gone.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentAway: (nickname: string) => string;
  /** The button firing the turn. */
  readonly fire: string;
  /** The fire button while its command runs. */
  readonly firing: string;
  /** Under the fire button during the player's turn, before a target is picked. */
  readonly pickTarget: string;
  /**
   * Under the fire button once targets are picked.
   * @param cells Their names, e.g. `B7`.
   * @returns The sentence.
   */
  readonly aimingAt: (cells: string) => string;
  /** Under the fire button during the opponent's turn. */
  readonly waitForTurn: string;
  /** Each ship's name, as it reads inside a sentence. */
  readonly shipNames: Readonly<Record<ShipType, string>>;
  /**
   * After a tap puts a cell in the draft.
   * @param cell The cell's name.
   * @returns The sentence.
   */
  readonly targeted: (cell: string) => string;
  /**
   * After a tap takes a cell out of the draft.
   * @param cell The cell's name.
   * @returns The sentence.
   */
  readonly untargeted: (cell: string) => string;
  /** After a refused tap, by the reason `toggleTarget` reports, given the cell's name and the shot allowance. */
  readonly refusals: Readonly<Record<TargetRefusal, (cell: string, shotsAllowed: number) => string>>;
  /**
   * After the player's shot.
   * @param cell The cell's name.
   * @param outcome What the shot found.
   * @param sunkShip The name of the ship it sank, or `null`.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly myShot: (cell: string, outcome: ShotOutcome, sunkShip: string | null, nickname: string) => string;
  /**
   * After the opponent's shot.
   * @param cell The cell's name.
   * @param outcome What the shot found.
   * @param sunkShip The name of the player's ship it sank, or `null`.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentShot: (cell: string, outcome: ShotOutcome, sunkShip: string | null, nickname: string) => string;
  /** The heading at game over for the winner. */
  readonly wonHeading: string;
  /** The heading at game over for the loser. */
  readonly lostHeading: string;
  /** The heading at game over without a winner. */
  readonly abandonedHeading: string;
  /** Why the match ended, by reason, given the opponent's nickname and whether the player won. */
  readonly reasons: Readonly<Record<GameOverReason, (nickname: string, hasWon: boolean) => string>>;
  /**
   * At game over, about the tracking board.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly revealed: (nickname: string) => string;
  /** The link home at game over. */
  readonly newMatch: string;
  /** A message for each command failure the view explains; the others get `unexpected`. */
  readonly errors: Readonly<Partial<Record<BattleCommandError, string>>>;
  /** For any command failure without its own message. */
  readonly unexpected: string;
}

/**
 * English strings of the battle view, in one typed object so that `I18nService` (ADR-0018) can supply them per locale
 * later.
 */
export const BATTLE_TEXT: BattleText = {
  myFleet: 'My fleet',
  enemyWaters: 'Enemy waters',
  boardToggle: 'Board shown',
  myTurn: 'Your turn',
  opponentTurn: (nickname) => `${nickname}'s turn`,
  myTurnHint: 'Pick a target in Enemy waters, then fire.',
  opponentTurnHint: (nickname) => `Wait for ${nickname} to fire.`,
  timeLeft: (time) => `Time left: ${time}`,
  opponentAway: (nickname) => `${nickname} is disconnected.`,
  fire: 'Fire',
  firing: 'Firing…',
  pickTarget: 'Tap a cell to aim.',
  aimingAt: (cells) => `Target: ${cells}.`,
  waitForTurn: 'You can aim once it is your turn.',
  shipNames: {
    [SHIP_TYPES.CARRIER]: 'carrier',
    [SHIP_TYPES.BATTLESHIP]: 'battleship',
    [SHIP_TYPES.CRUISER]: 'cruiser',
    [SHIP_TYPES.SUBMARINE]: 'submarine',
    [SHIP_TYPES.DESTROYER]: 'destroyer',
  },
  targeted: (cell) => `Aiming at ${cell}.`,
  untargeted: (cell) => `${cell} is no longer a target.`,
  refusals: {
    [TARGET_VIOLATIONS.ALREADY_TARGETED]: (cell) => `${cell} has already been shot. Pick another cell.`,
    [TARGET_VIOLATIONS.WRONG_TARGET_COUNT]: (_cell, shotsAllowed) =>
      `You have picked all ${String(shotsAllowed)} targets. Tap one to remove it first.`,
  },
  myShot: (cell, outcome, sunkShip, nickname) => {
    switch (outcome) {
      case SHOT_OUTCOMES.MISS:
        return `You fired at ${cell}: miss.`;
      case SHOT_OUTCOMES.HIT:
        return `You fired at ${cell}: hit!`;
      case SHOT_OUTCOMES.SUNK:
        return `You fired at ${cell} and sank ${nickname}'s ${sunkShip ?? 'ship'}!`;
    }
  },
  opponentShot: (cell, outcome, sunkShip, nickname) => {
    switch (outcome) {
      case SHOT_OUTCOMES.MISS:
        return `${nickname} fired at ${cell}: miss.`;
      case SHOT_OUTCOMES.HIT:
        return `${nickname} fired at ${cell}: hit.`;
      case SHOT_OUTCOMES.SUNK:
        return `${nickname} fired at ${cell} and sank your ${sunkShip ?? 'ship'}.`;
    }
  },
  wonHeading: 'You won!',
  lostHeading: 'You lost',
  abandonedHeading: 'Match abandoned',
  reasons: {
    [GAME_OVER_REASONS.FLEET_DESTROYED]: (nickname, hasWon) =>
      hasWon ? `You sank ${nickname}'s whole fleet.` : `${nickname} sank your whole fleet.`,
    [GAME_OVER_REASONS.SURRENDER]: (nickname, hasWon) => (hasWon ? `${nickname} surrendered.` : 'You surrendered.'),
    [GAME_OVER_REASONS.AFK_FORFEIT]: (nickname, hasWon) =>
      hasWon ? `${nickname} let too many turns run out.` : 'You let too many turns run out.',
    [GAME_OVER_REASONS.DISCONNECT_FORFEIT]: (nickname, hasWon) =>
      hasWon ? `${nickname} did not come back in time.` : 'You were away for too long.',
    [GAME_OVER_REASONS.ABANDONED]: () => 'Both players let too many turns run out.',
  },
  revealed: (nickname) => `Enemy waters now shows ${nickname}'s whole fleet, the ships you did not find included.`,
  newMatch: 'New match',
  errors: {
    [ERROR_CODES.NOT_YOUR_TURN]: 'It is not your turn.',
    [ERROR_CODES.INVALID_TARGETS]: 'The server refused this target. Pick another cell.',
    [ERROR_CODES.WRONG_PHASE]: 'The match is over.',
    [ERROR_CODES.RATE_LIMITED]: 'Too many taps at once. Wait a moment and try again.',
    [TRANSPORT_ERRORS.NOT_CONNECTED]: 'Not connected to the server. Try again once it is back.',
    [TRANSPORT_ERRORS.NO_ACK]: 'The server did not answer. The board shows what it last confirmed.',
  },
  unexpected: 'Something went wrong. Try again.',
};

/**
 * Words the last tap or fired turn, for the view's live region.
 * @param feedback What happened.
 * @param nickname The opponent's nickname.
 * @param text The words to use.
 * @returns The sentence; one per shot for a turn with several.
 */
export function battleFeedbackMessage(
  feedback: BattleFeedback,
  nickname: string,
  text: BattleText = BATTLE_TEXT,
): string {
  switch (feedback.kind) {
    case BATTLE_FEEDBACK.TARGETED:
      return text.targeted(formatCoordinate(feedback.coordinate));
    case BATTLE_FEEDBACK.UNTARGETED:
      return text.untargeted(formatCoordinate(feedback.coordinate));
    case BATTLE_FEEDBACK.REFUSED:
      return text.refusals[feedback.reason](formatCoordinate(feedback.coordinate), feedback.shotsAllowed);
    case BATTLE_FEEDBACK.FIRED: {
      const words = feedback.isMine ? text.myShot : text.opponentShot;
      return feedback.results
        .map(({ coordinate, outcome, sunkShip }) =>
          words(formatCoordinate(coordinate), outcome, sunkShip ? text.shipNames[sunkShip.type] : null, nickname),
        )
        .join(' ');
    }
  }
}

/**
 * Explains a failed battle command.
 * @param error Why the command failed.
 * @param text The messages to pick from.
 * @returns The message for that failure, or the generic one.
 */
export function battleErrorMessage(error: BattleCommandError, text: BattleText = BATTLE_TEXT): string {
  return text.errors[error] ?? text.unexpected;
}
