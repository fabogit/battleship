import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  ERROR_CODES,
  SERVER_EVENTS,
  TIMEOUT_ACTIONS,
  type GameRules,
} from '@battleship/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGameSocket, negotiationSnapshot, provideFakeGameSocket } from '../../../testing/fake-game-socket';
import { createRoomId } from '../../../testing/session-fixtures';
import { TRANSPORT_ERRORS } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import { RULES_EDITORS, RULES_NOTICE_KINDS } from './rules-store';
import { Rules } from './rules';
import { RULES_TEXT, rulesErrorMessage, rulesNoticeMessage } from './rules.text';

const ROOM_ID = createRoomId(0);

let socket: FakeGameSocket;
let fixture: ComponentFixture<Rules>;

/**
 * Delivers a negotiation snapshot and lets the screen render it.
 * @param negotiation The rules, their version or the confirmations to override.
 */
async function receive(negotiation: Parameters<typeof negotiationSnapshot>[1] = {}): Promise<void> {
  socket.fire(SERVER_EVENTS.STATE, negotiationSnapshot(ROOM_ID, negotiation));
  await fixture.whenStable();
}

/**
 * Shows the screen once the room negotiates, as the room page does.
 * @param negotiation The first snapshot's rules, version or confirmations.
 */
async function render(negotiation: Parameters<typeof negotiationSnapshot>[1] = {}): Promise<void> {
  TestBed.inject(GameStateService);
  socket.fire(SERVER_EVENTS.STATE, negotiationSnapshot(ROOM_ID, negotiation));
  fixture = TestBed.createComponent(Rules);
  await fixture.whenStable();
}

/** @returns The rendered screen. */
function screen(): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/**
 * Finds a switch by its label.
 * @param label The switch's label in `RULES_TEXT`.
 * @returns The checkbox.
 */
function toggle(label: string): HTMLInputElement {
  const row = [...screen().querySelectorAll('label')].find((element) => element.textContent.trim() === label);
  const input = row?.querySelector<HTMLInputElement>('input[role="switch"]');
  if (!input) {
    throw new Error(`No switch "${label}"`);
  }
  return input;
}

/**
 * Finds a radio by its group's legend and its accessible label.
 * @param legend The group's legend in `RULES_TEXT`.
 * @param name The option's name as read.
 * @returns The radio.
 */
function option(legend: string, name: string): HTMLInputElement {
  const group = [...screen().querySelectorAll('fieldset')].find(
    (element) => element.querySelector(':scope > legend')?.textContent.trim() === legend,
  );
  const label = [...(group?.querySelectorAll('label') ?? [])].find((element) =>
    [...element.querySelectorAll('span:not([aria-hidden])')].some((span) => span.textContent.trim() === name),
  );
  const input = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!input) {
    throw new Error(`No option "${name}" in "${legend}"`);
  }
  return input;
}

/** @returns The confirm button. */
function confirmButton(): HTMLButtonElement {
  const button = screen().querySelector<HTMLButtonElement>('button.primary');
  if (button === null) {
    throw new Error('No confirm button');
  }
  return button;
}

/** @returns The rules of every `UPDATE_RULES` sent so far, oldest first. */
function sentRules(): unknown[] {
  return socket.emitWithAck.mock.calls
    .filter(([event]) => event === CLIENT_EVENTS.UPDATE_RULES)
    .map(([, payload]) => (payload as { rules: unknown }).rules);
}

beforeEach(() => {
  socket = new FakeGameSocket();
  socket.emitWithAck.mockResolvedValue({ ok: true });
  TestBed.configureTestingModule({ providers: [provideFakeGameSocket(socket)] });
});

afterEach(() => {
  TestBed.inject(GameStateService).clear();
});

