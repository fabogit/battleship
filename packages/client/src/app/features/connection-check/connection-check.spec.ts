import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PROTOCOL_VERSION, type EchoResponse } from '@battleship/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECTION_STATUSES, GameSocketService, type ConnectionStatus } from '../../core/game-socket';
import { ServerWakeService, WAKE_STATUSES, type WakeStatus } from '../../core/server-wake';
import { ConnectionCheck } from './connection-check';

const wake = {
  status: signal<WakeStatus>(WAKE_STATUSES.IDLE),
  wake: vi.fn<() => Promise<boolean>>(),
};

const socket = {
  status: signal<ConnectionStatus>(CONNECTION_STATUSES.DISCONNECTED),
  connect: vi.fn<() => void>(),
  echo: vi.fn<(payload: unknown) => Promise<EchoResponse>>(),
};

beforeEach(() => {
  vi.resetAllMocks();
  wake.status.set(WAKE_STATUSES.WAKING);
  socket.status.set(CONNECTION_STATUSES.DISCONNECTED);
  TestBed.configureTestingModule({
    providers: [
      { provide: ServerWakeService, useValue: wake },
      { provide: GameSocketService, useValue: socket },
    ],
  });
});

async function render(): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(ConnectionCheck);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('ConnectionCheck', () => {
  it('shows the waking state and does not connect until the server is up', async () => {
    wake.wake.mockReturnValue(new Promise(() => undefined));

    const page = await render();

    expect(page.textContent).toContain('Waking up the server…');
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('offers a retry when the server does not wake up', async () => {
    wake.wake.mockImplementation(() => {
      wake.status.set(WAKE_STATUSES.UNREACHABLE);
      return Promise.resolve(false);
    });

    const page = await render();
    expect(page.textContent).toContain('The server is not responding.');
    expect(socket.connect).not.toHaveBeenCalled();

    page.querySelector('button')?.click();
    expect(wake.wake).toHaveBeenCalledTimes(2);
  });

  it('connects once awake and shows the echo round-trip', async () => {
    wake.wake.mockImplementation(() => {
      wake.status.set(WAKE_STATUSES.AWAKE);
      return Promise.resolve(true);
    });
    socket.connect.mockImplementation(() => {
      socket.status.set(CONNECTION_STATUSES.CONNECTED);
    });
    socket.echo.mockResolvedValue({ ok: true, payload: null, protocolVersion: PROTOCOL_VERSION });

    const page = await render();

    expect(socket.connect).toHaveBeenCalledOnce();
    expect(socket.echo).toHaveBeenCalledOnce();
    expect(page.querySelector('[data-testid="echo"]')?.textContent).toMatch(
      new RegExp(`Echo round-trip: \\d+ ms\\s+· protocol v${String(PROTOCOL_VERSION)}`),
    );
  });
});
