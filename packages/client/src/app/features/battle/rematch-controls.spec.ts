import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  CLIENT_EVENTS,
  ERROR_CODES,
  GAME_OVER_TTL_MS,
  REMATCH_CHOICES,
  SERVER_EVENTS,
  type GameOverSnapshot,
  type PlayerView,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeGameSocket, gameOverSnapshot, provideFakeGameSocket } from '../../../testing/fake-game-socket';
import { createRoomId } from '../../../testing/session-fixtures';
import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { RoomEntryService } from '../../core/room-entry';
import { BATTLE_TEXT, rematchErrorMessage } from './battle.text';
import { RematchControls } from './rematch-controls';

const ROOM_ID = createRoomId(0);
const TEXT = BATTLE_TEXT.rematch;

let socket: FakeGameSocket;
let fixture: ComponentFixture<RematchControls>;

/** @returns The rendered controls. */
function view(): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/**
 * Delivers a game-over snapshot and lets the controls render it.
 * @param rematch Both choices, as the receiver sees them.
 * @param opponent Fields of the opponent's view to override.
 */
async function receive(
  rematch: GameOverSnapshot['rematch'] = { me: null, opponent: null },
  opponent: Partial<PlayerView> = {},
): Promise<void> {
  const snapshot = gameOverSnapshot(ROOM_ID, { rematch });
  socket.fire(SERVER_EVENTS.STATE, {
    ...snapshot,
    opponent: snapshot.opponent === null ? null : { ...snapshot.opponent, ...opponent },
  });
  await fixture.whenStable();
}

/**
 * Finds a toggle by its text.
 * @param label `TEXT.playAgain` or `TEXT.changeRules`.
 * @returns The button.
 */
function toggle(label: string): HTMLButtonElement {
  const button = [...view().querySelectorAll('button')].find((element) => element.textContent.trim() === label);
  if (button === undefined) {
    throw new Error(`No "${label}" toggle`);
  }
  return button;
}

/** @returns The `aria-pressed` of both toggles, "Play again" first. */
function pressed(): (string | null)[] {
  return [toggle(TEXT.playAgain), toggle(TEXT.changeRules)].map((button) => button.getAttribute('aria-pressed'));
}

/** @returns The lines of the live region: both choices, and the wait for an absent opponent. */
function stateLines(): string[] {
  return [...view().querySelectorAll('.state p')].map((line) => line.textContent.trim());
}

/**
 * Answers the next `REMATCH_CHOICE` once the test calls the returned function.
 * @returns Resolves the ack.
 */
function holdAck(): (response: { ok: true } | { ok: false; error: string }) => void {
  let answer: (response: { ok: true } | { ok: false; error: string }) => void = () => undefined;
  socket.emitWithAck.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve as typeof answer;
    }),
  );
  return (response) => {
    answer(response);
  };
}

beforeEach(async () => {
  socket = new FakeGameSocket();
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket), provideRouter([])] });
  TestBed.inject(GameStateService);
  fixture = TestBed.createComponent(RematchControls);
  await receive();
});

afterEach(() => {
  TestBed.inject(GameStateService).clear();
});