describe('Rules', () => {
  it('offers the M3 rules as native inputs in a fieldset with a legend, and no salvo (#32, #34)', async () => {
    await render();

    const fieldset = screen().querySelector('fieldset');
    expect(fieldset?.querySelector(':scope > legend')?.textContent.trim()).toBe(RULES_TEXT.legend);
    expect(screen().querySelectorAll('input[role="switch"]')).toHaveLength(2);
    expect(screen().querySelectorAll('input[name="turnTimeLimitSeconds"]')).toHaveLength(4);
    expect(screen().querySelectorAll('input[name="timeoutAction"]')).toHaveLength(2);
    expect(screen().querySelectorAll('input')).toHaveLength(8);
    expect(screen().textContent.toLowerCase()).not.toContain('salvo');
  });

  it('says the room closes if the rules are not confirmed by both within NEGOTIATION_TTL_MS (#128)', async () => {
    await render();

    const intro = screen().querySelector('.intro')?.textContent.trim();
    expect(intro).toBe(RULES_TEXT.intro('Grace', 10));
    expect(intro).toContain('within 10 minutes, the room closes');
  });

  it('shows the rules of the snapshot, and of every later one', async () => {
    const rules: GameRules = {
      ...DEFAULT_RULES,
      areAdjacentShipsAllowed: true,
      turnTimeLimitSeconds: 120,
      timeoutAction: TIMEOUT_ACTIONS.PASS_TURN,
    };
    await render({ rules });

    expect(toggle(RULES_TEXT.extraTurn).checked).toBe(false);
    expect(toggle(RULES_TEXT.adjacentShips).checked).toBe(true);
    expect(option(RULES_TEXT.turnTimeLimit, RULES_TEXT.secondsName(120)).checked).toBe(true);
    expect(option(RULES_TEXT.turnTimeLimit, RULES_TEXT.secondsName(30)).checked).toBe(false);
    expect(option(RULES_TEXT.timeoutAction, RULES_TEXT.timeoutActions.PASS_TURN).checked).toBe(true);

    await receive({ rules: { ...rules, isExtraTurnOnHitEnabled: true, turnTimeLimitSeconds: 15 }, rulesVersion: 1 });

    expect(toggle(RULES_TEXT.extraTurn).checked).toBe(true);
    expect(option(RULES_TEXT.turnTimeLimit, RULES_TEXT.secondsName(15)).checked).toBe(true);
  });

  it('sends the whole rules when a switch or an option changes', async () => {
    const rules: GameRules = { ...DEFAULT_RULES, turnTimeLimitSeconds: 60 };
    await render({ rules });

    toggle(RULES_TEXT.adjacentShips).click();
    await fixture.whenStable();
    option(RULES_TEXT.timeoutAction, RULES_TEXT.timeoutActions.PASS_TURN).click();
    await fixture.whenStable();

    expect(sentRules()).toEqual([
      { ...rules, areAdjacentShipsAllowed: true },
      { ...rules, areAdjacentShipsAllowed: true, timeoutAction: TIMEOUT_ACTIONS.PASS_TURN },
    ]);
  });

  it.each([
    [ERROR_CODES.INVALID_RULES, RULES_TEXT.errors.INVALID_RULES],
    [TRANSPORT_ERRORS.NOT_CONNECTED, RULES_TEXT.errors.NOT_CONNECTED],
  ])("shows the server's value again after %s, with the reason", async (error, message) => {
    await render();
    socket.emitWithAck.mockResolvedValue({ ok: false, error });

    const input = option(RULES_TEXT.turnTimeLimit, RULES_TEXT.secondsName(60));
    input.click();

    await vi.waitFor(() => {
      expect(screen().querySelector('[role="alert"]')?.textContent).toBe(message);
    });
    expect(input.checked).toBe(false);
    expect(option(RULES_TEXT.turnTimeLimit, RULES_TEXT.secondsName(30)).checked).toBe(true);
  });

  it('keeps "Confirm rules" active after a failed edit, and confirms the version on screen', async () => {
    await render({ rulesVersion: 3 });
    socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: TRANSPORT_ERRORS.NOT_CONNECTED });

    toggle(RULES_TEXT.adjacentShips).click();

    await vi.waitFor(() => {
      expect(screen().querySelector('[role="alert"]')?.textContent).toBe(RULES_TEXT.errors.NOT_CONNECTED);
    });
    expect(toggle(RULES_TEXT.adjacentShips).checked).toBe(false);
    expect(confirmButton().hasAttribute('aria-disabled')).toBe(false);

    confirmButton().click();
    await fixture.whenStable();

    expect(socket.emitWithAck).toHaveBeenLastCalledWith(CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 3 });
  });

  it('confirms the version on screen, then says it is confirmed', async () => {
    await render({ rulesVersion: 4 });

    confirmButton().click();
    await fixture.whenStable();
    await receive({ rulesVersion: 4, hasConfirmedRules: { me: true, opponent: false } });

    expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.CONFIRM_RULES, { rulesVersion: 4 });
    expect(confirmButton().textContent.trim()).toBe(RULES_TEXT.confirmed);
    expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('reads "Confirming…" and ignores taps while the command runs', async () => {
    await render();
    socket.emitWithAck.mockReturnValue(new Promise(() => undefined));

    confirmButton().click();
    await fixture.whenStable();
    confirmButton().click();
    await fixture.whenStable();

    expect(socket.emitWithAck).toHaveBeenCalledOnce();
    expect(confirmButton().textContent.trim()).toBe(RULES_TEXT.confirming);
    expect(confirmButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('says the rules just changed on STALE_RULES, and lets the player confirm again', async () => {
    await render({ rulesVersion: 1 });
    socket.emitWithAck.mockResolvedValueOnce({ ok: false, error: ERROR_CODES.STALE_RULES });

    confirmButton().click();

    await vi.waitFor(() => {
      expect(screen().querySelector('[role="alert"]')?.textContent).toBe(RULES_TEXT.errors.STALE_RULES);
    });
    expect(confirmButton().textContent.trim()).toBe(RULES_TEXT.confirm);
    expect(confirmButton().hasAttribute('aria-disabled')).toBe(false);
  });

  it('describes "Confirm rules" with what an edit does, out of the reading order', async () => {
    await render();

    const hint = screen().querySelector(`[id="${confirmButton().getAttribute('aria-describedby') ?? ''}"]`);
    expect(hint?.textContent).toBe(RULES_TEXT.confirmHint);
    expect(hint?.hasAttribute('hidden')).toBe(true);
  });

  it("lists both players' confirmations", async () => {
    await render({ hasConfirmedRules: { me: false, opponent: true } });

    const items = [...screen().querySelectorAll(`ul[aria-label="${RULES_TEXT.confirmationsLabel}"] li`)];
    expect(items.map((item) => item.textContent.trim())).toEqual([
      RULES_TEXT.confirmation(RULES_TEXT.you, false),
      RULES_TEXT.confirmation('Grace', true),
    ]);
  });

  it("announces the opponent's edit and the cleared confirmations politely, without moving focus", async () => {
    await render({ rulesVersion: 1, hasConfirmedRules: { me: true, opponent: false } });
    const liveRegion = screen().querySelector('[aria-live="polite"]');
    const focused = toggle(RULES_TEXT.extraTurn);
    focused.focus();

    await receive({ rules: { ...DEFAULT_RULES, turnTimeLimitSeconds: 60 }, rulesVersion: 2 });

    expect(liveRegion?.textContent).toBe(
      `Grace ${RULES_TEXT.changes.turnTimeLimitSeconds(60)}. ${RULES_TEXT.youConfirmAgain}`,
    );
    expect(document.activeElement).toBe(focused);
    const items = [...screen().querySelectorAll('li')];
    expect(items[0]?.textContent.trim()).toBe(RULES_TEXT.confirmation(RULES_TEXT.you, false));
    expect(confirmButton().textContent.trim()).toBe(RULES_TEXT.confirm);
  });
});

describe('rulesNoticeMessage', () => {
  it('says who changed what, and who needs to confirm again', () => {
    const changed = {
      kind: RULES_NOTICE_KINDS.CHANGED,
      editor: RULES_EDITORS.ME,
      changes: { areAdjacentShipsAllowed: true },
      cleared: { me: false, opponent: true },
    } as const;

    expect(rulesNoticeMessage(changed, 'Grace')).toBe('You allowed ships to touch. Grace needs to confirm again.');
    expect(
      rulesNoticeMessage(
        {
          ...changed,
          editor: RULES_EDITORS.OPPONENT,
          changes: { isExtraTurnOnHitEnabled: true, turnTimeLimitSeconds: 15, timeoutAction: 'PASS_TURN' },
          cleared: { me: true, opponent: true },
        },
        'Grace',
      ),
    ).toBe(
      'Grace turned extra turn on hit on, set the time per turn to 15 seconds and chose to pass the turn when time runs out. You both need to confirm again.',
    );
    expect(
      rulesNoticeMessage(
        { ...changed, editor: RULES_EDITORS.OPPONENT, changes: {}, cleared: { me: false, opponent: false } },
        'Grace',
      ),
    ).toBe('Grace changed the rules.');
    expect(rulesNoticeMessage({ kind: RULES_NOTICE_KINDS.OPPONENT_CONFIRMED }, 'Grace')).toBe(
      'Grace confirmed the rules.',
    );
  });

  it('words every rule, salvo included, both ways', () => {
    expect(
      [true, false].flatMap((value) => [
        RULES_TEXT.changes.isExtraTurnOnHitEnabled(value),
        RULES_TEXT.changes.areAdjacentShipsAllowed(value),
        RULES_TEXT.changes.isSalvoModeEnabled(value),
      ]),
    ).toEqual([
      'turned extra turn on hit on',
      'allowed ships to touch',
      'turned salvo on',
      'turned extra turn on hit off',
      'stopped ships from touching',
      'turned salvo off',
    ]);
    expect(RULES_TEXT.changes.timeoutAction(TIMEOUT_ACTIONS.AUTO_RANDOM_SHOT)).toBe(
      'chose a random shot when time runs out',
    );
  });
});

describe('rulesErrorMessage', () => {
  it('explains the rules errors and falls back for the others', () => {
    expect(rulesErrorMessage(ERROR_CODES.STALE_RULES)).toBe(RULES_TEXT.errors.STALE_RULES);
    expect(rulesErrorMessage(ERROR_CODES.SERVER_ERROR)).toBe(RULES_TEXT.errors.SERVER_ERROR);
    expect(rulesErrorMessage(ERROR_CODES.ROOM_FULL)).toBe(RULES_TEXT.unexpected);
  });
});
