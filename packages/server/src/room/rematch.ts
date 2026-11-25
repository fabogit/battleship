// `REMATCH_CHOICE` as a pure transition (docs/server.md#game-over--rematch, ADR-0123): a choice to play again is kept
// until the rematch resolves, and `LEAVE` frees the seat as `LEAVE_ROOM` does at game over.

import { ERROR_CODES, REMATCH_CHOICES, ROOM_PHASES, type RematchChoice, type Seat } from '@battleship/core';

import { leaveGameOver } from './presence.js';
import {
  recordRematchChoice,
  type RejectedTransition,
  type RematchRoom,
  type RoomState,
  type WaitingRoom,
} from './room.js';

/** An accepted choice to play again: the seat stays, and the room is still in `GAME_OVER` or the phase it resolved into. */
export interface RematchChoiceKept {
  /** Discriminant: the ack reports success. */
  readonly ok: true;
  /** Whether the sender's seat was freed: never for a choice to play again. */
  readonly hasLeft: false;
  /** The room after the choice; the same object when the choice was already in place. */
  readonly state: RematchRoom;
}

/** An accepted `LEAVE`: the sender's seat is freed, and the other player waits for someone new. */
export interface RematchLeft {
  /** Discriminant: the ack reports success. */
  readonly ok: true;
  /** Whether the sender's seat was freed: always for `LEAVE`. */
  readonly hasLeft: true;
  /** The room the player left behind waits in. */
  readonly state: WaitingRoom;
}

/** An accepted `REMATCH_CHOICE`. */
export type RematchChosen = RematchChoiceKept | RematchLeft;

/**
 * Applies a seat's `REMATCH_CHOICE`. `SAME_RULES` and `CHANGE_RULES` are kept until the rematch resolves
 * (`recordRematchChoice`, ADR-0124); `LEAVE` frees the seat at once, with the same result as `LEAVE_ROOM` at game over
 * (ADR-0123). Pure: the input is never mutated.
 * @param state The sender's room.
 * @param seat The sender's seat.
 * @param choice The choice, as the guard returned it.
 * @param now Current time in epoch ms; a placement the rematch starts counts its deadline from it.
 * @returns The room after the choice, with whether the seat was freed, or `WRONG_PHASE` outside `GAME_OVER`, `LEAVE`
 * included: a choice that arrives after the rematch resolved, or after the other player left, never frees a seat.
 */
export function chooseRematch(
  state: RoomState,
  seat: Seat,
  choice: RematchChoice,
  now: number,
): RematchChosen | RejectedTransition {
  if (state.phase !== ROOM_PHASES.GAME_OVER) {
    return { ok: false, error: ERROR_CODES.WRONG_PHASE };
  }
  if (choice === REMATCH_CHOICES.LEAVE) {
    return { ok: true, hasLeft: true, state: leaveGameOver(state, seat) };
  }
  return { ok: true, hasLeft: false, state: recordRematchChoice(state, seat, choice, now) };
}
