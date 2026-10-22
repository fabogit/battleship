import { createSeededRng, generateRoomId } from '@battleship/core';

// The server's own generator, so that no literal UUID sits in a spec: secret scanners flag them.
export { createPlayerSecret } from '@battleship/core';

/**
 * Draws a room id with core's `generateRoomId`, as the server does, seeded as in the server's tests, so a spec gets the
 * same id on every run and a different one for every seed.
 * @param seed Picks the id; specs use 0 for their room and 1, 2… for the others.
 * @returns A well-formed id, accepted by core's `isRoomId`.
 */
export function createRoomId(seed: number): string {
  return generateRoomId(createSeededRng(seed));
}
