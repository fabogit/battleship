import { DestroyRef, Service, computed, inject, signal, type Signal } from '@angular/core';
import {
  SERVER_EVENTS,
  type Coordinate,
  type PlacedShip,
  type PlayerStateSnapshot,
  type RoomPhase,
  type Seat,
  type ShotResolvedPayload,
  type ShotResult,
} from '@battleship/core';

import { GameSocketService } from './game-socket';

/**
 * How often running countdowns are recomputed, in ms (ADR-0036): a displayed second is at most this late. Ticks run
 * only while a countdown is running.
 */
export const COUNTDOWN_TICK_MS = 250;

/** One board as the receiver sees it, for the board component. */
export interface BoardView {
  /** Ships drawn on the board: the receiver's own fleet, or the opponent's ships the receiver may see. */
  readonly ships: readonly PlacedShip[];
  /** Shots fired at this board, oldest first. */
  readonly shots: readonly ShotResult[];
}

/** The opponent's board as the receiver knows it (fog-of-war). */
export interface TrackingBoardView extends BoardView {
  /** The receiver's draft targets for the current turn; empty when it is not their turn. */
  readonly draftTargets: readonly Coordinate[];
}

/** A snapshot with the moment it arrived, which every countdown counts from. */
interface SyncedSnapshot {
  /** The latest `STATE`. */
  readonly snapshot: PlayerStateSnapshot;
  /** `performance.now()` when it arrived, in ms. */
  readonly receivedAt: number;
}

/**
 * The battle boards of a room as the receiver last saw them, kept for game over, whose snapshot carries no shots and
 * not the receiver's own fleet (ADR-0058).
 */
interface BattleRecord {
  /** The room the boards belong to. */
  readonly roomId: string;
  /** The receiver's seat, to tell their shots from the opponent's. */
  readonly seat: Seat;
  /** The receiver's fleet. */
  readonly myShips: readonly PlacedShip[];
  /** The opponent's shots on the receiver's board, oldest first. */
  readonly incomingShots: readonly ShotResult[];
  /** The receiver's shots on the opponent's board, oldest first. */
  readonly outgoingShots: readonly ShotResult[];
}

/** Where a countdown reads its remaining time in a snapshot. */
interface CountdownSource {
  /**
   * Reads the remaining time.
   * @param snapshot The snapshot it was sent in.
   * @returns Remaining ms when the server sent the snapshot, or `null` when this countdown does not apply.
   */
  readonly remainingMs: (snapshot: PlayerStateSnapshot) => number | null;
  /**
   * Tells whether the server holds this countdown still.
   * @param snapshot The snapshot it was sent in.
   * @returns Whether the remaining time stays as sent.
   */
  readonly isFrozen: (snapshot: PlayerStateSnapshot) => boolean;
}

/** The current turn; frozen while the match is paused (docs/server.md#disconnection--pause-in_progress). */
const TURN: CountdownSource = {
  remainingMs: (snapshot) => snapshot.battle?.turnRemainingMs ?? null,
  isFrozen: (snapshot) => snapshot.battle?.isPaused === true,
};

/** The placement deadline. */
const PLACEMENT: CountdownSource = {
  remainingMs: (snapshot) => snapshot.placement?.remainingMs ?? null,
  isFrozen: () => false,
};

/** The start countdown, while both fleets are confirmed. */
const START: CountdownSource = {
  remainingMs: (snapshot) => snapshot.placement?.startCountdownMs ?? null,
  isFrozen: () => false,
};

/** The opponent's forfeit clock while they are disconnected; it runs regardless of pause. */
const OPPONENT_FORFEIT: CountdownSource = {
  remainingMs: (snapshot) => snapshot.opponent?.forfeitRemainingMs ?? null,
  isFrozen: () => false,
};

/** Every countdown, to find the longest one still running after a snapshot. */
const COUNTDOWNS: readonly CountdownSource[] = [TURN, PLACEMENT, START, OPPONENT_FORFEIT];

/**
 * Holds the latest `STATE` snapshot, the client's single source of truth, and derives what the views need from it
 * (docs/client.md#reactive-model). Timers come as remaining ms; local countdowns tick from there and re-sync on every
 * snapshot (ADR-0036).
 */
