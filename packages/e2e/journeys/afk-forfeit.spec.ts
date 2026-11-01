import { DEFAULT_RULES, GAME_OVER_REASONS, MAX_CONSECUTIVE_AFK_TURNS } from '@battleship/core';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { test, expect } from '../src/fixtures.ts';
import { fire, firstShooter, mainHeading, startBattle, startTurnTimer } from '../src/flows.ts';

/** A turn under the default rules, in ms. */
const TURN_LIMIT_MS = DEFAULT_RULES.turnTimeLimitSeconds * 1_000;

test('a player who lets three turns in a row run out loses by AFK forfeit', async ({ openPlayer, skipServerClock }) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await startBattle(ada, grace, skipServerClock);
  // Whoever the dice pick stops playing; the other fires on every turn of theirs.
  const idle = await firstShooter([ada, grace]);
  const active = idle === ada ? grace : ada;
  await startTurnTimer([ada, grace], skipServerClock);

  for (const [timedOut, target] of ['A1', 'A2'].slice(0, MAX_CONSECUTIVE_AFK_TURNS - 1).entries()) {
    await skipServerClock(TURN_LIMIT_MS);
    await expect(mainHeading(active.page)).toHaveText(BATTLE_TEXT.myTurn);
    // Both are told how many timeouts in a row are left before the idle player loses (ADR-0109).
    const left = MAX_CONSECUTIVE_AFK_TURNS - (timedOut + 1);
    await expect(idle.page.getByText(BATTLE_TEXT.myAfk(left))).toBeVisible();
    await expect(active.page.getByText(BATTLE_TEXT.opponentAfk(idle.nickname, left))).toBeVisible();
    await fire(active, target);
    await expect(mainHeading(idle.page)).toHaveText(BATTLE_TEXT.myTurn);
  }
  await skipServerClock(TURN_LIMIT_MS);

  await expect(mainHeading(idle.page)).toHaveText(BATTLE_TEXT.lostHeading);
  await expect(
    idle.page.getByText(BATTLE_TEXT.reasons[GAME_OVER_REASONS.AFK_FORFEIT](active.nickname, false)),
  ).toBeVisible();
  await expect(mainHeading(active.page)).toHaveText(BATTLE_TEXT.wonHeading);
  await expect(
    active.page.getByText(BATTLE_TEXT.reasons[GAME_OVER_REASONS.AFK_FORFEIT](idle.nickname, true)),
  ).toBeVisible();
});
