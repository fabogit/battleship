import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { PRESENCE_TEXT } from '../../client/src/app/features/presence/presence.text';
import { test, expect } from '../src/fixtures.ts';
import { ALL_CELLS, board, cell, cellLabels, fire, firstShooter, mainHeading, startBattle } from '../src/flows.ts';

test('a reload mid-match brings the same boards back, and the match goes on', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await startBattle(ada, grace, skipServerClock);

  // Two turns each, so both of Ada's boards carry shots: the first cells of the board, a miss or a hit.
  let shooter = await firstShooter([ada, grace]);
  const shots = [...ALL_CELLS];
  for (let turn = 0; turn < 4; turn++) {
    await fire(shooter, shots[Math.floor(turn / 2)] ?? '');
    shooter = shooter === ada ? grace : ada;
    await expect(mainHeading(shooter.page)).toHaveText(BATTLE_TEXT.myTurn);
  }
  const heading = await mainHeading(ada.page).textContent();
  const myFleet = await cellLabels(board(ada.page, BATTLE_TEXT.myFleet));
  const enemyWaters = await cellLabels(board(ada.page, BATTLE_TEXT.enemyWaters));

  await ada.page.reload();

  await expect(mainHeading(ada.page)).toHaveText(heading ?? '');
  await expect.poll(() => cellLabels(board(ada.page, BATTLE_TEXT.myFleet))).toEqual(myFleet);
  await expect.poll(() => cellLabels(board(ada.page, BATTLE_TEXT.enemyWaters))).toEqual(enemyWaters);
  await expect(grace.page.getByText(PRESENCE_TEXT.back('Ada'))).toBeVisible();

  // The match goes on: each fires once more, and the other sees the shot land on their board.
  for (let turn = 0; turn < 2; turn++) {
    const target = shooter === ada ? grace : ada;
    await fire(shooter, 'C1');
    await expect(cell(board(target.page, BATTLE_TEXT.myFleet), 'C1')).toHaveAccessibleName(/^C1, (miss|hit|sunk)$/);
    await expect(mainHeading(target.page)).toHaveText(BATTLE_TEXT.myTurn);
    shooter = target;
  }
});
