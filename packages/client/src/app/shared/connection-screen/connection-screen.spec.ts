import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGameSocket, provideFakeGameSocket } from '../../../testing/fake-game-socket';
import { CLOSE_REASONS } from '../../core/game-socket';
import { ConnectionScreen, RELOAD_PAGE, SCREEN_CLOSE_REASONS, type ScreenCloseReason } from './connection-screen';
import { CONNECTION_SCREEN_TEXT } from './connection-screen.text';

let socket: FakeGameSocket;
const reload = vi.fn<() => void>();

beforeEach(() => {
  reload.mockReset();
  socket = new FakeGameSocket();
  TestBed.configureTestingModule({
    providers: [provideFakeGameSocket(socket), { provide: RELOAD_PAGE, useValue: reload }],
  });
});

/**
 * Renders the screen for one close reason.
 * @param reason Why the connection ended.
 * @returns The rendered screen.
 */
async function render(reason: ScreenCloseReason): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(ConnectionScreen);
  fixture.componentRef.setInput('reason', reason);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

/**
 * Finds a button by its text.
 * @param screen The rendered screen.
 * @param label The button's text.
 * @returns The button, or `undefined`.
 */
function button(screen: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...screen.querySelectorAll('button')].find((element) => element.textContent.trim() === label);
}

describe('SCREEN_CLOSE_REASONS', () => {
  it('lists the reasons retrying cannot fix', () => {
    expect(SCREEN_CLOSE_REASONS).toEqual([CLOSE_REASONS.PROTOCOL_MISMATCH, CLOSE_REASONS.SESSION_REPLACED]);
  });
});

describe('ConnectionScreen', () => {
  it('asks to reload after PROTOCOL_MISMATCH, and reloads', async () => {
    const screen = await render(CLOSE_REASONS.PROTOCOL_MISMATCH);

    expect(screen.querySelector('h1')?.textContent).toBe(CONNECTION_SCREEN_TEXT.outdatedHeading);
    expect(screen.textContent).toContain(CONNECTION_SCREEN_TEXT.outdatedReason);
    expect(button(screen, CONNECTION_SCREEN_TEXT.playHere)).toBeUndefined();

    button(screen, CONNECTION_SCREEN_TEXT.reload)?.click();

    expect(reload).toHaveBeenCalledOnce();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('says the match moved after SESSION_REPLACED, and takes the seat back with "Play here"', async () => {
    const screen = await render(CLOSE_REASONS.SESSION_REPLACED);

    expect(screen.querySelector('h1')?.textContent).toBe(CONNECTION_SCREEN_TEXT.replacedHeading);
    expect(screen.textContent).toContain(CONNECTION_SCREEN_TEXT.replacedReason);
    const playHere = button(screen, CONNECTION_SCREEN_TEXT.playHere);
    expect(playHere?.getAttribute('aria-describedby')).toBe('play-here-hint');
    expect(screen.querySelector('#play-here-hint')?.textContent).toBe(CONNECTION_SCREEN_TEXT.replacedHint);

    playHere?.click();

    expect(socket.connect).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});
