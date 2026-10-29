import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  DISCONNECT_FORFEIT_MS,
  ERROR_CODES,
  GAME_OVER_TTL_MS,
  PLACEMENT_TIME_LIMIT_MS,
  ROOM_PHASES,
  SEATS,
  SERVER_EVENTS,
  SHOT_OUTCOMES,
  type PlayerStateSnapshot,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakeGameSocket,
  battleSnapshot,
  fromSeat,
  gameOverSnapshot,
  negotiationSnapshot,
  placementSnapshot,
  provideFakeGameSocket,
  waitingSnapshot,
} from '../../../testing/fake-game-socket';
import { FakeServerWake, provideFakeServerWake } from '../../../testing/fake-server-wake';
import { routes } from '../../app.routes';
import { GameStateService } from '../../core/game-state';
import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { ROOM_ENTRY_TEXT } from '../../core/room-entry.text';
import { SessionStore } from '../../core/session-store';
import { BATTLE_TEXT } from '../battle/battle.text';
import { LOBBY_TEXT } from '../lobby/lobby.text';
import { PLACEMENT_TEXT } from '../placement/placement.text';
import { PRESENCE_TEXT } from '../presence/presence.text';
import { RULES_TEXT } from '../rules/rules.text';
import { ROOM_VIEWS } from './room';
import { ROOM_TEXT } from './room.text';
import { createRoomId, createPlayerSecret } from '../../../testing/session-fixtures';

const ROOM_ID = createRoomId(0);
const NEXT_ROOM_ID = createRoomId(1);
const PLAYER_SECRET = createPlayerSecret();

/**
 * The room right after the joiner took the seat, seen by the joiner. Until rules negotiation lands (#26) the server
 * moves straight to `PLACEMENT` (docs/server.md#room-creation--joining).
 * @returns The snapshot.
 */
function joinedSnapshot(): PlayerStateSnapshot {
  const waiting = waitingSnapshot(ROOM_ID, 'Ada');
  return {
    ...waiting,
    phase: ROOM_PHASES.PLACEMENT,
    me: { seat: SEATS.P2, nickname: 'Grace', isConnected: true, forfeitRemainingMs: null },
    opponent: { ...waiting.me },
    hasConfirmedRules: { me: true, opponent: true },
    placement: {
      myShips: [],
      hasConfirmed: { me: false, opponent: false },
      remainingMs: PLACEMENT_TIME_LIMIT_MS,
      startCountdownMs: null,
    },
  };
}

let socket: FakeGameSocket;
let wake: FakeServerWake;
let harness: RouterTestingHarness;

/** Starts the app with a fresh fake socket; web storage is whatever the spec left in it. */
async function startApp(): Promise<void> {
  socket = new FakeGameSocket();
  wake = new FakeServerWake();
  TestBed.configureTestingModule({
    providers: [
      provideFakeGameSocket(socket),
      provideFakeServerWake(wake),
      provideRouter(routes, withComponentInputBinding()),
    ],
  });
  // Created up front, as the app does through the shell, so it listens to `STATE` from the start.
  TestBed.inject(GameStateService);
  harness = await RouterTestingHarness.create();
}

/** Starts the app again in the same tab, as a reload does: `localStorage` and `sessionStorage` are kept. */
async function reload(): Promise<void> {
  TestBed.inject(GameStateService).clear();
  TestBed.resetTestingModule();
  await startApp();
}

beforeEach(async () => {
  await startApp();
});

afterEach(() => {
  // The placement snapshot starts the countdown ticker.
  TestBed.inject(GameStateService).clear();
});

/** @returns The rendered page. */
function page(): HTMLElement {
  return harness.routeNativeElement as HTMLElement;
}

/** @returns The page heading's text. */
function heading(): string | undefined {
  return page().querySelector('h1')?.textContent.trim();
}

/**
 * Types a nickname and presses "Join room".
 * @param nickname What the player types.
 */
async function join(nickname: string): Promise<void> {
  const input = page().querySelector('input');
  if (input === null) {
    throw new Error('No nickname field');
  }
  input.value = nickname;
  input.dispatchEvent(new Event('input'));
  page().querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  await harness.fixture.whenStable();
}