@Service()
export class GameStateService {
  /** The latest snapshot with its arrival time; written only by `apply` and `clear`. */
  private readonly synced = signal<SyncedSnapshot | null>(null);
  /** `performance.now()` at the latest tick or snapshot, in ms; what the countdowns are computed against. */
  private readonly now = signal(0);
  /** The interval refreshing `now`; set only while a countdown is running. */
  private ticker: ReturnType<typeof setInterval> | undefined;

  /**
   * The latest battle boards of the snapshot's room, plus the shots of every `SHOT_RESOLVED` since (ADR-0058); `null`
   * before the room's battle and once the room moves to another phase than `GAME_OVER`.
   */
  private readonly battleRecord = signal<BattleRecord | null>(null);

  /** The latest snapshot; `null` before the first `STATE` and after `clear()`. */
  readonly snapshot = computed(() => this.synced()?.snapshot ?? null);

  /** The room's phase; `null` without a snapshot. */
  readonly phase = computed<RoomPhase | null>(() => this.snapshot()?.phase ?? null);

  /** Whether the current turn is the receiver's, dice animation and pause included. */
  readonly isMyTurn = computed(() => {
    const snapshot = this.snapshot();
    return snapshot?.battle ? snapshot.battle.currentTurn === snapshot.me.seat : false;
  });

  /**
   * The receiver's board: their ships, and in battle and at game over the opponent's shots on them. At game over it
   * comes from the battle record (ADR-0058), so it is `null` when this client did not see the room's battle; `null`
   * in the other phases too.
   */
  readonly myFleet = computed<BoardView | null>(() => {
    const snapshot = this.snapshot();
    if (snapshot?.placement) {
      return { ships: snapshot.placement.myShips, shots: [] };
    }
    if (snapshot?.battle) {
      return { ships: snapshot.battle.myShips, shots: snapshot.battle.incomingShots };
    }
    const record = this.recordOf(snapshot);
    if (snapshot?.gameOver && record !== null) {
      return { ships: record.myShips, shots: record.incomingShots };
    }
    return null;
  });

  /**
   * The opponent's board: in battle the receiver's shots, the ships they sank and their draft; at game over the
   * revealed fleet under the receiver's shots from the battle record (ADR-0058), or without shots when this client did
   * not see the room's battle. `null` in the other phases.
   */
  readonly trackingBoard = computed<TrackingBoardView | null>(() => {
    const snapshot = this.snapshot();
    if (snapshot?.battle) {
      const shots = snapshot.battle.outgoingShots;
      return {
        ships: shots.flatMap((shot) => (shot.sunkShip ? [shot.sunkShip] : [])),
        shots,
        draftTargets: snapshot.battle.myDraftTargets,
      };
    }
    if (snapshot?.gameOver) {
      const shots = this.recordOf(snapshot)?.outgoingShots ?? [];
      return { ships: snapshot.gameOver.opponentShips, shots, draftTargets: [] };
    }
    return null;
  });

  /** Whether `SET_PAUSED { isPaused: true }` would be accepted: a running match with the opponent disconnected. */
  readonly canPause = computed(() => this.isOpponentAway() && this.snapshot()?.battle?.isPaused === false);

  /** Whether `SET_PAUSED { isPaused: false }` would be accepted: a paused match with the opponent disconnected. */
  readonly canResume = computed(() => this.isOpponentAway() && this.snapshot()?.battle?.isPaused === true);

  /** Whether the receiver won; `null` until game over, `false` for a match without a winner (`ABANDONED`). */
  readonly hasWon = computed(() => {
    const snapshot = this.snapshot();
    return snapshot?.gameOver ? snapshot.gameOver.winner === snapshot.me.seat : null;
  });

  /** Time left in the current turn, in ms; frozen while paused, `null` outside battle and during the dice animation. */
  readonly turnRemainingMs = this.countdown(TURN);

  /** Time left before unconfirmed fleets are completed and locked, in ms; `null` outside placement. */
  readonly placementRemainingMs = this.countdown(PLACEMENT);

  /** Time left before the match starts, in ms; `null` unless both fleets are confirmed. */
  readonly startCountdownMs = this.countdown(START);

  /** Time left before the disconnected opponent forfeits their seat, in ms; `null` while they are connected. */
  readonly opponentForfeitRemainingMs = this.countdown(OPPONENT_FORFEIT);

