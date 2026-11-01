import { DEFAULT_RULES, SHOT_OUTCOMES, TIMEOUT_ACTIONS } from '@battleship/core';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { test, expect } from '../src/fixtures.ts';
import {
  board,
  cell,
  escape,
  firedCells,
  firstShooter,
  mainHeading,
  startBattle,
  startTurnTimer,
  turnTimer,
} from '../src/flows.ts';

/** A turn under the default rules, in ms. */
const TURN_LIMIT_MS = DEFAULT_RULES.turnTimeLimitSeconds * 1_000;

/**
 * The start of the sentence announcing a random shot, up to its cell, whatever the shot found.
 * @param words `BATTLE_TEXT.myAutoShot` or `.opponentAutoShot`.
 * @param target The cell it landed on, e.g. `B7`.
 * @param nickname The nickname the sentence names.
 * @returns A pattern matching "Your time ran out: a random shot at B7…".
 */
function autoShotStart(words: typeof BATTLE_TEXT.myAutoShot, target: string, nickname: string): RegExp {
  const sentence = words(target, SHOT_OUTCOMES.MISS, null, nickname);
  return new RegExp(`^${escape(sentence.slice(0, sentence.indexOf(target) + target.length))}\\b`);
}

test('a turn that runs out of time fires a random shot for the player', async ({ openPlayer, skipServerClock }) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await startBattle(ada, grace, skipServerClock);
  const shooter = await firstShooter([ada, grace]);
  const other = shooter === ada ? grace : ada;
  await startTurnTimer([ada, grace], skipServerClock);

  await skipServerClock(TURN_LIMIT_MS);

  // The shot lands as if the player had fired it: on their Enemy waters and on the other's fleet, the same cell.
  await expect(mainHeading(shooter.page)).toHaveText(BATTLE_TEXT.opponentTurn(other.nickname));
  await expect(mainHeading(other.page)).toHaveText(BATTLE_TEXT.myTurn);
  const enemyWaters = board(shooter.page, BATTLE_TEXT.enemyWaters);
  await expect.poll(() => firedCells(enemyWaters)).toHaveLength(1);
  const fired = await firedCells(enemyWaters);
  await expect.poll(() => firedCells(board(other.page, BATTLE_TEXT.myFleet))).toEqual(fired);
  // Both are told that the shot was the server's, not the player's (ADR-0109).
  const [target = ''] = fired;
  await expect(shooter.page.getByText(autoShotStart(BATTLE_TEXT.myAutoShot, target, other.nickname))).toBeVisible();
  await expect(
    other.page.getByText(autoShotStart(BATTLE_TEXT.opponentAutoShot, target, shooter.nickname)),
  ).toBeVisible();
  // The next turn runs with its own time.
  await expect(turnTimer(other.page)).toBeVisible();
});

test('a turn that runs out of time passes under "Pass the turn", dropping the aim', async ({
  openPlayer,
  skipServerClock,
}) => {
  const ada = await openPlayer('Ada');
  const grace = await openPlayer('Grace');
  await startBattle(ada, grace, skipServerClock, TIMEOUT_ACTIONS.PASS_TURN);
  const shooter = await firstShooter([ada, grace]);
  const other = shooter === ada ? grace : ada;
  await startTurnTimer([ada, grace], skipServerClock);

  const enemyWaters = board(shooter.page, BATTLE_TEXT.enemyWaters);
  await cell(enemyWaters, 'C3').click();
  await expect(shooter.page.getByText(BATTLE_TEXT.aimingAt('C3'))).toBeVisible();

  await skipServerClock(TURN_LIMIT_MS);

  await expect(mainHeading(shooter.page)).toHaveText(BATTLE_TEXT.opponentTurn(other.nickname));
  await expect(mainHeading(other.page)).toHaveText(BATTLE_TEXT.myTurn);
  await expect(shooter.page.getByText(BATTLE_TEXT.waitForTurn)).toBeVisible();
  expect(await firedCells(enemyWaters)).toEqual([]);
  expect(await firedCells(board(other.page, BATTLE_TEXT.myFleet))).toEqual([]);

  // The other player lets their turn run out too: the turn comes back with no aim and still no shot.
  await skipServerClock(TURN_LIMIT_MS);
  await expect(mainHeading(shooter.page)).toHaveText(BATTLE_TEXT.myTurn);
  await expect(shooter.page.getByText(BATTLE_TEXT.pickTarget)).toBeVisible();
  expect(await firedCells(enemyWaters)).toEqual([]);
});
