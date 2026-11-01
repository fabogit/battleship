import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  DICE_ANIMATION_MS,
  ERROR_CODES,
  GAME_OVER_REASONS,
  ORIENTATIONS,
  SEATS,
  SERVER_EVENTS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  TIMEOUT_ACTIONS,
  otherSeat,
  toPlacedShip,
  type BattleSnapshot,
  type GameOverSnapshot,
  type PlayerStateSnapshot,
  type Seat,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakeGameSocket,
  RECEIVER_SEATS,
  battleSnapshot,
  fromSeat,
  gameOverSnapshot,
  provideFakeGameSocket,
} from '../../../testing/fake-game-socket';
import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { COUNTDOWN_TICK_MS, GameStateService } from '../../core/game-state';
import { CELL_STATES } from '../../shared/board-grid/board-cells';
import { PREFERS_REDUCED_MOTION } from '../../shared/reduced-motion';
import { BATTLE_BOARDS, Battle, SHOT_HOLD_MS } from './battle';
import { BATTLE_TEXT } from './battle.text';
import { createRoomId } from '../../../testing/session-fixtures';

const ROOM_ID = createRoomId(0);
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
let prefersReducedMotion: ReturnType<typeof signal<boolean>>;

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
  socket.fire(
    SERVER_EVENTS.STATE,
    gameOverSnapshot(ROOM_ID, { myShips: [MY_DESTROYER], opponentShips: [THEIR_CARRIER], ...gameOver }),
  );
  await fixture.whenStable();
}

/**
 * A battle snapshot with Ada's destroyer, seen from either seat.
 * @param seat Ada's seat.
 * @param battle Fields of the `IN_PROGRESS` part to override; turns and shooters name seats, so pick them for `seat`.
 * @returns The snapshot, not yet delivered.
 */
