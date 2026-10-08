# Deployment

## Hosting facts (Render Free)

Verified against Render documentation, then measured on the deployed service (#8, 2026-10-05):

- The service spins down after **15 minutes without inbound traffic**; inbound WebSocket messages count, so Socket.io heartbeats keep the server awake while any client is connected. _Measured:_ Render's own health checks on `/health` do not count (an instance woken by outside traffic stopped exactly 15 minutes later), while one connected tab with no other HTTP traffic kept the instance up for 20 minutes.
- Spin-up was documented as **about one minute**, with Render serving its own HTML loading page (no CORS headers). _Measured:_ about **24 s** from opening the client to a connected socket (two samples); the Node process starts 10–13 s after the first request. Render held the client's `fetch` requests open until the instance was ready instead of answering with the loading page ([Cold-start handling](client.md#cold-start-handling)). _Re-measured after the wake-up fix (#51, 2026-10-05):_ 23.2 s to a connected socket, through a single `/health` request answered after 22.8 s; Node started about 14 s after the page opened.
- The public URL receives crawler traffic (`GET /`, `/robots.txt`, `POST /`) that wakes the instance now and then. Harmless: it only spends free instance hours.
- Render **may restart a free service at any time**, and every deploy restarts it. **All in-flight matches are lost on restart. This is an accepted risk.** _Measured on a deploy:_ the old instance gets `SIGTERM` about 1 s before traffic switches to the new one; its open WebSockets receive no further frames and close about 10 s later, and Socket.io reconnects to the new instance within 2 s ([Backend (Render)](#backend-render)).
- Single instance only: no sticky sessions or Socket.io adapter needed.
- If no client is connected, the service will spin down after 15 minutes and lose every room, so in-memory TTLs longer than that are meaningless for empty rooms.

## Backend (Render)

- **Root directory:** repository root (`packages/server` depends on `packages/core` via workspace link).
- **Build command:**
  ```bash
  pnpm --version && pnpm install --frozen-lockfile --filter @battleship/server... && pnpm --filter @battleship/server... build
  ```
  (`...` selects the package plus its workspace dependencies, so the server build never installs Angular: the log shows `Scope: 2 of 4 workspace projects`.) Render's image ships `pnpm` and honours `packageManager` (the log prints `11.21.0`); `corepack enable` fails there because `/usr/bin` is read-only. Node comes from `.nvmrc`.
- **Start command:** `node packages/server/dist/index.js`
- **Service settings:** region Frankfurt; health check path `/health` (its request logs are silenced below `warn` unless `LOG_LEVEL` is `debug` or `trace`, since Render polls it every few seconds); auto-deploy from `main`; build filters limited to `packages/server/**`, `packages/core/**` and the root workspace files, so client-only commits do not restart the server and drop live matches.
- **Environment:** `PORT` (provided by Render; decimal 1–65535, default 3000), `ALLOWED_ORIGINS` (required, comma-separated; Cloudflare Pages production origin plus a `https://*.<project>.pages.dev` wildcard for previews, [D24](adr/0024-preview-origins.md)), `LOG_FORMAT` (optional: `json`, the default and the one to keep on Render, or `pretty` for local runs), `LOG_LEVEL` (optional Pino level, default `info`; set `debug` temporarily to see every socket event, [Logging](server.md#logging)). Missing or malformed values fail the startup: Render's health check sends no `Origin`, so a lost `ALLOWED_ORIGINS` would otherwise deploy as healthy while every browser gets 403. The error points to `packages/server/.env.example` for local runs.
- **`GET /health`** → `200 { status: "ok", uptime: number }` (`HealthResponse` in `core/protocol.ts`).
- **CORS:** configured twice — `@fastify/cors` for HTTP routes and the `cors` option of the Socket.io server. Both apply the same origin matcher to `ALLOWED_ORIGINS`, so the policy does not depend on hook order. A foreign `Origin` is rejected outright: `403` on HTTP (an `onRequest` hook, before any route) and a refused Socket.io handshake (`allowRequest`), since CORS headers alone do not stop WebSocket upgrades ([D21](adr/0021-origin-policy.md)).
- **Graceful shutdown:** on `SIGTERM` the server emits `SERVER_SHUTDOWN` to every socket before closing, so clients can say "the server restarted, the match was lost" instead of looping on reconnect. `SIGINT` (Ctrl+C) does the same locally; repeated signals are ignored and a 10 s deadline exits with code 1 ([D27](adr/0027-shutdown-signals.md)). It waits (up to 3 s) for each connection to flush and close first: a long-polling client only receives the message on its next poll ([D23](adr/0023-socket-io-integration.md)). _Measured on a Render deploy (#8):_ `SERVER_SHUTDOWN` never reached the connected client: the socket closed silently about 10 s after `SIGTERM`, and Socket.io reconnected to the new instance on its own, which knows nothing of the old rooms. `SERVER_SHUTDOWN` is therefore best effort (it works on local shutdowns and in tests); the client must recognize a restart after reconnecting, when its session turns out to be unknown (`SESSION_INVALID`, [Sessions & reconnection](server.md#sessions--reconnection); #22, #25). Conversely, when the message does arrive, the server-side disconnect (`io server disconnect`) stops Socket.io's automatic reconnection, so the client must reconnect itself.

## Frontend (Cloudflare Pages)

- **Root directory:** repository root.
- **Build command:**
  ```bash
  corepack pnpm --version && corepack pnpm install --frozen-lockfile --filter @battleship/client... && corepack pnpm --filter @battleship/client... build
  ```
  The Pages image ships its own pnpm, which does not switch to `packageManager`; `corepack pnpm` runs exactly `11.21.0` without writing any shims.
- **Output directory:** `packages/client/dist/client/browser`
- **Environment:** `NODE_VERSION=24.21.0` (exact: the image resolves `24` to 24.13.1, below Angular 22's `^24.15.0`; the root `engines` field states the same floor), `SKIP_DEPENDENCY_INSTALL=1` (otherwise Pages runs its own unfiltered install before the build command), `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`. Framework preset: none. Project `battleship-ac7` → `https://battleship-ac7.pages.dev`; Render's `ALLOWED_ORIGINS` lists it plus `https://*.battleship-ac7.pages.dev` for previews ([D24](adr/0024-preview-origins.md)). The server URL is fixed at build time by Angular environment files ([D25](adr/0025-client-server-url.md)), so Pages needs no other variable for now (switch to a `SERVER_URL` variable: #48).
- **SPA routing:** Pages serves `index.html` for unknown paths when no `404.html` exists, so `/r/<roomId>` deep links work.
- **Transport:** the client connects to an `https://` server URL, i.e. `wss://` (Pages is HTTPS; `ws://` is blocked as mixed content). Socket.io tries WebSocket first and falls back to HTTPS long-polling on networks that block upgrades. The fallback needs `tryAllTransports: true`: without it engine.io-client 6.6 keeps retrying WebSocket (#51).
