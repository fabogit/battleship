import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGameSocket, provideFakeGameSocket } from '../testing/fake-game-socket';
import { App } from './app';
import { routes } from './app.routes';
import { CLOSE_REASONS, CONNECTION_STATUSES } from './core/game-socket';
import { ServerWakeService, WAKE_STATUSES } from './core/server-wake';
import { CONNECTION_SCREEN_TEXT } from './shared/connection-screen/connection-screen.text';
import { SERVER_STATUS_TEXT } from './shared/server-status/server-status.text';

let socket: FakeGameSocket;

beforeEach(() => {
  socket = new FakeGameSocket();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideFakeGameSocket(socket),
      {
        provide: ServerWakeService,
        useValue: { status: signal(WAKE_STATUSES.WAKING), wake: vi.fn(() => new Promise(() => undefined)) },
      },
    ],
  });
});

describe('App', () => {
  it('shows the app name linking home and the server status above the page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const shell = fixture.nativeElement as HTMLElement;

    expect(shell.querySelector('header a')?.getAttribute('href')).toBe('/');
    expect(shell.querySelector('header')?.textContent).toContain(SERVER_STATUS_TEXT.waking);
    expect(shell.querySelector('main router-outlet')).not.toBeNull();
  });

  it.each([
    [CLOSE_REASONS.PROTOCOL_MISMATCH, CONNECTION_SCREEN_TEXT.outdatedHeading],
    [CLOSE_REASONS.SESSION_REPLACED, CONNECTION_SCREEN_TEXT.replacedHeading],
  ])('replaces the page with the screen for %s until the connection opens again (#25)', async (reason, heading) => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const shell = fixture.nativeElement as HTMLElement;

    socket.status.set(CONNECTION_STATUSES.DISCONNECTED);
    socket.closeReason.set(reason);
    await fixture.whenStable();

    expect(shell.querySelector('main router-outlet')).toBeNull();
    expect(shell.querySelector('main h1')?.textContent).toBe(heading);
    expect(shell.querySelector('header')).not.toBeNull();

    socket.closeReason.set(null);
    await fixture.whenStable();

    expect(shell.querySelector('main router-outlet')).not.toBeNull();
    expect(shell.querySelector('app-connection-screen')).toBeNull();
  });

  it.each([CLOSE_REASONS.REFUSED, CLOSE_REASONS.SERVER_DISCONNECT, CLOSE_REASONS.SERVER_SHUTDOWN])(
    'keeps the page after %s: the status line offers what to do',
    async (reason) => {
      const fixture = TestBed.createComponent(App);
      socket.status.set(CONNECTION_STATUSES.DISCONNECTED);
      socket.closeReason.set(reason);
      await fixture.whenStable();

      expect((fixture.nativeElement as HTMLElement).querySelector('main router-outlet')).not.toBeNull();
    },
  );
});
