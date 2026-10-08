---
status: accepted
date: 2026-10-07
---

# ADR-0043: Named constants for closed string sets

Every closed set of string values is an `as const` object with a plural name, its keys in `UPPER_SNAKE_CASE` and its values the strings that go on the wire, in logs or in the DOM. The existing union type is derived from it under the same name, `(typeof ROOM_PHASES)[keyof typeof ROOM_PHASES]` for `RoomPhase`, so no signature changes. Code names a value through its object wherever it compares, returns, emits or listens to it: `state.phase === ROOM_PHASES.GAME_OVER`, `reject(ERROR_CODES.ROOM_FULL)`, `socket.on(CLIENT_EVENTS.ECHO, …)`, `typeof ROOM_PHASES.PLACEMENT` in type positions, and the object exposed to Angular templates. TypeScript already rejects a typo against a literal union (TS2367); the objects add one named source per value that every package imports, so a value can be found by reference and renamed in one place. Core exports its sets from `@battleship/core`; sets that belong to one package stay in it. Details in [Development: Code conventions](../development.md#code-conventions) (#84).

## Considered options

- **`enum`:** not erasable syntax: Node's type stripping, which runs the server's `echo` script straight from `.ts`, refuses it without `--experimental-transform-types`. String enum members are also nominal: a value parsed from a payload, or a literal in a test, is not assignable to the enum without a cast.
- **`const enum`:** its point is that `tsc` inlines the values and emits nothing, which needs the whole program. Under `isolatedModules` (set in `tsconfig.base.json`), esbuild (Angular, `tsx`) and type stripping, files are compiled one at a time, so the inlining is lost or the syntax refused. A set with no runtime object would also leave the payload guards nothing to check against.
- **Bare literal unions (the previous code):** type-safe, but each value is written out wherever it is used, a rename means a search across three packages, and nothing tells a reader where a value comes from.
- **Arrays, as `ERROR_CODES` was (`[…] as const` with `(typeof ERROR_CODES)[number]`):** give a runtime list and the union, but elements have no names, so code still writes the literal. `ERROR_CODES` became an object like the others; `Object.values(ERROR_CODES)` is the list, in the order of [Protocol: Error codes](../protocol.md#error-codes).

## Consequences

- The wire is unchanged and `PROTOCOL_VERSION` stays `1`. One test per object pins its values in order, written out on purpose: renaming a key is a refactor, changing a value is a protocol change.
- `CLIENT_EVENTS` and `SERVER_EVENTS` use `satisfies` against `ClientToServerEvents` and `ServerToClientEvents`, so a missing or extra event name, or a value that differs from its event, does not compile.
- Payload guards check membership against `Object.values(…)` rather than keys, so renaming a key never changes what a guard accepts. Code whose output depends on the order of a set (seeded fleet generation) spells the order out instead of relying on key order.
- Not named, on purpose: the `ok` discriminant of acks and results; object keys and property names (`boards.P1`, `SHIP_LENGTH`, the event maps, `BOARD_GRID_TEXT.states`); third-party values (Pino levels, Socket.io and DOM event names, OS signals, keyboard `key` values, transport names); log messages and UI text; the single value of `HealthResponse.status`.
- CSS cannot import: the `data-state` selectors in `board-grid.css` spell the `CELL_STATES` values, which the client test pins.

## Links

- Added on 2026-10-07 from the review of PR #82 ([#84](https://github.com/fabogit/battleship/issues/84)).
- Spec: [Development: Code conventions](../development.md#code-conventions) · [Domain: Domain types](../domain.md#domain-types) · [Protocol](../protocol.md)
- Related: [ADR-0031](0031-payload-guard-strictness.md) (closed protocol contract) · [ADR-0035](0035-command-acks.md) (transport errors kept apart from `ERROR_CODES`)
- Issues: [#84](https://github.com/fabogit/battleship/issues/84)
