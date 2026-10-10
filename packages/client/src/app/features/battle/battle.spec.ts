import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  CLIENT_EVENTS,
  GAME_OVER_REASONS,
  ORIENTATIONS,
  SEATS,
  SERVER_EVENTS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  toPlacedShip,
  type BattleSnapshot,
  type GameOverSnapshot,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakeGameSocket,
  battleSnapshot,
  gameOverSnapshot,
  provideFakeGameSocket,
} from '../../../testing/fake-game-socket';
import { GameStateService } from '../../core/game-state';
import { CELL_STATES } from '../../shared/board-grid/board-cells';
import { BATTLE_BOARDS, Battle, SHOT_HOLD_MS } from './battle';
import { BATTLE_TEXT } from './battle.text';

const ROOM_ID = 'ab23cd45';
/** Ada's destroyer on A1–A2. */
const MY_DESTROYER = toPlacedShip({
  type: SHIP_TYPES.DESTROYER,
  start: { x: 0, y: 0 },
  orientation: ORIENTATIONS.HORIZONTAL,
});
/** Grace's carrier on E1–E5. */
const THEIR_CARRIER = toPlacedShip({
  type: SHIP_TYPES.CARRIER,
  start: { x: 0, y: 4 },
  orientation: ORIENTATIONS.HORIZONTAL,
});

let socket: FakeGameSocket;
let fixture: ComponentFixture<Battle>;

/** @returns The rendered view. */
function view(): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/**
 * Delivers a battle snapshot and lets the view render it.
 * @param battle Fields of the `IN_PROGRESS` part to override.
 */
async function receive(battle: Partial<BattleSnapshot> = {}): Promise<void> {
  socket.fire(SERVER_EVENTS.STATE, battleSnapshot(ROOM_ID, { myShips: [MY_DESTROYER], ...battle }));
  await fixture.whenStable();
}

/**
 * Delivers a game-over snapshot and lets the view render it.
 * @param gameOver Fields of the `GAME_OVER` part to override.
 */
async function receiveGameOver(gameOver: Partial<GameOverSnapshot> = {}): Promise<void> {
  socket.fire(SERVER_EVENTS.STATE, gameOverSnapshot(ROOM_ID, { opponentShips: [THEIR_CARRIER], ...gameOver }));
  await fixture.whenStable();
}

/**
 * Finds a button by its visible text.
 * @param label The button's text.
 * @returns The button, or `undefined`.
 */
function button(label: string): HTMLButtonElement | undefined {
  return Array.from(view().querySelectorAll('button')).find((candidate) => candidate.textContent.trim() === label);
}

/**
 * Finds a board by its accessible name.
 * @param label "My fleet" or "Enemy waters".
 * @returns The grid, or `null`.
 */
function board(label: string): HTMLElement | null {
  return view().querySelector(`[role="grid"][aria-label="${label}"]`);
}

/**
 * Finds a cell of "Enemy waters" by its name.
 * @param name The cell's name, e.g. `B7`.
 * @returns Its button.
 */
function enemyCell(name: string): HTMLButtonElement {
  const found = Array.from(board(BATTLE_TEXT.enemyWaters)?.querySelectorAll('button') ?? []).find(
    (candidate) => candidate.getAttribute('aria-label')?.split(',')[0] === name,
  );
  if (found === undefined) {
    throw new Error(`No cell ${name}`);
  }
  return found;
}

/**
 * Taps a button and lets the view render the outcome.
 * @param target The button.
 */
async function tap(target: HTMLButtonElement | undefined): Promise<void> {
  target?.click();
  await fixture.whenStable();
}

/** @returns The board a narrow screen shows. */
function shownBoard(): string | null | undefined {
  return view().querySelector('.boards')?.getAttribute('data-shown');
}

/**
 * Reads a toggle button's state.
 * @param label The button's text.
 * @returns Its `aria-pressed`.
 */
function pressed(label: string): string | null | undefined {
  return button(label)?.getAttribute('aria-pressed');
}

/**
 * Reads a line of the view.
 * @param selector Where it is.
 * @returns Its text, trimmed.
 */
function text(selector: string): string | undefined {
  return view().querySelector(selector)?.textContent.trim();
}

beforeEach(async () => {
  socket = new FakeGameSocket();
  socket.emitWithAck.mockResolvedValue({ ok: true });
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket), provideRouter([])] });
  TestBed.inject(GameStateService);
  socket.fire(SERVER_EVENTS.STATE, battleSnapshot(ROOM_ID, { myShips: [MY_DESTROYER] }));
  fixture = TestBed.createComponent(Battle);
  await fixture.whenStable();
});

