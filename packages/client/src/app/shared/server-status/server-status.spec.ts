import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DISCONNECT_FORFEIT_MS } from '@battleship/core';

import { FakeGameSocket, provideFakeGameSocket } from '../../../testing/fake-game-socket';
import { createPlayerSecret, createRoomId } from '../../../testing/session-fixtures';
import { CLOSE_REASONS, CONNECTION_STATUSES } from '../../core/game-socket';
import { ServerWakeService, WAKE_STATUSES, type WakeOptions, type WakeStatus } from '../../core/server-wake';
import { SessionStore } from '../../core/session-store';
import { STATUS_TONES, ServerStatus } from './server-status';
import { SERVER_STATUS_TEXT } from './server-status.text';

const wake = {
  status: signal<WakeStatus>(WAKE_STATUSES.IDLE),
  wake: vi.fn<(options?: WakeOptions) => Promise<boolean>>(),
};

let socket: FakeGameSocket;

beforeEach(() => {
  vi.resetAllMocks();
  wake.status.set(WAKE_STATUSES.WAKING);
  socket = new FakeGameSocket();
  socket.status.set(CONNECTION_STATUSES.DISCONNECTED);
  TestBed.configureTestingModule({
    providers: [{ provide: ServerWakeService, useValue: wake }, provideFakeGameSocket(socket)],
  });
});

/** Makes the next `wake()` succeed and the next `connect()` complete the handshake. */
function serverUp(): void {
  wake.wake.mockImplementation(() => {
    wake.status.set(WAKE_STATUSES.AWAKE);
    return Promise.resolve(true);
  });
  socket.connect.mockImplementation(() => {
    socket.status.set(CONNECTION_STATUSES.CONNECTED);
  });
}

/** @returns The rendered status line, once stable. */
async function render(): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(ServerStatus);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('STATUS_TONES', () => {
  it('pins the values', () => {
    expect(Object.values(STATUS_TONES)).toEqual(['pending', 'ok', 'error']);
  });
});

