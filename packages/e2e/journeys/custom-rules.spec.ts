import type { Page } from '@playwright/test';
import { ORIENTATIONS, SHIP_TYPES, TIMEOUT_ACTIONS, type ShipType } from '@battleship/core';

import { PLACEMENT_TEXT } from '../../client/src/app/features/placement/placement.text';
import { RULES_TEXT } from '../../client/src/app/features/rules/rules.text';
import { test, expect } from '../src/fixtures.ts';
import { board, cell, createRoom, joinRoom, mainHeading } from '../src/flows.ts';

/** A fleet in five stacked rows from A1, each ship touching the next: only legal with "Ships may touch". */
const TOUCHING_FLEET: readonly (readonly [ShipType, string])[] = [
  [SHIP_TYPES.CARRIER, 'A1'],
  [SHIP_TYPES.BATTLESHIP, 'B1'],
  [SHIP_TYPES.CRUISER, 'C1'],
  [SHIP_TYPES.SUBMARINE, 'D1'],
  [SHIP_TYPES.DESTROYER, 'E1'],
];

/**
 * Asserts that a page shows a sentence, naming the sentence when it does not.
 * @param page The player's page.
 * @param sentence The whole sentence, e.g. a rules notice.
 */
async function expectSentence(page: Page, sentence: string): Promise<void> {
  await expect(page.getByText(sentence), `"${sentence}"`).toBeVisible();
}

test('two players agree on custom rules, and placement lets ships touch', async ({ openPlayer }) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await joinRoom(grace, await createRoom(ada));
  await expect(mainHeading(ada.page)).toHaveText(RULES_TEXT.heading);

  // Each edit shows on the other screen, with a notice naming who made it.
  await ada.page.getByRole('switch', { name: RULES_TEXT.adjacentShips }).click();
  await expect(grace.page.getByRole('switch', { name: RULES_TEXT.adjacentShips })).toBeChecked();
  await expectSentence(grace.page, `Ada ${RULES_TEXT.changes.areAdjacentShipsAllowed(true)}.`);

  await grace.page.getByRole('radio', { name: RULES_TEXT.secondsName(60) }).click();
  await expect(ada.page.getByRole('radio', { name: RULES_TEXT.secondsName(60) })).toBeChecked();
  await expectSentence(ada.page, `Grace ${RULES_TEXT.changes.turnTimeLimitSeconds(60)}.`);

  const passTurn = RULES_TEXT.timeoutActions[TIMEOUT_ACTIONS.PASS_TURN];
  await ada.page.getByRole('radio', { name: passTurn }).click();
  await expect(grace.page.getByRole('radio', { name: passTurn })).toBeChecked();
  await expectSentence(grace.page, `Ada ${RULES_TEXT.changes.timeoutAction(TIMEOUT_ACTIONS.PASS_TURN)}.`);

  // Grace confirms first: Ada sees it, then confirms the same version, and both go on to placement.
  await grace.page.getByRole('button', { name: RULES_TEXT.confirm }).click();
  await expect(grace.page.getByRole('button', { name: RULES_TEXT.confirmed })).toBeVisible();
  await expectSentence(ada.page, RULES_TEXT.opponentConfirmed('Grace'));
  await expect(
    ada.page
      .getByRole('list', { name: RULES_TEXT.confirmationsLabel })
      .getByText(RULES_TEXT.confirmation('Grace', true)),
  ).toBeVisible();
  await ada.page.getByRole('button', { name: RULES_TEXT.confirm }).click();
  for (const { page } of [ada, grace]) {
    await expect(mainHeading(page)).toHaveText(PLACEMENT_TEXT.heading);
  }

  // Five ships in five touching rows: each placed, and the server locks the fleet.
  const dock = ada.page.getByRole('list', { name: PLACEMENT_TEXT.dockLabel });
  const myFleet = board(ada.page, PLACEMENT_TEXT.boardLabel);
  for (const [type, start] of TOUCHING_FLEET) {
    const name = PLACEMENT_TEXT.shipNames[type];
    await dock.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click();
    await cell(myFleet, start).click();
    await expectSentence(
      ada.page,
      PLACEMENT_TEXT.placedAt(name, start, PLACEMENT_TEXT.orientations[ORIENTATIONS.HORIZONTAL]),
    );
  }
  await ada.page.getByRole('button', { name: PLACEMENT_TEXT.confirm }).click();
  await expect(ada.page.getByRole('button', { name: PLACEMENT_TEXT.unlock })).toBeVisible();
  await expect(ada.page.getByText(PLACEMENT_TEXT.lockedHint)).toBeVisible();
});
