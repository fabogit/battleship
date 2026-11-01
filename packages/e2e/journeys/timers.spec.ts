import { DEFAULT_RULES, PLACEMENT_TIME_LIMIT_MS } from '@battleship/core';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { PLACEMENT_TEXT } from '../../client/src/app/features/placement/placement.text';
import { LOW_TIME_MS } from '../../client/src/app/shared/countdown';
import { test, expect } from '../src/fixtures.ts';
import {
  confirmRandomFleet,
  diceResult,
  endStartCountdown,
  enterPlacement,
  mainHeading,
  placementTimer,
  timerSeconds,
  turnHeadings,
  turnTimer,
} from '../src/flows.ts';

/** A turn under the default rules, in seconds. */
const TURN_LIMIT_SECONDS = DEFAULT_RULES.turnTimeLimitSeconds;

/** Seconds a countdown may lose to real time between a skip and the assertion after it: a reload, a render. */
const SLACK_SECONDS = 5;

// The pages count down from their last snapshot, and a skip of the server's clock sends none: a page learns how much
// time is left from the next STATE, which a reload brings (ADR-0094). So each reload below shows the server's time.
test('the placement, start and turn countdowns and the dice roll show, and stay in sync after a reload', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await enterPlacement(ada, grace);

  // The placement deadline, on both pages, from the whole minute.
  for (const { page } of [ada, grace]) {
    await expect(placementTimer(page)).toBeVisible();
    expect(await timerSeconds(placementTimer(page))).toBeGreaterThan(PLACEMENT_TIME_LIMIT_MS / 1_000 - SLACK_SECONDS);
  }
  await skipServerClock(PLACEMENT_TIME_LIMIT_MS / 2);
  await grace.page.reload();
  await expect(placementTimer(grace.page)).toBeVisible();
  expect(await timerSeconds(placementTimer(grace.page))).toBeLessThanOrEqual(PLACEMENT_TIME_LIMIT_MS / 2 / 1_000);
  expect(await timerSeconds(placementTimer(grace.page))).toBeGreaterThan(
    PLACEMENT_TIME_LIMIT_MS / 2 / 1_000 - SLACK_SECONDS,
  );

  // The start countdown, on both pages, then the dice: both see them roll and end on the same starter.
  await confirmRandomFleet(ada);
  await confirmRandomFleet(grace);
  await endStartCountdown([ada, grace], skipServerClock);
  await Promise.all(
    [ada, grace].map(async ({ page }) => {
      await expect(mainHeading(page)).toHaveText(BATTLE_TEXT.diceHeading);
    }),
  );
  const results = await Promise.all(
    (
      [
        [ada, grace],
        [grace, ada],
      ] as const
    ).map(async ([player, opponent]) => {
      const result = player.page.getByText(diceResult(opponent));
      await expect(result).toBeVisible();
      return (await result.textContent()) ?? '';
    }),
  );
  const starter = results[0]?.endsWith(': you start.') === true ? ada : grace;
  const other = starter === ada ? grace : ada;
  expect(results[1]?.endsWith(': you start.')).toBe(starter === grace);

  // The animation ends on who starts, and the first turn's timer runs on both pages.
  await expect(mainHeading(starter.page)).toHaveText(BATTLE_TEXT.myTurn);
  await expect(mainHeading(other.page)).toHaveText(BATTLE_TEXT.opponentTurn(starter.nickname));
  for (const { page } of [ada, grace]) {
    await expect(turnTimer(page)).toBeVisible();
    expect(await timerSeconds(turnTimer(page))).toBeGreaterThan(TURN_LIMIT_SECONDS - SLACK_SECONDS);
  }

  // Skip to the turn's last seconds: after a reload both pages show the time the server has left, the low-time
  // warning, and the same starter, though the dice are not shown again (ADR-0106).
  const lowSeconds = LOW_TIME_MS / 1_000;
  await skipServerClock(((await timerSeconds(turnTimer(starter.page))) - lowSeconds) * 1_000);
  await Promise.all([starter.page.reload(), other.page.reload()]);
  for (const player of [starter, other]) {
    await expect(turnTimer(player.page)).toBeVisible();
    expect(await timerSeconds(turnTimer(player.page))).toBeLessThanOrEqual(lowSeconds);
    await expect(mainHeading(player.page)).toHaveText(turnHeadings(player === starter ? other : starter));
  }
  await expect(mainHeading(starter.page)).toHaveText(BATTLE_TEXT.myTurn);
  await expect(starter.page.getByText(BATTLE_TEXT.myTimeLow[DEFAULT_RULES.timeoutAction])).toBeVisible();
  await expect(other.page.getByText(BATTLE_TEXT.opponentTimeLow(starter.nickname))).toBeVisible();
});

test('the placement deadline warns over its last seconds, after a reload too', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await enterPlacement(ada, grace);
  await expect(placementTimer(ada.page)).toBeVisible();

  await skipServerClock(PLACEMENT_TIME_LIMIT_MS - LOW_TIME_MS + 1_000);
  await ada.page.reload();

  await expect(placementTimer(ada.page)).toBeVisible();
  expect(await timerSeconds(placementTimer(ada.page))).toBeLessThan(LOW_TIME_MS / 1_000);
  await expect(ada.page.getByText(PLACEMENT_TEXT.timeLow)).toBeVisible();
  // Nobody confirmed: the deadline completes both fleets and starts the match.
  await skipServerClock(LOW_TIME_MS);
  await expect(mainHeading(ada.page)).toHaveText(turnHeadings(grace));
});
