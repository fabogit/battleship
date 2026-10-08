import {
  ERROR_CODES,
  ORIENTATIONS,
  PLACEMENT_VIOLATIONS,
  SHIP_TYPES,
  type Orientation,
  type PlacementViolation,
  type ShipType,
} from '@battleship/core';

import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { formatCoordinate } from '../../shared/board-grid/coordinates';
import { PLACEMENT_FEEDBACK, type PlacementCommandError, type PlacementFeedback } from './placement-store';

/** The words of the placement view. */
export interface PlacementText {
  /** The page heading. */
  readonly heading: string;
  /** The board's accessible name. */
  readonly boardLabel: string;
  /** The accessible name of the list of ships. */
  readonly dockLabel: string;
  /** Each ship's name, as it starts a sentence. */
  readonly shipNames: Readonly<Record<ShipType, string>>;
  /** Each orientation, as it follows a cell name. */
  readonly orientations: Readonly<Record<Orientation, string>>;
  /**
   * A ship's size, read after its name in the dock.
   * @param cells `SHIP_LENGTH` of the ship.
   * @returns The phrase.
   */
  readonly shipCells: (cells: number) => string;
  /** Read after a dock ship that is on the board. */
  readonly placed: string;
  /**
   * The placement deadline.
   * @param time The remaining time, e.g. `0:45`.
   * @returns The sentence.
   */
  readonly timeLeft: (time: string) => string;
  /**
   * While the opponent's fleet is not locked.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentPlacing: (nickname: string) => string;
  /**
   * Once the opponent's fleet is locked.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentReady: (nickname: string) => string;
  /**
   * While both fleets are locked and the match is about to start.
   * @param seconds Whole seconds left.
   * @returns The sentence.
   */
  readonly startsIn: (seconds: number) => string;
  /**
   * Above the actions on the selected ship.
   * @param ship The ship's name.
   * @returns The phrase.
   */
  readonly selectedShip: (ship: string) => string;
  /** The button turning the selected ship. */
  readonly rotate: string;
  /** The button putting the selected ship back in the dock. */
  readonly remove: string;
  /** The button filling the board with a random fleet. */
  readonly randomize: string;
  /** The button locking the fleet. */
  readonly confirm: string;
  /** The confirm button while its command runs. */
  readonly confirming: string;
  /** The button reverting the fleet to draft. */
  readonly unlock: string;
  /** The unlock button while its command runs. */
  readonly unlocking: string;
  /** Under the fleet actions while the fleet is locked. */
  readonly lockedHint: string;
  /** Under the fleet actions while the fleet cannot be confirmed, by the rule `validateFleet` reports. */
  readonly confirmHints: Readonly<Record<PlacementViolation, string>>;
  /**
   * After a ship is selected.
   * @param ship The ship's name.
   * @param orientation Where a ship from the dock will extend, or the placed ship's own orientation.
   * @param isPlaced Whether the ship is on the board.
   * @returns The sentence.
   */
  readonly selected: (ship: string, orientation: string, isPlaced: boolean) => string;
  /**
   * After a ship is placed or moved.
   * @param ship The ship's name.
   * @param cell The name of its start cell, e.g. `B3`.
   * @param orientation Its orientation.
   * @returns The sentence.
   */
  readonly placedAt: (ship: string, cell: string, orientation: string) => string;
  /**
   * After a ship is turned.
   * @param ship The ship's name.
   * @param cell The name of its start cell.
   * @param orientation Its new orientation.
   * @returns The sentence.
   */
  readonly rotatedAt: (ship: string, cell: string, orientation: string) => string;
  /**
   * After a ship goes back to the dock.
   * @param ship The ship's name.
   * @returns The sentence.
   */
  readonly removed: (ship: string) => string;
  /**
   * After a position is refused, before its reason.
   * @param ship The ship's name.
   * @returns The sentence.
   */
  readonly refused: (ship: string) => string;
  /** Why a position is refused, by the rule it breaks. */
  readonly refusals: Readonly<Record<PlacementViolation, string>>;
  /** After "Randomize". */
  readonly randomized: string;
  /** After a tap on water with no ship selected. */
  readonly noShipSelected: string;
  /** A message for each command failure the view explains; the others get `unexpected`. */
  readonly errors: Readonly<Partial<Record<PlacementCommandError, string>>>;
  /** For any command failure without its own message. */
  readonly unexpected: string;
}

/**
 * English strings of the placement view, in one typed object so that `I18nService` (ADR-0018) can supply them per
 * locale later.
 */
