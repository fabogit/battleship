import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Lobby, NATIVE_SHEET_FAILURE_MS, SHARE_OUTCOMES } from './lobby';
import { LOBBY_TEXT } from './lobby.text';
import { createRoomId } from '../../../testing/session-fixtures';

const ROOM_ID = createRoomId(0);
/** The link the lobby shares. */
const ROOM_URL = new URL(`/r/${ROOM_ID}`, document.location.origin).href;

/** Stand-ins for the browser APIs the lobby uses; jsdom has neither. */
const share = vi.fn<(data: ShareData) => Promise<void>>();
const writeText = vi.fn<(text: string) => Promise<void>>();

/**
 * Installs or removes `navigator.share`, `navigator.clipboard` and the pointer media query for the next component.
 * @param apis What the browser offers.
 * @param apis.hasShare Whether the Web Share API exists.
 * @param apis.hasClipboard Whether the Clipboard API exists.
 * @param apis.hasCoarsePointer Whether `(pointer: coarse)` matches, as on a phone.
 */
function browserOffers({
  hasShare,
  hasClipboard,
  hasCoarsePointer = false,
}: {
  hasShare: boolean;
  hasClipboard: boolean;
  hasCoarsePointer?: boolean;
}): void {
  Object.defineProperty(navigator, 'share', { value: hasShare ? share : undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: hasClipboard ? { writeText } : undefined,
    configurable: true,
  });
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ matches: hasCoarsePointer && query === '(pointer: coarse)' }),
    configurable: true,
  });
}

/**
 * A share sheet that rejects with `AbortError` after some time.
 * @param elapsedMs How long the sheet stayed, on the faked `Date`.
 * @returns The stand-in for `navigator.share`.
 */
function abortedAfter(elapsedMs: number): () => Promise<void> {
  return () => {
    vi.setSystemTime(Date.now() + elapsedMs);
    return Promise.reject(new DOMException('Share canceled', 'AbortError'));
  };
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
 * @param scope The element to search.
 * @param label The button's text.
 * @returns The button, or `undefined`.
 */
function button(scope: Element, label: string): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll('button')).find((candidate) => candidate.textContent.trim() === label);
}

/**
 * The share dialog.
 * @param page The rendered screen.
 * @returns The `<dialog>`, which is always in the page.
 */
function dialogOf(page: HTMLElement): HTMLDialogElement {
  const dialog = page.querySelector('dialog');
  if (dialog === null) {
    throw new Error('No dialog');
  }
  return dialog;
}

/**
 * The text of an outcome line.
 * @param scope The page, for the line under the buttons, or the dialog, for its own line.
 * @returns The line's text.
 */
function outcomeIn(scope: Element): string {
  const lines = Array.from(scope.querySelectorAll('.outcome'));
  const line = lines.find((candidate) => scope.tagName === 'DIALOG' || candidate.closest('dialog') === null);
  return line?.textContent.trim() ?? '';
}

/**
 * Clicks a button and waits for an outcome line to change.
 * @param scope The page or the dialog; its outcome line is read.
 * @param label The button's text.
 * @returns The outcome line's text.
 */
async function clickAndReadOutcome(scope: Element, label: string): Promise<string> {
  button(scope, label)?.click();
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect(outcomeIn(scope)).not.toBe('');
  });
  return outcomeIn(scope);
}

/**
 * Clicks a button and lets its handler finish.
 * @param scope The page or the dialog.
 * @param label The button's text.
 */
async function click(scope: Element, label: string): Promise<void> {
  button(scope, label)?.click();
  await fixture.whenStable();
  await Promise.resolve();
  await fixture.whenStable();
}

beforeAll(() => {
  // jsdom has `<dialog>` without its methods; these do what the lobby relies on.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
});

afterEach(() => {
  vi.useRealTimers();
  browserOffers({ hasShare: false, hasClipboard: false });
});

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('SHARE_OUTCOMES', () => {
  it('pins the values', () => {
    expect(Object.values(SHARE_OUTCOMES)).toEqual(['copied', 'copy-failed', 'sheet-failed']);
  });
});