  /**
   * Applies every `STATE` from the socket, and the shots of every `SHOT_RESOLVED` to the battle record; stops
   * listening and ticking with the injector.
   */
  constructor() {
    const socket = inject(GameSocketService);
    const stopListening = [
      socket.on(SERVER_EVENTS.STATE, (snapshot) => {
        this.apply(snapshot);
      }),
      socket.on(SERVER_EVENTS.SHOT_RESOLVED, (payload) => {
        this.record(payload);
      }),
    ];
    inject(DestroyRef).onDestroy(() => {
      for (const stop of stopListening) {
        stop();
      }
      this.stopTicking();
    });
  }

  /**
   * Forgets the snapshot and the battle record and stops the countdowns, e.g. after leaving the room; the next `STATE`
   * starts over.
   */
  clear(): void {
    this.stopTicking();
    this.synced.set(null);
    this.battleRecord.set(null);
  }

  /**
   * Stores a snapshot and re-syncs every countdown to its remaining times. Ticks every `COUNTDOWN_TICK_MS` until the
   * longest running countdown reaches zero.
   * @param snapshot The `STATE` just received.
   */
  private apply(snapshot: PlayerStateSnapshot): void {
    const receivedAt = performance.now();
    this.stopTicking();
    this.now.set(receivedAt);
    this.synced.set({ snapshot, receivedAt });
    if (snapshot.battle) {
      const { myShips, incomingShots, outgoingShots } = snapshot.battle;
      this.battleRecord.set({ roomId: snapshot.roomId, seat: snapshot.me.seat, myShips, incomingShots, outgoingShots });
    } else if (snapshot.gameOver === null || this.battleRecord()?.roomId !== snapshot.roomId) {
      this.battleRecord.set(null);
    }

    const longestMs = Math.max(
      0,
      ...COUNTDOWNS.filter((source) => !source.isFrozen(snapshot)).map((source) => source.remainingMs(snapshot) ?? 0),
    );
    if (longestMs > 0) {
      this.ticker = setInterval(() => {
        const now = performance.now();
        this.now.set(now);
        if (now - receivedAt >= longestMs) {
          this.stopTicking();
        }
      }, COUNTDOWN_TICK_MS);
    }
  }

  /**
   * Adds a fired turn to the battle record, so the board at game over includes the shot that ended the match: it
   * arrives after the last battle `STATE` (ADR-0047). The next battle `STATE` replaces the record, shots included.
   * @param payload The `SHOT_RESOLVED` just received.
   */
  private record({ shooter, results }: ShotResolvedPayload): void {
    this.battleRecord.update((record) => {
      if (record === null) {
        return null;
      }
      return shooter === record.seat
        ? { ...record, outgoingShots: [...record.outgoingShots, ...results] }
        : { ...record, incomingShots: [...record.incomingShots, ...results] };
    });
  }

  /**
   * Reads the battle record of a snapshot's room.
   * @param snapshot The latest snapshot.
   * @returns The record, or `null` when there is none for that room.
   */
  private recordOf(snapshot: PlayerStateSnapshot | null): BattleRecord | null {
    const record = this.battleRecord();
    return record !== null && record.roomId === snapshot?.roomId ? record : null;
  }

  /** Clears the tick interval, if any. */
  private stopTicking(): void {
    clearInterval(this.ticker);
    this.ticker = undefined;
  }

  /**
   * Builds a countdown signal: the remaining time sent in the snapshot minus the time elapsed since it arrived, never
   * below zero; held still while the source is frozen.
   * @param source Where the remaining time is read.
   * @returns Remaining ms, or `null` when the countdown does not apply.
   */
  private countdown(source: CountdownSource): Signal<number | null> {
    return computed(() => {
      const synced = this.synced();
      const remainingMs = synced === null ? null : source.remainingMs(synced.snapshot);
      if (synced === null || remainingMs === null) {
        return null;
      }
      if (source.isFrozen(synced.snapshot)) {
        return remainingMs;
      }
      return Math.max(0, remainingMs - (this.now() - synced.receivedAt));
    });
  }

  /**
   * Tells whether the opponent is seated but disconnected during a match, when `SET_PAUSED` is allowed.
   * @returns Whether the receiver may pause or resume.
   */
  private isOpponentAway(): boolean {
    const snapshot = this.snapshot();
    return snapshot?.battle ? snapshot.opponent?.isConnected === false : false;
  }
}
