// Per-player projection of a room into the `STATE` snapshot (docs/protocol.md#snapshot, ADR-0038).

import {
  shotsAllowed,
  type BattleSnapshot,
  type GameOverSnapshot,
  type PlacementSnapshot,
  type PlayerStateSnapshot,
  type PlayerView,
  type Seat,
} from '@battleship/core';

import {
  otherSeat,
  type BattleRoom,
  type GameOverRoom,
  type PlacementRoom,
  type RoomPlayer,
  type RoomState,
} from './room.js';

/**
 * Builds what one seated player may see of a room. Fog-of-war: the opponent's fleet appears only as the receiver's own
 * shots (with `sunkShip` on each sinking shot) until `GAME_OVER`, which reveals it. Secrets are never included.
 * @param state The room.
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
  // Rules are fixed until negotiation lands (#26): every phase past it counts as both players having confirmed them.
  const haveRulesBeenAgreed = state.phase !== 'WAITING_FOR_OPPONENT';
  return {
    roomId: state.roomId,
    phase: state.phase,
    me: toPlayerView(seat, me),
    opponent: opponent === null ? null : toPlayerView(opponentSeat, opponent),
    rules: state.rules,
    rulesVersion: state.rulesVersion,
    hasConfirmedRules: { me: haveRulesBeenAgreed, opponent: haveRulesBeenAgreed },
    placement: state.phase === 'PLACEMENT' ? toPlacementSnapshot(state, seat, now) : null,
    battle: state.phase === 'IN_PROGRESS' ? toBattleSnapshot(state, seat) : null,
    gameOver: state.phase === 'GAME_OVER' ? toGameOverSnapshot(state, seat) : null,
  };
}

/**
 * Shows a seated player without their secret.
 * @param seat The player's seat.
 * @param player The player.
 * @returns The public view. Every seated player counts as connected until disconnections are tracked (#23).
 */
function toPlayerView(seat: Seat, player: RoomPlayer): PlayerView {
  return { seat, nickname: player.nickname, isConnected: true, forfeitRemainingMs: null };
}

/**
 * Builds the `PLACEMENT` part: the receiver's own fleet only, and both confirmation flags.
 * @param state The room in `PLACEMENT`.
 * @param seat The receiver.
 * @param now Current time in epoch ms.
 * @returns The placement part. `startCountdownMs` stays `null` until the start countdown lands (#28).
 */
function toPlacementSnapshot(state: PlacementRoom, seat: Seat, now: number): PlacementSnapshot {
  return {
    myShips: state.fleets[seat].ships,
    hasConfirmed: { me: state.fleets[seat].hasConfirmed, opponent: state.fleets[otherSeat(seat)].hasConfirmed },
    remainingMs: Math.max(0, state.deadline - now),
    startCountdownMs: null,
  };
}

/**
 * Builds the `IN_PROGRESS` part: the receiver's own board with the shots it took, and only the receiver's shots on the
 * opponent's board (ADR-0034), never the opponent's ships.
 * @param state The room in `IN_PROGRESS`.
 * @param seat The receiver.
 * @returns The battle part. `turnRemainingMs` stays `null` and `afkCount` zero until the turn timer lands (#30).
 */
function toBattleSnapshot(state: BattleRoom, seat: Seat): BattleSnapshot {
  const { boards, currentTurn } = state.battle;
  return {
    myShips: boards[seat].ships,
    incomingShots: boards[seat].shots,
    outgoingShots: boards[otherSeat(seat)].shots,
    currentTurn,
    shotsAllowed: shotsAllowed(state.battle, state.rules),
    myDraftTargets: seat === currentTurn ? state.draftTargets : [],
    turnRemainingMs: null,
    isPaused: false,
    afkCount: { me: 0, opponent: 0 },
  };
}

/**
 * Builds the `GAME_OVER` part, which reveals the opponent's whole fleet.
 * @param state The room in `GAME_OVER`.
 * @param seat The receiver.
 * @returns The game-over part. Rematch choices stay `null` until the rematch flow lands (#36).
 */
function toGameOverSnapshot(state: GameOverRoom, seat: Seat): GameOverSnapshot {
  return {
    winner: state.winner,
    reason: state.reason,
    opponentShips: state.battle.boards[otherSeat(seat)].ships,
    rematch: { me: null, opponent: null },
  };
}