export const PLACEMENT_TEXT: PlacementText = {
  heading: 'Place your fleet',
  boardLabel: 'My fleet',
  dockLabel: 'Your ships',
  shipNames: {
    [SHIP_TYPES.CARRIER]: 'Carrier',
    [SHIP_TYPES.BATTLESHIP]: 'Battleship',
    [SHIP_TYPES.CRUISER]: 'Cruiser',
    [SHIP_TYPES.SUBMARINE]: 'Submarine',
    [SHIP_TYPES.DESTROYER]: 'Destroyer',
  },
  orientations: {
    [ORIENTATIONS.HORIZONTAL]: 'horizontal',
    [ORIENTATIONS.VERTICAL]: 'vertical',
  },
  shipCells: (cells) => `${String(cells)} cells`,
  placed: 'placed',
  timeLeft: (time) => `Time left: ${time}`,
  opponentPlacing: (nickname) => `${nickname} is still placing their fleet.`,
  opponentReady: (nickname) => `${nickname} is ready.`,
  startsIn: (seconds) => `Both fleets are ready. The match starts in ${String(seconds)} s.`,
  selectedShip: (ship) => `${ship} selected`,
  rotate: 'Rotate',
  remove: 'Remove',
  randomize: 'Randomize',
  confirm: 'Confirm fleet',
  confirming: 'Confirming…',
  unlock: 'Unlock fleet',
  unlocking: 'Unlocking…',
  lockedHint: 'Your fleet is locked. Unlock it to make changes.',
  confirmHints: {
    [PLACEMENT_VIOLATIONS.OUT_OF_BOUNDS]: 'A ship lies off the board.',
    [PLACEMENT_VIOLATIONS.DUPLICATE_TYPE]: 'A ship is placed twice.',
    [PLACEMENT_VIOLATIONS.OVERLAP]: 'Two ships overlap.',
    [PLACEMENT_VIOLATIONS.ADJACENT_SHIPS]: 'Two ships touch.',
    [PLACEMENT_VIOLATIONS.INCOMPLETE_FLEET]: 'Place all five ships to confirm your fleet.',
  },
  selected: (ship, orientation, isPlaced) =>
    isPlaced
      ? `${ship} selected. Tap a cell to move it there, or rotate or remove it.`
      : `${ship} selected, ${orientation}. Tap a cell to place it.`,
  placedAt: (ship, cell, orientation) => `${ship} placed at ${cell}, ${orientation}.`,
  rotatedAt: (ship, cell, orientation) => `${ship} turned ${orientation} at ${cell}.`,
  removed: (ship) => `${ship} back in the dock.`,
  refused: (ship) => `The ${ship.toLowerCase()} cannot go there.`,
  refusals: {
    [PLACEMENT_VIOLATIONS.OUT_OF_BOUNDS]: 'It would leave the board.',
    [PLACEMENT_VIOLATIONS.DUPLICATE_TYPE]: 'It is already placed.',
    [PLACEMENT_VIOLATIONS.OVERLAP]: 'Ships may not overlap.',
    [PLACEMENT_VIOLATIONS.ADJACENT_SHIPS]: 'Ships may not touch, not even at the corners.',
    [PLACEMENT_VIOLATIONS.INCOMPLETE_FLEET]: 'The fleet is incomplete.',
  },
  randomized: 'Fleet placed at random. Tap a ship to move it.',
  noShipSelected: 'Pick a ship from the list first.',
  errors: {
    [ERROR_CODES.PLACEMENT_LOCKED]: 'Your fleet is locked. Unlock it to make changes.',
    [ERROR_CODES.INVALID_PLACEMENT]: 'The server refused this layout. Check your ships and try again.',
    [ERROR_CODES.WRONG_PHASE]: 'Placement is over.',
    [ERROR_CODES.RATE_LIMITED]: 'Too many changes at once. Wait a moment and try again.',
    [TRANSPORT_ERRORS.NOT_CONNECTED]: 'Not connected to the server. Your last change was not saved.',
    [TRANSPORT_ERRORS.NO_ACK]: 'The server did not answer. Your last change may not be saved.',
  },
  unexpected: 'Something went wrong. Try again.',
};

/**
 * Words what the last placement action did, for the view's live region.
 * @param feedback What happened.
 * @param text The words to use.
 * @returns The sentence.
 */
export function placementFeedbackMessage(feedback: PlacementFeedback, text: PlacementText = PLACEMENT_TEXT): string {
  switch (feedback.kind) {
    case PLACEMENT_FEEDBACK.SELECTED:
      return text.selected(text.shipNames[feedback.ship], text.orientations[feedback.orientation], feedback.isPlaced);
    case PLACEMENT_FEEDBACK.PLACED:
    case PLACEMENT_FEEDBACK.ROTATED: {
      const { type, start, orientation } = feedback.placement;
      const words = feedback.kind === PLACEMENT_FEEDBACK.PLACED ? text.placedAt : text.rotatedAt;
      return words(text.shipNames[type], formatCoordinate(start), text.orientations[orientation]);
    }
    case PLACEMENT_FEEDBACK.REMOVED:
      return text.removed(text.shipNames[feedback.ship]);
    case PLACEMENT_FEEDBACK.REFUSED:
      return `${text.refused(text.shipNames[feedback.ship])} ${text.refusals[feedback.reason]}`;
    case PLACEMENT_FEEDBACK.RANDOMIZED:
      return text.randomized;
    case PLACEMENT_FEEDBACK.NO_SHIP_SELECTED:
      return text.noShipSelected;
  }
}

/**
 * Explains a failed placement command.
 * @param error Why the command failed.
 * @param text The messages to pick from.
 * @returns The message for that failure, or the generic one.
 */
export function placementErrorMessage(error: PlacementCommandError, text: PlacementText = PLACEMENT_TEXT): string {
  return text.errors[error] ?? text.unexpected;
}
