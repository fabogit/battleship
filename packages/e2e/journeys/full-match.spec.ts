import { GAME_OVER_REASONS } from '@battleship/core';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { test, expect } from '../src/fixtures.ts';
import { ALL_CELLS, board, fire, firstShooter, mainHeading, shipCells, startBattle } from '../src/flows.ts';

test('a full match from create and join to game over, with the fleet revealed', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await startBattle(ada, grace, skipServerClock);

  // Ada wins: she fires only at Grace's ships, read off Grace's own board, and Grace only at Ada's empty water.
  const adaFleet = await shipCells(board(ada.page, BATTLE_TEXT.myFleet));
  const graceFleet = await shipCells(board(grace.page, BATTLE_TEXT.myFleet));
  expect(graceFleet).toHaveLength(17);
  const targets = new Map([
    [ada, [...graceFleet]],
    [grace, ALL_CELLS.filter((name) => !adaFleet.includes(name))],
  ]);

  let shooter = await firstShooter([ada, grace]);
  for (;;) {
    const shots = targets.get(shooter) ?? [];
    await fire(shooter, shots.shift() ?? '');
    if (targets.get(ada)?.length === 0) {
      break;
    }
    // No extra turn on a hit (DEFAULT_RULES): the turn always passes.
    shooter = shooter === ada ? grace : ada;
    await expect(mainHeading(shooter.page)).toHaveText(BATTLE_TEXT.myTurn);
  }

  await expect(mainHeading(ada.page)).toHaveText(BATTLE_TEXT.wonHeading);
  await expect(ada.page.getByText(BATTLE_TEXT.reasons[GAME_OVER_REASONS.FLEET_DESTROYED]('Grace', true))).toBeVisible();
  await expect(mainHeading(grace.page)).toHaveText(BATTLE_TEXT.lostHeading);
  await expect(
    grace.page.getByText(BATTLE_TEXT.reasons[GAME_OVER_REASONS.FLEET_DESTROYED]('Ada', false)),
  ).toBeVisible();

  // Grace never hit anything, so her Enemy waters now shows Ada's whole fleet, every ship one she did not find.
  await expect(grace.page.getByText(BATTLE_TEXT.revealed('Ada'))).toBeVisible();
  expect(await shipCells(board(grace.page, BATTLE_TEXT.enemyWaters)), "Ada's fleet on Grace's Enemy waters").toEqual(
    adaFleet,
  );
  await expect(ada.page.getByText(BATTLE_TEXT.revealed('Grace'))).toBeVisible();
  for (const player of [ada, grace]) {
    await expect(player.page.getByRole('link', { name: BATTLE_TEXT.newMatch })).toBeVisible();
    await expect(player.page.getByRole('button', { name: BATTLE_TEXT.fire, exact: true })).toBeHidden();
  }
});
