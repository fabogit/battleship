// Steps the journeys share: entering a room, agreeing on the rules, placing a fleet, firing. Selectors go by ARIA role and the client's own
// text constants, imported from its sources, so a reworded label changes the journeys with it.

import { BOARD_SIZE, DEFAULT_RULES, DICE_ANIMATION_MS, START_COUNTDOWN_MS, type TimeoutAction } from '@battleship/core';
import type { Locator, Page } from '@playwright/test';

import { BATTLE_TEXT } from '../../client/src/app/features/battle/battle.text';
import { HOME_TEXT } from '../../client/src/app/features/home/home.text';
import { LOBBY_TEXT } from '../../client/src/app/features/lobby/lobby.text';
import { PLACEMENT_TEXT } from '../../client/src/app/features/placement/placement.text';
import { ROOM_TEXT } from '../../client/src/app/features/room/room.text';
import { RULES_TEXT } from '../../client/src/app/features/rules/rules.text';
import { BOARD_GRID_TEXT } from '../../client/src/app/shared/board-grid/board-grid.text';
import { formatCoordinate } from '../../client/src/app/shared/board-grid/coordinates';
import { NICKNAME_FORM_TEXT } from '../../client/src/app/shared/nickname-form/nickname-form.text';
import { expect, type JourneyFixtures, type Player } from './fixtures.ts';

/** Every cell name of the board, row by row: `A1` … `J10`. */
export const ALL_CELLS: readonly string[] = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) =>
  formatCoordinate({ x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) }),
);

/** The placement status while the start countdown runs, whatever the seconds left: "Both fleets are ready. …". */
export const STARTS_IN: RegExp = new RegExp(escape(PLACEMENT_TEXT.startsIn(0)).replace('0', '\\d+'));

/**
 * The page's main heading: the screen's title, or whose turn it is during the battle.
 * @param page The player's page.
 * @returns Its `h1`.
 */
export function mainHeading(page: Page): Locator {
  return page.getByRole('heading', { level: 1 });
}

/**
 * A board of the placement or battle view.
 * @param page The player's page.
 * @param name The board's accessible name: `BATTLE_TEXT.myFleet` (also the placement board) or `.enemyWaters`.
 * @returns The grid.
 */
export function board(page: Page, name: string): Locator {
  return page.getByRole('grid', { name, exact: true });
}

/**
 * One cell of a board, by name, whatever its state.
 * @param grid The board.
 * @param cell The cell's name, e.g. `B7`.
 * @returns The cell's button, named `B7` or `B7, <state>…` (`cellLabel`).
 */
export function cell(grid: Locator, cell: string): Locator {
  return grid.getByRole('button', { name: new RegExp(`^${cell}(,|$)`) });
}

/**
 * Reads the accessible names of a board's cells, as a screen reader would get them: `B7`, `B7, ship`, `B7, hit`, ….
 * @param grid The board, once it shows.
 * @returns The 100 names, row by row.
 */
export async function cellLabels(grid: Locator): Promise<string[]> {
  await expect(grid.getByRole('button')).toHaveCount(ALL_CELLS.length);
  return grid
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''));
}

/**
 * Lists the cells of a board that show an intact ship.
 * @param grid The board, once it shows.
 * @returns Their names, e.g. `B7`, row by row: 17 on a fresh fleet.
 */
export async function shipCells(grid: Locator): Promise<string[]> {
  const suffix = `, ${BOARD_GRID_TEXT.states.ship ?? ''}`;
  return (await cellLabels(grid))
    .filter((label) => label.endsWith(suffix))
    .map((label) => label.slice(0, -suffix.length));
}

/**
 * Lists the cells of a board that a shot has landed on, whatever it found.
 * @param grid The board, once it shows.
 * @returns Their names, e.g. `B7`, row by row.
 */
export async function firedCells(grid: Locator): Promise<string[]> {
  const outcomes = [BOARD_GRID_TEXT.states.miss, BOARD_GRID_TEXT.states.hit, BOARD_GRID_TEXT.states.sunk];
  return (await cellLabels(grid))
    .filter((label) => outcomes.some((outcome) => label.endsWith(`, ${outcome ?? ''}`)))
    .map((label) => label.slice(0, label.indexOf(',')));
}

/**
 * Creates a room from the home screen and waits for the lobby.
 * @param player The creator, on a blank page.
 * @returns The room's link, as the lobby shows it.
 */
export async function createRoom(player: Player): Promise<string> {
  const { page } = player;
  await page.goto('/');
  await page.getByLabel(NICKNAME_FORM_TEXT.label).fill(player.nickname);
  // Disabled (`aria-disabled`) until the socket connects; `click` waits for it.
  await page.getByRole('button', { name: HOME_TEXT.create }).click();
  await expect(mainHeading(page)).toHaveText(LOBBY_TEXT.heading);
  return page.getByRole('textbox', { name: LOBBY_TEXT.linkLabel }).inputValue();
}

