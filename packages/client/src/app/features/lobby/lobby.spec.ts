import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Lobby, SHARE_OUTCOMES } from './lobby';
import { LOBBY_TEXT } from './lobby.text';

const ROOM_ID = 'ab23cd45';

/** Stand-ins for the browser APIs the lobby uses; jsdom has neither. */
const share = vi.fn<(data: ShareData) => Promise<void>>();
const writeText = vi.fn<(text: string) => Promise<void>>();

/**
 * Installs or removes `navigator.share` and `navigator.clipboard` for the next component.
 * @param apis Which APIs the browser offers.
 * @param apis.hasShare Whether the Web Share API exists.
 * @param apis.hasClipboard Whether the Clipboard API exists.
 */
function browserOffers({ hasShare, hasClipboard }: { hasShare: boolean; hasClipboard: boolean }): void {
  Object.defineProperty(navigator, 'share', { value: hasShare ? share : undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: hasClipboard ? { writeText } : undefined,
    configurable: true,
  });
}

let fixture: ComponentFixture<Lobby>;

/** Renders the waiting screen of `ROOM_ID` for Ada. */
async function render(): Promise<HTMLElement> {
  fixture = TestBed.createComponent(Lobby);
  fixture.componentRef.setInput('roomId', ROOM_ID);
  fixture.componentRef.setInput('nickname', 'Ada');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

/**
 * Finds a button by its text.
 * @param page The rendered screen.
 * @param label The button's text.
 * @returns The button, or `undefined`.
 */
function button(page: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(page.querySelectorAll('button')).find((candidate) => candidate.textContent.trim() === label);
}

/**
 * Clicks a button and waits for the outcome line to change.
 * @param page The rendered screen.
 * @param label The button's text.
 * @returns The outcome line's text.
 */
async function clickAndReadOutcome(page: HTMLElement, label: string): Promise<string> {
  button(page, label)?.click();
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect(page.querySelector('.outcome')?.textContent.trim()).not.toBe('');
  });
  return page.querySelector('.outcome')?.textContent.trim() ?? '';
}

beforeEach(() => {
  vi.resetAllMocks();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
});

afterEach(() => {
  browserOffers({ hasShare: false, hasClipboard: false });
});

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('SHARE_OUTCOMES', () => {
  it('pins the values', () => {
    expect(Object.values(SHARE_OUTCOMES)).toEqual(['copied', 'copy-failed']);
  });
});

describe('Lobby', () => {
  it('shows the absolute room link in a labelled read-only field', async () => {
    browserOffers({ hasShare: false, hasClipboard: true });

    const page = await render();

    const field = page.querySelector<HTMLInputElement>('input#room-link');
    expect(field?.value).toBe(new URL(`/r/${ROOM_ID}`, document.location.origin).href);
    expect(field?.readOnly).toBe(true);
    expect(page.querySelector('label[for="room-link"]')?.textContent).toBe(LOBBY_TEXT.linkLabel);
    expect(page.textContent).toContain(LOBBY_TEXT.playingAs('Ada'));
  });

  describe('without the Web Share API', () => {
    beforeEach(() => {
      browserOffers({ hasShare: false, hasClipboard: true });
    });

    it('offers only the copy button', async () => {
      const page = await render();

      expect(button(page, LOBBY_TEXT.share)).toBeUndefined();
      expect(button(page, LOBBY_TEXT.copy)).toBeDefined();
    });

    it('copies the link and says so', async () => {
      writeText.mockResolvedValue();
      const page = await render();

      await expect(clickAndReadOutcome(page, LOBBY_TEXT.copy)).resolves.toBe(LOBBY_TEXT.copied);
      expect(writeText).toHaveBeenCalledExactlyOnceWith(new URL(`/r/${ROOM_ID}`, document.location.origin).href);
    });

    it('asks to copy by hand when the clipboard refuses', async () => {
      writeText.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
      const page = await render();

      await expect(clickAndReadOutcome(page, LOBBY_TEXT.copy)).resolves.toBe(LOBBY_TEXT.copyFailed);
    });
  });

  it('asks to copy by hand without the Clipboard API', async () => {
    browserOffers({ hasShare: false, hasClipboard: false });
    const page = await render();

    await expect(clickAndReadOutcome(page, LOBBY_TEXT.copy)).resolves.toBe(LOBBY_TEXT.copyFailed);
  });

  describe('with the Web Share API', () => {
    beforeEach(() => {
      browserOffers({ hasShare: true, hasClipboard: true });
    });

    it('opens the share sheet with the room link', async () => {
      share.mockResolvedValue();
      const page = await render();

      button(page, LOBBY_TEXT.share)?.click();
      await fixture.whenStable();

      expect(share).toHaveBeenCalledExactlyOnceWith({
        title: LOBBY_TEXT.shareTitle,
        text: LOBBY_TEXT.shareMessage,
        url: new URL(`/r/${ROOM_ID}`, document.location.origin).href,
      });
      expect(writeText).not.toHaveBeenCalled();
    });

    it('does nothing more when the player closes the sheet', async () => {
      share.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
      const page = await render();

      button(page, LOBBY_TEXT.share)?.click();
      await vi.waitFor(() => {
        expect(share).toHaveBeenCalledOnce();
      });
      await fixture.whenStable();

      expect(writeText).not.toHaveBeenCalled();
    });

    it('falls back to copying when the sheet fails', async () => {
      share.mockRejectedValue(new DOMException('No user gesture', 'NotAllowedError'));
      writeText.mockResolvedValue();
      const page = await render();

      await expect(clickAndReadOutcome(page, LOBBY_TEXT.share)).resolves.toBe(LOBBY_TEXT.copied);
    });
  });
});
