import { GAME_OVER_TTL_MS, WAITING_TTL_MS } from '@battleship/core';

import { HOME_TEXT } from '../../client/src/app/features/home/home.text';
import { LOBBY_TEXT } from '../../client/src/app/features/lobby/lobby.text';
import { ROOM_TEXT } from '../../client/src/app/features/room/room.text';
import { wholeMinutes } from '../../client/src/app/shared/countdown';
import { test, expect } from '../src/fixtures.ts';
import { createRoom, mainHeading } from '../src/flows.ts';

test('a room nobody joins closes after WAITING_TTL_MS, and its creator creates a new one', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const firstUrl = await createRoom(ada);
  await expect(ada.page.getByText(LOBBY_TEXT.instructions(wholeMinutes(WAITING_TTL_MS)))).toBeVisible();

  await skipServerClock(WAITING_TTL_MS);

  // The server says so (`ROOM_CLOSED`) while Ada waits: the waiting screen gives way to the closed room.
  await expect(mainHeading(ada.page)).toHaveText(ROOM_TEXT.closedHeading);
  await expect(
    ada.page.getByText(
      ROOM_TEXT.closedReasons.WAITING_TTL(wholeMinutes(WAITING_TTL_MS), wholeMinutes(GAME_OVER_TTL_MS)),
    ),
  ).toBeVisible();
  await expect(ada.page.getByRole('textbox', { name: LOBBY_TEXT.linkLabel })).toBeHidden();

  await ada.page.getByRole('link', { name: ROOM_TEXT.createOwn }).click();
  await expect(mainHeading(ada.page)).toHaveText(HOME_TEXT.heading);
  const secondUrl = await createRoom(ada);
  expect(secondUrl).not.toBe(firstUrl);
});
