import type { Locator } from '@playwright/test';
import { GAME_OVER_REASONS, REMATCH_CHOICES, TIMEOUT_ACTIONS } from '@battleship/core';

import { SURRENDER_PROMPTS } from '../../client/src/app/features/battle/battle-store';
import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { HOME_TEXT } from '../../client/src/app/features/home/home.text';
import { LOBBY_TEXT } from '../../client/src/app/features/lobby/lobby.text';
import { PLACEMENT_TEXT } from '../../client/src/app/features/placement/placement.text';
import { PRESENCE_TEXT } from '../../client/src/app/features/presence/presence.text';
import { RULES_TEXT } from '../../client/src/app/features/rules/rules.text';
import { test, expect, type Player } from '../src/fixtures.ts';
import {
  agreeOnRules,
  board,
  confirmRandomFleet,
  endStartCountdown,
  fire,
  firstShooter,
  joinRoom,
  mainHeading,
  shipCells,
  startBattle,
  turnHeadings,
} from '../src/flows.ts';

/** The rematch's words. */
const TEXT = BATTLE_TEXT.rematch;

/**
 * Surrenders the match with "Surrender" and its dialog; both players then see the game over.
 * @param loser The player who gives up.
 * @param winner The other player.
 */
async function surrender(loser: Player, winner: Player): Promise<void> {
  await loser.page.getByRole('button', { name: BATTLE_TEXT.surrender, exact: true }).click();
  await loser.page
    .getByRole('dialog')
    .getByRole('button', { name: BATTLE_TEXT.surrenderPrompts[SURRENDER_PROMPTS.SURRENDER].confirm })
    .click();
  await expect(mainHeading(loser.page)).toHaveText(BATTLE_TEXT.lostHeading);
  await expect(mainHeading(winner.page)).toHaveText(BATTLE_TEXT.wonHeading);
}

/**
 * A rematch toggle.
 * @param player The player whose page it is on.
 * @param name `TEXT.playAgain` or `TEXT.changeRules`.
 * @returns The button.
 */
function toggle(player: Player, name: string): Locator {
  return player.page.getByRole('button', { name, exact: true });
}

test('both players play again: placement starts empty, the dice roll, and a second match runs', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await startBattle(ada, grace, skipServerClock);
  await surrender(grace, ada);

  await toggle(ada, TEXT.playAgain).click();
  await expect(toggle(ada, TEXT.playAgain)).toHaveAttribute('aria-pressed', 'true');
  await expect(grace.page.getByText(TEXT.theirs('Ada', REMATCH_CHOICES.SAME_RULES))).toBeVisible();
  await toggle(grace, TEXT.playAgain).click();

  for (const player of [ada, grace]) {
    await expect(mainHeading(player.page)).toHaveText(PLACEMENT_TEXT.heading);
    // Focus moves to the new view's heading (ADR-0126); the last fleet is not offered again (ADR-0125).
    await expect(mainHeading(player.page)).toBeFocused();
    expect(await shipCells(board(player.page, PLACEMENT_TEXT.boardLabel)), `${player.nickname}'s draft`).toEqual([]);
  }
  await confirmRandomFleet(ada);
  await confirmRandomFleet(grace);
  await endStartCountdown([ada, grace], skipServerClock);
  for (const player of [ada, grace]) {
    await expect(mainHeading(player.page)).toHaveText(turnHeadings(player === ada ? grace : ada));
  }
  const shooter = await firstShooter([ada, grace]);
  await fire(shooter, 'A1');
  await expect(
    board(shooter.page, BATTLE_TEXT.enemyWaters).getByRole('button', { name: /^A1, (hit|miss)/ }),
  ).toBeVisible();
});

test('one player changes the rules: the rules screen shows the last rules, nobody confirmed, then placement', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await startBattle(ada, grace, skipServerClock, TIMEOUT_ACTIONS.PASS_TURN);
  await surrender(ada, grace);

  await toggle(ada, TEXT.changeRules).click();
  await expect(grace.page.getByText(TEXT.theirs('Ada', REMATCH_CHOICES.CHANGE_RULES))).toBeVisible();
  await toggle(grace, TEXT.playAgain).click();

  const passTurn = RULES_TEXT.timeoutActions[TIMEOUT_ACTIONS.PASS_TURN];
  for (const player of [ada, grace]) {
    await expect(mainHeading(player.page)).toHaveText(RULES_TEXT.heading);
    await expect(mainHeading(player.page)).toBeFocused();
    await expect(player.page.getByRole('radio', { name: passTurn })).toBeChecked();
    await expect(player.page.getByRole('button', { name: RULES_TEXT.confirm })).toBeVisible();
  }
  // Nobody confirmed, and the version is the same, so no changed-rules notice greets the new negotiation.
  await expect(ada.page.getByText(RULES_TEXT.opponentConfirmed('Grace'))).toBeHidden();
  await expect(ada.page.locator('.notice')).toHaveText('');

  const autoShot = RULES_TEXT.timeoutActions[TIMEOUT_ACTIONS.AUTO_RANDOM_SHOT];
  await ada.page.getByRole('radio', { name: autoShot }).click();
  await expect(grace.page.getByRole('radio', { name: autoShot })).toBeChecked();
  await agreeOnRules([ada, grace]);
});

test('one player leaves through the header link: home for them, the waiting screen with the result for the other, and a new player joins', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  const roomUrl = await startBattle(ada, grace, skipServerClock);
  await surrender(grace, ada);

  await grace.page.getByRole('link', { name: 'Battleship' }).click();

  await expect(grace.page).toHaveURL('/');
  await expect(mainHeading(grace.page)).toHaveText(HOME_TEXT.heading);
  await expect(mainHeading(ada.page)).toHaveText(LOBBY_TEXT.heading);
  await expect(ada.page.getByText(PRESENCE_TEXT.departed('Grace'))).toBeVisible();
  await expect(
    ada.page.getByText(
      LOBBY_TEXT.lastMatch(true, false, BATTLE_TEXT.reasons[GAME_OVER_REASONS.SURRENDER]('Grace', true)),
    ),
  ).toBeVisible();
  await expect(ada.page.getByRole('textbox', { name: LOBBY_TEXT.linkLabel })).toHaveValue(roomUrl);

  const linus = await openPlayer('Linus');
  await joinRoom(linus, roomUrl);
  await expect(mainHeading(ada.page)).toHaveText(RULES_TEXT.heading);
});

test('a surrender on the way out of the match: the opponent wins, then waits for someone new', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await startBattle(ada, grace, skipServerClock);

  await grace.page.getByRole('link', { name: 'Battleship' }).click();
  await grace.page
    .getByRole('dialog')
    .getByRole('button', { name: BATTLE_TEXT.surrenderPrompts[SURRENDER_PROMPTS.LEAVE].confirm })
    .click();

  await expect(grace.page).toHaveURL('/');
  await expect(mainHeading(ada.page)).toHaveText(LOBBY_TEXT.heading);
  await expect(ada.page.getByText(PRESENCE_TEXT.departed('Grace'))).toBeVisible();
  // The victory stays readable on the waiting screen (decision 4).
  await expect(
    ada.page.getByText(
      LOBBY_TEXT.lastMatch(true, false, BATTLE_TEXT.reasons[GAME_OVER_REASONS.SURRENDER]('Grace', true)),
    ),
  ).toBeVisible();
});
