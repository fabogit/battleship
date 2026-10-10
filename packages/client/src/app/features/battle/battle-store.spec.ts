import { TestBed } from '@angular/core/testing';
import {
  CLIENT_EVENTS,
  ERROR_CODES,
  SEATS,
  SERVER_EVENTS,
  SHOT_OUTCOMES,
  TARGET_VIOLATIONS,
  type BattleSnapshot,
  type ShotResult,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeGameSocket, battleSnapshot, provideFakeGameSocket } from '../../../testing/fake-game-socket';
import { TRANSPORT_ERRORS, type CommandResult } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { BATTLE_FEEDBACK, BattleStore } from './battle-store';

const ROOM_ID = 'ab23cd45';
const B7 = { x: 6, y: 1 };
const C3 = { x: 2, y: 2 };
const MISS_ON_J10: ShotResult = { coordinate: { x: 9, y: 9 }, outcome: SHOT_OUTCOMES.MISS };

let socket: FakeGameSocket;
let store: BattleStore;

/**
 * Delivers a battle snapshot, as the server sends it after every change.
 * @param battle Fields of the `IN_PROGRESS` part to override.
 */
function receive(battle: Partial<BattleSnapshot> = {}): void {
  socket.fire(SERVER_EVENTS.STATE, battleSnapshot(ROOM_ID, battle));
}

/**
 * Makes the next command wait until the test answers it.
 * @returns Resolves the command with its reply.
 */
function holdNextReply(): (result: CommandResult<typeof CLIENT_EVENTS.UPDATE_TARGETS>) => void {
  let answer: (result: CommandResult<typeof CLIENT_EVENTS.UPDATE_TARGETS>) => void = () => undefined;
  socket.emitWithAck.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  return answer;
}

/**
 * Lists the payloads sent with one command.
 * @param event The command.
 * @returns Their targets, oldest first.
 */
function sent(event: typeof CLIENT_EVENTS.UPDATE_TARGETS | typeof CLIENT_EVENTS.FIRE): unknown[] {
  return socket.emitWithAck.mock.calls
    .filter(([name]) => name === event)
    .map(([, payload]) => (payload as { targets: unknown }).targets);
}

/** Lets pending acks resolve. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Creates the store once the room is in battle, as the view does.
 * @param battle Fields of the first snapshot's `IN_PROGRESS` part.
 */
function createStore(battle: Partial<BattleSnapshot> = {}): void {
  TestBed.inject(GameStateService);
  receive(battle);
  store = TestBed.inject(BattleStore);
}

beforeEach(() => {
  socket = new FakeGameSocket();
  socket.emitWithAck.mockResolvedValue({ ok: true });
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket), BattleStore] });
});

afterEach(() => {
  TestBed.inject(GameStateService).clear();
});

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('BATTLE_FEEDBACK', () => {
  it('pins the values', () => {
    expect(Object.values(BATTLE_FEEDBACK)).toEqual(['targeted', 'untargeted', 'refused', 'fired']);
  });
});

