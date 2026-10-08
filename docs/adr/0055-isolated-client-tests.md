---
status: accepted
date: 2026-10-08
---

# ADR-0055: Isolated client test files

`ng test` runs every client spec file in a fresh module registry (`"isolate": true` in the `test` options of `angular.json`), against the builder's default of `false`. Without isolation, spec files that share a Vitest worker share their imported modules. `game-socket.spec.ts` mocks `socket.io-client` with `vi.mock`, and the mock is ignored whenever another spec in the same worker imported `GameSocketService` first. Which files share a worker depends on the number of cores, so the suite passed on a 16-core laptop and failed 12 tests on the CI runner once #19 added three spec files. With one worker it already failed on `main`. Details in [Development: Local tooling](../development.md#local-tooling) (#19).

## Considered options

- **Keeping the default and making `game-socket.spec.ts` reset its modules (`vi.resetModules()` and a dynamic import):** fixes that file only; the next spec that mocks a module would fail the same way, depending on the runner.
- **Disabling code splitting (`"splitting": false`):** the builder suggests it for mocking failures caused by shared chunks, but the mocked module here is an external package, and files sharing a worker would still share their imports.

## Consequences

- The client suite takes a few seconds longer (about 14 s for `ng test` locally, build included).
- A spec may mock a module with `vi.mock` without depending on which other files run in its worker.

## Links

- Added on 2026-10-08 while fixing CI for the placement view ([#19](https://github.com/fabogit/battleship/issues/19)).
- Spec: [Development: Local tooling](../development.md#local-tooling)
- Related: [ADR-0035](0035-command-acks.md) (the socket service whose spec mocks `socket.io-client`)
- Issues: [#19](https://github.com/fabogit/battleship/issues/19)
