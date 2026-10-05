# Roadmap

## Implementation roadmap

Every phase ends deployed and playable on the production URLs.

0. **Deploy spike**
   * Workspace scaffolding (pnpm, tsconfig, ESM, pinned Node/pnpm).
   * Minimal Fastify + Socket.io server with `/health` and an echo event on Render.
   * Blank Angular 22 app on Cloudflare Pages connecting over `wss` after the wake-up poll.
   * Verify: monorepo builds on both platforms, Node 24 availability, CORS (HTTP + Socket.io), cold-start behaviour, SPA deep links.
1. **Vertical slice — playable minimum**
   * Nickname, create room, share link, join.
   * Fixed default rules (no negotiation UI).
   * Placement with manual + random + confirm (no timer).
   * Standard single-shot turns, victory, game over with fleet reveal.
   * `core` placement/engine tests; snapshot protocol with validation guards.
2. **Resilience** (early, because mobile depends on it)
   * `SessionStore`, handshake auth, reconnection, latest-wins.
   * Seat reservation, auto-pause/resume, disconnect forfeit.
   * TTL sweeps, rate limiting, room cap, graceful shutdown, protocol version check.
3. **Rules & timing**
   * Rules negotiation with `rulesVersion`.
   * Placement timer, start countdown, auto-completion; dice roll.
   * Turn timer, timeout actions, AFK rules.
4. **Variants & end-game**
   * Salvo (draft targets, shot allowance) and extra turn on hit.
   * Surrender; rematch flow.
5. **Polish**
   * i18n (IT/EN), mobile layout refinement, accessibility pass, animations (dice, shots).

## Review & consolidation

Every milestone (M0–M5) ends with a `Mn · Review & consolidation` issue (#51–#56) that depends on all its other issues:

1. Read-only analysis of `main`: checks re-run, production smoke test, findings posted on the issue, each tagged bug, refactor, docs or defer.
2. Triage: fix now only code the milestone delivered, without abstractions for later phases; deferred findings go into the issues that will touch that code, or into new ones.
3. Small themed PRs, bugfixes separate from refactors; the docs changes go in the last PR, which closes the issue. A new decision gets a new file in `docs/adr/`; a spec change edits the topic document.
4. After the deploy: re-measure in production what the fixes changed, then a retro comment on the issue.

M0 (#51) piloted the step.

## Open risks

* **Restart = lost matches** (Render free restarts and deploys). Accepted. **Carried forward (#22, #25):** `SERVER_SHUTDOWN` does not reach clients on a Render deploy ([Backend (Render)](deployment.md#backend-render), #8), so the client has to detect a restart from `SESSION_INVALID` after reconnecting.
* **Cold start and spin-down:** **resolved (#8).** About 24 s end to end; an open socket keeps the instance awake; Render's health checks do not ([Hosting facts (Render Free)](deployment.md#hosting-facts-render-free), [Cold-start handling](client.md#cold-start-handling)).
* **Mobile connectivity:** **resolved (#8).** The production client wakes the server and connects on Android and on iPhone; layout and touch play are covered by the device playtest (#38).
* **Platform versions:** **resolved.** Confirmed on Render (Node 24 from `.nvmrc`, pnpm 11 from `packageManager`, #5) and Cloudflare Pages (exact `NODE_VERSION`, `corepack pnpm`, #6). **Carried forward:** `NODE_VERSION` on Pages is pinned, so it must be bumped by hand when Angular raises its Node floor again.
* **Angular 22 ecosystem compatibility:** **resolved.** `socket.io-client` 4.8 bundles with `@angular/build` (esbuild) without CommonJS warnings (#4). `@angular/build` 22 requires Node `^24.15`, so the Pages image needs an exact recent `NODE_VERSION` ([Frontend (Cloudflare Pages)](deployment.md#frontend-cloudflare-pages), #6).
* **TypeScript held at 6.0.x:** **carried forward.** The workspace pins `typescript ~6.0.3` in the pnpm catalog because Angular 22 (`@angular/compiler-cli`) and `typescript-eslint` both require `>=6.0 <6.1`. TypeScript 7 (native compiler) is preferred; upgrade once both accept it. Splitting versions per package was rejected, since lint already ties every package to 6.0.x.
* **Placement time on mobile:** **carried forward (#38).** 60 s may be tight with touch placement; tune after playtesting.
* **Empty rooms cannot outlive Render's 15-minute spin-down**, regardless of TTL settings. **Confirmed (#8).**
