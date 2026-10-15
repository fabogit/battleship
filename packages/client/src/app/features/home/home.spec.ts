import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CLIENT_EVENTS, ERROR_CODES, NICKNAME_MAX_LENGTH } from '@battleship/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGameSocket, provideFakeGameSocket } from '../../../testing/fake-game-socket';
import { FakeServerWake, provideFakeServerWake } from '../../../testing/fake-server-wake';
import { routes } from '../../app.routes';
import { CONNECTION_STATUSES } from '../../core/game-socket';
import { ROOM_ENTRY_TEXT } from '../../core/room-entry.text';
import { SessionStore } from '../../core/session-store';
import { NICKNAME_FORM_TEXT } from '../../shared/nickname-form/nickname-form.text';
import { Home } from './home';
import { HOME_TEXT } from './home.text';
import { createRoomId, createPlayerSecret } from '../../../testing/session-fixtures';

const ROOM_ID = createRoomId(0);
const PLAYER_SECRET = createPlayerSecret();

let socket: FakeGameSocket;
let harness: RouterTestingHarness;

beforeEach(async () => {
  socket = new FakeGameSocket();
  TestBed.configureTestingModule({
    providers: [
      provideFakeGameSocket(socket),
      provideFakeServerWake(new FakeServerWake()),
      provideRouter(routes, withComponentInputBinding()),
    ],
  });
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/', Home);
});

/** @returns The rendered page. */
function page(): HTMLElement {
  return harness.routeNativeElement as HTMLElement;
}

/** @returns The submit button. */
function submitButton(): HTMLButtonElement {
  const button = page().querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button === null) {
    throw new Error('No submit button');
  }
  return button;
}

/**
 * Types a nickname and submits the form.
 * @param nickname What the player types.
 */
async function submit(nickname: string): Promise<void> {
  const input = page().querySelector('input');
  if (input === null) {
    throw new Error('No nickname field');
  }
  input.value = nickname;
  input.dispatchEvent(new Event('input'));
  submitButton().click();
  await harness.fixture.whenStable();
}

describe('Home', () => {
  it('asks for a nickname with a labelled field', () => {
    expect(page().querySelector('h1')?.textContent).toBe(HOME_TEXT.heading);
    expect(page().querySelector('label[for="nickname"]')?.textContent).toBe(NICKNAME_FORM_TEXT.label);
    expect(page().querySelector('input#nickname')).not.toBeNull();
    expect(submitButton().textContent.trim()).toBe(HOME_TEXT.create);
  });

  it('creates a room with the trimmed nickname and opens its page', async () => {
    socket.emitWithAck.mockResolvedValue({ ok: true, roomId: ROOM_ID, playerSecret: PLAYER_SECRET });

    await submit('  Ada  ');

    expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.CREATE_ROOM, { nickname: 'Ada' });
    await vi.waitFor(() => {
      expect(TestBed.inject(Router).url).toBe(`/r/${ROOM_ID}`);
    });
    expect(TestBed.inject(SessionStore).get(ROOM_ID)).not.toBeNull();
  });

  it('refuses a blank nickname without sending anything', async () => {
    await submit('   ');

    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(page().querySelector('#nickname-error')?.textContent.trim()).toBe(NICKNAME_FORM_TEXT.empty);
    expect(page().querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  });

  // ADR-0060: one invisible, one bidi override, one blank-looking, one control character.
  it.each([
    ['a zero-width space', '\u200B'],
    ['a right-to-left override', '\u202Eevil'],
    ['a Hangul filler', '\u3164'],
    ['a NUL', 'a\u0000b'],
  ])('refuses a nickname with %s and says why, without sending anything', async (_label, nickname) => {
    await submit(nickname);

    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(page().querySelector('#nickname-error')?.textContent.trim()).toBe(NICKNAME_FORM_TEXT.unsupportedCharacters);
    expect(page().querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('creates a room for a nickname in another script with an emoji', async () => {
    socket.emitWithAck.mockResolvedValue({ ok: true, roomId: ROOM_ID, playerSecret: PLAYER_SECRET });

    await submit('ليلى 👩\u200D💻');

    expect(socket.emitWithAck).toHaveBeenCalledExactlyOnceWith(CLIENT_EVENTS.CREATE_ROOM, {
      nickname: 'ليلى 👩\u200D💻',
    });
  });

  it('keeps the button focusable but inactive until the socket is connected', async () => {
    socket.status.set(CONNECTION_STATUSES.CONNECTING);
    await harness.fixture.whenStable();

    expect(submitButton().getAttribute('aria-disabled')).toBe('true');
    expect(submitButton().disabled).toBe(false);
    expect(page().querySelector('#nickname-wait')?.textContent.trim()).toBe(NICKNAME_FORM_TEXT.waitingForServer);

    await submit('Ada');

    expect(socket.emitWithAck).not.toHaveBeenCalled();
  });

  it('stays home and explains a refusal', async () => {
    socket.emitWithAck.mockResolvedValue({ ok: false, error: ERROR_CODES.SERVER_FULL });

    await submit('Ada');

    await vi.waitFor(() => {
      expect(page().querySelector('[role="alert"]')?.textContent).toBe(ROOM_ENTRY_TEXT.errors.SERVER_FULL);
    });
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('limits the field to NICKNAME_MAX_LENGTH characters', () => {
    expect(page().querySelector('input')?.getAttribute('maxlength')).toBe(String(NICKNAME_MAX_LENGTH));
  });
});
