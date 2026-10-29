import { TestBed } from '@angular/core/testing';
import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  ERROR_CODES,
  PAYLOAD_PARSERS,
  SERVER_EVENTS,
  TIMEOUT_ACTIONS,
  type GameRules,
  type PlayerStateSnapshot,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FakeGameSocket,
  negotiationSnapshot,
  placementSnapshot,
  provideFakeGameSocket,
} from '../../../testing/fake-game-socket';
import { createRoomId } from '../../../testing/session-fixtures';
import { TRANSPORT_ERRORS, type CommandResult } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { RULES_EDITORS, RULES_NOTICE_KINDS, RulesStore, TURN_TIME_LIMIT_OPTIONS, areSameRules } from './rules-store';

const ROOM_ID = createRoomId(0);

let socket: FakeGameSocket;
let store: RulesStore;

/**
 * Delivers a negotiation snapshot, as the server sends it after every change.
 * @param negotiation The rules, their version or the confirmations to override.
 */
function receive(negotiation: Parameters<typeof negotiationSnapshot>[1] = {}): void {
  socket.fire(SERVER_EVENTS.STATE, negotiationSnapshot(ROOM_ID, negotiation));
}

/**
 * Makes the next command wait until the test answers it.
 * @returns Resolves the command with its reply.
 */
function holdNextReply(): (result: CommandResult<typeof CLIENT_EVENTS.UPDATE_RULES>) => void {
  let answer: (result: CommandResult<typeof CLIENT_EVENTS.UPDATE_RULES>) => void = () => undefined;
  socket.emitWithAck.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  return answer;
}

/** @returns The rules of every `UPDATE_RULES` sent so far, oldest first. */
function sentRules(): unknown[] {
  return socket.emitWithAck.mock.calls
    .filter(([event]) => event === CLIENT_EVENTS.UPDATE_RULES)
    .map(([, payload]) => (payload as { rules: unknown }).rules);
}

/** @returns The versions of every `CONFIRM_RULES` sent so far, oldest first. */
function sentConfirmations(): unknown[] {
  return socket.emitWithAck.mock.calls
    .filter(([event]) => event === CLIENT_EVENTS.CONFIRM_RULES)
    .map(([, payload]) => (payload as { rulesVersion: unknown }).rulesVersion);
}

/** Lets pending acks resolve. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Creates the store once the room negotiates, as the view does.
 * @param negotiation The first snapshot's rules, version or confirmations.
 */
function createStore(negotiation: Parameters<typeof negotiationSnapshot>[1] = {}): void {
  TestBed.inject(GameStateService);
  receive(negotiation);
  store = TestBed.inject(RulesStore);
}

beforeEach(() => {
  socket = new FakeGameSocket();
  socket.emitWithAck.mockResolvedValue({ ok: true });
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket), RulesStore] });
});

afterEach(() => {
  TestBed.inject(GameStateService).clear();
});

describe('TURN_TIME_LIMIT_OPTIONS', () => {
  it("lists exactly the limits core's UPDATE_RULES guard accepts, shortest first", () => {
    const accepted = Array.from({ length: 301 }, (_, seconds) => seconds).filter(
      (seconds) =>
        PAYLOAD_PARSERS.UPDATE_RULES({ rules: { ...DEFAULT_RULES, turnTimeLimitSeconds: seconds } }) !== null,
    );

    expect(TURN_TIME_LIMIT_OPTIONS).toEqual(accepted);
  });
});

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('RULES_EDITORS and RULES_NOTICE_KINDS', () => {
  it('pin the values', () => {
    expect(Object.values(RULES_EDITORS)).toEqual(['me', 'opponent']);
    expect(Object.values(RULES_NOTICE_KINDS)).toEqual(['changed', 'opponent-confirmed']);
  });
});

describe('areSameRules', () => {
  it('compares every field', () => {
    expect(areSameRules(DEFAULT_RULES, { ...DEFAULT_RULES })).toBe(true);
    for (const change of [
      { isExtraTurnOnHitEnabled: true },
      { areAdjacentShipsAllowed: true },
      { turnTimeLimitSeconds: 60 },
      { isSalvoModeEnabled: true },
      { timeoutAction: TIMEOUT_ACTIONS.PASS_TURN },
    ] satisfies Partial<GameRules>[]) {
      expect(areSameRules(DEFAULT_RULES, { ...DEFAULT_RULES, ...change })).toBe(false);
    }
  });
});

