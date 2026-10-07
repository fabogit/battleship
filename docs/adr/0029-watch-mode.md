---
status: accepted
date: 2026-10-07
---

# ADR-0029: Watch mode

`pnpm dev` starts server and client in watch mode. The server's `dev` script runs `src/` through `tsx watch` with the `@battleship/source` condition (ADR-0022) and the server's `.env`, and restarts on any change to server or core files; the client's `dev` is `ng serve`. `start` and the production builds still run `dist/`. Details in [Local tooling](../development.md#local-tooling) (#74).

## Considered options

* **Node's own `--watch` with type stripping:** no extra dependency, but Node does not map the `./config.js` specifiers of the TypeScript sources to `.ts` files. Switching every import to `.ts` with `rewriteRelativeImportExtensions` would touch the whole codebase for a local convenience.
* **`tsc --watch` for core and server, plus `node --watch dist/index.js`:** keeps running exactly what production runs, but needs two compilers and a process runner, and a restart waits for both compilations.
* **`nodemon`:** only restarts a command, so it would still need one of the two options above to run TypeScript.

## Consequences

* Restarts after a change are clean: `tsx` sends one `SIGTERM` and waits for the graceful shutdown (ADR-0027).
* Ctrl+C on a `pnpm` script delivers `SIGINT` twice to `tsx`, once from the terminal and once forwarded by `pnpm`, and `tsx` answers the second with `SIGKILL`. The server starts its shutdown and is then killed. Locally nothing is lost but the `SERVER_SHUTDOWN` message.
* `ng serve` also honours a `PORT` environment variable, so the server's port belongs in its `.env`, not in the shell that runs `pnpm dev`.

## Links

* Added on 2026-10-07 for local watch mode ([#74](https://github.com/fabogit/battleship/issues/74)).
* Spec: [Development: Local tooling](../development.md#local-tooling) · [Development: Resolving `@battleship/core`](../development.md#resolving-battleshipcore)
* Issues: [#74](https://github.com/fabogit/battleship/issues/74)
