import { START_COUNTDOWN_MS } from '@battleship/core';

import { PLACEMENT_TEXT } from '../../client/src/app/features/placement/placement.text';
import { test, expect } from '../src/fixtures.ts';
import {
  confirmRandomFleet,
  endStartCountdown,
  enterPlacement,
  mainHeading,
  STARTS_IN,
  turnHeadings,
} from '../src/flows.ts';

test('an unlock during the start countdown keeps the battle from starting, and a re-confirmation starts it', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await enterPlacement(ada, grace);
  await confirmRandomFleet(ada);
  await confirmRandomFleet(grace);
  for (const { page } of [ada, grace]) {
    await expect(page.getByText(STARTS_IN)).toBeVisible();
  }

  // Ada unlocks: the countdown is gone on both sides, and its end passes without a battle.
  await ada.page.getByRole('button', { name: PLACEMENT_TEXT.unlock }).click();
  await expect(ada.page.getByRole('button', { name: PLACEMENT_TEXT.confirm })).toBeVisible();
  await expect(grace.page.getByText(PLACEMENT_TEXT.opponentPlacing('Ada'))).toBeVisible();
  for (const { page } of [ada, grace]) {
    await expect(page.getByText(STARTS_IN)).toHaveCount(0);
  }
  await skipServerClock(START_COUNTDOWN_MS);

  // Ada confirms again: a new countdown on both pages, which a battle started by the old one would have replaced.
  await ada.page.getByRole('button', { name: PLACEMENT_TEXT.confirm }).click();
  for (const { page } of [ada, grace]) {
    await expect(mainHeading(page)).toHaveText(PLACEMENT_TEXT.heading);
  }
  await endStartCountdown([ada, grace], skipServerClock);
  await expect(mainHeading(ada.page)).toHaveText(turnHeadings(grace));
  await expect(mainHeading(grace.page)).toHaveText(turnHeadings(ada));
});