describe('ServerStatus', () => {
  it('shows the waking state and does not connect until the server is up', async () => {
    wake.wake.mockReturnValue(new Promise(() => undefined));

    const status = await render();

    expect(status.textContent).toContain(SERVER_STATUS_TEXT.waking);
    expect(status.textContent).toContain(SERVER_STATUS_TEXT.wakingHint);
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('offers a retry when the server does not wake up', async () => {
    wake.wake.mockImplementation(() => {
      wake.status.set(WAKE_STATUSES.UNREACHABLE);
      return Promise.resolve(false);
    });

    const status = await render();
    expect(status.textContent).toContain(SERVER_STATUS_TEXT.unreachable);
    expect(socket.connect).not.toHaveBeenCalled();

    serverUp();
    status.querySelector('button')?.click();

    await vi.waitFor(() => {
      expect(socket.connect).toHaveBeenCalledOnce();
    });
    expect(wake.wake).toHaveBeenCalledTimes(2);
  });

  it('connects once the server is awake', async () => {
    serverUp();

    const status = await render();

    expect(socket.connect).toHaveBeenCalledOnce();
    expect(status.textContent).toContain(SERVER_STATUS_TEXT.connected);
    expect(status.querySelector('button')).toBeNull();
  });

  it('offers a retry when the socket gives up', async () => {
    serverUp();
    const fixture = TestBed.createComponent(ServerStatus);
    await fixture.whenStable();

    socket.status.set(CONNECTION_STATUSES.DISCONNECTED);
    await fixture.whenStable();
    const status = fixture.nativeElement as HTMLElement;
    expect(status.textContent).toContain(SERVER_STATUS_TEXT.disconnected);

    status.querySelector('button')?.click();

    await vi.waitFor(() => {
      expect(socket.connect).toHaveBeenCalledTimes(2);
    });
  });

  it('announces every change', async () => {
    wake.wake.mockReturnValue(new Promise(() => undefined));

    const status = await render();

    expect(status.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  describe('refused or retrying (#25, ADR-0075)', () => {
    /**
     * Renders the line with the server awake and the socket in the given state.
     * @param state What the fake socket reports.
     * @returns The status line and its fixture.
     */
    async function renderSocket(state: {
      readonly status: (typeof CONNECTION_STATUSES)[keyof typeof CONNECTION_STATUSES];
      readonly closeReason?: (typeof CLOSE_REASONS)[keyof typeof CLOSE_REASONS];
      readonly retryError?: string;
      readonly isReconnecting?: boolean;
    }): Promise<HTMLElement> {
      wake.status.set(WAKE_STATUSES.AWAKE);
      wake.wake.mockResolvedValue(true);
      socket.status.set(state.status);
      socket.closeReason.set(state.closeReason ?? null);
      socket.retryError.set(state.retryError ?? null);
      socket.isReconnecting.set(state.isReconnecting ?? false);
      return render();
    }

    it('says the connection was lost while Socket.io reconnects, and how long a seat is kept', async () => {
      TestBed.inject(SessionStore).save({ roomId: createRoomId(0), playerSecret: createPlayerSecret() });

      const status = await renderSocket({ status: CONNECTION_STATUSES.CONNECTING, isReconnecting: true });

      expect(status.textContent).toContain(SERVER_STATUS_TEXT.reconnecting);
      expect(status.textContent).toContain(SERVER_STATUS_TEXT.seatKept(DISCONNECT_FORFEIT_MS / 60_000));
      expect(status.querySelector('button')).toBeNull();
    });

    it('does not mention a seat to a tab in no room', async () => {
      const status = await renderSocket({ status: CONNECTION_STATUSES.CONNECTING, isReconnecting: true });

      expect(status.textContent).toContain(SERVER_STATUS_TEXT.reconnecting);
      expect(status.textContent).not.toContain(SERVER_STATUS_TEXT.seatKept(DISCONNECT_FORFEIT_MS / 60_000));
    });

    it('shows the last failed attempt while retrying, instead of an endless "Connecting…" (#51, F9)', async () => {
      const status = await renderSocket({ status: CONNECTION_STATUSES.CONNECTING, retryError: 'xhr poll error' });

      expect(status.textContent).toContain(SERVER_STATUS_TEXT.connecting);
      expect(status.textContent).toContain(SERVER_STATUS_TEXT.retrying('xhr poll error'));
      expect(status.querySelector('button')).toBeNull();
    });

    it('says the server refused, with a retry', async () => {
      const status = await renderSocket({
        status: CONNECTION_STATUSES.DISCONNECTED,
        closeReason: CLOSE_REASONS.REFUSED,
      });

      expect(status.textContent).toContain(SERVER_STATUS_TEXT.refused);
      expect(status.querySelector('button')?.textContent.trim()).toBe(SERVER_STATUS_TEXT.retry);
    });

    it.each([
      [CLOSE_REASONS.PROTOCOL_MISMATCH, SERVER_STATUS_TEXT.outdated],
      [CLOSE_REASONS.SESSION_REPLACED, SERVER_STATUS_TEXT.replaced],
    ])('names %s without a retry: the page shows what to do', async (closeReason, message) => {
      const status = await renderSocket({ status: CONNECTION_STATUSES.DISCONNECTED, closeReason });

      expect(status.textContent).toContain(message);
      expect(status.textContent).not.toContain(SERVER_STATUS_TEXT.disconnected);
      expect(status.querySelector('button')).toBeNull();
    });

    it('polls again, forced, when the retry button is pressed', async () => {
      const status = await renderSocket({
        status: CONNECTION_STATUSES.DISCONNECTED,
        closeReason: CLOSE_REASONS.SERVER_DISCONNECT,
      });
      wake.wake.mockClear();

      status.querySelector('button')?.click();

      await vi.waitFor(() => {
        expect(socket.connect).toHaveBeenCalled();
      });
      expect(wake.wake).toHaveBeenCalledExactlyOnceWith({ isForced: true });
    });

    it('waits for the next instance after SERVER_SHUTDOWN, then reconnects (#51, F15)', async () => {
      serverUp();
      const fixture = TestBed.createComponent(ServerStatus);
      await fixture.whenStable();
      wake.wake.mockClear();
      socket.connect.mockClear();
      let wakeUp: (isAwake: boolean) => void = () => undefined;
      wake.wake.mockImplementation(() => {
        wake.status.set(WAKE_STATUSES.WAKING);
        return new Promise((resolve) => (wakeUp = resolve));
      });

      socket.closeReason.set(CLOSE_REASONS.SERVER_SHUTDOWN);
      socket.status.set(CONNECTION_STATUSES.DISCONNECTED);
      await fixture.whenStable();

      expect(wake.wake).toHaveBeenCalledExactlyOnceWith({ isForced: true });
      const status = fixture.nativeElement as HTMLElement;
      expect(status.textContent).toContain(SERVER_STATUS_TEXT.restarting);
      expect(status.textContent).not.toContain(SERVER_STATUS_TEXT.waking);
      expect(socket.connect).not.toHaveBeenCalled();

      wake.status.set(WAKE_STATUSES.AWAKE);
      wakeUp(true);
      await vi.waitFor(() => {
        expect(socket.connect).toHaveBeenCalledOnce();
      });
    });

    it('does not poll again for a server disconnect without SERVER_SHUTDOWN', async () => {
      serverUp();
      const fixture = TestBed.createComponent(ServerStatus);
      await fixture.whenStable();
      wake.wake.mockClear();

      socket.closeReason.set(CLOSE_REASONS.SERVER_DISCONNECT);
      socket.status.set(CONNECTION_STATUSES.DISCONNECTED);
      await fixture.whenStable();

      expect(wake.wake).not.toHaveBeenCalled();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(SERVER_STATUS_TEXT.disconnected);
    });
  });
});
