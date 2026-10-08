import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGameSocket, provideFakeGameSocket } from '../../../testing/fake-game-socket';
import { CONNECTION_STATUSES } from '../../core/game-socket';
import { ServerWakeService, WAKE_STATUSES, type WakeStatus } from '../../core/server-wake';
import { ServerStatus } from './server-status';
import { SERVER_STATUS_TEXT } from './server-status.text';

const wake = {
  status: signal<WakeStatus>(WAKE_STATUSES.IDLE),
  wake: vi.fn<() => Promise<boolean>>(),
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
});
