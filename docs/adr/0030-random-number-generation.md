---
status: accepted
date: 2026-10-07
---

# ADR-0030: Random number generation

Every random choice (placement, dice, auto shots) goes through an injected `Rng` from `packages/core/src/random.ts`. Tests use `createSeededRng(seed)`, an sfc32 generator seeded with an unsigned 32-bit integer; production uses `createCryptoRng()`, which reads `globalThis.crypto.getRandomValues`, the one strong source that browsers and Node share, so core keeps zero runtime dependencies. Both draw 32-bit words and share one sampling layer: `nextInt` uses rejection sampling, so no result is favoured, `pick` builds on it, and `shuffle` returns a new array (Fisher–Yates) because inputs are `readonly`. Details in [Randomness](../domain.md#randomness) (#10).

## Considered options

- **mulberry32:** a single 32-bit state word, so its period is only 2^32 and roughly a third of the 32-bit values can never come out. Rejection sampling over whole words would inherit those gaps.
- **xoshiro128\*\*:** as good as sfc32, but it needs a second generator (splitmix32) to fill its state from a seed, and its jump functions are of no use here. sfc32 seeds itself by discarding 12 outputs.
- **String seeds hashed to a state:** no use case; tests pick numbers, and nothing replays a game from a room id.
- **Coercing any number to a seed (`seed >>> 0`):** `1.5` and `1`, or `-1` and `2^32 - 1`, would silently give the same sequence. Invalid seeds throw instead.
- **`Math.floor(random * maxExclusive)`, or `word % maxExclusive` without rejection:** both favour some results whenever `maxExclusive` does not divide the source's range.
- **`Math.random()` in production:** its quality depends on the engine, and Web Crypto is available everywhere core runs.
- **`node:crypto` (`randomInt`):** Node only; the client runs the same placement code in the browser.
- **Adding the `DOM` lib or `@types/node` to core:** either would let core call platform APIs other than the one it needs. A local structural type for `getRandomValues` is enough.
- **Shuffling in place:** contradicts the `readonly` arrays the domain passes around.

## Consequences

- Seeded test expectations depend on the exact algorithm and seeding. Changing either breaks them, which is why a test pins the first outputs of two seeds.
- The seeded generator runs the same `nextInt`/`pick`/`shuffle` code as production, so tests cover the sampling the game really uses.
- `nextInt` accepts at most 2^32, the range of one word. Game draws are far smaller (≤ 100 cells).
- Under the core tsconfig used by typechecking, Vitest pulls in Node's types, so `globalThis.crypto` is typed as always present there. The code reads it through its own type, so the code compiles the same way with Node types, DOM types or neither.

## Links

- Added on 2026-10-07 for the seedable `Rng` ([#10](https://github.com/fabogit/battleship/issues/10)).
- Spec: [Domain: Randomness](../domain.md#randomness) · [Domain: Placement](../domain.md#placement) · [Server: Testability](../server.md#testability)
- Issues: [#10](https://github.com/fabogit/battleship/issues/10)