function battleFrom(seat: Seat, battle: Partial<BattleSnapshot> = {}): PlayerStateSnapshot {
  return fromSeat(seat, battleSnapshot(ROOM_ID, { myShips: [MY_DESTROYER], ...battle }));
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
  prefersReducedMotion = signal(false);
  TestBed.configureTestingModule({
    providers: [
      provideFakeGameSocket(socket),
      provideRouter([]),
      { provide: PREFERS_REDUCED_MOTION, useValue: prefersReducedMotion },
    ],
  });
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

    it.each([
      [ERROR_CODES.NOT_YOUR_TURN, BATTLE_TEXT.errors.NOT_YOUR_TURN],
      [ERROR_CODES.SERVER_ERROR, BATTLE_TEXT.errors.SERVER_ERROR],
      [TRANSPORT_ERRORS.NO_ACK, BATTLE_TEXT.errors.NO_ACK],
      // The view has no message of its own for this one.
      [ERROR_CODES.INVALID_PAYLOAD, BATTLE_TEXT.unexpected],
    ])('explains a FIRE that fails with %s', async (error, message) => {
      await tap(enemyCell('B7'));
      expect(text('[role="alert"]')).toBe('');
      socket.emitWithAck.mockResolvedValueOnce({ ok: false, error });

      await tap(button(BATTLE_TEXT.fire));

      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(text('[role="alert"]')).toBe(message);
      });
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

    it.each(RECEIVER_SEATS)('shows where a shot landed for a moment before the next turn takes over, as %s', (seat) => {
      // Rendered with detectChanges: whenStable waits on the scheduler's timers, which fake timers hold.
      vi.useFakeTimers();
      const results = [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.HIT }];
      socket.fire(SERVER_EVENTS.STATE, battleFrom(seat, { currentTurn: otherSeat(seat) }));
      socket.fire(SERVER_EVENTS.SHOT_RESOLVED, { shooter: otherSeat(seat), results });
      socket.fire(SERVER_EVENTS.STATE, battleFrom(seat, { currentTurn: seat, incomingShots: results }));
      fixture.detectChanges();

      expect(shownBoard()).toBe(BATTLE_BOARDS.MY_FLEET);
      expect(text('h1')).toBe(BATTLE_TEXT.myTurn);
      expect(text('.feedback')).toBe(BATTLE_TEXT.opponentShot('A1', SHOT_OUTCOMES.HIT, null, 'Grace'));

      vi.advanceTimersByTime(SHOT_HOLD_MS);
      fixture.detectChanges();

      expect(shownBoard()).toBe(BATTLE_BOARDS.ENEMY_WATERS);
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
      // Straight to game over, as after a reload: both boards come from the snapshot (ADR-0064).
      await receiveGameOver({
        incomingShots: [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.HIT }],
        outgoingShots: [
          { coordinate: { x: 9, y: 9 }, outcome: SHOT_OUTCOMES.MISS },
          { coordinate: { x: 0, y: 4 }, outcome: SHOT_OUTCOMES.HIT },
        ],
      });

      expect(text('h1')).toBe(BATTLE_TEXT.wonHeading);
      expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.reasons.FLEET_DESTROYED('Grace', true));
      expect(view().textContent).toContain(BATTLE_TEXT.revealed('Grace'));
      expect(shownBoard()).toBe(BATTLE_BOARDS.ENEMY_WATERS);
      expect(enemyCell('E1').getAttribute('aria-label')).toBe('E1, hit');
      expect(enemyCell('E2').getAttribute('aria-label')).toBe('E2, ship');
      expect(enemyCell('J10').getAttribute('aria-label')).toBe('J10, miss');
      expect(enemyCell('A1').getAttribute('aria-disabled')).toBe('true');
      const myCells = Array.from(board(BATTLE_TEXT.myFleet)?.querySelectorAll('button') ?? []).map((cell) =>
        cell.getAttribute('aria-label'),
      );
      expect(myCells).toContain('A1, hit');
      expect(myCells).toContain('A2, ship');

      const actions = Array.from(view().querySelectorAll('button:not([role="grid"] button)')).map((element) =>
        element.textContent.trim(),
      );
      expect(actions).toEqual([BATTLE_TEXT.myFleet, BATTLE_TEXT.enemyWaters]);
      expect(view().querySelector('a')?.textContent).toBe(BATTLE_TEXT.newMatch);
      expect(view().querySelector('a')?.getAttribute('href')).toBe('/');
    });

    it('names the joiner as the winner, with each board on its own side', async () => {
      const finalShot = { coordinate: { x: 0, y: 4 }, outcome: SHOT_OUTCOMES.HIT };
      socket.fire(
        SERVER_EVENTS.STATE,
        battleFrom(SEATS.P2, {
          currentTurn: SEATS.P2,
          incomingShots: [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.HIT }],
          outgoingShots: [{ coordinate: { x: 9, y: 9 }, outcome: SHOT_OUTCOMES.MISS }],
        }),
      );
      socket.fire(SERVER_EVENTS.SHOT_RESOLVED, { shooter: SEATS.P2, results: [finalShot] });

      socket.fire(
        SERVER_EVENTS.STATE,
        fromSeat(
          SEATS.P2,
          gameOverSnapshot(ROOM_ID, {
            winner: SEATS.P2,
            myShips: [MY_DESTROYER],
            incomingShots: [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.HIT }],
            outgoingShots: [{ coordinate: { x: 9, y: 9 }, outcome: SHOT_OUTCOMES.MISS }, finalShot],
            opponentShips: [THEIR_CARRIER],
          }),
        ),
      );
      await fixture.whenStable();

      expect(text('h1')).toBe(BATTLE_TEXT.wonHeading);
      expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.reasons.FLEET_DESTROYED('Grace', true));
      expect(text('.feedback')).toBe(BATTLE_TEXT.myShot('E1', SHOT_OUTCOMES.HIT, null, 'Grace'));
      expect(enemyCell('E1').getAttribute('aria-label')).toBe('E1, hit');
      expect(enemyCell('J10').getAttribute('aria-label')).toBe('J10, miss');
      const myCells = Array.from(board(BATTLE_TEXT.myFleet)?.querySelectorAll('button') ?? []).map((cell) =>
        cell.getAttribute('aria-label'),
      );
      expect(myCells).toContain('A1, hit');
      // The final shot went to Grace's board, not to Ada's own.
      expect(myCells).toContain('E1');
    });

    it('tells the loser and a match without a winner apart', async () => {
      await receiveGameOver({ winner: SEATS.P2 });
      expect(text('h1')).toBe(BATTLE_TEXT.lostHeading);
      expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.reasons.FLEET_DESTROYED('Grace', false));

      await receiveGameOver({ winner: null, reason: GAME_OVER_REASONS.ABANDONED });
      expect(text('h1')).toBe(BATTLE_TEXT.abandonedHeading);
    });

    it('offers both boards when this client did not see the battle, as after a reload (#52, F16)', async () => {
      TestBed.inject(GameStateService).clear();

      await receiveGameOver({ incomingShots: [{ coordinate: { x: 0, y: 1 }, outcome: SHOT_OUTCOMES.MISS }] });

      expect(button(BATTLE_TEXT.myFleet)).toBeDefined();
      expect(shownBoard()).toBe(BATTLE_BOARDS.ENEMY_WATERS);
      expect(enemyCell('E1').getAttribute('aria-label')).toBe('E1, ship');

      button(BATTLE_TEXT.myFleet)?.click();
      await fixture.whenStable();

      expect(shownBoard()).toBe(BATTLE_BOARDS.MY_FLEET);
      const myCells = Array.from(board(BATTLE_TEXT.myFleet)?.querySelectorAll('button') ?? []).map((cell) =>
        cell.getAttribute('aria-label'),
      );
      expect(myCells).toContain('B1, miss');
      expect(myCells).toContain('A1, ship');
    });
  });

  describe('timers, dice and AFK (#31)', () => {
    // Fake timers throughout, rendered with detectChanges: whenStable waits on the scheduler's timers, which fake
    // timers hold.
    beforeEach(() => {
      vi.useFakeTimers();
    });

    /**
     * Delivers a snapshot and renders it.
     * @param snapshot The `STATE`.
     */
    function receiveNow(snapshot: PlayerStateSnapshot): void {
      socket.fire(SERVER_EVENTS.STATE, snapshot);
      fixture.detectChanges();
    }

    /**
     * Lets time pass and renders the result.
     * @param ms How long, in ms.
     */
    function wait(ms: number): void {
      vi.advanceTimersByTime(ms);
      fixture.detectChanges();
    }

    /** @returns The turn timer, or `null`. */
    function timer(): Element | null {
      return view().querySelector('[role="timer"]');
    }

    /** @returns The warnings about turns run out in a row. */
    function afkWarnings(): string[] {
      return Array.from(view().querySelectorAll('.afk p')).map((line) => line.textContent.trim());
    }

    it.each(RECEIVER_SEATS)(
      'counts both turns down beside the heading, warning over the last 10 seconds, as %s',
      (seat) => {
        receiveNow(battleFrom(seat, { currentTurn: seat, turnRemainingMs: 10_400 }));
        expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:11'));
        expect(timer()?.classList).not.toContain('is-low');
        expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.myTurnHint);

        wait(COUNTDOWN_TICK_MS * 2);
        expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:10'));
        expect(timer()?.classList).toContain('is-low');
        expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.myTimeLow.AUTO_RANDOM_SHOT);

        receiveNow(battleFrom(seat, { currentTurn: otherSeat(seat), turnRemainingMs: 30_000 }));
        expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:30'));
        expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.opponentTurnHint('Grace'));

        wait(20_000);
        expect(timer()?.classList).toContain('is-low');
        expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.opponentTimeLow('Grace'));
      },
    );

    it('warns over the last 5 seconds of a 15-second turn, in the words of "Pass the turn"', () => {
      const rules = { ...DEFAULT_RULES, turnTimeLimitSeconds: 15, timeoutAction: TIMEOUT_ACTIONS.PASS_TURN } as const;
      receiveNow({ ...battleSnapshot(ROOM_ID, { turnRemainingMs: 5_200 }), rules });
      expect(timer()?.classList).not.toContain('is-low');

      wait(COUNTDOWN_TICK_MS);
      expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:05'));
      expect(timer()?.classList).toContain('is-low');
      expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.myTimeLow.PASS_TURN);
    });

    it('holds a paused turn still and says so, without urging the player to fire', () => {
      receiveNow(battleSnapshot(ROOM_ID, { turnRemainingMs: 8_000, isPaused: true }));

      wait(5_000);

      expect(timer()?.textContent).toBe(BATTLE_TEXT.timePaused('0:08'));
      expect(timer()?.classList).toContain('is-low');
      expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.myTurnHint);
    });

    it('keeps the turn timer in sync after a reconnect', () => {
      receiveNow(battleSnapshot(ROOM_ID, { turnRemainingMs: 30_000 }));
      wait(10_000);
      expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:20'));

      // The connection dropped and came back: the server's time went on, and its snapshot wins over the local count.
      receiveNow(battleSnapshot(ROOM_ID, { turnRemainingMs: 6_000 }));
      expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:06'));
      expect(timer()?.classList).toContain('is-low');

      wait(1_000);
      expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:05'));
    });

    it('shows the time left after a reload mid-match, from the snapshot alone', () => {
      // A reload: a new page with no snapshot and no dice, then the handshake's STATE.
      TestBed.inject(GameStateService).clear();
      receiveNow(
        battleSnapshot(ROOM_ID, {
          currentTurn: SEATS.P2,
          outgoingShots: [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.MISS }],
          turnRemainingMs: 17_300,
        }),
      );

      expect(text('h1')).toBe(BATTLE_TEXT.opponentTurn('Grace'));
      expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:18'));
      expect(view().querySelector('app-die')).toBeNull();
      wait(2_500);
      expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:15'));
    });

    describe('the dice roll (ADR-0107)', () => {
      /**
       * The dice of the view.
       * @returns How many there are, and whether they tumble.
       */
      function dice(): { count: number; isRolling: boolean } {
        const shown = Array.from(view().querySelectorAll('app-die'));
        return { count: shown.length, isRolling: shown.some((die) => die.classList.contains('is-rolling')) };
      }

      it.each(RECEIVER_SEATS.flatMap((seat) => [true, false].map((isMine) => [seat, isMine] as const)))(
        'rolls a tie and a re-roll, ends on who starts, then lets the turn go on, as %s (starts: %s)',
        (seat, isMine) => {
          const starter = isMine ? seat : otherSeat(seat);
          const decisive = { [starter]: 6, [otherSeat(starter)]: 2 } as Record<Seat, number>;
          socket.fire(SERVER_EVENTS.DICE_ROLLED, { rolls: [{ P1: 4, P2: 4 }, decisive], starter });
          receiveNow(battleFrom(seat, { currentTurn: starter, turnRemainingMs: null }));

          expect(text('h1')).toBe(BATTLE_TEXT.diceHeading);
          expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.diceRolling);
          expect(dice()).toEqual({ count: 2, isRolling: true });
          expect(text('#fire-hint')).toBe(BATTLE_TEXT.waitForDice);
          expect(enemyCell('A1').getAttribute('aria-disabled')).toBe('true');
          expect(timer()).toBeNull();

          wait(DICE_ANIMATION_MS / 4);
          expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.diceTie(4, 'Grace'));
          expect(dice().isRolling).toBe(false);

          wait(DICE_ANIMATION_MS / 4);
          expect(dice().isRolling).toBe(true);

          wait(DICE_ANIMATION_MS / 4);
          const [myFace, theirFace] = isMine ? [6, 2] : [2, 6];
          expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.diceResult(myFace, theirFace, 'Grace', isMine));
          expect(text('h1')).toBe(BATTLE_TEXT.diceHeading);

          wait(DICE_ANIMATION_MS / 4);
          expect(text('h1')).toBe(isMine ? BATTLE_TEXT.myTurn : BATTLE_TEXT.opponentTurn('Grace'));
          expect(enemyCell('A1').getAttribute('aria-disabled')).toBe(isMine ? null : 'true');
          // Until the server starts the first turn's timer, the result stays in its place.
          expect(dice()).toEqual({ count: 2, isRolling: false });

          receiveNow(battleFrom(seat, { currentTurn: starter, turnRemainingMs: 30_000 }));
          expect(dice().count).toBe(0);
          expect(timer()?.textContent).toBe(BATTLE_TEXT.timeLeft('0:30'));
          expect(text('.status [aria-live]')).toBe(
            isMine ? BATTLE_TEXT.myTurnHint : BATTLE_TEXT.opponentTurnHint('Grace'),
          );
        },
      );

      it('shows the result still and at once, and lets the starter aim, when the player asks for reduced motion', () => {
        prefersReducedMotion.set(true);
        socket.fire(SERVER_EVENTS.DICE_ROLLED, {
          rolls: [
            { P1: 3, P2: 3 },
            { P1: 5, P2: 1 },
          ],
          starter: SEATS.P1,
        });
        receiveNow(battleSnapshot(ROOM_ID, { turnRemainingMs: null }));

        expect(text('h1')).toBe(BATTLE_TEXT.myTurn);
        expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.diceResult(5, 1, 'Grace', true));
        expect(dice()).toEqual({ count: 2, isRolling: false });
        expect(enemyCell('A1').getAttribute('aria-disabled')).toBeNull();
      });

      it.each(RECEIVER_SEATS)(
        'says who the dice picked after a reload during the animation, with no dice to show (ADR-0106), as %s',
        (seat) => {
          TestBed.inject(GameStateService).clear();
          receiveNow(battleFrom(seat, { currentTurn: otherSeat(seat), turnRemainingMs: null }));

          expect(text('h1')).toBe(BATTLE_TEXT.opponentTurn('Grace'));
          expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.diceStarter('Grace', false));
          expect(dice().count).toBe(0);
          expect(timer()).toBeNull();

          receiveNow(battleFrom(seat, { currentTurn: seat, turnRemainingMs: null }));
          expect(text('.status [aria-live]')).toBe(BATTLE_TEXT.diceStarter('Grace', true));
        },
      );
    });

    describe('turns run out in a row (ADR-0109)', () => {
      it('warns the player who let turns run out how many are left, and tells the other one', () => {
        receiveNow(battleSnapshot(ROOM_ID, { afkCount: { me: 1, opponent: 0 } }));
        expect(afkWarnings()).toEqual([BATTLE_TEXT.myAfk(2)]);

        receiveNow(battleSnapshot(ROOM_ID, { afkCount: { me: 2, opponent: 2 } }));
        expect(afkWarnings()).toEqual([BATTLE_TEXT.myAfk(1), BATTLE_TEXT.opponentAfk('Grace', 1)]);

        receiveNow(battleSnapshot(ROOM_ID, { afkCount: { me: 0, opponent: 1 } }));
        expect(afkWarnings()).toEqual([BATTLE_TEXT.opponentAfk('Grace', 2)]);

        receiveNow(battleSnapshot(ROOM_ID));
        expect(afkWarnings()).toEqual([]);
      });

      it.each(RECEIVER_SEATS)('words a shot fired when time ran out, by either player, as %s', (seat) => {
        const results = [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.MISS }];
        receiveNow(battleFrom(seat, { currentTurn: seat }));
        socket.fire(SERVER_EVENTS.SHOT_RESOLVED, { shooter: seat, results });
        receiveNow(battleFrom(seat, { currentTurn: otherSeat(seat), afkCount: { me: 1, opponent: 0 } }));
        expect(text('.feedback')).toBe(BATTLE_TEXT.myAutoShot('A1', SHOT_OUTCOMES.MISS, null, 'Grace'));

        socket.fire(SERVER_EVENTS.SHOT_RESOLVED, { shooter: otherSeat(seat), results });
        receiveNow(battleFrom(seat, { currentTurn: seat, afkCount: { me: 1, opponent: 1 } }));
        expect(text('.feedback')).toBe(BATTLE_TEXT.opponentAutoShot('A1', SHOT_OUTCOMES.MISS, null, 'Grace'));

        // A shot the player fires sets their count back to zero: it was not automatic.
        socket.fire(SERVER_EVENTS.SHOT_RESOLVED, { shooter: seat, results });
        receiveNow(battleFrom(seat, { currentTurn: otherSeat(seat), afkCount: { me: 0, opponent: 1 } }));
        expect(text('.feedback')).toBe(BATTLE_TEXT.myShot('A1', SHOT_OUTCOMES.MISS, null, 'Grace'));
      });
    });
  });
});
