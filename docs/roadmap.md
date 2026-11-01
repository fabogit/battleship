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
5. Release: the last PR also bumps the version in the four `package.json` files; its merge commit gets the annotated tag and a GitHub Release ([ADR-0071](adr/0071-milestone-versioning.md), [Development: Versions](development.md#versions)).

M0 (#51) piloted the step.

## Open risks

- **Restart = lost matches** (Render free restarts and deploys). Accepted; **client handling resolved (#21, #25).** `SERVER_SHUTDOWN` does not reach clients on a Render deploy ([Backend (Render)](deployment.md#backend-render), #8), so the client detects a restart from `SESSION_INVALID` after reconnecting. Seen by the hub on 2026-10-13: a Render deploy during a match dropped it. Rooms live in memory, so every deploy still ends the matches in progress; since #22 the server restores a seat after a dropped connection and answers a room lost in a restart with `SESSION_INVALID`, which the client acts on since #21: it drops the stored session ([ADR-0070](adr/0070-client-handshake-refusals.md)). Since #25 the room page says that the server restarted, from the server's uptime compared with when the seat was taken ([ADR-0076](adr/0076-refused-seat-explanation.md)).
- **Cold start and spin-down:** **resolved (#8).** About 24 s end to end; an open socket keeps the instance awake; Render's health checks do not ([Hosting facts (Render Free)](deployment.md#hosting-facts-render-free), [Cold-start handling](client.md#cold-start-handling)).
- **Mobile connectivity:** **resolved (#8).** The production client wakes the server and connects on Android and on iPhone. Touch play was confirmed in M1 with full production matches in mobile emulation (#52); real phones, and how the layout handles large text sizes, are the device playtest (#38).
- **Platform versions:** **resolved.** Confirmed on Render (Node 24 from `.nvmrc`, pnpm 11 from `packageManager`, #5) and Cloudflare Pages (exact `NODE_VERSION`, `corepack pnpm`, #6). **Carried forward:** `NODE_VERSION` on Pages is pinned, so it must be bumped by hand when Angular raises its Node floor again.
- **Angular 22 ecosystem compatibility:** **resolved.** `socket.io-client` 4.8 bundles with `@angular/build` (esbuild) without CommonJS warnings (#4). `@angular/build` 22 requires Node `^24.15`, so the Pages image needs an exact recent `NODE_VERSION` ([Frontend (Cloudflare Pages)](deployment.md#frontend-cloudflare-pages), #6).
- **TypeScript held at 6.0.x:** **carried forward.** The workspace pins `typescript ~6.0.3` in the pnpm catalog because Angular 22 (`@angular/compiler-cli`) and `typescript-eslint` both require `>=6.0 <6.1`. TypeScript 7 (native compiler) is preferred; upgrade once both accept it. Checked again in the M1 review (#52): TypeScript 7.0.2 is out, and Angular 22.2 and `typescript-eslint` 8.71 still require `<6.1`; so do Angular 22.2.3 and `typescript-eslint` 8.72.0 in the M2 review (#53, #110). Splitting versions per package was rejected, since lint already ties every package to 6.0.x.
- **Placement time on mobile:** **carried forward (#38).** 60 s may be tight with touch placement; tune after playtesting.
- **Rooms nobody sits in cannot outlive Render's 15-minute spin-down:** **confirmed (#8).** Since #23 they close sooner anyway: their forfeits and the game-over TTL remove them within `DISCONNECT_FORFEIT_MS + GAME_OVER_TTL_MS` (5 minutes), and a core test keeps that sum below the spin-down ([ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)).
- **Room cap per server lifetime:** **resolved (#24, #23).** Forfeits, `LEAVE_ROOM`, the waiting TTL (#113) and the game-over TTL remove rooms, so `MAX_ROOMS` (50) caps the rooms open at once ([ADR-0065](adr/0065-clock-and-room-timers.md), [ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)). A production smoke test still uses `ECHO`: a `CREATE_ROOM` holds a place until its seat is forfeited (`DISCONNECT_FORFEIT_MS`), unless the test sends `LEAVE_ROOM` (#23, [ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)).
- **One client can hold every room place:** **mitigated (#113, #30, #128); carried forward for many sockets.** One socket now holds at most one waiting room: creating or joining another frees the seat it waited in alone, and the room closes ([ADR-0095](adr/0095-moving-on-frees-a-lone-waiting-seat.md)). A waiting room closes `WAITING_TTL_MS` (10 minutes) after it started waiting, even with its creator connected, who is told with `ROOM_CLOSED` ([ADR-0096](adr/0096-waiting-ttl.md), [ADR-0097](adr/0097-room-closed-notice.md)). A room in `RULES_NEGOTIATION` closes `NEGOTIATION_TTL_MS` (10 minutes) after the join unless both players confirm the rules, connected or not, and edits do not restart it, so two sockets per room no longer hold a place there (#128, [ADR-0102](adr/0102-negotiation-ttl.md)). In `IN_PROGRESS` the turn timer ends an idle match by AFK within `5 × turnTimeLimitSeconds` (#30, [ADR-0101](adr/0101-afk-forfeit.md)). Every phase is now bounded while its players stay connected. What remains: the rate limit is per socket ([ADR-0066](adr/0066-rate-limit-and-message-size.md)), so a client with `MAX_ROOMS` open sockets still holds every place if it creates its rooms again every 10 minutes, or two sockets per room that leave and join again before each negotiation runs out. A per-address cap is out while `TRUST_PROXY_HOPS` is `1`, since polling clients all log Render's internal address ([ADR-0081](adr/0081-one-proxy-hop-on-render.md)); it needs a hop count per transport first ([#53 addendum](https://github.com/fabogit/battleship/issues/53#issuecomment-6329698267)).
- **Bundle headroom:** **deferred (#63).** At the M2 close-out the initial bundle is 469.86 kB raw of the 500 kB warning budget, 124.22 kB estimated transfer (#53, F19). M1 took it to 426.8 kB, mostly `@angular/forms` (Signal Forms, [ADR-0051](adr/0051-signal-forms.md)) and the client sources; M2 added 43 kB, mostly the QR code encoder `uqr` ([ADR-0079](adr/0079-share-dialog.md)), `@angular/core` and the new client sources. Lazy-loading the room route would save about 44 kB raw, and a dynamic `import()` of the QR code about 11 kB, but either brings back the stale-chunk risk after a deploy until #63 lands. The rules screen (#27) took it to 482.53 kB raw, 126.65 kB estimated transfer (+12.64 kB and +2.38 kB over 469.89 kB and 124.27 kB with #26's rules negotiation, @ 44bad30). M3 took it to 484.98 kB raw, 127.17 kB estimated transfer at 836e869 (#30 and #128 merged); the timers and dice UI (#31) to 494.64 kB and 129.49 kB (+9.66 kB and +2.32 kB), 5.4 kB under the warning. Decide on lazy loading with #63 before the next feature that adds this much.
- **Postman messages are not linted:** **resolved (#24).** `postman-cli collection lint` never reads the saved Socket.IO messages; a server test replays each one inside `pnpm test` and checks its ack ([Local tooling](development.md#local-tooling), [ADR-0068](adr/0068-postman-replay-test.md)).
- **A refused origin looks like a cold start:** **carried forward (#114).** A foreign origin gets `403` without CORS headers, which the browser reports as a network error, so the page waits 90 s on "Waking up the server…" and then says the server is not responding ([Cold-start handling](client.md#cold-start-handling)). Only a misconfigured deploy meets it (a new Pages project, a custom domain, an origin missing from `ALLOWED_ORIGINS`), so the developer sees it, not the players (#53, F18).
- **Library updates:** **deferred (#110).** The M2 review found patch and minor releases (Angular, Fastify, Vitest, ESLint and others) and 9 `pnpm audit` advisories, all in dev tooling (the MCP server bundled with `@angular/cli`, the Vite dev server); `pnpm audit --prod` is clean. Updates wait until most development is done (#53, F13).
- **Drop-detection times:** **accepted; tuning with the device playtest (#38).** In production the opponent sees a dropped player about 10 s after a closed tab, 20 s after a TCP FIN without a close frame, and up to 45 s after a silent network loss: Render's proxy delays connection teardown, and the Engine.IO heartbeat defaults bound a silent loss ([Hosting facts (Render Free)](deployment.md#hosting-facts-render-free), [Sessions & reconnection](server.md#sessions--reconnection)). The 3-minute forfeit dominates either way (#53, F17).