/**
 * Opens a room's link and takes its free seat, which starts rules negotiation.
 * @param player The joiner, on any page.
 * @param roomUrl The link the creator shares.
 */
export async function joinRoom(player: Player, roomUrl: string): Promise<void> {
  const { page } = player;
  await page.goto(roomUrl);
  await expect(mainHeading(page)).toHaveText(ROOM_TEXT.joinHeading);
  await page.getByLabel(NICKNAME_FORM_TEXT.label).fill(player.nickname);
  await page.getByRole('button', { name: ROOM_TEXT.join }).click();
  await expect(mainHeading(page)).toHaveText(RULES_TEXT.heading);
}

/**
 * Both players confirm the rules on screen, one after the other, which starts placement (ADR-0003).
 * @param players The two players, both on the rules screen.
 */
export async function agreeOnRules(players: readonly [Player, Player]): Promise<void> {
  for (const { page } of players) {
    await expect(mainHeading(page)).toHaveText(RULES_TEXT.heading);
    // Disabled while an edit or a confirmation is on its way; `click` waits for it.
    await page.getByRole('button', { name: RULES_TEXT.confirm }).click();
  }
  for (const { page } of players) {
    await expect(mainHeading(page)).toHaveText(PLACEMENT_TEXT.heading);
  }
}

/**
 * Creates a room, joins it and agrees on the rules: the shortest way into placement.
 * @param creator The player who creates the room and sits in `P1`.
 * @param joiner The player who joins it.
 * @param timeoutAction What a turn that runs out of time does; any other than the default is picked by the creator,
 * and the joiner sees it before both confirm.
 * @returns The room's link.
 */
export async function enterPlacement(
  creator: Player,
  joiner: Player,
  timeoutAction: TimeoutAction = DEFAULT_RULES.timeoutAction,
): Promise<string> {
  const roomUrl = await createRoom(creator);
  await joinRoom(joiner, roomUrl);
  if (timeoutAction !== DEFAULT_RULES.timeoutAction) {
    const name = RULES_TEXT.timeoutActions[timeoutAction];
    await creator.page.getByRole('radio', { name }).click();
    await expect(joiner.page.getByRole('radio', { name })).toBeChecked();
  }
  await agreeOnRules([creator, joiner]);
  return roomUrl;
}

/**
 * Places a random fleet and confirms it; once both fleets are confirmed, the start countdown runs (`endStartCountdown`).
 * @param player A player in placement.
 */
export async function confirmRandomFleet(player: Player): Promise<void> {
  const { page } = player;
  await expect(mainHeading(page)).toHaveText(PLACEMENT_TEXT.heading);
  await page.getByRole('button', { name: PLACEMENT_TEXT.randomize }).click();
  // Disabled until the fleet is valid; `click` waits for it.
  await page.getByRole('button', { name: PLACEMENT_TEXT.confirm }).click();
}

/**
 * Waits until both players see the start countdown, then skips the server clock past it, so the battle starts without
 * waiting `START_COUNTDOWN_MS` in real time (ADR-0090).
 * @param players The two players, both fleets confirmed.
 * @param skipServerClock The journey's `skipServerClock` fixture.
 */
export async function endStartCountdown(
  players: readonly [Player, Player],
  skipServerClock: JourneyFixtures['skipServerClock'],
): Promise<void> {
  for (const { page } of players) {
    await expect(page.getByText(STARTS_IN)).toBeVisible();
  }
  await skipServerClock(START_COUNTDOWN_MS);
}

/**
 * Creates a room, joins it, agrees on the rules, confirms two random fleets and skips the start countdown: the shortest
 * way into the battle.
 * @param creator The player who creates the room and sits in `P1`.
 * @param joiner The player who joins it.
 * @param skipServerClock The journey's `skipServerClock` fixture.
 * @param timeoutAction What a turn that runs out of time does; the default rules' by default.
 * @returns The room's link.
 */
export async function startBattle(
  creator: Player,
  joiner: Player,
  skipServerClock: JourneyFixtures['skipServerClock'],
  timeoutAction: TimeoutAction = DEFAULT_RULES.timeoutAction,
): Promise<string> {
  const roomUrl = await enterPlacement(creator, joiner, timeoutAction);
  await confirmRandomFleet(creator);
  await confirmRandomFleet(joiner);
  await endStartCountdown([creator, joiner], skipServerClock);
  for (const player of [creator, joiner]) {
    await expect(mainHeading(player.page)).toHaveText(turnHeadings(player === creator ? joiner : creator));
  }
  return roomUrl;
}

