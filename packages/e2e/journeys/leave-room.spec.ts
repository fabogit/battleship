import { HOME_TEXT } from '../../client/src/app/features/home/home.text';
import { LOBBY_TEXT } from '../../client/src/app/features/lobby/lobby.text';
import { PRESENCE_TEXT } from '../../client/src/app/features/presence/presence.text';
import { ROOM_TEXT } from '../../client/src/app/features/room/room.text';
import { test, expect } from '../src/fixtures.ts';
import { enterPlacement, mainHeading } from '../src/flows.ts';

test('"Leave room" during placement frees the seat and takes the leaver home', async ({ openPlayer }) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await enterPlacement(ada, grace);

  await grace.page.getByRole('button', { name: ROOM_TEXT.leave }).click();

  await expect(grace.page).toHaveURL('/');
  await expect(mainHeading(grace.page)).toHaveText(HOME_TEXT.heading);
  await expect(ada.page.getByText(PRESENCE_TEXT.departed('Grace'))).toBeVisible();
  await expect(mainHeading(ada.page)).toHaveText(LOBBY_TEXT.heading);
});
