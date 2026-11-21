import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { RULES_TEXT } from '../../client/src/app/features/rules/rules.text';
import { test, expect } from '../src/fixtures.ts';
import {
  SPREAD_FLEET,
  agreeOnRules,
  board,
  cell,
  createRoom,
  endStartCountdown,
  firstShooter,
  joinRoom,
  mainHeading,
  placeFleet,
  startTurnTimer,
} from '../src/flows.ts';

/** A phone held upright, as the acceptance criterion of #34 asks: "Salvo match playable on a phone". */
const PHONE = { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true } as const;

/** Five targets: the destroyer of `SPREAD_FLEET` on I1–I2, and three cells of row J, which is all water. */
const SALVO = ['I1', 'I2', 'J8', 'J9', 'J10'] as const;

test('a salvo match on a phone: salvo agreed on the rules screen, a five-target salvo sinks a ship and lowers the allowance', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada', PHONE);
  const grace = await openPlayer('Grace', PHONE);
  await joinRoom(grace, await createRoom(ada));

  // Grace turns salvo on: both screens show it, and extra turn on hit is inactive on both, saying why (ADR-0119).
  await grace.page.getByRole('switch', { name: RULES_TEXT.salvo }).click();
  await expect(ada.page.getByText(`Grace ${RULES_TEXT.changes.isSalvoModeEnabled(true)}.`)).toBeVisible();
  for (const { page } of [ada, grace]) {
    await expect(page.getByRole('switch', { name: RULES_TEXT.salvo })).toBeChecked();
    const extraTurn = page.getByRole('switch', { name: RULES_TEXT.extraTurn });
    await expect(extraTurn).toHaveAttribute('aria-disabled', 'true');
    await expect(extraTurn).toHaveAccessibleDescription(RULES_TEXT.excluded.isExtraTurnOnHitEnabled);
  }
  await agreeOnRules([ada, grace]);

  await placeFleet(ada, SPREAD_FLEET);
  await placeFleet(grace, SPREAD_FLEET);
  await endStartCountdown([ada, grace], skipServerClock);
  await startTurnTimer([ada, grace], skipServerClock);
  const shooter = await firstShooter([ada, grace]);
  const other = shooter === ada ? grace : ada;
  await expect(shooter.page.getByText(BATTLE_TEXT.mySalvoTurnHint(5))).toBeVisible();
  await expect(other.page.getByText(BATTLE_TEXT.opponentSalvoTurnHint(shooter.nickname, 5))).toBeVisible();

  // Five taps, each announced with the count; "Fire" stays in view on the phone and fires at the fifth.
  const { page } = shooter;
  const enemyWaters = board(page, BATTLE_TEXT.enemyWaters);
  const fire = page.getByRole('button', { name: BATTLE_TEXT.fire, exact: true });
  await expect(
    page.getByText(BATTLE_TEXT.salvoAiming(BATTLE_TEXT.targetCount({ picked: 0, allowed: 5 }), '')),
  ).toBeVisible();
  for (const [index, target] of SALVO.entries()) {
    await expect(fire).toHaveAttribute('aria-disabled', 'true');
    await cell(enemyWaters, target).click();
    await expect(
      page.getByText(BATTLE_TEXT.targeted(target, BATTLE_TEXT.targetCount({ picked: index + 1, allowed: 5 }))),
    ).toBeVisible();
  }
  await expect(page.getByText(`5 of 5 targets: ${SALVO.join(', ')}.`)).toBeVisible();
  await expect(fire).toBeInViewport({ ratio: 1 });
  await expect(fire).not.toHaveAttribute('aria-disabled');
  await fire.click();

  // One message per turn on each page, and the allowance the sunk destroyer leaves the other player.
  const results = 'hits on I1 and I2, misses on J8, J9 and J10.';
  await expect(
    page.getByText(
      `${BATTLE_TEXT.mySalvo(5)}: ${results} ${BATTLE_TEXT.mySinks('destroyer', other.nickname)} ${BATTLE_TEXT.opponentAllowance(other.nickname, 4)}`,
    ),
  ).toBeVisible();
  await expect(
    other.page.getByText(
      `${BATTLE_TEXT.opponentSalvo(shooter.nickname, 5)}: ${results} ${BATTLE_TEXT.opponentSinks('destroyer', shooter.nickname)} ${BATTLE_TEXT.myAllowance(4)}`,
    ),
  ).toBeVisible();
  await expect(mainHeading(other.page)).toHaveText(BATTLE_TEXT.myTurn);
  await expect(other.page.getByText(BATTLE_TEXT.mySalvoTurnHint(4))).toBeVisible();
  await expect(
    other.page.getByText(BATTLE_TEXT.salvoAiming(BATTLE_TEXT.targetCount({ picked: 0, allowed: 4 }), '')),
  ).toBeVisible();
  await expect(page.getByText(BATTLE_TEXT.opponentSalvoTurnHint(other.nickname, 4))).toBeVisible();
});
