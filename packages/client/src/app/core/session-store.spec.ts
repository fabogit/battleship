import { TestBed } from '@angular/core/testing';
import { computed } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { SessionStore } from './session-store';

// Generated, as the server does: a literal UUID named like a secret trips secret scanners.
const FIRST_SECRET = crypto.randomUUID();
const SECOND_SECRET = crypto.randomUUID();

let store: SessionStore;

beforeEach(() => {
  store = TestBed.inject(SessionStore);
});

describe('SessionStore', () => {
  it('holds no session at first', () => {
    expect(store.get('ab23cd45')).toBeNull();
  });

  it('keeps one session per room, the latest one winning', () => {
    store.save({ roomId: 'ab23cd45', playerSecret: FIRST_SECRET });
    store.save({ roomId: 'zz23cd45', playerSecret: FIRST_SECRET });
    store.save({ roomId: 'ab23cd45', playerSecret: SECOND_SECRET });

    expect(store.get('ab23cd45')).toEqual({ roomId: 'ab23cd45', playerSecret: SECOND_SECRET });
    expect(store.get('zz23cd45')).toEqual({ roomId: 'zz23cd45', playerSecret: FIRST_SECRET });
  });

  it('notifies reactive readers', () => {
    const hasSeat = computed(() => store.get('ab23cd45') !== null);
    expect(hasSeat()).toBe(false);

    store.save({ roomId: 'ab23cd45', playerSecret: FIRST_SECRET });

    expect(hasSeat()).toBe(true);
  });
});
