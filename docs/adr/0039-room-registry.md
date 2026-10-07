---
status: accepted
date: 2026-10-07
---

# ADR-0039: Room registry

`RoomManager` (`packages/server/src/room/room-manager.ts`) is the only stateful part of room logic: an in-memory `Map` from room id to `RoomState`, which runs `applyCommand` and stores the state an accepted command returns. It owns the randomness the pure functions do not take: room ids from an injected `Rng` (`createCryptoRng()` by default, a seeded one in tests, [ADR-0030](0030-random-number-generation.md)) and player secrets from an injected function (`crypto.randomUUID` by default). A room id is `ROOM_ID_LENGTH` characters drawn one by one with `Rng.nextInt` from `ROOM_ID_ALPHABET`; when it matches an open room, the manager draws again until it does not. `CREATE_ROOM` with `MAX_ROOMS` rooms open is refused with `SERVER_FULL` before any id is drawn. Details in [Server: Room logic](../server.md#room-logic) (#14).

## Considered options

* **Ids from `crypto.randomUUID()` or `randomBytes`, outside the `Rng`:** a second random source to fake in tests; the `Rng` already wraps `crypto` and draws without modulo bias.
* **A cap on redraws, failing after N collisions:** 31⁸ ≈ 8.5 · 10¹¹ ids against at most 50 open rooms makes a collision about one in 17 billion draws; a cap would add an error path no one can reach. The loop ends with probability 1 and a seeded test covers the redraw.
* **Accepting collisions** (no check): rare, but it would seat a stranger in someone else's room.
* **Longer ids instead of a check:** the length is fixed by the share link and the guard; the check is one `Map` lookup.
* **A factory returning an object of closures**, like `createOriginMatcher`: the registry has several methods over one private map, which a class with `#` fields states more plainly.

## Consequences

* Rooms are never removed yet: TTL sweeps arrive with #24. Until then a server holds at most `MAX_ROOMS` rooms over its lifetime and answers `SERVER_FULL` after that; Render's idle spin-down restarts it with an empty registry ([Spin-down](../deployment.md#hosting-facts-render-free)).
* `ROOM_NOT_FOUND` comes from the registry, `ROOM_FULL` from `applyCommand`.

## Links

* Added on 2026-10-07 for the room logic ([#14](https://github.com/fabogit/battleship/issues/14)).
* Spec: [Server: Sessions & reconnection](../server.md#sessions--reconnection) · [Server: Hardening](../server.md#hardening) · [Domain: Constants](../domain.md#constants)
* Related: [ADR-0030](0030-random-number-generation.md) (random number generation) · [ADR-0037](0037-room-transition-shape.md) (room transition shape)
* Issues: [#14](https://github.com/fabogit/battleship/issues/14) · [#24](https://github.com/fabogit/battleship/issues/24) (TTL sweeps)
