import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPlayerSecret,
  createSeededRng,
  generateRoomId,
  PAYLOAD_PARSERS,
  parseSessionCredentials,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
} from '../src/index.js';

describe('generateRoomId', () => {
  it('draws ROOM_ID_LENGTH characters of ROOM_ID_ALPHABET, which the JOIN_ROOM guard accepts', () => {
    const rng = createSeededRng(7);
    for (let attempt = 0; attempt < 100; attempt++) {
      const roomId = generateRoomId(rng);
      expect(roomId).toMatch(new RegExp(`^[${ROOM_ID_ALPHABET}]{${String(ROOM_ID_LENGTH)}}$`));
      expect(PAYLOAD_PARSERS.JOIN_ROOM({ roomId, nickname: 'Bob' })).not.toBeNull();
    }
  });

  it('is repeatable with a fixed seed', () => {
    expect(generateRoomId(createSeededRng(7))).toBe(generateRoomId(createSeededRng(7)));
  });
});

describe('createPlayerSecret', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('generates a new secret on every call, which parseSessionCredentials accepts', () => {
    const roomId = generateRoomId(createSeededRng(0));
    const secrets = Array.from({ length: 100 }, () => createPlayerSecret());
    expect(new Set(secrets).size).toBe(secrets.length);
    for (const playerSecret of secrets) {
      expect(parseSessionCredentials({ roomId, playerSecret })).toEqual({ roomId, playerSecret });
    }
  });

  it('throws when the platform has no crypto.randomUUID, as in a browser outside a secure context', () => {
    vi.stubGlobal('crypto', {});
    expect(() => createPlayerSecret()).toThrow(/globalThis\.crypto\.randomUUID/);
    vi.stubGlobal('crypto', undefined);
    expect(() => createPlayerSecret()).toThrow(/globalThis\.crypto\.randomUUID/);
  });
});
