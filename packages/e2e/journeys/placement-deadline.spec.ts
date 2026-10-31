import { FLEET, PLACEMENT_TIME_LIMIT_MS, SHIP_LENGTH } from '@battleship/core';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { PLACEMENT_TEXT } from '../../client/src/app/features/placement/placement.text';
import { test, expect } from '../src/fixtures.ts';
import { board, confirmRandomFleet, enterPlacement, mainHeading, shipCells, turnHeadings } from '../src/flows.ts';

/** How many cells a whole fleet covers: 17. */
const FLEET_CELLS = FLEET.reduce((cells, type) => cells + SHIP_LENGTH[type], 0);

test('the placement deadline completes and locks the fleet nobody confirmed, and the battle starts', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await enterPlacement(ada, grace);

  // Ada confirms a random fleet; Grace places nothing.
  await confirmRandomFleet(ada);
  await expect(ada.page.getByRole('button', { name: PLACEMENT_TEXT.unlock })).toBeVisible();
  const adaFleet = await shipCells(board(ada.page, PLACEMENT_TEXT.boardLabel));
  expect(adaFleet).toHaveLength(FLEET_CELLS);
  await expect(ada.page.getByText(PLACEMENT_TEXT.opponentPlacing('Grace'))).toBeVisible();
  await expect(grace.page.getByText(PLACEMENT_TEXT.opponentReady('Ada'))).toBeVisible();
  expect(await shipCells(board(grace.page, PLACEMENT_TEXT.boardLabel))).toEqual([]);

  // The deadline completes Grace's fleet from her empty draft, locks it, and the battle starts at once (ADR-0090).
  await skipServerClock(PLACEMENT_TIME_LIMIT_MS);
  await expect(mainHeading(ada.page)).toHaveText(turnHeadings(grace));
  await expect(mainHeading(grace.page)).toHaveText(turnHeadings(ada));
  expect(await shipCells(board(grace.page, BATTLE_TEXT.myFleet))).toHaveLength(FLEET_CELLS);
  expect(await shipCells(board(ada.page, BATTLE_TEXT.myFleet))).toEqual(adaFleet);
});
