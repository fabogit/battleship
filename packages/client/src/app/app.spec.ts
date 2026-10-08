import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { FakeGameSocket, provideFakeGameSocket } from '../testing/fake-game-socket';
import { App } from './app';
import { routes } from './app.routes';
import { ServerWakeService, WAKE_STATUSES } from './core/server-wake';
import { SERVER_STATUS_TEXT } from './shared/server-status/server-status.text';

describe('App', () => {
  it('shows the app name linking home and the server status above the page', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideFakeGameSocket(new FakeGameSocket()),
        {
          provide: ServerWakeService,
          useValue: { status: signal(WAKE_STATUSES.WAKING), wake: vi.fn(() => new Promise(() => undefined)) },
        },
      ],
    });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const shell = fixture.nativeElement as HTMLElement;

    expect(shell.querySelector('header a')?.getAttribute('href')).toBe('/');
    expect(shell.querySelector('header')?.textContent).toContain(SERVER_STATUS_TEXT.waking);
    expect(shell.querySelector('main router-outlet')).not.toBeNull();
  });
});
