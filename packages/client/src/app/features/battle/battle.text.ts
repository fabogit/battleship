import {
  ERROR_CODES,
  GAME_OVER_REASONS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  TARGET_VIOLATIONS,
  TIMEOUT_ACTIONS,
  type GameOverReason,
  type ShipType,
  type ShotOutcome,
  type ShotResult,
  type TimeoutAction,
} from '@battleship/core';

import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { formatCoordinate } from '../../shared/board-grid/coordinates';
import {
  BATTLE_FEEDBACK,
  SURRENDER_PROMPTS,
  type BattleCommandError,
  type BattleFeedback,
  type SurrenderPrompt,
  type TargetCount,
} from './battle-store';
import type { TargetRefusal } from './target-draft';

/** The words of the surrender dialog for one of the `SURRENDER_PROMPTS`. */
export interface SurrenderPromptText {
  /** The dialog's heading. */
  readonly heading: string;
  /**
   * What surrendering does.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly intro: (nickname: string) => string;
  /** The confirm button. */
  readonly confirm: string;
}

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
   * Under the heading during the player's turn when it fires more than one target (ADR-0121).
   * @param count The turn's shot allowance, at least 2.
   * @returns The sentence.
   */
  readonly mySalvoTurnHint: (count: number) => string;
  /**
   * Under the heading during the opponent's turn when it fires more than one target (ADR-0121).
   * @param nickname The opponent's nickname.
   * @param count The turn's shot allowance, at least 2.
   * @returns The sentence.
   */
  readonly opponentSalvoTurnHint: (nickname: string, count: number) => string;
  /**
   * The turn's deadline, while the snapshot carries one.
   * @param time The remaining time, e.g. `0:25`.
   * @returns The sentence.
   */
  readonly timeLeft: (time: string) => string;
  /**
   * The turn's deadline while the match is paused, frozen.
   * @param time The remaining time, e.g. `0:25`.
   * @returns The sentence.
   */
  readonly timePaused: (time: string) => string;
  /** In place of the hint during the player's turn once its time runs low (ADR-0108), by what a timeout does. */
  readonly myTimeLow: Readonly<Record<TimeoutAction, string>>;
  /**
   * In place of `myTimeLow` under "Random shot" when the turn fires more than one target: the timeout keeps the
   * drafted targets and draws the rest (ADR-0114, ADR-0121).
   */
  readonly mySalvoTimeLow: string;
  /**
   * In place of the hint during the opponent's turn once its time runs low (ADR-0108).
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentTimeLow: (nickname: string) => string;
  /** The heading while the dice roll for the first turn (ADR-0107). */
  readonly diceHeading: string;
  /** Under the heading while the dice tumble. */
  readonly diceRolling: string;
  /** Under each die: whose it is; the opponent's shows their nickname. The dice are drawn only (`aria-hidden`). */
  readonly diceOwners: {
    /** The player's die. */
    readonly me: string;
  };
  /**
   * Under the heading once a round is a tie.
   * @param face The face both dice show.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly diceTie: (face: number, nickname: string) => string;
  /**
   * Under the heading once the last round shows who starts.
   * @param myFace The player's die.
   * @param theirFace The opponent's die.
   * @param nickname The opponent's nickname.
   * @param isMine Whether the player starts.
   * @returns The sentence.
   */
  readonly diceResult: (myFace: number, theirFace: number, nickname: string, isMine: boolean) => string;
  /**
   * In place of the hint while the first turn's timer waits for the dice animation, on a client that did not see the
   * roll, as after a reload (ADR-0106).
   * @param nickname The opponent's nickname.
   * @param isMine Whether the player starts.
   * @returns The sentence.
   */
  readonly diceStarter: (nickname: string, isMine: boolean) => string;
  /**
   * While the player has let turns run out in a row (ADR-0109).
   * @param left Timeouts in a row left before the match is lost: `MAX_CONSECUTIVE_AFK_TURNS − afkCount.me`, at least 1.
   * @returns The sentence.
   */
  readonly myAfk: (left: number) => string;
  /**
   * While the opponent has let turns run out in a row (ADR-0109).
   * @param nickname The opponent's nickname.
   * @param left Timeouts in a row left before they lose: `MAX_CONSECUTIVE_AFK_TURNS − afkCount.opponent`, at least 1.
   * @returns The sentence.
   */
  readonly opponentAfk: (nickname: string, left: number) => string;
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
  /** Under the fire button while the dice roll for the first turn. */
  readonly waitForDice: string;
  /**
   * The salvo target counter (ADR-0121).
   * @param count How full the draft is.
   * @returns The counter, e.g. `2 of 5 targets`.
   */
  readonly targetCount: (count: TargetCount) => string;
  /**
   * Under the fire button during a salvo turn: the counter, then the targets or what to do.
   * @param count The counter, from `targetCount`.
   * @param cells The targets' names, joined; empty before the first.
   * @returns The sentence.
   */
  readonly salvoAiming: (count: string, cells: string) => string;
  /** Each ship's name, as it reads inside a sentence. */
  readonly shipNames: Readonly<Record<ShipType, string>>;
  /**
   * After a tap puts a cell in the draft.
   * @param cell The cell's name.
   * @param count In salvo mode the counter after the tap, announced with it (ADR-0121); `null` otherwise.
   * @returns The sentence.
   */
  readonly targeted: (cell: string, count: string | null) => string;
  /**
   * After a tap takes a cell out of the draft.
   * @param cell The cell's name.
   * @param count In salvo mode the counter after the tap, announced with it (ADR-0121); `null` otherwise.
   * @returns The sentence.
   */
  readonly untargeted: (cell: string, count: string | null) => string;
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
  /**
   * After the shot fired for the player when their time ran out (ADR-0109, ADR-0121): their target, or a random one;
   * the words claim neither.
   * @param cell The cell's name.
   * @param outcome What the shot found.
   * @param sunkShip The name of the ship it sank, or `null`.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly myAutoShot: (cell: string, outcome: ShotOutcome, sunkShip: string | null, nickname: string) => string;
  /**
   * After the shot fired for the opponent when their time ran out (ADR-0109, ADR-0121): their target, or a random one;
   * the words claim neither.
   * @param cell The cell's name.
   * @param outcome What the shot found.
   * @param sunkShip The name of the player's ship it sank, or `null`.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentAutoShot: (cell: string, outcome: ShotOutcome, sunkShip: string | null, nickname: string) => string;
  /** After a shot of the player's that keeps the turn: an extra turn on a hit (ADR-0121). */
  readonly myFireAgain: string;
  /**
   * After a shot of the opponent's that keeps their turn: an extra turn on a hit (ADR-0121).
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentFiresAgain: (nickname: string) => string;
  /**
   * Opens the message of the player's turn with several targets (ADR-0121).
   * @param count How many targets it fired.
   * @returns The words before the results, without a stop.
   */
  readonly mySalvo: (count: number) => string;
  /**
   * Opens the message of the opponent's turn with several targets (ADR-0121).
   * @param nickname The opponent's nickname.
   * @param count How many targets it fired.
   * @returns The words before the results, without a stop.
   */
  readonly opponentSalvo: (nickname: string, count: number) => string;
  /**
   * Opens the message of the player's turn with several targets, fired for them when their time ran out: the drafted
   * targets and random ones, which `SHOT_RESOLVED` does not tell apart (ADR-0121).
   * @param count How many targets it fired.
   * @returns The words before the results, without a stop.
   */
  readonly myAutoSalvo: (count: number) => string;
  /**
   * Opens the message of the opponent's turn with several targets, fired for them when their time ran out (ADR-0121).
   * @param nickname The opponent's nickname.
   * @param count How many targets it fired.
   * @returns The words before the results, without a stop.
   */
  readonly opponentAutoSalvo: (nickname: string, count: number) => string;
  /**
   * The cells of a turn with several targets that found a ship, sunk ones included.
   * @param cells Their names, joined.
   * @param count How many.
   * @returns The phrase, e.g. `hits on A2 and A3`.
   */
  readonly hits: (cells: string, count: number) => string;
  /**
   * The cells of a turn with several targets that found water.
   * @param cells Their names, joined.
   * @param count How many.
   * @returns The phrase, e.g. `a miss on A1`.
   */
  readonly misses: (cells: string, count: number) => string;
  /**
   * The opponent's ships a turn of the player's with several targets sank.
   * @param ships Their names, joined.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly mySinks: (ships: string, nickname: string) => string;
  /**
   * The player's ships a turn of the opponent's with several targets sank.
   * @param ships Their names, joined.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentSinks: (ships: string, nickname: string) => string;
  /**
   * In salvo mode, after the opponent sank a ship of the player's: the player's allowance from now on (ADR-0121).
   * @param count The new allowance.
   * @returns The sentence.
   */
  readonly myAllowance: (count: number) => string;
  /**
   * In salvo mode, after the player sank a ship of the opponent's: the opponent's allowance from now on (ADR-0121).
   * @param nickname The opponent's nickname.
   * @param count The new allowance.
   * @returns The sentence.
   */
  readonly opponentAllowance: (nickname: string, count: number) => string;
  /**
   * Joins names into a list.
   * @param items At least one name.
   * @returns The list, e.g. `A1, A4 and A5`.
   */
  readonly list: (items: readonly string[]) => string;
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
  /** The button that opens the surrender dialog while the match is on (ADR-0116). */
  readonly surrender: string;
  /** The surrender dialog, by what opened it (ADR-0116, ADR-0117). */
  readonly surrenderPrompts: Readonly<Record<SurrenderPrompt, SurrenderPromptText>>;
  /** The dialog's confirm button while `SURRENDER` waits for its ack. */
  readonly surrendering: string;
  /** The dialog's button that closes it and goes on with the match. */
  readonly keepPlaying: string;
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
  myTurnHint: 'Aim in Enemy waters, then fire.',
  opponentTurnHint: (nickname) => `Wait for ${nickname} to fire.`,
  mySalvoTurnHint: (count) => `Aim at ${String(count)} cells in Enemy waters, then fire.`,
  opponentSalvoTurnHint: (nickname, count) => `Wait for ${nickname} to fire ${String(count)} shots.`,
  timeLeft: (time) => `Time left: ${time}`,
  timePaused: (time) => `Time left: ${time}, paused`,
  myTimeLow: {
    [TIMEOUT_ACTIONS.AUTO_RANDOM_SHOT]: 'Fire now, or a shot is fired for you.',
    [TIMEOUT_ACTIONS.PASS_TURN]: 'Fire now, or your turn passes.',
  },
  mySalvoTimeLow: 'Fire now, or random shots fill the rest.',
  opponentTimeLow: (nickname) => `${nickname}'s time is almost up.`,
  diceHeading: 'Who starts?',
  diceRolling: 'Rolling the dice…',
  diceOwners: { me: 'You' },
  diceTie: (face, nickname) => `You and ${nickname} both rolled ${String(face)}: rolling again.`,
  diceResult: (myFace, theirFace, nickname, isMine) =>
    `You rolled ${String(myFace)}, ${nickname} rolled ${String(theirFace)}: ${isMine ? 'you start' : `${nickname} starts`}.`,
  diceStarter: (nickname, isMine) =>
    isMine ? 'The dice picked you to start.' : `The dice picked ${nickname} to start.`,
  myAfk: (left) =>
    left === 1 ? 'One more timeout and you lose.' : `${String(left)} more timeouts in a row and you lose.`,
  opponentAfk: (nickname, left) =>
    left === 1
      ? `One more timeout and ${nickname} loses.`
      : `${String(left)} more timeouts in a row and ${nickname} loses.`,
  fire: 'Fire',
  firing: 'Firing…',
  pickTarget: 'Tap a cell to aim.',
  aimingAt: (cells) => `Target: ${cells}.`,
  waitForTurn: 'You can aim once it is your turn.',
  waitForDice: 'You can aim once the dice have picked who starts.',
  targetCount: ({ picked, allowed }) =>
    `${String(picked)} of ${String(allowed)} ${allowed === 1 ? 'target' : 'targets'}`,
  salvoAiming: (count, cells) => (cells === '' ? `${count}: tap a cell to aim.` : `${count}: ${cells}.`),
  shipNames: {
    [SHIP_TYPES.CARRIER]: 'carrier',
    [SHIP_TYPES.BATTLESHIP]: 'battleship',
    [SHIP_TYPES.CRUISER]: 'cruiser',
    [SHIP_TYPES.SUBMARINE]: 'submarine',
    [SHIP_TYPES.DESTROYER]: 'destroyer',
  },
  targeted: (cell, count) => (count === null ? `Aiming at ${cell}.` : `Aiming at ${cell}: ${count}.`),
  untargeted: (cell, count) =>
    count === null ? `${cell} is no longer a target.` : `${cell} is no longer a target: ${count}.`,
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
  myAutoShot: (cell, outcome, sunkShip, nickname) => {
    switch (outcome) {
      case SHOT_OUTCOMES.MISS:
        return `Your time ran out: a shot was fired for you at ${cell}, miss.`;
      case SHOT_OUTCOMES.HIT:
        return `Your time ran out: a shot was fired for you at ${cell}, hit!`;
      case SHOT_OUTCOMES.SUNK:
        return `Your time ran out: a shot was fired for you at ${cell} and sank ${nickname}'s ${sunkShip ?? 'ship'}!`;
    }
  },
  opponentAutoShot: (cell, outcome, sunkShip, nickname) => {
    switch (outcome) {
      case SHOT_OUTCOMES.MISS:
        return `${nickname}'s time ran out: a shot was fired for them at ${cell}, miss.`;
      case SHOT_OUTCOMES.HIT:
        return `${nickname}'s time ran out: a shot was fired for them at ${cell}, hit.`;
      case SHOT_OUTCOMES.SUNK:
        return `${nickname}'s time ran out: a shot was fired for them at ${cell} and sank your ${sunkShip ?? 'ship'}.`;
    }
  },
  myFireAgain: 'Fire again.',
  opponentFiresAgain: (nickname) => `${nickname} fires again.`,
  mySalvo: (count) => `You fired ${String(count)} shots`,
  opponentSalvo: (nickname, count) => `${nickname} fired ${String(count)} shots`,
  myAutoSalvo: (count) => `Your time ran out, so your ${String(count)} shots were fired for you`,
  opponentAutoSalvo: (nickname, count) =>
    `${nickname}'s time ran out, so their ${String(count)} shots were fired for them`,
  hits: (cells, count) => (count === 1 ? `a hit on ${cells}` : `hits on ${cells}`),
  misses: (cells, count) => (count === 1 ? `a miss on ${cells}` : `misses on ${cells}`),
  mySinks: (ships, nickname) => `Your shots sank ${nickname}'s ${ships}!`,
  opponentSinks: (ships, nickname) => `${nickname}'s shots sank your ${ships}.`,
  myAllowance: (count) => `You now fire ${String(count)} ${count === 1 ? 'shot' : 'shots'} per turn.`,
  opponentAllowance: (nickname, count) =>
    `${nickname} now fires ${String(count)} ${count === 1 ? 'shot' : 'shots'} per turn.`,
  list: (items) =>
    items.length === 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`,
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
  surrender: 'Surrender',
  surrenderPrompts: {
    [SURRENDER_PROMPTS.SURRENDER]: {
      heading: 'Surrender the match?',
      intro: (nickname) => `${nickname} wins at once. You stay in the room and see both fleets.`,
      confirm: 'Surrender',
    },
    [SURRENDER_PROMPTS.LEAVE]: {
      heading: 'Leave the match?',
      intro: (nickname) => `Leaving the room surrenders the match: ${nickname} wins at once.`,
      confirm: 'Surrender and leave',
    },
  },
  surrendering: 'Surrendering…',
  keepPlaying: 'Keep playing',
  errors: {
    [ERROR_CODES.NOT_YOUR_TURN]: 'It is not your turn.',
    [ERROR_CODES.INVALID_TARGETS]: 'The server refused this target. Pick another cell.',
    [ERROR_CODES.WRONG_PHASE]: 'The match is over.',
    [ERROR_CODES.RATE_LIMITED]: 'Too many taps at once. Wait a moment and try again.',
    [ERROR_CODES.SERVER_ERROR]: 'The server ran into an error. Your last move was not saved.',
    [TRANSPORT_ERRORS.NOT_CONNECTED]: 'Not connected to the server. Your last move was not saved.',
    [TRANSPORT_ERRORS.NO_ACK]: 'The server did not answer. Your last move may not be saved.',
  },
  unexpected: 'Something went wrong. Try again.',
};

/**
 * Words the last tap or fired turn, for the view's live region.
 * @param feedback What happened.
 * @param nickname The opponent's nickname.
 * @param text The words to use.
 * @returns The message; one for the whole turn, however many targets it fired (ADR-0121).
 */
export function battleFeedbackMessage(
  feedback: BattleFeedback,
  nickname: string,
  text: BattleText = BATTLE_TEXT,
): string {
  switch (feedback.kind) {
    case BATTLE_FEEDBACK.TARGETED:
    case BATTLE_FEEDBACK.UNTARGETED: {
      const words = feedback.kind === BATTLE_FEEDBACK.TARGETED ? text.targeted : text.untargeted;
      return words(formatCoordinate(feedback.coordinate), feedback.count && text.targetCount(feedback.count));
    }
    case BATTLE_FEEDBACK.REFUSED:
      return text.refusals[feedback.reason](formatCoordinate(feedback.coordinate), feedback.shotsAllowed);
    case BATTLE_FEEDBACK.FIRED:
      return firedTurnMessage(feedback, nickname, text);
  }
}

/**
 * Words a fired turn (ADR-0121): the single-shot sentence for one target, else one message for all of them, the extra
 * turn on a hit (ADR-0121) and, in salvo mode, the next allowance after a sunk ship.
 * @param feedback What `SHOT_RESOLVED` and the `STATE` after it told.
 * @param nickname The opponent's nickname.
 * @param text The words to use.
 * @returns The sentences, joined.
 */
function firedTurnMessage(
  feedback: Extract<BattleFeedback, { kind: typeof BATTLE_FEEDBACK.FIRED }>,
  nickname: string,
  text: BattleText,
): string {
  const { isMine, isAutomatic, results } = feedback;
  const shotWords = isAutomatic
    ? isMine
      ? text.myAutoShot
      : text.opponentAutoShot
    : isMine
      ? text.myShot
      : text.opponentShot;
  const [only] = results;
  const sentences = [
    results.length === 1 && only !== undefined
      ? shotWords(
          formatCoordinate(only.coordinate),
          only.outcome,
          only.sunkShip ? text.shipNames[only.sunkShip.type] : null,
          nickname,
        )
      : salvoSentences(feedback, nickname, text),
  ];
  if (feedback.keepsTurn) {
    sentences.push(isMine ? text.myFireAgain : text.opponentFiresAgain(nickname));
  }
  const hasSunk = results.some(({ outcome }) => outcome === SHOT_OUTCOMES.SUNK);
  if (hasSunk && feedback.nextShotsAllowed !== null) {
    sentences.push(
      isMine
        ? text.opponentAllowance(nickname, feedback.nextShotsAllowed)
        : text.myAllowance(feedback.nextShotsAllowed),
    );
  }
  return sentences.join(' ');
}

/**
 * Words a turn with several targets in one message (ADR-0121): who fired how many, the hits and the misses in firing
 * order, then the ships sunk.
 * @param feedback What `SHOT_RESOLVED` and the `STATE` after it told; two targets or more.
 * @param nickname The opponent's nickname.
 * @param text The words to use.
 * @returns The summary, and the ships sunk when there are any.
 */
function salvoSentences(
  feedback: Extract<BattleFeedback, { kind: typeof BATTLE_FEEDBACK.FIRED }>,
  nickname: string,
  text: BattleText,
): string {
  const { isMine, isAutomatic, results } = feedback;
  const count = results.length;
  const opening = isAutomatic
    ? isMine
      ? text.myAutoSalvo(count)
      : text.opponentAutoSalvo(nickname, count)
    : isMine
      ? text.mySalvo(count)
      : text.opponentSalvo(nickname, count);
  const cells = (wanted: (result: ShotResult) => boolean): string[] =>
    results.filter(wanted).map(({ coordinate }) => formatCoordinate(coordinate));
  const hits = cells(({ outcome }) => outcome !== SHOT_OUTCOMES.MISS);
  const misses = cells(({ outcome }) => outcome === SHOT_OUTCOMES.MISS);
  const groups = [
    ...(hits.length > 0 ? [text.hits(text.list(hits), hits.length)] : []),
    ...(misses.length > 0 ? [text.misses(text.list(misses), misses.length)] : []),
  ];
  const sunk = results.flatMap(({ sunkShip }) => (sunkShip ? [text.shipNames[sunkShip.type]] : []));
  const summary = `${opening}: ${groups.join(', ')}.`;
  if (sunk.length === 0) {
    return summary;
  }
  const ships = text.list(sunk);
  return `${summary} ${isMine ? text.mySinks(ships, nickname) : text.opponentSinks(ships, nickname)}`;
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