describe('RematchControls (#36, ADR-0126)', () => {
  it('offers both choices unpressed, says nobody chose, and links home to leave', () => {
    expect(view().querySelector('[role="group"]')?.getAttribute('aria-labelledby')).toBe('rematch-label');
    expect(view().querySelector('#rematch-label')?.textContent.trim()).toBe(TEXT.label);
    expect(pressed()).toEqual(['false', 'false']);
    expect(stateLines()).toEqual([TEXT.mine(null), TEXT.theirs('Grace', null)]);
    expect(view().querySelector('.hint')?.textContent).toContain(TEXT.changeWins);
    expect(view().querySelector('.hint')?.textContent).toContain(TEXT.expiry(GAME_OVER_TTL_MS / 60_000));
    const leave = view().querySelector('a');
    expect(leave?.textContent.trim()).toBe(TEXT.leave);
    expect(leave?.getAttribute('href')).toBe('/');
    expect(leave?.hasAttribute('aria-disabled')).toBe(false);
  });

  it('sends the choice once, shows it pressed while it waits, then as the snapshot holds it', async () => {
    const answer = holdAck();

    toggle(TEXT.playAgain).click();
    toggle(TEXT.playAgain).click();
    toggle(TEXT.changeRules).click();
    await fixture.whenStable();

    expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.REMATCH_CHOICE, {
      choice: REMATCH_CHOICES.SAME_RULES,
    });
    expect(pressed()).toEqual(['true', 'false']);
    expect(toggle(TEXT.playAgain).getAttribute('aria-disabled')).toBe('true');
    expect(toggle(TEXT.changeRules).getAttribute('aria-disabled')).toBe('true');
    expect(stateLines()[0]).toBe(TEXT.mine(REMATCH_CHOICES.SAME_RULES));

    answer({ ok: true });
    await receive({ me: REMATCH_CHOICES.SAME_RULES, opponent: null });

    expect(pressed()).toEqual(['true', 'false']);
    expect(toggle(TEXT.playAgain).hasAttribute('aria-disabled')).toBe(false);
  });

  it('changes the choice, keeping the same buttons, so focus stays on the one pressed', async () => {
    await receive({ me: REMATCH_CHOICES.SAME_RULES, opponent: null });
    const buttons = [...view().querySelectorAll('button')];
    socket.emitWithAck.mockResolvedValue({ ok: true });
    toggle(TEXT.changeRules).focus();

    toggle(TEXT.changeRules).click();
    await receive({ me: REMATCH_CHOICES.CHANGE_RULES, opponent: null });

    expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.REMATCH_CHOICE, {
      choice: REMATCH_CHOICES.CHANGE_RULES,
    });
    expect(pressed()).toEqual(['false', 'true']);
    expect([...view().querySelectorAll('button')]).toEqual(buttons);
    expect(document.activeElement).toBe(toggle(TEXT.changeRules));
  });

  it('sends nothing for the choice the room already holds: a choice is changed, not taken back', async () => {
    await receive({ me: REMATCH_CHOICES.CHANGE_RULES, opponent: null });

    toggle(TEXT.changeRules).click();
    await fixture.whenStable();

    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(pressed()).toEqual(['false', 'true']);
  });

  it.each([
    [REMATCH_CHOICES.SAME_RULES, REMATCH_CHOICES.CHANGE_RULES],
    [REMATCH_CHOICES.CHANGE_RULES, REMATCH_CHOICES.SAME_RULES],
  ] as const)("shows both players' choices: mine %s, the opponent's %s", async (me, opponent) => {
    await receive({ me, opponent });

    expect(stateLines()).toEqual([TEXT.mine(me), TEXT.theirs('Grace', opponent)]);
  });

  it('says the rematch waits for an opponent who is away', async () => {
    await receive(
      { me: REMATCH_CHOICES.SAME_RULES, opponent: REMATCH_CHOICES.SAME_RULES },
      { isConnected: false, forfeitRemainingMs: null },
    );

    expect(stateLines()).toEqual([
      TEXT.mine(REMATCH_CHOICES.SAME_RULES),
      TEXT.theirs('Grace', REMATCH_CHOICES.SAME_RULES),
      TEXT.waitsForReturn('Grace'),
    ]);
  });

  it.each([
    ERROR_CODES.WRONG_PHASE,
    ERROR_CODES.RATE_LIMITED,
    ERROR_CODES.SERVER_ERROR,
    TRANSPORT_ERRORS.NOT_CONNECTED,
    TRANSPORT_ERRORS.NO_ACK,
  ])('explains %s, shows the choice the room holds again, and forgets it when the opponent chooses', async (error) => {
    socket.emitWithAck.mockResolvedValue({ ok: false, error });

    toggle(TEXT.playAgain).click();
    await fixture.whenStable();

    expect(view().querySelector('[role="alert"]')?.textContent.trim()).toBe(rematchErrorMessage(error));
    expect(rematchErrorMessage(error)).not.toBe(TEXT.unexpected);
    expect(pressed()).toEqual(['false', 'false']);

    await receive({ me: null, opponent: REMATCH_CHOICES.CHANGE_RULES });
    expect(view().querySelector('[role="alert"]')?.textContent.trim()).toBe('');
  });

  it('marks "Leave room" as under way while LEAVE_ROOM waits for its ack', async () => {
    let answer: (response: { ok: true }) => void = () => undefined;
    socket.emitWithAck.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const leaving = TestBed.inject(RoomEntryService).leave(ROOM_ID);
    await fixture.whenStable();

    const link = view().querySelector('a');
    expect(link?.textContent.trim()).toBe(TEXT.leaving);
    expect(link?.getAttribute('aria-disabled')).toBe('true');

    answer({ ok: true });
    await leaving;
  });
});