/**
 * Who fires first: the player whose heading says it is their turn.
 * @param players The two players, both in the battle.
 * @returns The player who has the turn.
 */
export async function firstShooter(players: readonly [Player, Player]): Promise<Player> {
  let shooter: Player | undefined;
  await expect
    .poll(async () => {
      for (const player of players) {
        if ((await mainHeading(player.page).textContent()) === BATTLE_TEXT.myTurn) {
          shooter = player;
        }
      }
      return shooter?.nickname;
    }, 'one of the players has the first turn')
    .toBeDefined();
  if (shooter === undefined) {
    throw new Error('no shooter');
  }
  return shooter;
}

/**
 * Waits for the dice animation's end on both pages, skipping the server clock to it, so the first turn's timer runs
 * (ADR-0093): each page shows the turn's time.
 * @param players The two players, both in the battle.
 * @param skipServerClock The journey's `skipServerClock` fixture.
 */
export async function startTurnTimer(
  players: readonly [Player, Player],
  skipServerClock: JourneyFixtures['skipServerClock'],
): Promise<void> {
  await skipServerClock(DICE_ANIMATION_MS);
  for (const { page } of players) {
    await expect(turnTimer(page)).toBeVisible();
  }
}

/**
 * The turn's time left, while the snapshot carries one.
 * @param page The player's page.
 * @returns The `timer` reading "Time left: m:ss".
 */
export function turnTimer(page: Page): Locator {
  const pattern = new RegExp(`^${escape(BATTLE_TEXT.timeLeft('@')).replace('@', '\\d+:\\d{2}')}$`);
  return page.getByRole('timer').filter({ hasText: pattern });
}

/**
 * The placement deadline.
 * @param page The player's page.
 * @returns The `timer` reading "Time left: m:ss".
 */
export function placementTimer(page: Page): Locator {
  const pattern = new RegExp(`^${escape(PLACEMENT_TEXT.timeLeft('@')).replace('@', '\\d+:\\d{2}')}$`);
  return page.getByRole('timer').filter({ hasText: pattern });
}

/**
 * Reads the seconds a countdown shows.
 * @param timer A `timer` reading "Time left: m:ss".
 * @returns The whole seconds it shows.
 */
export async function timerSeconds(timer: Locator): Promise<number> {
  const [, minutes = '0', seconds = '0'] = /(\d+):(\d{2})/.exec((await timer.textContent()) ?? '') ?? [];
  return Number(minutes) * 60 + Number(seconds);
}

/**
 * The last words of the dice animation, whoever starts: "You rolled 5, Grace rolled 3: you start." or "…: Grace
 * starts." (ADR-0107).
 * @param opponent The player's opponent.
 * @returns A pattern matching both.
 */
export function diceResult(opponent: Player): RegExp {
  const variants = [true, false].map((isMine) =>
    escape(BATTLE_TEXT.diceResult(1, 2, opponent.nickname, isMine))
      .replace('1', '\\d')
      .replace('2', '\\d'),
  );
  return new RegExp(`^(${variants.join('|')})$`);
}

/**
 * Fires one shot, aiming through Enemy waters as a player would, and waits for the server's answer.
 * @param shooter The player whose turn it is.
 * @param target The cell to fire at, e.g. `B7`.
 */
export async function fire(shooter: Player, target: string): Promise<void> {
  const { page } = shooter;
  const enemyWaters = board(page, BATTLE_TEXT.enemyWaters);
  // Inactive (`aria-disabled`) outside the player's turn; `click` waits for it.
  await cell(enemyWaters, target).click();
  await expect(page.getByText(BATTLE_TEXT.aimingAt(target))).toBeVisible();
  await page.getByRole('button', { name: BATTLE_TEXT.fire, exact: true }).click();
  // The shot's result replaces the bare name: `B7, miss`, `B7, hit` or `B7, sunk`.
  await expect(cell(enemyWaters, target)).not.toHaveAccessibleName(target);
}

/**
 * The headings a player sees while the battle runs.
 * @param opponent The player's opponent.
 * @returns A pattern matching both turns: "Your turn" and "<opponent>'s turn".
 */
export function turnHeadings(opponent: Player): RegExp {
  return new RegExp(`^(${escape(BATTLE_TEXT.myTurn)}|${escape(BATTLE_TEXT.opponentTurn(opponent.nickname))})$`);
}

/**
 * Escapes a text for use inside a regular expression.
 * @param text Any text, e.g. a nickname or a sentence.
 * @returns The text with every special character escaped.
 */
export function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
