import { GAME_OVER_REASONS } from '@battleship/core';

import { SURRENDER_PROMPTS } from '../../client/src/app/features/battle/battle-store';
import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { HOME_TEXT } from '../../client/src/app/features/home/home.text';
import { LOBBY_TEXT } from '../../client/src/app/features/lobby/lobby.text';
import { test, expect } from '../src/fixtures.ts';
import { mainHeading, startBattle } from '../src/flows.ts';

test('"Surrender" asks first, ends the match, and keeps the player in the room', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  const roomUrl = await startBattle(ada, grace, skipServerClock);
  const prompt = BATTLE_TEXT.surrenderPrompts[SURRENDER_PROMPTS.SURRENDER];
  const surrender = ada.page.getByRole('button', { name: BATTLE_TEXT.surrender });
  const dialog = ada.page.getByRole('dialog', { name: prompt.heading });

  // Esc closes the dialog without a word to the server, and focus goes back to the button.
  await surrender.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: BATTLE_TEXT.keepPlaying })).toBeFocused();
  await ada.page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(surrender).toBeFocused();

  await surrender.click();
  await dialog.getByRole('button', { name: prompt.confirm }).click();

  await expect(mainHeading(ada.page)).toHaveText(BATTLE_TEXT.lostHeading);
  await expect(ada.page.getByText(BATTLE_TEXT.reasons[GAME_OVER_REASONS.SURRENDER]('Grace', false))).toBeVisible();
  await expect(mainHeading(ada.page)).toBeFocused();
  await expect(ada.page).toHaveURL(roomUrl);
  await expect(surrender).toHaveCount(0);
  await expect(mainHeading(grace.page)).toHaveText(BATTLE_TEXT.wonHeading);
  await expect(grace.page.getByText(BATTLE_TEXT.reasons[GAME_OVER_REASONS.SURRENDER]('Ada', true))).toBeVisible();
});

test('leaving the room during the match asks first, and confirming surrenders it', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  const roomUrl = await startBattle(ada, grace, skipServerClock);
  const prompt = BATTLE_TEXT.surrenderPrompts[SURRENDER_PROMPTS.LEAVE];
  const dialog = ada.page.getByRole('dialog', { name: prompt.heading });
  const brandLink = ada.page.getByRole('banner').getByRole('link', { name: 'Battleship' });

  // The browser's Back button asks too; "Keep playing" stays in the room, and history stays as it was.
  await ada.page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: BATTLE_TEXT.keepPlaying }).click();
  await expect(dialog).toBeHidden();
  await expect(ada.page).toHaveURL(roomUrl);
  await expect(ada.page.getByRole('grid', { name: BATTLE_TEXT.enemyWaters })).toBeVisible();

  // The next Back asks again: the cancelled one left the history as it was ('computed', ADR-0117), where 'replace'
  // would have let this one leave the app.
  await ada.page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: BATTLE_TEXT.keepPlaying }).click();
  await expect(dialog).toBeHidden();
  await expect(ada.page).toHaveURL(roomUrl);

  // The header's link home, confirmed: the surrender goes out, then LEAVE_ROOM frees the seat (ADR-0126), then the page
  // goes home. Grace won, and waits for someone new with the result still readable.
  await brandLink.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: prompt.confirm }).click();

  await expect(ada.page).toHaveURL('/');
  await expect(mainHeading(ada.page)).toHaveText(HOME_TEXT.heading);
  await expect(mainHeading(grace.page)).toHaveText(LOBBY_TEXT.heading);
  await expect(grace.page.getByText(BATTLE_TEXT.reasons[GAME_OVER_REASONS.SURRENDER]('Ada', true))).toBeVisible();
});
