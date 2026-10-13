import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH, createSeededRng } from '@battleship/core';

/**
 * Draws a room id the way the server's `generateRoomId` does: `ROOM_ID_LENGTH` characters of `ROOM_ID_ALPHABET`, each
 * picked by an `Rng`. Seeded, as in the server's tests, so a spec gets the same id on every run and a different one for
 * every seed.
 * @param seed Picks the id; specs use 0 for their room and 1, 2… for the others.
 * @returns A well-formed id, accepted by core's `isRoomId`.
 */
export function createRoomId(seed: number): string {
  const rng = createSeededRng(seed);
  return Array.from({ length: ROOM_ID_LENGTH }, () =>
    ROOM_ID_ALPHABET.charAt(rng.nextInt(ROOM_ID_ALPHABET.length)),
  ).join('');
}

/**
 * Generates a player secret the way the server's `createPlayerSecret` does, a lowercase `crypto.randomUUID()`: a
 * literal UUID in a spec trips secret scanners.
 * @returns A new secret, accepted by core's `parseSessionCredentials`.
 */
export function createPlayerSecret(): string {
  return crypto.randomUUID();
}