/**
 * Creates a room from the home screen, as the player does, and waits for its page.
 * @param roomId The id the server gives the new room.
 */
async function createRoom(roomId: string): Promise<void> {
  socket.emitWithAck.mockResolvedValueOnce({ ok: true, roomId, playerSecret: createPlayerSecret() });
  const input = page().querySelector('input');
  if (input === null) {
    throw new Error('No nickname field');
  }
  input.value = 'Ada';
  input.dispatchEvent(new Event('input'));
  page().querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  await vi.waitFor(() => {
    expect(TestBed.inject(Router).url).toBe(`/r/${roomId}`);
  });
  await harness.fixture.whenStable();
}

/**
 * Moves through the tab's history, as the browser's Back and Forward buttons do, and waits for the router to follow.
 * @param direction `back` or `forward`.
 */
async function goThroughHistory(direction: 'back' | 'forward'): Promise<void> {
  const router = TestBed.inject(Router);
  const from = router.url;
  TestBed.inject(Location)[direction]();
  await vi.waitFor(() => {
    expect(router.url).not.toBe(from);
  });
  await harness.fixture.whenStable();
}

/**
 * Delivers a snapshot and lets the page render it.
 * @param snapshot The `STATE` payload.
 */
async function receive(snapshot: PlayerStateSnapshot): Promise<void> {
  socket.fire(SERVER_EVENTS.STATE, snapshot);
  await harness.fixture.whenStable();
}

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('ROOM_VIEWS', () => {
  it('pins the values', () => {
    expect(Object.values(ROOM_VIEWS)).toEqual([
      'join',
      'entering',
      'left',
      'lobby',
      'rules',
      'placement',
      'battle',
      'not-found',
      'seat-lost',
      'full',
    ]);
  });
});

