# Roadmap

## Implementation roadmap

Every phase ends deployed and playable on the production URLs.

0. **Deploy spike**
   - Workspace scaffolding (pnpm, tsconfig, ESM, pinned Node/pnpm).
   - Minimal Fastify + Socket.io server with `/health` and an echo event on Render.
   - Blank Angular 22 app on Cloudflare Pages connecting over `wss` after the wake-up poll.
   - Verify: monorepo builds on both platforms, Node 24 availability, CORS (HTTP + Socket.io), cold-start behaviour, SPA deep links.
1. **Vertical slice — playable minimum**
   - Nickname, create room, share link, join.
   - Fixed default rules (no negotiation UI).
   - Placement with manual + random + confirm (no timer).
   - Standard single-shot turns, victory, game over with fleet reveal.
   - `core` placement/engine tests; snapshot protocol with validation guards.
2. **Resilience** (early, because mobile depends on it)
   - `SessionStore`, handshake auth, reconnection, latest-wins.
   - Seat reservation, auto-pause/resume, disconnect forfeit.
   - TTL sweeps, rate limiting, room cap, graceful shutdown, protocol version check.
3. **Rules & timing**
   - Rules negotiation with `rulesVersion`.
   - Placement timer, start countdown, auto-completion; dice roll.
   - Turn timer, timeout actions, AFK rules.
4. **Variants & end-game**
   - Salvo (draft targets, shot allowance) and extra turn on hit.
   - Surrender; rematch flow.
5. **Polish**
   - i18n (IT/EN), mobile layout refinement, accessibility pass, animations (dice, shots).

## Review & consolidation

Every milestone (M0–M5) ends with a `Mn · Review & consolidation` issue (#51–#56) that depends on all its other issues:

1. Read-only analysis of `main`: checks re-run, production smoke test, findings posted on the issue, each tagged bug, refactor, docs or defer.
2. Triage: fix now only code the milestone delivered, without abstractions for later phases; deferred findings go into the issues that will touch that code, or into new ones.
3. Small themed PRs, bugfixes separate from refactors; the docs changes go in the last PR, which closes the issue. A new decision gets a new file in `docs/adr/`; a spec change edits the topic document.
4. After the deploy: re-measure in production what the fixes changed, then a retro comment on the issue.

M0 (#51) piloted the step.

## Open risks

- **Restart = lost matches** (Render free restarts and deploys). Accepted. **Carried forward (#21, #25):** `SERVER_SHUTDOWN` does not reach clients on a Render deploy ([Backend (Render)](deployment.md#backend-render), #8), so the client has to detect a restart from `SESSION_INVALID` after reconnecting. Seen by the hub on 2026-10-13: a Render deploy during a match dropped it. Rooms live in memory, so every deploy still ends the matches in progress; since #22 the server restores a seat after a dropped connection and answers a room lost in a restart with `SESSION_INVALID`, which the client acts on with #21 (stored session) and #25 (connection-state UX).
- **Cold start and spin-down:** **resolved (#8).** About 24 s end to end; an open socket keeps the instance awake; Render's health checks do not ([Hosting facts (Render Free)](deployment.md#hosting-facts-render-free), [Cold-start handling](client.md#cold-start-handling)).
- **Mobile connectivity:** **resolved (#8).** The production client wakes the server and connects on Android and on iPhone. Touch play was confirmed in M1 with full production matches in mobile emulation (#52); real phones, and how the layout handles large text sizes, are the device playtest (#38).
- **Platform versions:** **resolved.** Confirmed on Render (Node 24 from `.nvmrc`, pnpm 11 from `packageManager`, #5) and Cloudflare Pages (exact `NODE_VERSION`, `corepack pnpm`, #6). **Carried forward:** `NODE_VERSION` on Pages is pinned, so it must be bumped by hand when Angular raises its Node floor again.
- **Angular 22 ecosystem compatibility:** **resolved.** `socket.io-client` 4.8 bundles with `@angular/build` (esbuild) without CommonJS warnings (#4). `@angular/build` 22 requires Node `^24.15`, so the Pages image needs an exact recent `NODE_VERSION` ([Frontend (Cloudflare Pages)](deployment.md#frontend-cloudflare-pages), #6).
- **TypeScript held at 6.0.x:** **carried forward.** The workspace pins `typescript ~6.0.3` in the pnpm catalog because Angular 22 (`@angular/compiler-cli`) and `typescript-eslint` both require `>=6.0 <6.1`. TypeScript 7 (native compiler) is preferred; upgrade once both accept it. Checked again in the M1 review (#52): TypeScript 7.0.2 is out, and Angular 22.2 and `typescript-eslint` 8.71 still require `<6.1`. Splitting versions per package was rejected, since lint already ties every package to 6.0.x.
- **Placement time on mobile:** **carried forward (#38).** 60 s may be tight with touch placement; tune after playtesting.
- **Empty rooms cannot outlive Render's 15-minute spin-down**, regardless of TTL settings. **Confirmed (#8).**
- **Room cap per server lifetime:** **still carried forward after M1 (#24).** Rooms are never removed until the TTL sweeps land, so a server answers `SERVER_FULL` to every `CREATE_ROOM` after `MAX_ROOMS` (50) rooms, until Render restarts it (spin-down or deploy) ([ADR-0039](adr/0039-room-registry.md)). A production smoke test should use `ECHO`, not `CREATE_ROOM`.
- **Bundle headroom:** **new in M1 (#53).** The initial bundle is 426 kB raw of the 500 kB warning budget (131.8 kB transferred with brotli from Pages, [ADR-0051](adr/0051-signal-forms.md)); M1 added 163 kB, mostly `@angular/forms` (Signal Forms) and the client sources. Lazy-loading the room route would save about 44 kB raw, but a lazy chunk brings back the stale-chunk risk after a deploy (#63). A topic for #53.
- **Postman messages are not linted:** **new in M1 (#24).** `postman-cli collection lint` never reads the saved Socket.IO messages, so a broken message passes ([Local tooling](development.md#local-tooling)). Until the server test of #24 sends each one, a changed or new message is checked by hand against a local server.
