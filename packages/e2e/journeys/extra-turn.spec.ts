import { DEFAULT_RULES, SHOT_OUTCOMES } from '@battleship/core';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { RULES_TEXT } from '../../client/src/app/features/rules/rules.text';
import { test, expect } from '../src/fixtures.ts';
import {
  SPREAD_FLEET,
  agreeOnRules,
  createRoom,
  endStartCountdown,
  fire,
  firstShooter,
  joinRoom,
  mainHeading,
  placeFleet,
  startTurnTimer,
  timerSeconds,
  turnTimer,
} from '../src/flows.ts';

/** A turn under the default rules, in ms. */
const TURN_LIMIT_MS = DEFAULT_RULES.turnTimeLimitSeconds * 1_000;

test('extra turn on hit: a hit keeps the turn, both pages say so, and the turn timer restarts (#33)', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await joinRoom(grace, await createRoom(ada));

  // Ada turns extra turn on hit on: salvo is then inactive on both screens, saying why (ADR-0119).
  await ada.page.getByRole('switch', { name: RULES_TEXT.extraTurn }).click();
  for (const { page } of [ada, grace]) {
    await expect(page.getByRole('switch', { name: RULES_TEXT.extraTurn })).toBeChecked();
    const salvo = page.getByRole('switch', { name: RULES_TEXT.salvo });
    await expect(salvo).toHaveAttribute('aria-disabled', 'true');
    await expect(salvo).toHaveAccessibleDescription(RULES_TEXT.excluded.isSalvoModeEnabled);
  }
  await agreeOnRules([ada, grace]);

  await placeFleet(ada, SPREAD_FLEET);
  await placeFleet(grace, SPREAD_FLEET);
  await endStartCountdown([ada, grace], skipServerClock);
  await startTurnTimer([ada, grace], skipServerClock);
  const shooter = await firstShooter([ada, grace]);
  const other = shooter === ada ? grace : ada;

  // Two thirds of the turn go by on the server: without a restart, the hit's turn would have 10 seconds left.
  await skipServerClock(TURN_LIMIT_MS - 10_000);
  await fire(shooter, 'I1');

  await expect(
    shooter.page.getByText(
      `${BATTLE_TEXT.myShot('I1', SHOT_OUTCOMES.HIT, null, other.nickname)} ${BATTLE_TEXT.myFireAgain}`,
    ),
  ).toBeVisible();
  await expect(
    other.page.getByText(
      `${BATTLE_TEXT.opponentShot('I1', SHOT_OUTCOMES.HIT, null, shooter.nickname)} ${BATTLE_TEXT.opponentFiresAgain(shooter.nickname)}`,
    ),
  ).toBeVisible();
  await expect(mainHeading(shooter.page)).toHaveText(BATTLE_TEXT.myTurn);
  await expect(mainHeading(other.page)).toHaveText(BATTLE_TEXT.opponentTurn(shooter.nickname));
  for (const { page } of [shooter, other]) {
    expect(await timerSeconds(turnTimer(page))).toBeGreaterThan(20);
  }

  // A miss ends the extra turn.
  await fire(shooter, 'J10');
  await expect(mainHeading(other.page)).toHaveText(BATTLE_TEXT.myTurn);
  await expect(mainHeading(shooter.page)).toHaveText(BATTLE_TEXT.opponentTurn(other.nickname));
});
