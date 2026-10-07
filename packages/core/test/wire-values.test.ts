import { describe, expect, it } from 'vitest';

import {
  CLIENT_EVENTS,
  ERROR_CODES,
  GAME_OVER_REASONS,
  ORIENTATIONS,
  PLACEMENT_VIOLATIONS,
  REMATCH_CHOICES,
  ROOM_PHASES,
  SEATS,
  SERVER_EVENTS,
  SHIP_TYPES,
  SHOT_OUTCOMES,
  TARGET_VIOLATIONS,
  TIMEOUT_ACTIONS,
} from '../src/index.js';

// Each test pins the values of one named set, written out on purpose (ADR-0043): renaming a key is a refactor, while
// changing a value changes the protocol or what the logs show, and needs a new PROTOCOL_VERSION when it is on the wire.
describe('wire values', () => {
  it('SHIP_TYPES', () => {
    expect(Object.values(SHIP_TYPES)).toEqual(['CARRIER', 'BATTLESHIP', 'CRUISER', 'SUBMARINE', 'DESTROYER']);
  });

  it('ORIENTATIONS', () => {
    expect(Object.values(ORIENTATIONS)).toEqual(['HORIZONTAL', 'VERTICAL']);
  });

  it('TIMEOUT_ACTIONS', () => {
    expect(Object.values(TIMEOUT_ACTIONS)).toEqual(['AUTO_RANDOM_SHOT', 'PASS_TURN']);
  });

  it('SHOT_OUTCOMES', () => {
    expect(Object.values(SHOT_OUTCOMES)).toEqual(['MISS', 'HIT', 'SUNK']);
  });

  it('SEATS', () => {
    expect(Object.values(SEATS)).toEqual(['P1', 'P2']);
  });

  it('ROOM_PHASES', () => {
    expect(Object.values(ROOM_PHASES)).toEqual([
      'WAITING_FOR_OPPONENT',
      'RULES_NEGOTIATION',
      'PLACEMENT',
      'IN_PROGRESS',
      'GAME_OVER',
    ]);
  });

  it('GAME_OVER_REASONS', () => {
    expect(Object.values(GAME_OVER_REASONS)).toEqual([
      'FLEET_DESTROYED',
      'SURRENDER',
      'AFK_FORFEIT',
      'DISCONNECT_FORFEIT',
      'ABANDONED',
    ]);
  });

  it('REMATCH_CHOICES', () => {
    expect(Object.values(REMATCH_CHOICES)).toEqual(['SAME_RULES', 'CHANGE_RULES', 'LEAVE']);
  });

  it('PLACEMENT_VIOLATIONS', () => {
    expect(Object.values(PLACEMENT_VIOLATIONS)).toEqual([
      'OUT_OF_BOUNDS',
      'DUPLICATE_TYPE',
      'OVERLAP',
      'ADJACENT_SHIPS',
      'INCOMPLETE_FLEET',
    ]);
  });

  it('TARGET_VIOLATIONS', () => {
    expect(Object.values(TARGET_VIOLATIONS)).toEqual([
      'WRONG_TARGET_COUNT',
      'OUT_OF_BOUNDS',
      'DUPLICATE_TARGET',
      'ALREADY_TARGETED',
    ]);
  });

  it('ERROR_CODES, in the order of docs/protocol.md#error-codes', () => {
    expect(Object.values(ERROR_CODES)).toEqual([
      'PROTOCOL_MISMATCH',
      'INVALID_PAYLOAD',
      'RATE_LIMITED',
      'SERVER_FULL',
      'ROOM_NOT_FOUND',
      'ROOM_FULL',
      'SESSION_INVALID',
      'WRONG_PHASE',
      'NOT_YOUR_TURN',
      'NOT_ALLOWED',
      'INVALID_RULES',
      'STALE_RULES',
      'INVALID_PLACEMENT',
      'PLACEMENT_LOCKED',
      'INVALID_TARGETS',
    ]);
  });

  it('CLIENT_EVENTS', () => {
    expect(Object.values(CLIENT_EVENTS)).toEqual([
      'ECHO',
      'CREATE_ROOM',
      'JOIN_ROOM',
      'UPDATE_RULES',
      'CONFIRM_RULES',
      'UPDATE_PLACEMENT',
      'CONFIRM_PLACEMENT',
      'UNLOCK_PLACEMENT',
      'UPDATE_TARGETS',
      'FIRE',
      'SET_PAUSED',
      'SURRENDER',
      'REMATCH_CHOICE',
      'LEAVE_ROOM',
    ]);
  });

  it('SERVER_EVENTS', () => {
    expect(Object.values(SERVER_EVENTS)).toEqual([
      'STATE',
      'SHOT_RESOLVED',
      'DICE_ROLLED',
      'SESSION_REPLACED',
      'SERVER_SHUTDOWN',
    ]);
  });
});
