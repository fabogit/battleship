# Overview

## Product scope (v1)

* **Game Model:** Real-time 1v1 classic Battleship on a 10×10 board.
* **Out of scope for v1:** team play (dropped entirely, no abstractions designed for it), random matchmaking, spectators, chat, native app.
* **Room access:** private rooms only, shared via link (`/r/<roomId>`).
* **Platforms:** desktop and mobile browsers (Android/iOS). Mobile is a first-class target, not an afterthought. A native app (likely a Capacitor wrapper of the Angular client) may follow later; v1 must not preclude it.
* **Languages:** Italian and English (runtime-switchable i18n).
* **Players** choose a nickname before creating or joining a room.

## Design principle: good faith

Players are assumed to be cooperating to play a match. The room is **symmetric**: there is no host, no kick, and either player may edit the rules. Conflicts are resolved by mutual confirmation, not by privilege. Hard limits exist only where needed to bound server memory (timeouts, TTLs, caps), not to police behaviour.

## Technical constraints

* **Cost:** strict zero-cost operational budget. No paid tiers.
* **State lifecycle:** ephemeral, in-memory only. No database.
* **Network topology:** server-authoritative WebSockets. The server holds the full game state; each client only receives its own fleet and the shot history (fog-of-war).
* **Stack:**
  * Package manager: `pnpm` workspaces, pinned by the root `packageManager` field. Node.js 24: `.nvmrc` and the root `engines` range (enforced on install by `engineStrict`), plus an exact `NODE_VERSION` on Pages ([Frontend (Cloudflare Pages)](deployment.md#frontend-cloudflare-pages)).
  * All packages are ESM (`"type": "module"`).
  * Shared domain core: pure TypeScript, zero runtime dependencies (`packages/core`).
  * Backend: Fastify + Socket.io (`packages/server`) on Render Free.
  * Frontend: Angular 22, zoneless + Signals + OnPush (`packages/client`) on Cloudflare Pages.