describe('RulesStore', () => {
  describe('state', () => {
    it("reflects the snapshot's rules, version and confirmations", () => {
      const rules: GameRules = { ...DEFAULT_RULES, areAdjacentShipsAllowed: true, turnTimeLimitSeconds: 120 };
      createStore({ rules, rulesVersion: 4, hasConfirmedRules: { me: false, opponent: true } });

      expect(store.rules()).toEqual(rules);
      expect(store.rulesVersion()).toBe(4);
      expect(store.hasConfirmed()).toEqual({ me: false, opponent: true });
      expect(store.canConfirm()).toBe(true);
    });

    it('follows every later snapshot', () => {
      createStore();

      receive({ rules: { ...DEFAULT_RULES, timeoutAction: TIMEOUT_ACTIONS.PASS_TURN }, rulesVersion: 1 });

      expect(store.rules().timeoutAction).toBe(TIMEOUT_ACTIONS.PASS_TURN);
      expect(store.rulesVersion()).toBe(1);
    });
  });

  describe('editing (ADR-0086)', () => {
    it('sends the whole rules with the change, and shows it at once', () => {
      const rules: GameRules = { ...DEFAULT_RULES, turnTimeLimitSeconds: 60 };
      createStore({ rules });
      holdNextReply();

      store.change('areAdjacentShipsAllowed', true);

      expect(sentRules()).toEqual([{ ...rules, areAdjacentShipsAllowed: true }]);
      expect(store.rules().areAdjacentShipsAllowed).toBe(true);
    });

    it('sends nothing for a value the rules already hold', () => {
      createStore();

      store.change('turnTimeLimitSeconds', DEFAULT_RULES.turnTimeLimitSeconds);

      expect(socket.emitWithAck).not.toHaveBeenCalled();
    });

    it('keeps the change while its ack is on its way, over an older snapshot', () => {
      createStore();
      holdNextReply();

      store.change('isExtraTurnOnHitEnabled', true);
      receive({ hasConfirmedRules: { me: false, opponent: true } });

      expect(store.rules().isExtraTurnOnHitEnabled).toBe(true);
    });

    it.each([
      ['refused', { ok: false, error: ERROR_CODES.INVALID_RULES }],
      ['not answered', { ok: false, error: TRANSPORT_ERRORS.NO_ACK }],
    ] as const)("shows the server's rules again and the reason when an edit is %s", async (_case, reply) => {
      createStore();
      const answer = holdNextReply();

      store.change('turnTimeLimitSeconds', 15);
      answer(reply);
      await settle();

      expect(store.rules()).toEqual(DEFAULT_RULES);
      expect(store.error()).toBe(reply.error);
    });

    it.each([ERROR_CODES.INVALID_RULES, TRANSPORT_ERRORS.NOT_CONNECTED])(
      'lets the player confirm again after an edit that failed with %s',
      async (error) => {
        createStore({ rulesVersion: 2 });
        socket.emitWithAck.mockResolvedValueOnce({ ok: false, error });

        store.change('areAdjacentShipsAllowed', true);
        await settle();

        expect(store.error()).toBe(error);
        expect(store.rules()).toEqual(DEFAULT_RULES);
        expect(store.isUpdatePending()).toBe(false);
        expect(store.canConfirm()).toBe(true);

        await store.confirm();

        expect(sentConfirmations()).toEqual([2]);
      },
    );

    it('clears the error once a later command succeeds', async () => {
      createStore();
      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: ERROR_CODES.RATE_LIMITED });
      store.change('turnTimeLimitSeconds', 15);
      await settle();

      socket.emitWithAck.mockResolvedValueOnce({ ok: true, rulesVersion: 1 });
      store.change('turnTimeLimitSeconds', 60);
      await settle();

      expect(store.error()).toBeNull();
    });
  });

  describe('confirming', () => {
    it('sends the version on screen', async () => {
      createStore({ rulesVersion: 7 });

      await store.confirm();

      expect(sentConfirmations()).toEqual([7]);
    });

    it('sends once however often it is tapped', () => {
      createStore({ rulesVersion: 2 });
      holdNextReply();

      void store.confirm();
      void store.confirm();

      expect(store.isConfirmPending()).toBe(true);
      expect(sentConfirmations()).toEqual([2]);
    });

    it('sends nothing once the player confirmed the version on screen', async () => {
      createStore({ rulesVersion: 2, hasConfirmedRules: { me: true, opponent: false } });

      await store.confirm();

      expect(store.canConfirm()).toBe(false);
      expect(sentConfirmations()).toEqual([]);
    });

    it("waits while the player's edit has not reached the snapshot, then confirms its version", async () => {
      createStore({ rulesVersion: 2 });
      const answer = holdNextReply();

      store.change('areAdjacentShipsAllowed', true);
      expect(store.canConfirm()).toBe(false);
      await store.confirm();

      answer({ ok: true, rulesVersion: 3 });
      await settle();
      // Acked, but the `STATE` of version 3 has not arrived: confirming now would accept version 2.
      expect(store.canConfirm()).toBe(false);

      receive({ rules: { ...DEFAULT_RULES, areAdjacentShipsAllowed: true }, rulesVersion: 3 });
      expect(store.canConfirm()).toBe(true);
      await store.confirm();

      expect(sentConfirmations()).toEqual([3]);
    });

    it('says the rules changed on STALE_RULES, and lets the player confirm again', async () => {
      createStore({ rulesVersion: 2 });
      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: ERROR_CODES.STALE_RULES });

      await store.confirm();

      expect(store.error()).toBe(ERROR_CODES.STALE_RULES);
      expect(store.canConfirm()).toBe(true);

      receive({ rulesVersion: 3 });
      await store.confirm();

      expect(sentConfirmations()).toEqual([2, 3]);
      expect(store.error()).toBeNull();
    });
  });

  describe('notice (ADR-0088)', () => {
    it('says nothing for the first snapshot, as after a reload', () => {
      createStore({ rulesVersion: 5, hasConfirmedRules: { me: false, opponent: true } });

      expect(store.notice()).toBeNull();
    });

    it("reports the opponent's edit, what it changed and whose confirmation it cleared", () => {
      createStore({ rulesVersion: 1, hasConfirmedRules: { me: true, opponent: false } });

      receive({ rules: { ...DEFAULT_RULES, turnTimeLimitSeconds: 60 }, rulesVersion: 2 });

      expect(store.notice()).toEqual({
        kind: RULES_NOTICE_KINDS.CHANGED,
        editor: RULES_EDITORS.OPPONENT,
        changes: { turnTimeLimitSeconds: 60 },
        cleared: { me: true, opponent: false },
      });
    });

    it("reports the player's own edit when it cleared a confirmation, told apart by its ack", async () => {
      createStore({ rulesVersion: 1, hasConfirmedRules: { me: false, opponent: true } });
      socket.emitWithAck.mockResolvedValueOnce({ ok: true, rulesVersion: 2 });

      store.change('isExtraTurnOnHitEnabled', true);
      await settle();
      receive({ rules: { ...DEFAULT_RULES, isExtraTurnOnHitEnabled: true }, rulesVersion: 2 });

      expect(store.notice()).toEqual({
        kind: RULES_NOTICE_KINDS.CHANGED,
        editor: RULES_EDITORS.ME,
        changes: { isExtraTurnOnHitEnabled: true },
        cleared: { me: false, opponent: true },
      });
    });

    it("says nothing for the player's own edit that cleared no confirmation", async () => {
      createStore({ rulesVersion: 1 });
      receive({ rulesVersion: 1, hasConfirmedRules: { me: false, opponent: true } });
      receive({ rules: { ...DEFAULT_RULES, turnTimeLimitSeconds: 15 }, rulesVersion: 2 });
      expect(store.notice()).not.toBeNull();
      socket.emitWithAck.mockResolvedValueOnce({ ok: true, rulesVersion: 3 });

      store.change('turnTimeLimitSeconds', 120);
      await settle();
      receive({ rules: { ...DEFAULT_RULES, turnTimeLimitSeconds: 120 }, rulesVersion: 3 });

      expect(store.notice()).toBeNull();
    });

    it("credits the opponent with a version that arrives while the player's edit waits for its ack", async () => {
      createStore({ rulesVersion: 1 });
      const answer = holdNextReply();

      store.change('areAdjacentShipsAllowed', true);
      receive({ rules: { ...DEFAULT_RULES, timeoutAction: TIMEOUT_ACTIONS.PASS_TURN }, rulesVersion: 2 });

      expect(store.notice()).toMatchObject({ editor: RULES_EDITORS.OPPONENT, changes: { timeoutAction: 'PASS_TURN' } });

      answer({ ok: true, rulesVersion: 3 });
      await settle();
      receive({ rules: { ...DEFAULT_RULES, areAdjacentShipsAllowed: true }, rulesVersion: 3 });

      expect(store.rules()).toEqual({ ...DEFAULT_RULES, areAdjacentShipsAllowed: true });
      expect(store.notice()).toBeNull();
    });

    it('reports the opponent confirming', () => {
      createStore({ rulesVersion: 1 });

      receive({ rulesVersion: 1, hasConfirmedRules: { me: false, opponent: true } });

      expect(store.notice()).toEqual({ kind: RULES_NOTICE_KINDS.OPPONENT_CONFIRMED });
    });

    it('compares nothing across rooms or phases', () => {
      createStore({ rulesVersion: 1 });
      const otherRoom: PlayerStateSnapshot = { ...negotiationSnapshot(createRoomId(1)), rulesVersion: 9 };

      socket.fire(SERVER_EVENTS.STATE, otherRoom);
      socket.fire(SERVER_EVENTS.STATE, placementSnapshot(ROOM_ID));

      expect(store.notice()).toBeNull();
    });
  });
});
