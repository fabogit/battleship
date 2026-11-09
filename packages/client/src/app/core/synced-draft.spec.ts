import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ERROR_CODES, SERVER_EVENTS, type CommandEvent, type ErrorCode } from '@battleship/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGameSocket, negotiationSnapshot, provideFakeGameSocket } from '../../testing/fake-game-socket';
import { createRoomId } from '../../testing/session-fixtures';
import { TRANSPORT_ERRORS, type CommandResult, type TransportError } from './game-socket';
import { createSyncedDraft, type SyncedDraft } from './synced-draft';

const ROOM_ID = createRoomId(0);

let socket: FakeGameSocket;
let send: ReturnType<typeof vi.fn<(draft: number) => Promise<CommandResult<CommandEvent>>>>;
let sync: SyncedDraft<number, string>;
let error: ReturnType<typeof signal<ErrorCode | TransportError | null>>;

/**
 * Makes the next update wait until the test answers it.
 * @returns Resolves the update with its reply.
 */
function holdNextReply(): (result: CommandResult<CommandEvent>) => void {
  let answer: (result: CommandResult<CommandEvent>) => void = () => undefined;
  send.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  return answer;
}

/** Lets pending acks resolve. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  socket = new FakeGameSocket();
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket)] });
  send = vi.fn<(draft: number) => Promise<CommandResult<CommandEvent>>>();
  error = signal<ErrorCode | TransportError | null>(null);
  // A draft of one number, the rules version, keeps the sync itself in view.
  sync = TestBed.runInInjectionContext(() =>
    createSyncedDraft<number, string>({
      read: (snapshot) => snapshot.rulesVersion,
      empty: 0,
      equal: (a, b) => a === b,
      send,
      feedback: signal<string | null>(null),
      error,
    }),
  );
});

describe('createSyncedDraft', () => {
  describe('isUpdatePending', () => {
    it('is false before any update', () => {
      expect(sync.isUpdatePending()).toBe(false);
    });

    it('is true from sending an update until the ack of the last one in flight', async () => {
      const answerFirst = holdNextReply();
      const answerSecond = holdNextReply();

      sync.update(1);
      expect(sync.isUpdatePending()).toBe(true);
      sync.update(2);

      answerFirst({ ok: true });
      await settle();
      expect(sync.isUpdatePending()).toBe(true);

      answerSecond({ ok: true });
      await settle();
      expect(sync.isUpdatePending()).toBe(false);
      expect(error()).toBeNull();
    });

    it.each([ERROR_CODES.RATE_LIMITED, TRANSPORT_ERRORS.NOT_CONNECTED])(
      'is false again after an update fails with %s',
      async (code) => {
        const answer = holdNextReply();

        sync.update(1);
        expect(sync.isUpdatePending()).toBe(true);
        answer({ ok: false, error: code });
        await settle();

        expect(sync.isUpdatePending()).toBe(false);
        expect(error()).toBe(code);
        expect(sync.draft()).toBe(0);
      },
    );

    it('keeps STATE from replacing the draft only while it is true', async () => {
      const answer = holdNextReply();
      sync.update(1);

      socket.fire(SERVER_EVENTS.STATE, negotiationSnapshot(ROOM_ID, { rulesVersion: 5 }));
      expect(sync.draft()).toBe(1);

      answer({ ok: true });
      await settle();
      socket.fire(SERVER_EVENTS.STATE, negotiationSnapshot(ROOM_ID, { rulesVersion: 5 }));
      expect(sync.draft()).toBe(5);
    });
  });
});
