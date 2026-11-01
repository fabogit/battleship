import { GAME_OVER_TTL_MS, NEGOTIATION_TTL_MS, WAITING_TTL_MS } from '@battleship/core';

import { HOME_TEXT } from '../../client/src/app/features/home/home.text';
import { ROOM_TEXT } from '../../client/src/app/features/room/room.text';
import { RULES_TEXT } from '../../client/src/app/features/rules/rules.text';
import { wholeMinutes } from '../../client/src/app/shared/countdown';
import { test, expect } from '../src/fixtures.ts';
import { createRoom, joinRoom, mainHeading } from '../src/flows.ts';

test('two players who never both confirm the rules lose the room after NEGOTIATION_TTL_MS', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  const firstUrl = await createRoom(ada);
  await joinRoom(grace, firstUrl);
  const minutes = wholeMinutes(NEGOTIATION_TTL_MS);
  await expect(ada.page.getByText(RULES_TEXT.intro('Grace', minutes))).toBeVisible();
  await expect(grace.page.getByText(RULES_TEXT.intro('Ada', minutes))).toBeVisible();

  // An edit and one confirmation do not keep the room: only the second confirmation would (ADR-0102).
  await ada.page.getByRole('switch', { name: RULES_TEXT.adjacentShips }).click();
  await expect(grace.page.getByRole('switch', { name: RULES_TEXT.adjacentShips })).toBeChecked();
  await grace.page.getByRole('button', { name: RULES_TEXT.confirm }).click();
  await expect(grace.page.getByRole('button', { name: RULES_TEXT.confirmed })).toBeVisible();

  await skipServerClock(NEGOTIATION_TTL_MS);

  // The server says so (`ROOM_CLOSED`) to both: the rules screen gives way to the closed room.
  const reason = ROOM_TEXT.closedReasons.NEGOTIATION_TTL(
    wholeMinutes(WAITING_TTL_MS),
    wholeMinutes(GAME_OVER_TTL_MS),
    minutes,
  );
  for (const { page } of [ada, grace]) {
    await expect(mainHeading(page)).toHaveText(ROOM_TEXT.closedHeading);
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByRole('switch', { name: RULES_TEXT.adjacentShips })).toBeHidden();
  }

  await grace.page.getByRole('link', { name: ROOM_TEXT.createOwn }).click();
  await expect(mainHeading(grace.page)).toHaveText(HOME_TEXT.heading);
  const secondUrl = await createRoom(grace);
  expect(secondUrl).not.toBe(firstUrl);
});
