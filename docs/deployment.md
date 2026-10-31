# Deployment

## Hosting facts (Render Free)

Verified against Render documentation, then measured on the deployed service (#8, 2026-10-05):

- The service spins down after **15 minutes without inbound traffic**; inbound WebSocket messages count, so Socket.io heartbeats keep the server awake while any client is connected. _Measured:_ Render's own health checks on `/health` do not count (an instance woken by outside traffic stopped exactly 15 minutes later), while one connected tab with no other HTTP traffic kept the instance up for 20 minutes.
- Spin-up was documented as **about one minute**, with Render serving its own HTML loading page (no CORS headers). _Measured:_ about **24 s** from opening the client to a connected socket (two samples); the Node process starts 10–13 s after the first request. Render held the client's `fetch` requests open until the instance was ready instead of answering with the loading page ([Cold-start handling](client.md#cold-start-handling)). _Re-measured after the wake-up fix (#51, 2026-10-05):_ 23.2 s to a connected socket, through a single `/health` request answered after 22.8 s; Node started about 14 s after the page opened.
- The public URL receives crawler traffic (`GET /`, `/robots.txt`, `POST /`) that wakes the instance now and then. Harmless: it only spends free instance hours.
- Render **may restart a free service at any time**, and every deploy restarts it. **All in-flight matches are lost on restart. This is an accepted risk.** _Measured on a deploy:_ the old instance gets `SIGTERM` about 1 s before traffic switches to the new one; its open WebSockets receive no further frames and close about 10 s later, and Socket.io reconnects to the new instance within 2 s ([Backend (Render)](#backend-render)).
- Single instance only: no sticky sessions or Socket.io adapter needed.
- **A dropped connection reaches the server late.** Data frames cross Render's edge in about 50 ms, but a connection's teardown reaches the instance only 10 s (a WebSocket close frame) or 20 s (a TCP FIN without one) later, both deterministic. A silent loss, with no frame and no FIN, is caught only by the Engine.IO heartbeat ([Server: Sessions & reconnection](server.md#sessions--reconnection)). The server reacts at once to whatever reaches it, so these are the times until the opponent sees "Grace is disconnected.". _Measured (#53, F17, 2026-10-21, 21:00–22:07 UTC):_ from the drop to the other player's `STATE` with the opponent away:

  | How the player drops                                                                          | Local  | Production    |
  | --------------------------------------------------------------------------------------------- | ------ | ------------- |
  | Socket.io disconnect packet, then close (`socket.disconnect()`)                               | 4 ms   | 47–62 ms      |
  | WebSocket close frame: tab closed, or Chromium going offline (`setOffline` closes the socket) | ~0.1 s | 10.05–10.07 s |
  | Browser process killed                                                                        | —      | 10.18 s       |
  | TCP FIN without a close frame (Node client)                                                   | 2 ms   | 20.06 s       |
  | Silent loss: no frame and no FIN (a paused socket)                                            | 43.4 s | 43.4 s        |

  The disconnect forfeit counts from when the server noticed, so it fires up to about 45 s later than `DISCONNECT_FORFEIT_MS` after the real drop. Tuning (a client `socket.disconnect()` on `pagehide`, a shorter heartbeat) waits for the device playtest (#38): today a reload rebinds in under a second, before the old socket's close arrives, so the opponent sees nothing of it.

- If no client is connected, the service spins down after 15 minutes and loses every room. A room nobody sits in closes sooner anyway: its forfeits and the game-over TTL remove it within `DISCONNECT_FORFEIT_MS + GAME_OVER_TTL_MS` (5 minutes, [Server: Room lifecycle](server.md#room-lifecycle)).

## Environment variables

Everything each host needs, in one place. A value set in a dashboard applies to the next build or deploy only: Render redeploys to pick up a change, Cloudflare Pages uses it from the next build (retry the latest deployment to apply it at once).

### Render (service `battleship-server`)

Set in the service's **Environment** page. Locally the same variables come from `packages/server/.env` (copy of `packages/server/.env.example`).

| Variable           | Value on Render                                                       | Required | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`             | provided by Render, do not set                                        | —        | Port to listen on: decimal 1–65535, default 3000.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ALLOWED_ORIGINS`  | `https://battleship-ac7.pages.dev,https://*.battleship-ac7.pages.dev` | yes      | Browser origins allowed over HTTP and Socket.io, comma-separated: the Pages production origin plus a wildcard for previews ([D24](adr/0024-preview-origins.md)). Missing or malformed fails the startup: Render's health check sends no `Origin`, so a lost value would otherwise deploy as healthy while every browser gets 403.                                                                                                                                                                                   |
| `LOG_FORMAT`       | unset (`json`)                                                        | no       | `json` (default, the one for Render) or `pretty` for local runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `LOG_LEVEL`        | unset (`info`)                                                        | no       | Pino level; set `debug` temporarily to see every socket event ([Logging](server.md#logging)).                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `TRUST_PROXY_HOPS` | `1` (calibrated on 2026-10-22, see below)                             | no       | Proxies in front of the server that append to `X-Forwarded-For`, 0–5: the logged client address is read that many entries from the right ([ADR-0067](adr/0067-client-address.md)). `0` logs the TCP peer, which on Render is always the proxy. Set, the logs hold each client's public IP address (personal data). On Render, `1` fits WebSocket handshakes, the transport browsers use; HTTP request lines and polling handshakes log Render's internal address ([ADR-0081](adr/0081-one-proxy-hop-on-render.md)). |

Node comes from `.nvmrc`; Render needs no variable for it.

**Calibrating `TRUST_PROXY_HOPS`** ([ADR-0081](adr/0081-one-proxy-hop-on-render.md)): Render does not document how many entries its proxies append, and it keeps whatever `X-Forwarded-For` the client sent, so the leftmost entry cannot be trusted. What it appends depends on the transport. Calibrated on 2026-10-22 (UTC) from a known address, written `<client>` below, with `TRUST_PROXY_HOPS=1` and `LOG_LEVEL=debug`:

| Request                                                                           | `X-Forwarded-For` sent | `forwardedFor` ("Socket address chain") | Logged address with `1`                 |
| --------------------------------------------------------------------------------- | ---------------------- | --------------------------------------- | --------------------------------------- |
| Browser, WebSocket handshake (the client tries `websocket` first)                 | none                   | `<client>`                              | `<client>`                              |
| Node client, WebSocket only                                                       | `198.51.100.7`         | `198.51.100.7,<client>`                 | `<client>`                              |
| Node client, polling                                                              | none                   | `<client>, 172.70.x.x, 10.30.x.x`       | `10.30.x.x`, Render's internal balancer |
| `curl -H 'X-Forwarded-For: 198.51.100.1' <server>/missing` (Fastify request line) | `198.51.100.1`         | —                                       | `req.remoteAddress` `10.30.x.x`         |

- A WebSocket handshake gets one entry, the client's address. Plain HTTP, polling and `/health` included, gets three: the client's address, a Cloudflare address (`172.70.x`) and Render's internal load balancer (`10.30.x`). The TCP peer (`peerAddress`) is always `127.0.0.1`.
- No single count fits both paths. `1` is right for WebSocket and cannot be spoofed; `3` would be right for HTTP but would log a WebSocket client's own leftmost entry, a spoofed one in the second row. Browsers use WebSocket, so the value is `1`, and HTTP request lines log `10.30.x`.
- **To calibrate again:** set `LOG_LEVEL=debug`, redeploy, open the client in a browser from a network whose public address you know, and read the "Socket address chain" of its WebSocket handshake (the "Socket connected" line next to it says `transport: websocket`). Count from the right of `forwardedFor`, starting at 1, to your own address; that position is the hop count. A polling or `curl` request shows the HTTP path, not the one browsers use.
- **To check spoofing:** connect a WebSocket-only Socket.io client that sends a made-up header, e.g. `io(<server>, { transports: ['websocket'], extraHeaders: { 'x-forwarded-for': '198.51.100.7' }, query: { protocolVersion: '<n>' } })` from Node, and check that "Socket connected" still logs your address. `curl` only exercises the HTTP path, and `pnpm --filter @battleship/server echo` sends no `X-Forwarded-For`.
- Then put `LOG_LEVEL` back (unset, `info`) and redeploy.

### Cloudflare Pages

Set in **Settings → Variables and Secrets**, as plain text, in **both** the Production and the Preview environment: a variable set in one only is missing from the other's builds.

| Variable                          | Value                                         | Why                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_VERSION`                    | `24.21.0`                                     | Exact: the image resolves `24` to 24.13.1, below Angular 22's `^24.15.0` (the root `engines` field states the same floor).                                                                                                                                                                                                                     |
| `SKIP_DEPENDENCY_INSTALL`         | `1`                                           | Otherwise Pages runs its own unfiltered install before the build command.                                                                                                                                                                                                                                                                      |
| `COREPACK_ENABLE_DOWNLOAD_PROMPT` | `0`                                           | `corepack pnpm` downloads pnpm `11.21.0` without waiting for a confirmation.                                                                                                                                                                                                                                                                   |
| `SERVER_URL`                      | `https://battleship-server-jumc.onrender.com` | Server URL baked into the bundle ([ADR-0052](adr/0052-server-url-build-variable.md)). The build stops when it is missing or not `https://` (`http://` is accepted only for `localhost`, for local builds). Both environments point at the one Render server today; a preview could target a staging server by changing only its Preview value. |

### GitHub Actions (`ci` and `e2e` jobs)

`SERVER_URL` is set in the job's `env` in `.github/workflows/ci.yml` (the Render URL; not a secret), so `pnpm build` there behaves like Pages. Nothing is set in the repository settings. The `e2e` job sets nothing: its client bundle is built against the local e2e server, whose URL `packages/e2e/src/client.ts` passes as `SERVER_URL` itself ([Development: End-to-end journeys](development.md#end-to-end-journeys)).

### Local

`packages/server/.env` and `packages/client/.env`, copies of the `.env.example` next to them, both gitignored ([Development: Local tooling](development.md#local-tooling)). The client's sets `SERVER_URL=http://localhost:3000`, the local server, for `ng serve` and local builds alike; nothing in the code falls back to it.

## Backend (Render)

- **Root directory:** repository root (`packages/server` depends on `packages/core` via workspace link).
- **Build command:**
  ```bash
  pnpm --version && pnpm install --frozen-lockfile --filter @battleship/server... && pnpm --filter @battleship/server... build
  ```
  (`...` selects the package plus its workspace dependencies, so the server build never installs Angular: the log shows `Scope: 2 of 4 workspace projects`.) Render's image ships `pnpm` and honours `packageManager` (the log prints `11.21.0`); `corepack enable` fails there because `/usr/bin` is read-only. Node comes from `.nvmrc`.
- **Start command:** `node packages/server/dist/index.js`
- **Service settings:** region Frankfurt; health check path `/health` (its request logs are silenced below `warn` unless `LOG_LEVEL` is `debug` or `trace`, since Render polls it every few seconds); auto-deploy from `main`; build filters limited to `packages/server/**`, `packages/core/**` and the root workspace files, so client-only commits do not restart the server and drop live matches.
- **Environment:** see [Environment variables › Render](#render-service-battleship-server). A missing or malformed value fails the startup, with an error that points to `packages/server/.env.example` for local runs.
- **`GET /health`** → `200 { status: "ok", uptime: number }` (`HealthResponse` in `core/protocol.ts`).
- **CORS:** configured twice — `@fastify/cors` for HTTP routes and the `cors` option of the Socket.io server. Both apply the same origin matcher to `ALLOWED_ORIGINS`, so the policy does not depend on hook order. A foreign `Origin` is rejected outright: `403` on HTTP (an `onRequest` hook, before any route) and a refused Socket.io handshake (`allowRequest`), since CORS headers alone do not stop WebSocket upgrades ([D21](adr/0021-origin-policy.md)).
- **Graceful shutdown:** on `SIGTERM` the server emits `SERVER_SHUTDOWN` to every socket before closing, so clients can say "the server restarted, the match was lost" instead of looping on reconnect. `SIGINT` (Ctrl+C) does the same locally; repeated signals are ignored and a 10 s deadline exits with code 1 ([D27](adr/0027-shutdown-signals.md)). It waits (up to 3 s) for each connection to flush and close first: a long-polling client only receives the message on its next poll ([D23](adr/0023-socket-io-integration.md)). _Measured on a Render deploy (#8):_ `SERVER_SHUTDOWN` never reached the connected client: the socket closed silently about 10 s after `SIGTERM`, and Socket.io reconnected to the new instance on its own, which knows nothing of the old rooms. `SERVER_SHUTDOWN` is therefore best effort (it works on local shutdowns and in tests); the client must recognize a restart after reconnecting, when its session turns out to be unknown (`SESSION_INVALID`, [Sessions & reconnection](server.md#sessions--reconnection); #22, #25). Conversely, when the message does arrive, the server-side disconnect (`io server disconnect`) stops Socket.io's automatic reconnection, so the client reconnects itself: it shows "The server is restarting…", polls `/health` again and connects to the next instance ([Client: Connection states](client.md#connection-states), [ADR-0075](adr/0075-client-connection-states.md)). Either way the room page then says that the server restarted ([ADR-0076](adr/0076-refused-seat-explanation.md)).

## Frontend (Cloudflare Pages)

- **Root directory:** repository root.
- **Build command:**
  ```bash
  corepack pnpm --version && corepack pnpm install --frozen-lockfile --filter @battleship/client... && corepack pnpm --filter @battleship/client... build
  ```
  The Pages image ships its own pnpm, which does not switch to `packageManager`; `corepack pnpm` runs exactly `11.21.0` without writing any shims.
- **Output directory:** `packages/client/dist/client/browser`
- **Environment:** see [Environment variables › Cloudflare Pages](#cloudflare-pages), in both the Production and the Preview environment. Framework preset: none. Project `battleship-ac7` → `https://battleship-ac7.pages.dev`; Render's `ALLOWED_ORIGINS` lists it plus `https://*.battleship-ac7.pages.dev` for previews ([D24](adr/0024-preview-origins.md)).
- **Server URL:** `pnpm --filter @battleship/client build` (and `dev`/`start`, for `ng serve`) runs `scripts/ng.ts`, which reads `SERVER_URL` and passes it to `ng build --define` (or `ng serve --define`); it stops when the value is missing, not a URL, or neither `https://` nor `http://` to `localhost`, naming what to set ([ADR-0052](adr/0052-server-url-build-variable.md)). There is no default URL anywhere: every build and dev server gets it from its environment.
- **SPA routing:** Pages serves `index.html` for unknown paths when no `404.html` exists, so `/r/<roomId>` deep links work.
- **Transport:** the client connects to an `https://` server URL, i.e. `wss://` (Pages is HTTPS; `ws://` is blocked as mixed content). Socket.io tries WebSocket first and falls back to HTTPS long-polling on networks that block upgrades. The fallback needs `tryAllTransports: true`: without it engine.io-client 6.6 keeps retrying WebSocket (#51).
