# Roadmap

## Implementation roadmap

Every phase ends deployed and playable on the production URLs.

0. **Deploy spike**: **delivered** (`v0.1.0`, #51).
   - Workspace scaffolding (pnpm, tsconfig, ESM, pinned Node/pnpm).
   - Minimal Fastify + Socket.io server with `/health` and an echo event on Render.
   - Blank Angular 22 app on Cloudflare Pages connecting over `wss` after the wake-up poll.
   - Verify: monorepo builds on both platforms, Node 24 availability, CORS (HTTP + Socket.io), cold-start behaviour, SPA deep links.
1. **Vertical slice — playable minimum**: **delivered** (`v0.2.0`, #52).
   - Nickname, create room, share link, join.
   - Fixed default rules (no negotiation UI).
   - Placement with manual + random + confirm (no timer).
   - Standard single-shot turns, victory, game over with fleet reveal.
   - `core` placement/engine tests; snapshot protocol with validation guards.
2. **Resilience** (early, because mobile depends on it): **delivered** (`v0.3.0`, #53).
   - `SessionStore`, handshake auth, reconnection, latest-wins.
   - Seat reservation, auto-pause/resume, disconnect forfeit.
   - TTL sweeps, rate limiting, room cap, graceful shutdown, protocol version check.
3. **Rules & timing**: **delivered** (`v0.4.0`, #54).
   - Rules negotiation with `rulesVersion` (#26), on the rules screen (#27).
   - Placement timer, start countdown, auto-completion (#28); dice roll (#29).
   - Turn timer, timeout actions, AFK rules (#30); the countdowns, the dice, the low-time and AFK warnings in the client (#31).
   - Also delivered: the room place limits (a socket that moves on frees its waiting seat, and the waiting TTL, #113; the negotiation TTL, #128), room failure containment (#123), the browser journeys as a required CI job (#120), and the review's fixes (#134–#139).
   - Handed on: a bound on how long a played match holds a room (#133, M5); library updates and the production advisories (#110); bundle size, judged on a nearly final client (#63).
4. **Variants & end-game**
   - Salvo (draft targets, shot allowance).
   - Extra turn on hit is already in: the engine since #80, the rules toggle since #121, and the board held in view for it since #139. What is left for M4 is its journey, wording and AFK edge cases (see #33).
   - Surrender; rematch flow.
5. **Polish**
   - i18n (IT/EN), mobile layout refinement, accessibility pass, animations (dice, shots).

## Review & consolidation

Every milestone (M0–M5) ends with a `Mn · Review & consolidation` issue (#51–#56) that depends on all its other issues:

1. Read-only analysis of `main`: checks re-run, production smoke test, findings posted on the issue, each tagged bug, refactor, docs or defer.
2. Triage: fix now only code the milestone delivered, without abstractions for later phases; deferred findings go into the issues that will touch that code, or into new ones.
3. Small themed PRs, bugfixes separate from refactors; the docs changes go in the last PR, which closes the issue. A new decision gets a new file in `docs/adr/`; a spec change edits the topic document.
4. After the deploy: re-measure in production what the fixes changed, then a retro comment on the issue.
5. Release: the last PR also bumps the version in the five `package.json` files (the root and the four packages); its merge commit gets the annotated tag and a GitHub Release ([ADR-0071](adr/0071-milestone-versioning.md), [Development: Versions](development.md#versions)).

M0 (#51) piloted the step, and M1 (#52), M2 (#53) and M3 (#54) followed it.

## Open risks

- **Restart = lost matches** (Render free restarts and deploys). Accepted; **client handling resolved (#21, #25).** `SERVER_SHUTDOWN` does not reach clients on a Render deploy ([Backend (Render)](deployment.md#backend-render), #8), so the client detects a restart from `SESSION_INVALID` after reconnecting. Seen by the hub on 2026-10-13: a Render deploy during a match dropped it. Rooms live in memory, so every deploy still ends the matches in progress; since #22 the server restores a seat after a dropped connection and answers a room lost in a restart with `SESSION_INVALID`, which the client acts on since #21: it drops the stored session ([ADR-0070](adr/0070-client-handshake-refusals.md)). Since #25 the room page says that the server restarted, from the server's uptime compared with when the seat was taken ([ADR-0076](adr/0076-refused-seat-explanation.md)).
- **Cold start and spin-down:** **resolved (#8).** About 24 s end to end; an open socket keeps the instance awake; Render's health checks do not ([Hosting facts (Render Free)](deployment.md#hosting-facts-render-free), [Cold-start handling](client.md#cold-start-handling)).
- **Mobile connectivity:** **resolved (#8).** The production client wakes the server and connects on Android and on iPhone. Touch play was confirmed in M1 with full production matches in mobile emulation (#52); real phones, and how the layout handles large text sizes, are the device playtest (#38).
- **Platform versions:** **resolved.** Confirmed on Render (Node 24 from `.nvmrc`, pnpm 11 from `packageManager`, #5) and Cloudflare Pages (exact `NODE_VERSION`, `corepack pnpm`, #6). **Carried forward:** `NODE_VERSION` on Pages is pinned, so it must be bumped by hand when Angular raises its Node floor again.
- **Angular 22 ecosystem compatibility:** **resolved.** `socket.io-client` 4.8 bundles with `@angular/build` (esbuild) without CommonJS warnings (#4). `@angular/build` 22 requires Node `^24.15`, so the Pages image needs an exact recent `NODE_VERSION` ([Frontend (Cloudflare Pages)](deployment.md#frontend-cloudflare-pages), #6).
- **TypeScript held at 6.0.x:** **carried forward.** The workspace pins `typescript ~6.0.3` in the pnpm catalog because Angular 22 (`@angular/compiler-cli`) and `typescript-eslint` both require `>=6.0 <6.1`. TypeScript 7 (native compiler) is preferred; upgrade once both accept it. Checked again in the M1 review (#52): TypeScript 7.0.2 is out, and Angular 22.2 and `typescript-eslint` 8.71 still require `<6.1`; so do Angular 22.2.3 and `typescript-eslint` 8.72.0 in the M2 review (#53, #110), and Angular 22.2.6 and `typescript-eslint` 8.72.2 at the M3 close-out (#54). Splitting versions per package was rejected, since lint already ties every package to 6.0.x.
- **Placement time on mobile:** **carried forward (#38).** 60 s may be tight with touch placement; tune after playtesting.
- **Salvo turns on a phone:** **new in M3; with the device playtest (#38).** The shortest turn is 15 s, and a salvo turn (#32) fires up to one target per surviving ship, five at the start, each picked with a tap on Enemy waters before "Fire". No decision gives a salvo turn more time than a single shot; settle it with #32 and #34, and check 15 s on real phones.
- **Landscape phones:** **carried forward (#38).** At 844×390 and 640×360, "Fire" and "Confirm rules" fall below the fold, more so with the opponent-away banner. The portrait and laptop cases were fixed in the M3 review (#54, F2, [ADR-0110](adr/0110-compact-presence-banner.md)).
- **Rooms nobody sits in cannot outlive Render's 15-minute spin-down:** **confirmed (#8).** Since #23 they close sooner anyway: their forfeits and the game-over TTL remove them within `DISCONNECT_FORFEIT_MS + GAME_OVER_TTL_MS` (5 minutes), and a core test keeps that sum below the spin-down ([ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)).
- **A rematch and the forfeit bound:** **open (#36).** The bound above holds because every phase before game over has the players' forfeit clocks, and game over has its TTL. A rematch leaves `GAME_OVER`, which [ADR-0073](adr/0073-room-lifecycle-with-forfeits.md) names as the case that may break it, and a seat still away at game over keeps the time it dropped: a rematch into placement would count that seat's forfeit from the old drop. #36 decides, for instance by clearing the drop time on leaving game over or by refusing a rematch while a seat is away.
- **Room cap per server lifetime:** **resolved (#24, #23).** Forfeits, `LEAVE_ROOM`, the waiting TTL (#113), the negotiation TTL (#128), the game-over TTL and a room failure (#123) remove rooms, so `MAX_ROOMS` (50) caps the rooms open at once ([ADR-0065](adr/0065-clock-and-room-timers.md), [ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)). A production smoke test still uses `ECHO`: a `CREATE_ROOM` holds a place until its seat is forfeited (`DISCONNECT_FORFEIT_MS`), unless the test sends `LEAVE_ROOM` (#23, [ADR-0073](adr/0073-room-lifecycle-with-forfeits.md)).
- **One client can hold every room place:** **mitigated (#113, #30, #128); carried forward for many sockets and for played matches (#133).** One socket now holds at most one waiting room: creating or joining another frees the seat it waited in alone, and the room closes ([ADR-0095](adr/0095-moving-on-frees-a-lone-waiting-seat.md)). A waiting room closes `WAITING_TTL_MS` (10 minutes) after it started waiting, even with its creator connected, who is told with `ROOM_CLOSED` ([ADR-0096](adr/0096-waiting-ttl.md), [ADR-0097](adr/0097-room-closed-notice.md)). A room in `RULES_NEGOTIATION` closes `NEGOTIATION_TTL_MS` (10 minutes) after the join unless both players confirm the rules, connected or not, and edits do not restart it, so two sockets per room no longer hold a place there (#128, [ADR-0102](adr/0102-negotiation-ttl.md)). In `IN_PROGRESS` the turn timer ends a match nobody plays by AFK within `5 × turnTimeLimitSeconds` (#30, [ADR-0101](adr/0101-afk-forfeit.md)), but a match that is played has no bound: the AFK counter counts consecutive timeouts only. A client that plays both seats, each timing out twice and then firing, holds a room for 599 turns: about 20 hours at 120 s turns, 2.5 hours at 15 s. A seat that drops and comes back within `DISCONNECT_FORFEIT_MS` keeps the match paused, with a new forfeit clock on each return, for as long as it repeats it (#54, F5). Only a client that controls both seats gains: an honest opponent may fire while the match is paused, or leave and lose by forfeit. #133 (M5) bounds a played match, with an absence budget per seat for the whole match and/or a cap on its length. What else remains: the rate limit is per socket ([ADR-0066](adr/0066-rate-limit-and-message-size.md)), so a client with `MAX_ROOMS` open sockets still holds every place if it creates its rooms again every 10 minutes, or two sockets per room that leave and join again before each negotiation runs out. A per-address cap is out while `TRUST_PROXY_HOPS` is `1`, since polling clients all log Render's internal address ([ADR-0081](adr/0081-one-proxy-hop-on-render.md)); it needs a hop count per transport first ([#53 addendum](https://github.com/fabogit/battleship/issues/53#issuecomment-6329698267)).
- **Bundle headroom:** **deferred (#63).** At the M3 close-out the initial bundle is 496.84 kB raw of the 500 kB warning budget, 129.89 kB estimated transfer (`main` at 6ea3d9b, built with the production `SERVER_URL`); Pages serves that same `main` file as 152.0 kB with brotli (150.4 kB with gzip), about 17% above the estimate, as in M2. M1 took it to 426.8 kB, mostly `@angular/forms` (Signal Forms, [ADR-0051](adr/0051-signal-forms.md)) and the client sources; M2 to 469.86 kB, mostly the QR code encoder `uqr` ([ADR-0079](adr/0079-share-dialog.md)); M3 added 27.0 kB raw (5.7 kB estimated), all of it client sources, with no new runtime dependency: the rules screen about 12.7 kB, the battle view's timers and dice about 6.2 kB, the rest in the room, the die, placement and presence (#54, F10). The savings measured on the review's build (494.66 kB raw, 129.54 kB estimated, a57725b), one source at a time:

  | Change                                     | Initial raw | Estimated transfer | Extra chunks                |
  | ------------------------------------------ | ----------- | ------------------ | --------------------------- |
  | `HttpClient` → `fetch` in `server-wake.ts` | −19.0 kB    | −4.9 kB            | none                        |
  | `uqr` through a dynamic `import()`         | −10.1 kB    | −2.7 kB            | lazy 11.6 kB, shared 0.7 kB |
  | The room route as `loadComponent`          | −87.8 kB    | −19.7 kB           | lazy room 89.4 kB           |

  The two lazy options bring back the stale-chunk risk after a deploy until #63 handles it; the `fetch` swap adds no chunk. Decision: no bundle work until the client is nearly final, when #63 weighs these options together. M4 may cross the 500 kB warning in the meantime; the error budget is 1 MB.

- **Postman messages are not linted:** **resolved (#24).** `postman-cli collection lint` never reads the saved Socket.IO messages; a server test replays each one inside `pnpm test` and checks its ack ([Local tooling](development.md#local-tooling), [ADR-0068](adr/0068-postman-replay-test.md)).
- **A refused origin looks like a cold start:** **carried forward (#114).** A foreign origin gets `403` without CORS headers, which the browser reports as a network error, so the page waits 90 s on "Waking up the server…" and then says the server is not responding ([Cold-start handling](client.md#cold-start-handling)). Only a misconfigured deploy meets it (a new Pages project, a custom domain, an origin missing from `ALLOWED_ORIGINS`), so the developer sees it, not the players (#53, F18).
- **Library updates:** **deferred (#110).** The M3 review found more patch and minor releases (Angular 22.2.5, Fastify 5.12.7, Vitest 5.0.5, ESLint 10.14, `typescript-eslint` 8.72.1 and others) and 29 `pnpm audit` advisories, up from 9 in M2. **`pnpm audit --prod` is no longer clean:** 10 advisories (1 high, 4 moderate, 5 low), none reachable from the game:
  - `fastify` 5.12.5, GHSA-389g-gv7q-r4x8 (low, a header validation bypass): the server declares no `headers` schema.
  - `fast-uri` 4.2.1 and 3.1.8, through ajv and `fast-json-stringify`: GHSA-w74x-v6f9-j3xg and GHSA-wjr9-j795-jxcr (moderate, scheme spoofing and host confusion), GHSA-xhq7-xmqj-769h and GHSA-333x-w4r6-6crp (low), each in both major lines: no schema uses `format: 'uri'` or an external `$ref`.
  - `zod` 4.6.5, GHSA-mrhx-c7xc-m3w5 (high, memory exhaustion): a declared dependency of `@angular/forms` that nothing imports and the bundle leaves out.

  The other 19 are in dev tooling (the MCP server bundled with `@angular/cli`, undici through jsdom and Vitest, Vite, minimatch). A targeted bump (`fastify` `^5.12.7`, and `fast-uri` and `zod` refreshed in the lockfile) clears the production list and keeps the server suite green; it waits in #110 with the rest. Updates wait until most development is done (#53, F13; #54, F6).

- **Drop-detection times:** **accepted; tuning with the device playtest (#38).** In production the opponent sees a dropped player about 10 s after a closed tab, 20 s after a TCP FIN without a close frame, and up to 45 s after a silent network loss: Render's proxy delays connection teardown, and the Engine.IO heartbeat defaults bound a silent loss ([Hosting facts (Render Free)](deployment.md#hosting-facts-render-free), [Sessions & reconnection](server.md#sessions--reconnection)). The 3-minute forfeit dominates either way (#53, F17).