describe('BattleStore', () => {
  it("starts from the server's draft", () => {
    createStore({ myDraftTargets: [B7] });

    expect(store.draftTargets()).toEqual([B7]);
    expect(store.canFire()).toBe(true);
  });

  describe('aiming', () => {
    beforeEach(() => {
      createStore({ outgoingShots: [MISS_ON_J10] });
    });

    it('puts a tapped cell in the draft and sends the whole draft', () => {
      store.activateCell(B7);

      expect(store.draftTargets()).toEqual([B7]);
      expect(sent(CLIENT_EVENTS.UPDATE_TARGETS)).toStrictEqual([[B7]]);
      expect(store.feedback()).toEqual({ kind: BATTLE_FEEDBACK.TARGETED, coordinate: B7 });
      expect(store.canFire()).toBe(true);
    });

    it('moves the target with the next tap, and clears it with a tap on the target', () => {
      store.activateCell(B7);
      store.activateCell(C3);
      expect(store.draftTargets()).toEqual([C3]);

      store.activateCell(C3);

      expect(store.draftTargets()).toEqual([]);
      expect(sent(CLIENT_EVENTS.UPDATE_TARGETS)).toStrictEqual([[B7], [C3], []]);
      expect(store.feedback()).toEqual({ kind: BATTLE_FEEDBACK.UNTARGETED, coordinate: C3 });
      expect(store.canFire()).toBe(false);
    });

    it('refuses a cell already shot without sending anything', () => {
      store.activateCell(MISS_ON_J10.coordinate);

      expect(store.draftTargets()).toEqual([]);
      expect(socket.emitWithAck).not.toHaveBeenCalled();
      expect(store.feedback()).toEqual({
        kind: BATTLE_FEEDBACK.REFUSED,
        coordinate: MISS_ON_J10.coordinate,
        reason: TARGET_VIOLATIONS.ALREADY_TARGETED,
        shotsAllowed: 1,
      });
    });

    it('keeps the local draft over a STATE sent while an update waits for its ack', async () => {
      const answer = holdNextReply();
      store.activateCell(B7);

      receive({ outgoingShots: [MISS_ON_J10], myDraftTargets: [] });
      expect(store.draftTargets()).toEqual([B7]);

      answer({ ok: true });
      await settle();
      receive({ outgoingShots: [MISS_ON_J10], myDraftTargets: [C3] });
      expect(store.draftTargets()).toEqual([C3]);
    });

    it("puts back the server's draft after a failed update", async () => {
      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: TRANSPORT_ERRORS.NO_ACK });

      store.activateCell(B7);
      await settle();

      expect(store.draftTargets()).toEqual([]);
      expect(store.error()).toBe(TRANSPORT_ERRORS.NO_ACK);
    });
  });

  describe("during the opponent's turn", () => {
    beforeEach(() => {
      createStore({ currentTurn: SEATS.P2 });
    });

    it('ignores taps and has no draft', () => {
      store.activateCell(B7);

      expect(store.canTarget()).toBe(false);
      expect(store.draftTargets()).toEqual([]);
      expect(socket.emitWithAck).not.toHaveBeenCalled();
    });
  });

  describe('firing', () => {
    beforeEach(() => {
      createStore();
    });

    it('does nothing before a target is picked', async () => {
      await store.fire();

      expect(sent(CLIENT_EVENTS.FIRE)).toEqual([]);
    });

    it('fires the draft and blocks the board until the ack', async () => {
      store.activateCell(B7);
      const answer = holdNextReply();

      const firing = store.fire();

      expect(sent(CLIENT_EVENTS.FIRE)).toStrictEqual([[B7]]);
      expect(store.isFiring()).toBe(true);
      expect(store.canTarget()).toBe(false);
      expect(store.canFire()).toBe(false);
      answer({ ok: true });
      await firing;
      expect(store.isFiring()).toBe(false);
      expect(store.error()).toBeNull();
    });

    it('keeps the draft and says why when the shot is refused', async () => {
      store.activateCell(B7);
      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: ERROR_CODES.NOT_YOUR_TURN });

      await store.fire();

      expect(store.error()).toBe(ERROR_CODES.NOT_YOUR_TURN);
      expect(store.draftTargets()).toEqual([B7]);
    });

    it('announces every fired turn, by either player', () => {
      const results = [MISS_ON_J10];

      socket.fire(SERVER_EVENTS.SHOT_RESOLVED, { shooter: SEATS.P1, results });
      expect(store.feedback()).toEqual({ kind: BATTLE_FEEDBACK.FIRED, isMine: true, results });

      socket.fire(SERVER_EVENTS.SHOT_RESOLVED, { shooter: SEATS.P2, results });
      expect(store.feedback()).toEqual({ kind: BATTLE_FEEDBACK.FIRED, isMine: false, results });
    });

    it('drops the draft when the turn passes', () => {
      store.activateCell(B7);

      receive({ currentTurn: SEATS.P2, outgoingShots: [{ coordinate: B7, outcome: SHOT_OUTCOMES.MISS }] });

      expect(store.draftTargets()).toEqual([]);
    });
  });
});
