import { DISCONNECT_FORFEIT_MS, GAME_OVER_REASONS } from '@battleship/core';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { PRESENCE_TEXT } from '../../client/src/app/features/presence/presence.text';
import { test, expect } from '../src/fixtures.ts';
import { escape, mainHeading, startBattle } from '../src/flows.ts';

test('a player away past DISCONNECT_FORFEIT_MS loses by forfeit', async ({ openPlayer, skipServerClock }) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  const roomUrl = await startBattle(ada, grace);

  await grace.page.close();

  // The server noticed: Ada's banner says so and counts down Grace's forfeit, from the snapshot's remaining time.
  await expect(ada.page.getByText(PRESENCE_TEXT.away('Grace'))).toBeVisible();
  const countdown = new RegExp(`^${escape(PRESENCE_TEXT.forfeitsMatch('Grace', '@')).replace('@', '\\d+:\\d{2}')}$`);
  await expect(ada.page.getByRole('timer').filter({ hasText: countdown })).toBeVisible();

  await skipServerClock(DISCONNECT_FORFEIT_MS);

  await expect(mainHeading(ada.page)).toHaveText(BATTLE_TEXT.wonHeading);
  await expect(
    ada.page.getByText(BATTLE_TEXT.reasons[GAME_OVER_REASONS.DISCONNECT_FORFEIT]('Grace', true)),
  ).toBeVisible();

  // Grace opens the link again: her session still holds the seat, and she sees the loss.
  grace.page = await grace.context.newPage();
  await grace.page.goto(roomUrl);
  await expect(mainHeading(grace.page)).toHaveText(BATTLE_TEXT.lostHeading);
  await expect(
    grace.page.getByText(BATTLE_TEXT.reasons[GAME_OVER_REASONS.DISCONNECT_FORFEIT]('Ada', false)),
  ).toBeVisible();
});