afterEach(() => {
  TestBed.inject(GameStateService).clear();
  vi.useRealTimers();
});

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('BATTLE_BOARDS', () => {
  it('pins the values', () => {
    expect(Object.values(BATTLE_BOARDS)).toEqual(['my-fleet', 'enemy-waters']);
  });
});

describe('Battle', () => {
  describe("during the player's turn", () => {
    it('says so and brings "Enemy waters" forward', () => {
      expect(text('h1')).toBe(BATTLE_TEXT.myTurn);
      expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.myTurnHint);
      expect(shownBoard()).toBe(BATTLE_BOARDS.ENEMY_WATERS);
      expect(pressed(BATTLE_TEXT.enemyWaters)).toBe('true');
      expect(pressed(BATTLE_TEXT.myFleet)).toBe('false');
      expect(view().querySelector('[role="timer"]')).toBeNull();
    });

    it('draws both boards, only "Enemy waters" interactive', () => {
      const myCells = board(BATTLE_TEXT.myFleet)?.querySelectorAll(`button[data-state="${CELL_STATES.SHIP}"]`);
      expect(myCells).toHaveLength(2);
      expect(board(BATTLE_TEXT.myFleet)?.querySelector('button')?.getAttribute('aria-disabled')).toBe('true');
      expect(enemyCell('A1').getAttribute('aria-disabled')).toBeNull();
    });

    it('aims with a tap and fires the target', async () => {
      const fire = button(BATTLE_TEXT.fire);
      expect(fire?.getAttribute('aria-disabled')).toBe('true');
      expect(text('#fire-hint')).toBe(BATTLE_TEXT.pickTarget);

      await tap(enemyCell('B7'));

      expect(enemyCell('B7').getAttribute('aria-label')).toBe('B7, target');
      expect(text('#fire-hint')).toBe(BATTLE_TEXT.aimingAt('B7'));
      expect(text('.feedback')).toBe(BATTLE_TEXT.targeted('B7'));
      expect(fire?.getAttribute('aria-disabled')).toBeNull();

      await tap(fire);

      expect(socket.emitWithAck).toHaveBeenLastCalledWith(CLIENT_EVENTS.FIRE, { targets: [{ x: 6, y: 1 }] });
    });

    it('says why a cell already shot cannot be a target', async () => {
      await receive({ outgoingShots: [{ coordinate: { x: 6, y: 1 }, outcome: SHOT_OUTCOMES.MISS }] });

      await tap(enemyCell('B7'));

      expect(text('.feedback')).toBe(BATTLE_TEXT.refusals.ALREADY_TARGETED('B7', 1));
    });

    it('shows the turn deadline when the snapshot carries one', async () => {
      await receive({ turnRemainingMs: 25_000 });

      expect(text('[role="timer"]')).toBe(BATTLE_TEXT.timeLeft('0:25'));
    });
  });

  describe("during the opponent's turn", () => {
    beforeEach(async () => {
      await receive({ currentTurn: SEATS.P2 });
    });

    it('says whose turn it is and brings "My fleet" forward', () => {
      expect(text('h1')).toBe(BATTLE_TEXT.opponentTurn('Grace'));
      expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.opponentTurnHint('Grace'));
      expect(shownBoard()).toBe(BATTLE_BOARDS.MY_FLEET);
      expect(pressed(BATTLE_TEXT.myFleet)).toBe('true');
      expect(enemyCell('A1').getAttribute('aria-disabled')).toBe('true');
      expect(text('#fire-hint')).toBe(BATTLE_TEXT.waitForTurn);
    });

    it('keeps the board the player picks until the turn changes', async () => {
      await tap(button(BATTLE_TEXT.enemyWaters));
      expect(shownBoard()).toBe(BATTLE_BOARDS.ENEMY_WATERS);

      await receive({ currentTurn: SEATS.P2 });
      expect(shownBoard()).toBe(BATTLE_BOARDS.ENEMY_WATERS);

      await receive({
        currentTurn: SEATS.P1,
        incomingShots: [{ coordinate: { x: 9, y: 9 }, outcome: SHOT_OUTCOMES.MISS }],
      });
      await receive({
        currentTurn: SEATS.P2,
        incomingShots: [{ coordinate: { x: 9, y: 9 }, outcome: SHOT_OUTCOMES.MISS }],
        outgoingShots: [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.MISS }],
      });
      expect(shownBoard()).toBe(BATTLE_BOARDS.MY_FLEET);
    });

    it('shows where a shot landed for a moment before the next turn takes over', () => {
      // Rendered with detectChanges: whenStable waits on the scheduler's timers, which fake timers hold.
      vi.useFakeTimers();
      const results = [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.HIT }];
      socket.fire(SERVER_EVENTS.SHOT_RESOLVED, { shooter: SEATS.P2, results });
      socket.fire(
        SERVER_EVENTS.STATE,
        battleSnapshot(ROOM_ID, { myShips: [MY_DESTROYER], currentTurn: SEATS.P1, incomingShots: results }),
      );
      fixture.detectChanges();

      expect(shownBoard()).toBe(BATTLE_BOARDS.MY_FLEET);
      expect(text('h1')).toBe(BATTLE_TEXT.myTurn);
      expect(text('.feedback')).toBe(BATTLE_TEXT.opponentShot('A1', SHOT_OUTCOMES.HIT, null, 'Grace'));

      vi.advanceTimersByTime(SHOT_HOLD_MS);
      fixture.detectChanges();

      expect(shownBoard()).toBe(BATTLE_BOARDS.ENEMY_WATERS);
    });

    it('says when the opponent is disconnected', async () => {
      const snapshot = battleSnapshot(ROOM_ID, { currentTurn: SEATS.P2 });
      socket.fire(SERVER_EVENTS.STATE, {
        ...snapshot,
        opponent: { seat: SEATS.P2, nickname: 'Grace', isConnected: false, forfeitRemainingMs: 60_000 },
      });
      await fixture.whenStable();

      expect(view().textContent).toContain(BATTLE_TEXT.opponentAway('Grace'));
    });
  });

  it('announces a sinking shot with the ship', async () => {
    const sunkShip = toPlacedShip({
      type: SHIP_TYPES.DESTROYER,
      start: { x: 6, y: 1 },
      orientation: ORIENTATIONS.VERTICAL,
    });

    socket.fire(SERVER_EVENTS.SHOT_RESOLVED, {
      shooter: SEATS.P1,
      results: [{ coordinate: { x: 6, y: 2 }, outcome: SHOT_OUTCOMES.SUNK, sunkShip }],
    });
    await fixture.whenStable();

    expect(text('.feedback')).toBe("You fired at C7 and sank Grace's destroyer!");
  });

  describe('at game over', () => {
    it('names the winner and the reason, reveals the fleet under the shots, and offers only a new match', async () => {
      const finalShot = { coordinate: { x: 0, y: 4 }, outcome: SHOT_OUTCOMES.HIT };
      await receive({ outgoingShots: [{ coordinate: { x: 9, y: 9 }, outcome: SHOT_OUTCOMES.MISS }] });
      socket.fire(SERVER_EVENTS.SHOT_RESOLVED, { shooter: SEATS.P1, results: [finalShot] });

      await receiveGameOver();

      expect(text('h1')).toBe(BATTLE_TEXT.wonHeading);
      expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.reasons.FLEET_DESTROYED('Grace', true));
      expect(view().textContent).toContain(BATTLE_TEXT.revealed('Grace'));
      expect(shownBoard()).toBe(BATTLE_BOARDS.ENEMY_WATERS);
      expect(enemyCell('E1').getAttribute('aria-label')).toBe('E1, hit');
      expect(enemyCell('E2').getAttribute('aria-label')).toBe('E2, ship');
      expect(enemyCell('J10').getAttribute('aria-label')).toBe('J10, miss');
      expect(enemyCell('A1').getAttribute('aria-disabled')).toBe('true');
      expect(board(BATTLE_TEXT.myFleet)).not.toBeNull();

      const actions = Array.from(view().querySelectorAll('button:not([role="grid"] button)')).map((element) =>
        element.textContent.trim(),
      );
      expect(actions).toEqual([BATTLE_TEXT.myFleet, BATTLE_TEXT.enemyWaters]);
      expect(view().querySelector('a')?.textContent).toBe(BATTLE_TEXT.newMatch);
      expect(view().querySelector('a')?.getAttribute('href')).toBe('/');
    });

    it('tells the loser and a match without a winner apart', async () => {
      await receiveGameOver({ winner: SEATS.P2 });
      expect(text('h1')).toBe(BATTLE_TEXT.lostHeading);
      expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.reasons.FLEET_DESTROYED('Grace', false));

      await receiveGameOver({ winner: null, reason: GAME_OVER_REASONS.ABANDONED });
      expect(text('h1')).toBe(BATTLE_TEXT.abandonedHeading);
    });

    it('shows only the revealed fleet when this client did not see the battle', async () => {
      TestBed.inject(GameStateService).clear();

      await receiveGameOver();

      expect(button(BATTLE_TEXT.myFleet)).toBeUndefined();
      expect(board(BATTLE_TEXT.myFleet)).toBeNull();
      expect(shownBoard()).toBe(BATTLE_BOARDS.ENEMY_WATERS);
      expect(enemyCell('E1').getAttribute('aria-label')).toBe('E1, ship');
    });
  });
});
