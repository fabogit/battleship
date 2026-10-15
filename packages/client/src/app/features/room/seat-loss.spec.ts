import { describe, expect, it } from 'vitest';

import { SEAT_LOSSES, classifySeatLoss } from './seat-loss';

const TAKEN_AT = 1_000_000;

// Written out on purpose (ADR-0043): renaming a key is a refactor, changing a value is not.
describe('SEAT_LOSSES', () => {
  it('pins the values', () => {
    expect(Object.values(SEAT_LOSSES)).toEqual(['restarted', 'closed', 'given-up', 'unknown']);
  });
});

describe('classifySeatLoss (ADR-0076)', () => {
  it('blames a restart when the server started after the seat was taken', () => {
    expect(classifySeatLoss({ hasSeenGameOver: false, seatTakenAt: TAKEN_AT, serverStartedAt: TAKEN_AT + 1 })).toBe(
      SEAT_LOSSES.RESTARTED,
    );
  });

  it('blames the seat when the server has run since before it was taken, the same moment included', () => {
    for (const serverStartedAt of [TAKEN_AT - 60_000, TAKEN_AT]) {
      expect(classifySeatLoss({ hasSeenGameOver: false, seatTakenAt: TAKEN_AT, serverStartedAt })).toBe(
        SEAT_LOSSES.GIVEN_UP,
      );
    }
  });

  it('says the room closed after a match this tab saw end, unless the server restarted since', () => {
    for (const serverStartedAt of [TAKEN_AT - 60_000, null]) {
      expect(classifySeatLoss({ hasSeenGameOver: true, seatTakenAt: TAKEN_AT, serverStartedAt })).toBe(
        SEAT_LOSSES.CLOSED,
      );
    }
    expect(classifySeatLoss({ hasSeenGameOver: true, seatTakenAt: TAKEN_AT, serverStartedAt: TAKEN_AT + 1 })).toBe(
      SEAT_LOSSES.RESTARTED,
    );
  });

  it('cannot tell without both times', () => {
    expect(classifySeatLoss({ hasSeenGameOver: false, seatTakenAt: null, serverStartedAt: TAKEN_AT })).toBe(
      SEAT_LOSSES.UNKNOWN,
    );
    expect(classifySeatLoss({ hasSeenGameOver: false, seatTakenAt: TAKEN_AT, serverStartedAt: null })).toBe(
      SEAT_LOSSES.UNKNOWN,
    );
  });
});