describe('Lobby', () => {
  it('shows the absolute room link in a labelled read-only field', async () => {
    browserOffers({ hasShare: false, hasClipboard: true });

    const page = await render();

    const field = page.querySelector<HTMLInputElement>('input#room-link');
    expect(field?.value).toBe(ROOM_URL);
    expect(field?.readOnly).toBe(true);
    expect(page.querySelector('label[for="room-link"]')?.textContent).toBe(LOBBY_TEXT.linkLabel);
    expect(page.textContent).toContain(LOBBY_TEXT.playingAs('Ada'));
  });

  it('offers sharing and copying in every browser', async () => {
    browserOffers({ hasShare: false, hasClipboard: false });

    const page = await render();

    expect(button(page, LOBBY_TEXT.share)).toBeDefined();
    expect(button(page, LOBBY_TEXT.copy)).toBeDefined();
    expect(dialogOf(page).open).toBe(false);
  });

  describe('copying', () => {
    it('copies the link and says so', async () => {
      browserOffers({ hasShare: false, hasClipboard: true });
      writeText.mockResolvedValue();
      const page = await render();

      await expect(clickAndReadOutcome(page, LOBBY_TEXT.copy)).resolves.toBe(LOBBY_TEXT.copied);
      expect(writeText).toHaveBeenCalledExactlyOnceWith(ROOM_URL);
    });

    it('asks to copy by hand when the clipboard refuses', async () => {
      browserOffers({ hasShare: false, hasClipboard: true });
      writeText.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
      const page = await render();

      await expect(clickAndReadOutcome(page, LOBBY_TEXT.copy)).resolves.toBe(LOBBY_TEXT.copyFailed);
    });

    it('asks to copy by hand without the Clipboard API', async () => {
      browserOffers({ hasShare: false, hasClipboard: false });
      const page = await render();

      await expect(clickAndReadOutcome(page, LOBBY_TEXT.copy)).resolves.toBe(LOBBY_TEXT.copyFailed);
    });
  });

  describe('on a computer', () => {
    beforeEach(() => {
      browserOffers({ hasShare: true, hasClipboard: true });
    });

    it('opens the share dialog rather than the share sheet', async () => {
      const page = await render();

      await click(page, LOBBY_TEXT.share);

      const dialog = dialogOf(page);
      expect(dialog.open).toBe(true);
      expect(share).not.toHaveBeenCalled();
      expect(page.querySelector(`#${dialog.getAttribute('aria-labelledby') ?? ''}`)?.textContent).toBe(
        LOBBY_TEXT.dialogHeading,
      );
      expect(dialog.querySelector<HTMLInputElement>('input#share-link')?.value).toBe(ROOM_URL);
      expect(dialog.querySelector('label[for="share-link"]')?.textContent).toBe(LOBBY_TEXT.linkLabel);
      expect(button(dialog, LOBBY_TEXT.copy)?.hasAttribute('autofocus')).toBe(true);
      expect(button(dialog, LOBBY_TEXT.otherApps)).toBeDefined();
      expect(button(dialog, LOBBY_TEXT.close)).toBeDefined();
    });

    it('shows a QR code of the link, named by the link', async () => {
      const page = await render();

      await click(page, LOBBY_TEXT.share);

      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(dialogOf(page).querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe(
          LOBBY_TEXT.codeLabel(ROOM_URL),
        );
      });
    });

    it('copies from the dialog and says so there', async () => {
      writeText.mockResolvedValue();
      const page = await render();
      await click(page, LOBBY_TEXT.share);

      await expect(clickAndReadOutcome(dialogOf(page), LOBBY_TEXT.copy)).resolves.toBe(LOBBY_TEXT.copied);
      expect(outcomeIn(page)).toBe('');
    });

    it('starts the dialog without the page message', async () => {
      writeText.mockResolvedValue();
      const page = await render();
      await clickAndReadOutcome(page, LOBBY_TEXT.copy);

      await click(page, LOBBY_TEXT.share);

      expect(outcomeIn(dialogOf(page))).toBe('');
    });

    it('closes the dialog, gives focus back to "Share link" and forgets the dialog message', async () => {
      writeText.mockResolvedValue();
      const page = await render();
      await click(page, LOBBY_TEXT.share);
      const dialog = dialogOf(page);
      await clickAndReadOutcome(dialog, LOBBY_TEXT.copy);

      await click(dialog, LOBBY_TEXT.close);

      expect(dialog.open).toBe(false);
      expect(document.activeElement).toBe(button(page, LOBBY_TEXT.share));
      expect(outcomeIn(page)).toBe('');
    });

    it('opens the share sheet from "Other apps…"', async () => {
      share.mockResolvedValue();
      const page = await render();
      await click(page, LOBBY_TEXT.share);

      await click(dialogOf(page), LOBBY_TEXT.otherApps);

      expect(share).toHaveBeenCalledExactlyOnceWith({
        title: LOBBY_TEXT.shareTitle,
        text: LOBBY_TEXT.shareMessage,
        url: ROOM_URL,
      });
      expect(outcomeIn(dialogOf(page))).toBe('');
    });

    it('says nothing when the player closes the sheet opened from "Other apps…"', async () => {
      share.mockImplementation(abortedAfter(NATIVE_SHEET_FAILURE_MS));
      const page = await render();
      await click(page, LOBBY_TEXT.share);

      await click(dialogOf(page), LOBBY_TEXT.otherApps);

      expect(share).toHaveBeenCalledOnce();
      expect(outcomeIn(dialogOf(page))).toBe('');
    });

    it('says so when "Other apps…" fails at once, and then stays inactive', async () => {
      share.mockImplementation(abortedAfter(NATIVE_SHEET_FAILURE_MS - 1));
      const page = await render();
      await click(page, LOBBY_TEXT.share);
      const dialog = dialogOf(page);

      // Not `clickAndReadOutcome`: `vi.waitFor` moves the faked clock on, which would make the sheet look closed.
      await click(dialog, LOBBY_TEXT.otherApps);
      expect(outcomeIn(dialog)).toBe(LOBBY_TEXT.sheetFailed);
      expect(button(dialog, LOBBY_TEXT.otherApps)?.getAttribute('aria-disabled')).toBe('true');

      await click(dialog, LOBBY_TEXT.otherApps);
      expect(share).toHaveBeenCalledOnce();
    });

    it('ignores a second "Other apps…" while the sheet is open', async () => {
      let closeSheet: () => void = () => undefined;
      share
        .mockReturnValueOnce(new Promise((resolve) => (closeSheet = resolve)))
        .mockRejectedValue(new DOMException('An earlier share has not yet completed', 'InvalidStateError'));
      const page = await render();
      await click(page, LOBBY_TEXT.share);
      const dialog = dialogOf(page);

      await click(dialog, LOBBY_TEXT.otherApps);
      await click(dialog, LOBBY_TEXT.otherApps);
      closeSheet();
      await fixture.whenStable();

      expect(share).toHaveBeenCalledOnce();
      expect(outcomeIn(dialog)).toBe('');
      expect(button(dialog, LOBBY_TEXT.otherApps)?.getAttribute('aria-disabled')).toBeNull();
    });

    it('leaves "Other apps…" out without the Web Share API', async () => {
      browserOffers({ hasShare: false, hasClipboard: true });
      const page = await render();

      await click(page, LOBBY_TEXT.share);

      expect(dialogOf(page).open).toBe(true);
      expect(button(dialogOf(page), LOBBY_TEXT.otherApps)).toBeUndefined();
    });
  });

  describe('on a phone', () => {
    beforeEach(() => {
      browserOffers({ hasShare: true, hasClipboard: true, hasCoarsePointer: true });
    });

    it('opens the share sheet with the room link', async () => {
      share.mockResolvedValue();
      const page = await render();

      await click(page, LOBBY_TEXT.share);

      expect(share).toHaveBeenCalledExactlyOnceWith({
        title: LOBBY_TEXT.shareTitle,
        text: LOBBY_TEXT.shareMessage,
        url: ROOM_URL,
      });
      expect(dialogOf(page).open).toBe(false);
    });

    it('does nothing more when the player closes the sheet', async () => {
      share.mockImplementation(abortedAfter(NATIVE_SHEET_FAILURE_MS));
      const page = await render();

      await click(page, LOBBY_TEXT.share);

      expect(share).toHaveBeenCalledOnce();
      expect(dialogOf(page).open).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('opens the sheet again once the player has closed it', async () => {
      share.mockImplementation(abortedAfter(NATIVE_SHEET_FAILURE_MS));
      const page = await render();

      await click(page, LOBBY_TEXT.share);
      await click(page, LOBBY_TEXT.share);

      expect(share).toHaveBeenCalledTimes(2);
      expect(dialogOf(page).open).toBe(false);
    });

    it('opens the dialog when the sheet aborts too soon to have shown, and skips the sheet afterwards', async () => {
      share.mockImplementation(abortedAfter(NATIVE_SHEET_FAILURE_MS - 1));
      const page = await render();

      await click(page, LOBBY_TEXT.share);

      const dialog = dialogOf(page);
      expect(dialog.open).toBe(true);
      expect(outcomeIn(dialog)).toBe(LOBBY_TEXT.sheetFailed);

      await click(dialog, LOBBY_TEXT.close);
      await click(page, LOBBY_TEXT.share);
      expect(share).toHaveBeenCalledOnce();
      expect(dialog.open).toBe(true);
    });

    it('opens the dialog when the sheet fails otherwise', async () => {
      share.mockRejectedValue(new DOMException('No user gesture', 'NotAllowedError'));
      const page = await render();

      await click(page, LOBBY_TEXT.share);

      expect(dialogOf(page).open).toBe(true);
      expect(outcomeIn(dialogOf(page))).toBe(LOBBY_TEXT.sheetFailed);
    });

    it('ignores a second "Share link" while the sheet is open', async () => {
      share
        .mockReturnValueOnce(new Promise<void>(() => undefined))
        .mockRejectedValue(new DOMException('An earlier share has not yet completed', 'InvalidStateError'));
      const page = await render();

      await click(page, LOBBY_TEXT.share);
      await click(page, LOBBY_TEXT.share);

      expect(share).toHaveBeenCalledOnce();
      expect(dialogOf(page).open).toBe(false);
      expect(outcomeIn(dialogOf(page))).toBe('');
    });

    it('opens the dialog without the Web Share API', async () => {
      browserOffers({ hasShare: false, hasClipboard: true, hasCoarsePointer: true });
      const page = await render();

      await click(page, LOBBY_TEXT.share);

      expect(dialogOf(page).open).toBe(true);
      expect(outcomeIn(dialogOf(page))).toBe('');
    });
  });
});
