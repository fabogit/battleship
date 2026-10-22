// Room ids and player secrets (docs/server.md#sessions--reconnection): the server issues them, client specs draw them
// so that no literal id or UUID sits in a test.

import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from './constants.js';
import type { Rng } from './random.js';

/**
 * The one Web Crypto method a player secret needs. Core compiles without DOM or Node types, so it declares the shape
 * it relies on instead of a global, as `random.ts` does (ADR-0030).
 */
interface RandomUuidSource {
  /**
   * Generates a version 4 UUID from a cryptographically strong source. Browsers expose it only in secure contexts
   * (https, or http to localhost).
   * @returns A lowercase UUID.
   */
  randomUUID?(): string;
}

/**
 * Draws a room id: `ROOM_ID_LENGTH` characters of `ROOM_ID_ALPHABET`, each picked uniformly. It may collide with an
 * open room; the server's `RoomManager` draws again when it does (ADR-0039).
 * @param rng Source of the characters: `createCryptoRng()` on the server, `createSeededRng` in tests.
 * @returns A well-formed id, accepted by `isRoomId` and so by the `JOIN_ROOM` guard.
 */
export function generateRoomId(rng: Rng): string {
  return Array.from({ length: ROOM_ID_LENGTH }, () =>
    ROOM_ID_ALPHABET.charAt(rng.nextInt(ROOM_ID_ALPHABET.length)),
  ).join('');
}

/**
 * Generates a player secret: a lowercase `globalThis.crypto.randomUUID()`, which `parseSessionCredentials` accepts.
 * Node always has it; browsers only in secure contexts, which is why the client never calls it outside its specs.
 * @returns A new secret, never sent to the other player.
 * @throws When the platform has no `globalThis.crypto.randomUUID`.
 */
export function createPlayerSecret(): string {
  // Not `typeof globalThis & …`, for the same reason as in `createCryptoRng`: the check must compile where Node or DOM
  // types declare `crypto` as always present.
  const { crypto } = globalThis as { readonly crypto?: RandomUuidSource };
  if (crypto?.randomUUID === undefined) {
    throw new Error('globalThis.crypto.randomUUID is not available');
  }
  return crypto.randomUUID();
}
