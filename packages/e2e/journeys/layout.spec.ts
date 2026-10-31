import type { BrowserContextOptions, Locator, Page } from '@playwright/test';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { LOBBY_TEXT } from '../../client/src/app/features/lobby/lobby.text';
import { PLACEMENT_TEXT } from '../../client/src/app/features/placement/placement.text';
import { ROOM_TEXT } from '../../client/src/app/features/room/room.text';
import { RULES_TEXT } from '../../client/src/app/features/rules/rules.text';
import { test, expect } from '../src/fixtures.ts';
import { agreeOnRules, confirmRandomFleet, createRoom, joinRoom, mainHeading, turnHeadings } from '../src/flows.ts';

/**
 * The smallest phone the layout supports, held as a phone, and a laptop screen (#53 F1, F4). "Leave room" sits beside
 * the heading (ADR-0080), so it is in view at the top of the page, as is "Confirm rules". "Confirm fleet" sits under
 * the placement board, which fills either screen, so it only has to come whole into view once scrolled to; so does
 * "Fire" on the phone, where Enemy waters fills the screen, while the laptop shows it at the top of the page. Both
 * coming into view without a scroll is #31's.
 */
const SCREENS = [
  { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, fireScroll: 'to' },
  { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, fireScroll: 'top' },
] as const;

/** Both color schemes: the dark one has its own palette, not its own layout, but a regression may hide in either. */
const COLOR_SCHEMES = ['light', 'dark'] as const;

/**
 * Asserts that the page does not scroll sideways.
 * @param page The page.
 * @param view The view, for the failure message.
 */
async function expectNoHorizontalScroll(page: Page, view: string): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      `${view}: page width beyond the viewport, in px`,
    )
    .toBe(0);
}

/**
 * Asserts that a control is whole inside the viewport, with no ancestor clipping it.
 * @param control The control.
 * @param what The control and where it is, for the failure message.
 * @param scroll `top` checks it at the top of the page, `to` once the page is scrolled to it.
 */
async function expectInView(control: Locator, what: string, scroll: 'top' | 'to'): Promise<void> {
  if (scroll === 'top') {
    await control.page().evaluate(() => {
      window.scrollTo(0, 0);
    });
  } else {
    await control.scrollIntoViewIfNeeded();
  }
  await expect(control, `${what}, ${scroll === 'top' ? 'at the top of the page' : 'scrolled to'}`).toBeInViewport({
    ratio: 1,
  });
}

for (const screen of SCREENS) {
  for (const colorScheme of COLOR_SCHEMES) {
    const { width, height } = screen.viewport;
    test(`layout at ${String(width)}×${String(height)}, ${colorScheme}`, async ({ openPlayer }) => {
      const options: BrowserContextOptions = {
        viewport: screen.viewport,
        isMobile: screen.isMobile,
        hasTouch: screen.hasTouch,
        colorScheme,
        permissions: ['clipboard-read', 'clipboard-write'],
      };
      const ada = await openPlayer('Ada', options);
      const grace = await openPlayer('Grace', options);
      // A share sheet that never opens, as on desktop Linux: the lobby falls back to its dialog, with "Other apps…".
      await ada.context.addInitScript(() => {
        navigator.share = () => Promise.reject(new DOMException('No share sheet', 'NotAllowedError'));
      });

      const roomUrl = await createRoom(ada);
      const leave = ada.page.getByRole('button', { name: ROOM_TEXT.leave });
      await expectNoHorizontalScroll(ada.page, 'lobby');
      await expectInView(leave, '"Leave room" in the lobby', 'top');

      await ada.page.getByRole('button', { name: LOBBY_TEXT.share }).click();
      const dialog = ada.page.getByRole('dialog', { name: LOBBY_TEXT.dialogHeading });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: LOBBY_TEXT.copy }).click();
      await expect(dialog.getByText(LOBBY_TEXT.copied)).toBeVisible();
      // The dialog does not scroll: everything in it is in view as it opens.
      await expect
        .poll(
          () => dialog.evaluate((element) => element.scrollHeight - element.clientHeight),
          'share dialog content beyond its height, in px',
        )
        .toBe(0);
      for (const [what, control] of [
        ['the QR code', dialog.getByRole('img', { name: LOBBY_TEXT.codeLabel(roomUrl) })],
        ['"Copy link"', dialog.getByRole('button', { name: LOBBY_TEXT.copy })],
        ['"Other apps…"', dialog.getByRole('button', { name: LOBBY_TEXT.otherApps })],
        ['"Close"', dialog.getByRole('button', { name: LOBBY_TEXT.close })],
        ['"Link copied."', dialog.getByText(LOBBY_TEXT.copied)],
      ] as const) {
        await expect(control, `${what} in the share dialog`).toBeInViewport({ ratio: 1 });
      }
      await dialog.getByRole('button', { name: LOBBY_TEXT.close }).click();
      await expect(dialog).toBeHidden();

      await joinRoom(grace, roomUrl);
      await expect(mainHeading(ada.page)).toHaveText(RULES_TEXT.heading);
      await expectNoHorizontalScroll(ada.page, 'rules');
      await expectInView(leave, '"Leave room" on the rules screen', 'top');
      await expectInView(
        ada.page.getByRole('button', { name: RULES_TEXT.confirm }),
        '"Confirm rules" on the rules screen',
        'top',
      );

      await agreeOnRules([ada, grace]);
      await expectNoHorizontalScroll(ada.page, 'placement');
      await expectInView(leave, '"Leave room" in placement', 'top');
      await expectInView(
        ada.page.getByRole('button', { name: PLACEMENT_TEXT.confirm }),
        '"Confirm fleet" in placement',
        'to',
      );

      await confirmRandomFleet(ada);
      await confirmRandomFleet(grace);
      await expect(mainHeading(ada.page)).toHaveText(turnHeadings(grace));
      await expectNoHorizontalScroll(ada.page, 'battle');
      if (screen.isMobile) {
        // One board at a time on a narrow screen; Fire sits under Enemy waters.
        await ada.page.getByRole('button', { name: BATTLE_TEXT.enemyWaters, exact: true }).click();
      }
      await expectInView(
        ada.page.getByRole('button', { name: BATTLE_TEXT.fire, exact: true }),
        '"Fire"',
        screen.fireScroll,
      );
    });
  }
}
