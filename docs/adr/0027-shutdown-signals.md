---
status: accepted
date: 2026-10-05
---

# ADR-0027: Shutdown signals

`SIGTERM`/`SIGINT` are handled in `shutdown.ts` with persistent listeners: the first signal starts `app.close()`, repeats are ignored (pnpm and npm forward Ctrl+C, so the process gets SIGINT twice). A 10 s deadline exits with code 1 if the close fails or hangs, below Render's SIGKILL at 30 s. No `close-with-grace` (#59).

## Considered options

* **Shutdown signals — `close-with-grace` vs. hand-written handler:** `close-with-grace` is the usual choice with Fastify (fastify-cli uses it), but on a second signal during shutdown it always calls `process.exit(1)`. Under `pnpm start` the terminal and pnpm each deliver Ctrl+C, so the process died before `SERVER_SHUTDOWN` was sent (verified with v2.5.0). Its other features (graceful close on `uncaughtException`/`unhandledRejection`, eleven signals, `beforeExit`) add nothing here: state is in memory, so a crash exits with Node's default code 1 and Render restarts the service. The hand-written handler is about fifteen lines (D27).

## Links

* Added on 2026-10-05 after duplicate shutdown signals under pnpm ([#59](https://github.com/fabogit/battleship/issues/59)).
* Spec: [Development: Monorepo topology](../development.md#monorepo-topology) · [Deployment: Backend (Render)](../deployment.md#backend-render)
* Issues: [#59](https://github.com/fabogit/battleship/issues/59)
