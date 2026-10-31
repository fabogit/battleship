// Per-player projection of a room into the `STATE` snapshot (docs/protocol.md#snapshot, ADR-0038).

import {
  otherSeat,
  ROOM_PHASES,
  shotsAllowed,
  type BattleSnapshot,
  type GameOverSnapshot,
  type PerPlayer,
  type PlacementSnapshot,
  type PlayerStateSnapshot,
  type PlayerView,
  type Seat,
} from '@battleship/core';

import { forfeitDeadline } from './presence.js';
import {
  turnTimerEndsAt,
  type BattleRoom,
  type GameOverRoom,
  type PlacementRoom,
  type RoomPlayer,
  type RoomState,
} from './room.js';

/**
 * Builds what one seated player may see of a room. Fog-of-war: the opponent's fleet appears only as the receiver's own
 * shots (with `sunkShip` on each sinking shot) until `GAME_OVER`, which reveals it next to both final boards. Secrets
 * are never included.
 * @param state The room, in any phase.
 * @param seat The receiver; must be seated.
 * @param now Current time in epoch ms; stored deadlines become remaining milliseconds.
 * @returns The receiver's snapshot; it shares the room's arrays, which nothing mutates.
 * @throws When `seat` is empty, which only a caller bug can cause.
 */
export function projectSnapshot(state: RoomState, seat: Seat, now: number): PlayerStateSnapshot {
  const me = state.players[seat];
  if (me === null) {
    throw new Error(`Seat ${seat} of room ${state.roomId} is empty`);
  }
  const opponentSeat = otherSeat(seat);
  const opponent = state.players[opponentSeat];
  return {
    roomId: state.roomId,
    phase: state.phase,
    me: toPlayerView(state, seat, me, now),
    opponent: opponent === null ? null : toPlayerView(state, opponentSeat, opponent, now),
    rules: state.rules,
    rulesVersion: state.rulesVersion,
    hasConfirmedRules: toRulesConfirmations(state, seat),
    placement: state.phase === ROOM_PHASES.PLACEMENT ? toPlacementSnapshot(state, seat, now) : null,
    battle: state.phase === ROOM_PHASES.IN_PROGRESS ? toBattleSnapshot(state, seat, now) : null,
    gameOver: state.phase === ROOM_PHASES.GAME_OVER ? toGameOverSnapshot(state, seat) : null,
  };
}

/**
 * Shows a seated player without their secret, with their presence (docs/server.md#seat-presence).
 * @param state The room, for the seat's presence and the phase.
 * @param seat Where the player sits: `RoomPlayer` does not store it, `players` is keyed by it.
 * @param player The server's record of the player, secret included.
 * @param now Current time in epoch ms.
 * @returns The public view. `forfeitRemainingMs` is set while the player is away, except in `GAME_OVER`, where nothing
 * is forfeited any more.
 */
function toPlayerView(state: RoomState, seat: Seat, player: RoomPlayer, now: number): PlayerView {
  const deadline = forfeitDeadline(state, seat);
  return {
    seat,
    nickname: player.nickname,
    isConnected: state.disconnectedAt[seat] === null,
    forfeitRemainingMs: deadline === null ? null : Math.max(0, deadline - now),
  };
}

/**
 * Shows who confirmed the current rules (ADR-0003): the room's flags during negotiation; before it nobody has, and every
 * phase after it was reached by both confirming.
 * @param state The room, in any phase.
 * @param seat The receiver.
 * @returns `me` and `opponent` as the receiver sees them.
 */
function toRulesConfirmations(state: RoomState, seat: Seat): PerPlayer<boolean> {
  switch (state.phase) {
    case ROOM_PHASES.WAITING_FOR_OPPONENT:
      return { me: false, opponent: false };
    case ROOM_PHASES.RULES_NEGOTIATION:
      return { me: state.hasConfirmedRules[seat], opponent: state.hasConfirmedRules[otherSeat(seat)] };
    case ROOM_PHASES.PLACEMENT:
    case ROOM_PHASES.IN_PROGRESS:
    case ROOM_PHASES.GAME_OVER:
      return { me: true, opponent: true };
  }
}

/**
 * Builds the `PLACEMENT` part: the receiver's own fleet only, both confirmation flags, and the time left before the
 * deadline and, while both fleets are confirmed, before the start countdown ends (ADR-0090).
 * @param state The room in `PLACEMENT`.
 * @param seat The receiver.
 * @param now Current time in epoch ms; a reconnecting player gets the times left at that moment.
 * @returns The placement part.
 */
function toPlacementSnapshot(state: PlacementRoom, seat: Seat, now: number): PlacementSnapshot {
  return {
    myShips: state.fleets[seat].ships,
    hasConfirmed: { me: state.fleets[seat].hasConfirmed, opponent: state.fleets[otherSeat(seat)].hasConfirmed },
    remainingMs: Math.max(0, state.deadline - now),
    startCountdownMs: state.countdownEndsAt === null ? null : Math.max(0, state.countdownEndsAt - now),
  };
}

/**
 * Builds the `IN_PROGRESS` part: the receiver's own board with the shots it took, and only the receiver's shots on the
 * opponent's board (ADR-0034), never the opponent's ships.
 * @param state The room in `IN_PROGRESS`.
 * @param seat The receiver.
 * @param now Current time in epoch ms; a reconnecting player gets the turn time left at that moment.
 * @returns The battle part, with both AFK counts and the turn time left (`turnRemaining`).
 */
function toBattleSnapshot(state: BattleRoom, seat: Seat, now: number): BattleSnapshot {
  const { boards, currentTurn } = state.battle;
  const opponentSeat = otherSeat(seat);
  return {
    myShips: boards[seat].ships,
    incomingShots: boards[seat].shots,
    outgoingShots: boards[opponentSeat].shots,
    currentTurn,
    shotsAllowed: shotsAllowed(state.battle, state.rules),
    myDraftTargets: seat === currentTurn ? state.draftTargets : [],
    turnRemainingMs: turnRemaining(state, now),
    isPaused: state.isPaused,
    afkCount: { me: state.afkCount[seat], opponent: state.afkCount[opponentSeat] },
  };
}

/**
 * The time left in the current turn (ADR-0099): `null` before its timer starts, while the dice animation plays
 * (ADR-0093); the frozen time while the match is paused; the time to `turnTimerEndsAt` otherwise.
 * @param state The room in `IN_PROGRESS`.
 * @param now Current time in epoch ms.
 * @returns Remaining ms, never below zero, or `null`.
 */
function turnRemaining(state: BattleRoom, now: number): number | null {
  if (now < state.turnTimerStartsAt) {
    return null;
  }
  return state.isPaused ? state.turnTimeLeftMs : Math.max(0, turnTimerEndsAt(state) - now);
}

/**
 * Builds the `GAME_OVER` part: both final boards, as the battle part shows them, plus the opponent's whole fleet, now
 * revealed (ADR-0064).
 * @param state The room in `GAME_OVER`.
 * @param seat The receiver.
 * @returns The game-over part. Rematch choices stay `null` until the rematch flow lands (#36).
 */
function toGameOverSnapshot(state: GameOverRoom, seat: Seat): GameOverSnapshot {
  const { boards } = state.battle;
  const opponentSeat = otherSeat(seat);
  return {
    winner: state.winner,
    reason: state.reason,
    myShips: boards[seat].ships,
    incomingShots: boards[seat].shots,
    outgoingShots: boards[opponentSeat].shots,
    opponentShips: boards[opponentSeat].ships,
    rematch: { me: null, opponent: null },
  };
}
