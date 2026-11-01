import type { BrowserContextOptions, Locator, Page } from '@playwright/test';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { LOBBY_TEXT } from '../../client/src/app/features/lobby/lobby.text';
import { PLACEMENT_TEXT } from '../../client/src/app/features/placement/placement.text';
import { ROOM_TEXT } from '../../client/src/app/features/room/room.text';
import { RULES_TEXT } from '../../client/src/app/features/rules/rules.text';
import { test, expect } from '../src/fixtures.ts';
import {
  STARTS_IN,
  agreeOnRules,
  confirmRandomFleet,
  createRoom,
  endStartCountdown,
  joinRoom,
  mainHeading,
  placementTimer,
  turnHeadings,
  turnTimer,
} from '../src/flows.ts';

/**
 * The smallest phone the layout supports, held as a phone, and a laptop screen (#53 F1, F4). Every main action is in
 * view at the top of the page, with no scroll, together with the countdowns (#31): "Leave room" beside the heading
 * (ADR-0080), "Confirm rules", the placement deadline and "Confirm fleet" above the board, and in the battle the turn
 * timer beside the heading with "Fire" under Enemy waters.
 */
const SCREENS = [
  { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true },
  { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
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
 * Asserts that a control is whole inside the viewport at the top of the page, with no scroll and no ancestor clipping
 * it.
 * @param control The control.
 * @param what The control and where it is, for the failure message.
 */
async function expectInView(control: Locator, what: string): Promise<void> {
  await control.page().evaluate(() => {
    window.scrollTo(0, 0);
  });
  await expect(control, `${what}, at the top of the page`).toBeInViewport({ ratio: 1 });
}

for (const screen of SCREENS) {
  for (const colorScheme of COLOR_SCHEMES) {
    const { width, height } = screen.viewport;
    test(`layout at ${String(width)}×${String(height)}, ${colorScheme}`, async ({ openPlayer, skipServerClock }) => {
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
      await expectInView(leave, '"Leave room" in the lobby');

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
      await expectInView(leave, '"Leave room" on the rules screen');
      await expectInView(
        ada.page.getByRole('button', { name: RULES_TEXT.confirm }),
        '"Confirm rules" on the rules screen',
      );

      await agreeOnRules([ada, grace]);
      await expectNoHorizontalScroll(ada.page, 'placement');
      await expectInView(leave, '"Leave room" in placement');
      await expectInView(placementTimer(ada.page), 'the deadline in placement');
      await expectInView(
        ada.page.getByRole('button', { name: PLACEMENT_TEXT.confirm }),
        '"Confirm fleet" in placement',
      );

      await confirmRandomFleet(ada);
      await confirmRandomFleet(grace);
      await expectInView(ada.page.getByText(STARTS_IN), 'the start countdown in placement');
      await endStartCountdown([ada, grace], skipServerClock);
      await expect(mainHeading(ada.page)).toHaveText(turnHeadings(grace));
      await expect(turnTimer(ada.page)).toBeVisible();
      await expectNoHorizontalScroll(ada.page, 'battle');
      if (screen.isMobile) {
        // One board at a time on a narrow screen; Fire sits under Enemy waters.
        await ada.page.getByRole('button', { name: BATTLE_TEXT.enemyWaters, exact: true }).click();
      }
      await expectInView(turnTimer(ada.page), 'the turn timer');
      await expectInView(ada.page.getByRole('button', { name: BATTLE_TEXT.fire, exact: true }), '"Fire"');
    });
  }
}