describe('Room', () => {
  describe('as the joiner', () => {
    beforeEach(async () => {
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
    });

    it('asks for a nickname to take the free seat', () => {
      expect(heading()).toBe(ROOM_TEXT.joinHeading);
      expect(page().textContent).toContain(ROOM_ID);
      expect(page().querySelector('button[type="submit"]')?.textContent.trim()).toBe(ROOM_TEXT.join);
    });

    it('joins with the trimmed nickname, then follows the snapshot', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: true, playerSecret: PLAYER_SECRET });

      await join(' Grace ');

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.JOIN_ROOM, {
        roomId: ROOM_ID,
        nickname: 'Grace',
      });
      await vi.waitFor(() => {
        expect(page().textContent).toContain(ROOM_TEXT.entering);
      });

      await receive(joinedSnapshot());

      expect(heading()).toBe(PLACEMENT_TEXT.heading);
      expect(page().textContent).toContain(PLACEMENT_TEXT.opponentPlacing('Ada'));
    });

    it('shows a not-found screen with a way home for ROOM_NOT_FOUND', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.ROOM_NOT_FOUND });

      await join('Grace');

      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.notFoundHeading);
      });
      expect(page().querySelector('a')?.getAttribute('href')).toBe('/');
      expect(page().querySelector('input')).toBeNull();
    });

    it('shows a full-room screen with a way home for ROOM_FULL', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.ROOM_FULL });

      await join('Grace');

      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.fullHeading);
      });
      expect(page().textContent).toContain(ROOM_TEXT.fullReason);
      expect(page().querySelector('a')?.textContent).toBe(ROOM_TEXT.createOwn);
    });

    it('keeps the form and explains any other failure', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: TRANSPORT_ERRORS.NO_ACK });

      await join('Grace');

      await vi.waitFor(() => {
        expect(page().querySelector('[role="alert"]')?.textContent).toBe(ROOM_ENTRY_TEXT.errors.NO_ACK);
      });
      expect(heading()).toBe(ROOM_TEXT.joinHeading);
    });

    it('forgets a failed join when the address names another room', async () => {
      socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.ROOM_NOT_FOUND });
      await join('Grace');
      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.notFoundHeading);
      });

      await harness.navigateByUrl(`/r/${NEXT_ROOM_ID}`);

      expect(heading()).toBe(ROOM_TEXT.joinHeading);
    });

    it("ignores another room's snapshot", async () => {
      await receive(waitingSnapshot(NEXT_ROOM_ID));

      expect(heading()).toBe(ROOM_TEXT.joinHeading);
    });
  });

  describe('as the creator', () => {
    beforeEach(async () => {
      TestBed.inject(SessionStore).save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
    });

    it('waits for the first snapshot, then shows the waiting screen with the room link', async () => {
      expect(page().textContent).toContain(ROOM_TEXT.entering);

      await receive(waitingSnapshot(ROOM_ID, 'Ada'));

      expect(heading()).toBe(LOBBY_TEXT.heading);
      expect(page().textContent).toContain(LOBBY_TEXT.playingAs('Ada'));
      expect(page().querySelector<HTMLInputElement>('input#room-link')?.value).toMatch(new RegExp(`/r/${ROOM_ID}$`));
    });

    it('moves on when the opponent joins', async () => {
      await receive(waitingSnapshot(ROOM_ID, 'Ada'));

      const joined = joinedSnapshot();
      await receive({ ...joined, me: joined.opponent ?? joined.me, opponent: joined.me });

      expect(heading()).toBe(PLACEMENT_TEXT.heading);
      expect(page().textContent).toContain(PLACEMENT_TEXT.opponentPlacing('Grace'));
    });

    it('shows the rules screen while the players agree on the rules, then placement (#27)', async () => {
      await receive(waitingSnapshot(ROOM_ID, 'Ada'));

      await receive(negotiationSnapshot(ROOM_ID));

      expect(heading()).toBe(RULES_TEXT.heading);
      expect(page().textContent).toContain(RULES_TEXT.intro('Grace'));

      await receive(placementSnapshot(ROOM_ID));

      expect(heading()).toBe(PLACEMENT_TEXT.heading);
    });

    it('shows the battle view once both fleets are confirmed, and the game-over screen after it', async () => {
      await receive(battleSnapshot(ROOM_ID));

      expect(heading()).toBe(BATTLE_TEXT.myTurn);
      expect(page().querySelector('[role="grid"][aria-label="Enemy waters"]')).not.toBeNull();

      await receive(gameOverSnapshot(ROOM_ID));

      expect(heading()).toBe(BATTLE_TEXT.wonHeading);
      expect(page().textContent).toContain(BATTLE_TEXT.reasons.FLEET_DESTROYED('Grace', true));
    });
  });

  describe('after entering another room from this tab', () => {
    beforeEach(async () => {
      // As the app's bootstrap does; without it the router does not follow Back and Forward.
      TestBed.inject(Router).initialNavigation();
      await harness.navigateByUrl('/');
      await createRoom(ROOM_ID);
    });

    /** Creates the next room from home, then goes Back twice: past home, to the first room. */
    async function createNextRoomAndGoBack(): Promise<void> {
      await createRoom(NEXT_ROOM_ID);
      await receive(waitingSnapshot(NEXT_ROOM_ID));
      await goThroughHistory('back');
      await goThroughHistory('back');
      expect(TestBed.inject(Router).url).toBe(`/r/${ROOM_ID}`);
    }

    it('says the first room was left, with a way home, after the header link and Back', async () => {
      await receive(waitingSnapshot(ROOM_ID));
      // The header's app-name link, which the harness does not render.
      await harness.navigateByUrl('/');

      await createNextRoomAndGoBack();

      expect(heading()).toBe(ROOM_TEXT.leftHeading);
      expect(page().textContent).not.toContain(ROOM_TEXT.entering);
      expect(page().querySelector('a')?.getAttribute('href')).toBe('/');
    });

    it('says the first room was left after "New match" at game over and Back', async () => {
      await receive(battleSnapshot(ROOM_ID));
      await receive(gameOverSnapshot(ROOM_ID));
      const newMatch = [...page().querySelectorAll('a')].find((link) => link.textContent === BATTLE_TEXT.newMatch);
      newMatch?.click();
      await vi.waitFor(() => {
        expect(TestBed.inject(Router).url).toBe('/');
      });

      await createNextRoomAndGoBack();

      expect(heading()).toBe(ROOM_TEXT.leftHeading);
      expect(page().querySelector('[role="grid"]')).toBeNull();
    });

    it('still shows the room entered last', async () => {
      await harness.navigateByUrl('/');
      await createNextRoomAndGoBack();

      await goThroughHistory('forward');
      await goThroughHistory('forward');

      expect(TestBed.inject(Router).url).toBe(`/r/${NEXT_ROOM_ID}`);
      expect(heading()).toBe(LOBBY_TEXT.heading);
    });
  });

  describe('after a reload or in a new tab (#21)', () => {
    beforeEach(() => {
      TestBed.inject(SessionStore).save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
    });

    it('takes the seat back on a reload mid-match: the handshake already sends the session', async () => {
      await reload();
      await harness.navigateByUrl(`/r/${ROOM_ID}`);

      expect(page().textContent).toContain(ROOM_TEXT.entering);
      expect(socket.reconnect).not.toHaveBeenCalled();

      await receive(battleSnapshot(ROOM_ID));
      expect(heading()).toBe(BATTLE_TEXT.myTurn);
    });

    it('enters the room when its link opens in a new tab, and reconnects so the handshake sends the session', async () => {
      sessionStorage.clear();
      await reload();
      await harness.navigateByUrl(`/r/${ROOM_ID}`);

      expect(page().textContent).toContain(ROOM_TEXT.entering);
      expect(socket.reconnect).toHaveBeenCalledOnce();
      expect(TestBed.inject(SessionStore).current()?.roomId).toBe(ROOM_ID);

      await receive(battleSnapshot(ROOM_ID));
      expect(heading()).toBe(BATTLE_TEXT.myTurn);
    });

    it('shows both final boards when reloaded at game over (#52, F16)', async () => {
      await reload();
      await harness.navigateByUrl(`/r/${ROOM_ID}`);

      await receive(
        gameOverSnapshot(ROOM_ID, {
          incomingShots: [{ coordinate: { x: 0, y: 0 }, outcome: SHOT_OUTCOMES.MISS }],
          outgoingShots: [{ coordinate: { x: 9, y: 9 }, outcome: SHOT_OUTCOMES.MISS }],
        }),
      );

      expect(heading()).toBe(BATTLE_TEXT.wonHeading);
      for (const [label, cell] of [
        [BATTLE_TEXT.myFleet, 'A1, miss'],
        [BATTLE_TEXT.enemyWaters, 'J10, miss'],
      ] as const) {
        const cells = [...page().querySelectorAll(`[role="grid"][aria-label="${label}"] button`)];
        expect(cells.map((element) => element.getAttribute('aria-label'))).toContain(cell);
      }
    });

    it('shows the same rules, version and confirmations after a reload during negotiation (#27)', async () => {
      const snapshot = negotiationSnapshot(ROOM_ID, {
        rules: { ...DEFAULT_RULES, turnTimeLimitSeconds: 60 },
        rulesVersion: 3,
        hasConfirmedRules: { me: false, opponent: true },
      });
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
      await receive(snapshot);

      await reload();
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
      expect(page().textContent).toContain(ROOM_TEXT.entering);
      await receive(snapshot);

      expect(heading()).toBe(RULES_TEXT.heading);
      const checked = page().querySelector<HTMLInputElement>('input[name="turnTimeLimitSeconds"]:checked');
      expect(checked?.value).toBe('60');
      expect(page().textContent).toContain(RULES_TEXT.confirmation('Grace', true));
      expect(page().textContent).toContain(RULES_TEXT.confirmation(RULES_TEXT.you, false));
      // The version on screen is the one confirmed.
      socket.emitWithAck.mockResolvedValue({ ok: true });
      [...page().querySelectorAll('button')]
        .find((button) => button.textContent.trim() === RULES_TEXT.confirm)
        ?.click();
      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 3 });
    });

    it('still says a left room was left after a reload', async () => {
      TestBed.inject(SessionStore).save({ roomId: NEXT_ROOM_ID, playerSecret: PLAYER_SECRET });

      await reload();
      await harness.navigateByUrl(`/r/${ROOM_ID}`);

      expect(heading()).toBe(ROOM_TEXT.leftHeading);
      expect(socket.reconnect).not.toHaveBeenCalled();
    });

    it('explains a seat the server refused, even over an older snapshot (ADR-0076)', async () => {
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
      await receive(battleSnapshot(ROOM_ID));

      TestBed.inject(SessionStore).refuse(ROOM_ID);
      await harness.fixture.whenStable();

      expect(heading()).toBe(ROOM_TEXT.seatLosses.unknown.heading);
      expect(page().querySelector('a')?.getAttribute('href')).toBe('/');
    });
  });

  describe('after the server refused the stored seat (#25, ADR-0076)', () => {
    /** The minutes the explanations quote, from core's constants. */
    const FORFEIT_MINUTES = DISCONNECT_FORFEIT_MS / 60_000;
    const GAME_OVER_MINUTES = GAME_OVER_TTL_MS / 60_000;

    /**
     * Opens the room with a stored seat, shows a snapshot of it, then refuses the seat as the handshake does.
     * @param snapshot The room's latest snapshot before the refusal.
     */
    async function refuseAfter(snapshot: PlayerStateSnapshot): Promise<void> {
      TestBed.inject(SessionStore).save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
      await receive(snapshot);
      TestBed.inject(SessionStore).refuse(ROOM_ID);
      await harness.fixture.whenStable();
    }

    it('says the server restarted when it started after the seat was taken, with no way back in', async () => {
      wake.startedAt.mockImplementation(() => Promise.resolve(Date.now() + 1));

      await refuseAfter(battleSnapshot(ROOM_ID));

      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.seatLosses.restarted.heading);
      });
      expect(page().textContent).toContain(ROOM_TEXT.seatLosses.restarted.reason(FORFEIT_MINUTES, GAME_OVER_MINUTES));
      expect(page().querySelector('input')).toBeNull();
      expect(page().querySelector('a')?.textContent).toBe(ROOM_TEXT.createOwn);
      expect(wake.startedAt).toHaveBeenCalledOnce();
    });

    it('says the seat was given up when the server has run since, and offers to join again', async () => {
      wake.startedAt.mockImplementation(() => Promise.resolve(Date.now() - 60_000));

      await refuseAfter(placementSnapshot(ROOM_ID));

      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.seatLosses['given-up'].heading);
      });
      expect(page().textContent).toContain(ROOM_TEXT.seatLosses['given-up'].reason(FORFEIT_MINUTES, GAME_OVER_MINUTES));
      expect(page().textContent).toContain(`${String(FORFEIT_MINUTES)} minutes`);
      expect(page().querySelector('button[type="submit"]')?.textContent.trim()).toBe(ROOM_TEXT.join);
    });

    it('says the room closed after a match this tab saw end, while the server has run since', async () => {
      wake.startedAt.mockImplementation(() => Promise.resolve(Date.now() - 60_000));

      await refuseAfter(gameOverSnapshot(ROOM_ID));

      await vi.waitFor(() => {
        expect(wake.startedAt).toHaveBeenCalledOnce();
      });
      await harness.fixture.whenStable();
      expect(heading()).toBe(ROOM_TEXT.seatLosses.closed.heading);
      expect(page().textContent).toContain(`${String(GAME_OVER_MINUTES)} minutes`);
      expect(page().querySelector('input')).toBeNull();
    });

    it('says the server restarted rather than closed when it restarted after the match ended', async () => {
      wake.startedAt.mockImplementation(() => Promise.resolve(Date.now() + 1));

      await refuseAfter(gameOverSnapshot(ROOM_ID));

      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.seatLosses.restarted.heading);
      });
    });

    it('covers every cause when the server does not say when it started', async () => {
      await refuseAfter(placementSnapshot(ROOM_ID));

      await vi.waitFor(() => {
        expect(wake.startedAt).toHaveBeenCalledOnce();
      });
      await harness.fixture.whenStable();

      expect(heading()).toBe(ROOM_TEXT.seatLosses.unknown.heading);
      expect(page().querySelector('button[type="submit"]')).not.toBeNull();
    });

    it('takes the free seat again, P1 included, without showing the old snapshot (ADR-0073)', async () => {
      await refuseAfter(fromSeat(SEATS.P2, placementSnapshot(ROOM_ID)));
      socket.emitWithAck.mockResolvedValue({ ok: true, playerSecret: createPlayerSecret() });

      await join('Grace');

      await vi.waitFor(() => {
        expect(page().textContent).toContain(ROOM_TEXT.entering);
      });
      // The creator left too, so the joiner lands in P1 against a new opponent.
      const rejoined = fromSeat(SEATS.P1, placementSnapshot(ROOM_ID));
      await receive({ ...rejoined, opponent: rejoined.opponent && { ...rejoined.opponent, nickname: 'Linus' } });

      expect(heading()).toBe(PLACEMENT_TEXT.heading);
      expect(page().textContent).toContain(PLACEMENT_TEXT.opponentPlacing('Linus'));
    });

    it('shows not-found when joining again finds the room gone', async () => {
      await refuseAfter(placementSnapshot(ROOM_ID));
      socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.ROOM_NOT_FOUND });

      await join('Grace');

      await vi.waitFor(() => {
        expect(heading()).toBe(ROOM_TEXT.notFoundHeading);
      });
    });

    it('asks when the server started only once the seat is refused', async () => {
      TestBed.inject(SessionStore).save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
      for (const snapshot of [waitingSnapshot(ROOM_ID), placementSnapshot(ROOM_ID), battleSnapshot(ROOM_ID)]) {
        await receive(snapshot);
      }
      expect(wake.startedAt).not.toHaveBeenCalled();

      TestBed.inject(SessionStore).refuse(ROOM_ID);
      await harness.fixture.whenStable();

      expect(wake.startedAt).toHaveBeenCalledOnce();
    });
  });

  describe('opponent presence (#25)', () => {
    beforeEach(async () => {
      TestBed.inject(SessionStore).save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
    });

    it('shows above the waiting screen, the rules screen, placement and battle, but not while entering', async () => {
      expect(page().querySelector('app-presence')).toBeNull();

      for (const snapshot of [
        waitingSnapshot(ROOM_ID),
        negotiationSnapshot(ROOM_ID),
        placementSnapshot(ROOM_ID),
        battleSnapshot(ROOM_ID),
      ]) {
        await receive(snapshot);
        expect(page().querySelector('app-presence')).not.toBeNull();
      }
    });

    it('announces who left when a freed seat sends the player back to the waiting screen (ADR-0073)', async () => {
      await receive(fromSeat(SEATS.P2, placementSnapshot(ROOM_ID)));
      const liveRegion = page().querySelector('app-presence [aria-live]');

      // Grace, who created the room as P1, did not come back: Ada waits in her own seat, P2.
      await receive(fromSeat(SEATS.P2, waitingSnapshot(ROOM_ID, 'Ada')));

      expect(heading()).toBe(LOBBY_TEXT.heading);
      expect(page().querySelector('app-presence [aria-live]')).toBe(liveRegion);
      expect(liveRegion?.textContent).toContain(PRESENCE_TEXT.departed('Grace'));
    });
  });

  describe('leaving before the match (#25)', () => {
    beforeEach(async () => {
      TestBed.inject(SessionStore).save({ roomId: ROOM_ID, playerSecret: PLAYER_SECRET });
      await harness.navigateByUrl(`/r/${ROOM_ID}`);
    });

    /** @returns The "Leave room" button, or `null`. */
    function leaveButton(): HTMLButtonElement | null {
      return (
        [...page().querySelectorAll('button')].find((button) => button.textContent.trim() === ROOM_TEXT.leave) ?? null
      );
    }

    it.each([
      ['the waiting screen', waitingSnapshot(ROOM_ID)],
      ['the rules screen', negotiationSnapshot(ROOM_ID)],
      ['placement', placementSnapshot(ROOM_ID)],
    ])('gives up the seat from %s, forgets it and goes home', async (_view, snapshot) => {
      await receive(snapshot);
      socket.emitWithAck.mockResolvedValue({ ok: true });

      leaveButton()?.click();

      await vi.waitFor(() => {
        expect(TestBed.inject(Router).url).toBe('/');
      });
      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.LEAVE_ROOM, {});
      expect(TestBed.inject(SessionStore).get(ROOM_ID)).toBeNull();
      expect(TestBed.inject(SessionStore).current()).toBeNull();
      expect(TestBed.inject(GameStateService).snapshot()).toBeNull();
    });

    it('sends LEAVE_ROOM once however often it is tapped, and shows it under way (ADR-0078)', async () => {
      await receive(placementSnapshot(ROOM_ID));
      socket.emitWithAck.mockReturnValue(new Promise(() => undefined));

      const button = leaveButton();
      button?.click();
      await harness.fixture.whenStable();
      // The same element, now worded "Leaving…": `leaveButton()` would no longer find it.
      button?.click();
      await harness.fixture.whenStable();

      expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.LEAVE_ROOM, {});
      expect(button?.textContent.trim()).toBe(ROOM_TEXT.leaving);
      expect(button?.getAttribute('aria-disabled')).toBe('true');
    });

    it('stays with the reason when the server refuses', async () => {
      await receive(placementSnapshot(ROOM_ID));
      socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.NOT_ALLOWED });

      leaveButton()?.click();

      await vi.waitFor(() => {
        expect(page().querySelector('.leave-error[role="alert"]')?.textContent).toBe(ROOM_TEXT.leaveErrors.NOT_ALLOWED);
      });
      expect(TestBed.inject(Router).url).toBe(`/r/${ROOM_ID}`);
      expect(TestBed.inject(SessionStore).get(ROOM_ID)).not.toBeNull();
      expect(heading()).toBe(PLACEMENT_TEXT.heading);
    });

    it.each([
      ['the waiting screen', waitingSnapshot(ROOM_ID), LOBBY_TEXT.heading],
      ['the rules screen', negotiationSnapshot(ROOM_ID), RULES_TEXT.heading],
      ['placement', placementSnapshot(ROOM_ID), PLACEMENT_TEXT.heading],
    ])('sits beside the heading of %s, above the rest of the view (ADR-0080)', async (_view, snapshot, viewHeading) => {
      await receive(snapshot);

      const row = leaveButton()?.parentElement;
      expect(row?.querySelector(':scope > h1')?.textContent.trim()).toBe(viewHeading);
      expect(row?.querySelector(':scope > [role="alert"]')).not.toBeNull();
    });

    it('keeps its hint as a description, out of the reading order (ADR-0080)', async () => {
      await receive(placementSnapshot(ROOM_ID));

      const hintId = leaveButton()?.getAttribute('aria-describedby') ?? '';
      const hint = page().querySelector(`[id="${hintId}"]`);
      expect(hint?.textContent).toBe(ROOM_TEXT.leaveHint);
      expect(hint?.hasAttribute('hidden')).toBe(true);
    });

    it.each([
      ['the battle view', battleSnapshot(ROOM_ID)],
      ['the game-over screen', gameOverSnapshot(ROOM_ID)],
    ])('is not offered on %s', async (_view, snapshot) => {
      await receive(snapshot);

      expect(page().querySelector('app-presence')).not.toBeNull();
      expect(leaveButton()).toBeNull();
    });
  });

  // Drawn from a well-formed id: too short, upper case, and a letter outside ROOM_ID_ALPHABET.
  it.each([ROOM_ID.slice(0, 3), ROOM_ID.toUpperCase(), `${ROOM_ID.slice(0, -1)}o`])(
    'shows not-found for the malformed room id %s',
    async (roomId) => {
      await harness.navigateByUrl(`/r/${roomId}`);

      expect(heading()).toBe(ROOM_TEXT.notFoundHeading);
      expect(socket.emitWithAck).not.toHaveBeenCalled();
    },
  );
});
