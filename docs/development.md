# Development

## Monorepo topology

```text
battleship/
├── package.json                   # Root scripts, "packageManager": "pnpm@<pinned>", "engines" (Node range)
├── pnpm-workspace.yaml            # packages, allowBuilds (D26), catalogs (default + angular), engineStrict
├── tsconfig.base.json             # Strict compiler options
├── eslint.config.js               # Flat config for every package: typescript-eslint strictTypeChecked, JSDoc (D59)
├── .prettierrc                    # Prettier options; Angular parser for templates, JSON keys sorted (D44)
├── .prettierignore                # Files written by tools: lockfiles, postman/, .postman/
├── .husky/                        # pre-commit hook: lint-staged, prettier --write on the staged files (D44)
├── .git-blame-ignore-revs         # Formatting-only commits, skipped by git blame
├── .editorconfig
├── .nvmrc                         # 24
├── .github/workflows/ci.yml       # ci: install → format:check → typecheck → lint → test → build, required on main;
│                                  # e2e: the browser journeys (End-to-end journeys)
├── .vscode/                       # Debug configurations, format on save, YAML schema override for postman/ (D28)
│   └── extensions.json            # Recommended extensions: Prettier
├── .postman/                      # Postman Native Git workspace link (D28)
├── postman/                       # Collection v3 YAML + localhost environment (Local tooling, D28)
├── docs/                          # Specification, one document per topic
│   └── adr/                       # One file per decision (ADR-0001 …)
└── packages/
    ├── core/                      # Pure domain + protocol contract (zero runtime deps)
    │   ├── src/
    │   │   ├── constants.ts       # Board size, timings, limits, PROTOCOL_VERSION
    │   │   ├── types.ts           # Domain entities and their named value sets (SEATS, ROOM_PHASES, …)
    │   │   ├── grid.ts            # Board geometry: CELL_COUNT, row-major cell index ↔ coordinate
    │   │   ├── rules.ts           # DEFAULT_RULES, validateRules
    │   │   ├── placement.ts       # Layout validation, random generation, completion
    │   │   ├── engine.ts          # Shot resolution, shot count, victory check
    │   │   ├── random.ts          # Rng interface, seeded (tests) and crypto (production) implementations
    │   │   ├── identifiers.ts     # generateRoomId, createPlayerSecret: the server's ids and secrets, and the specs'
    │   │   ├── protocol.ts        # Socket.io event maps and names, snapshot, error codes
    │   │   ├── validation.ts      # Runtime guards for every client→server payload
    │   │   └── index.ts
    │   └── test/                  # Vitest
    │
    ├── server/
    │   ├── src/
    │   │   ├── room/                  # Room logic, no timers, sockets or I/O (server.md#room-logic)
    │   │   │   ├── room.ts            # RoomState per phase, createRoom, applyCommand(state, command, now) → state + effects
    │   │   │   ├── snapshot.ts        # projectSnapshot(state, seat, now): one player's snapshot, with fog-of-war
    │   │   │   ├── presence.ts        # Seat presence: drops, returns, disconnect forfeit, LEAVE_ROOM (D72, D73)
    │   │   │   ├── room-manager.ts    # RoomManager: rooms by id, room ids, secrets, MAX_ROOMS cap, presence, remove
    │   │   │   └── room-timers.ts     # RoomTimers: one timer per room and kind (forfeit, game-over TTL; turn timer later) (D65)
    │   │   ├── plugins/               # fastify-plugin wrapped, composed by createServer (server.md#plugins)
    │   │   │   ├── origin-policy.ts   # HTTP side of the origin policy: 403 onRequest hook + @fastify/cors (D21)
    │   │   │   ├── socket-io.ts       # Socket.io on the HTTP server: allowRequest origin check, 16 KiB cap, app.io, logs
    │   │   │   ├── handshake.ts       # Handshake middleware: protocol version, session rebinding, latest wins (D61, D63)
    │   │   │   ├── rate-limit.ts      # Per-socket rate limit, a middleware ahead of every listener (D66)
    │   │   │   ├── echo.ts            # ECHO smoke check (D48)
    │   │   │   └── room-handlers.ts   # Every command: guard → RoomManager → ack, effects, STATE; seat presence, room timers (D72)
    │   │   ├── config.ts              # PORT / ALLOWED_ORIGINS / LOG_* / TRUST_PROXY_HOPS parsing, validated at startup
    │   │   ├── clock.ts               # Clock (now + scheduleAt) and systemClock; tests use test/fake-clock.ts (D65)
    │   │   ├── rate-limiter.ts        # Sliding-window limiter behind the rate-limit plugin (D66)
    │   │   ├── client-address.ts      # Client address from X-Forwarded-For with trusted hops (D67)
    │   │   ├── origins.ts             # Origin matcher: exact origins + https://*.<domain> wildcards (D21, D24)
    │   │   ├── server.ts              # createServer: plugins + /health; rooms and clock injectable for tests
    │   │   ├── shutdown.ts            # SIGTERM/SIGINT → app.close(); repeats ignored, 10 s deadline (D27)
    │   │   └── index.ts               # Entry point: config, server, signal handling, listen
    │   │                              # Not yet: placement and turn timers (#28, #30)
    │   ├── scripts/echo-client.ts     # Production smoke test: handshake + ECHO round trip (D48)
    │   ├── .env.example               # Local PORT / ALLOWED_ORIGINS / LOG_* / TRUST_PROXY_HOPS: copy to .env
    │   └── test/                      # Vitest: room/ unit tests (seeded fleets, fake clock) + socket integration tests,
    │                                  # Postman message replay (D68); socket-harness.ts: the shared server and clients
    │
    ├── client/                    # Angular 22, @angular/build (esbuild), unit tests on Vitest + jsdom
    │   ├── vitest-base.config.ts  # `ng test` runnerConfig: resolves core from source (D22)
    │   ├── scripts/ng.ts          # `build`/`dev`: SERVER_URL → ng build|serve --define, stops when missing (ADR-0052)
    │   ├── .env.example           # Local SERVER_URL (http://localhost:3000): copy to .env (Local tooling)
    │   └── src/
    │       ├── build-defines.d.ts # BUILD_SERVER_URL, read only by the SERVER_URL token
    │       ├── app/
    │       │   ├── app.routes.ts  # `/` home, `/r/:roomId` room (D49)
    │       │   ├── core/          # GameSocketService, GameStateService, SessionStore, RoomEntryService,
    │       │   │                  # ServerWakeService, createSyncedDraft (the draft sync of placement, battle and rules)
    │       │   ├── features/      # home (nickname, create), room (one view per phase, refused-seat explanation, leave),
    │       │   │                  # lobby (waiting screen, share dialog D79), rules (+ RulesStore, D86–D88),
    │       │   │                  # placement (+ PlacementStore), battle (+ BattleStore; also the game-over screen, D58),
    │       │   │                  # presence (opponent's connection, pause control, D77)
    │       │   └── shared/        # board-grid/, nickname-form/, qr-code/ (D79), server-status/, connection-screen/ (D75),
    │       │                      # countdown.ts
    │       │                      # Not yet: I18nService (#37), dice (#29), timers UI (#31)
    │       └── testing/           # Test doubles shared by the specs (FakeGameSocket, FakeServerWake), id and secret generators, the setup file; left out of the app build
    │
    └── e2e/                       # Browser journeys (Playwright), private; `pnpm e2e`, outside test and verify (D89)
        ├── playwright.config.ts   # One Chromium project, one worker, the two webServer entries, traces on failure
        ├── src/
        │   ├── stack.ts           # E2E_* ports and Chromium path, 127.0.0.1, the control route's path and body
        │   ├── skip-clock.ts      # SkipClock: real time + an offset; advance(ms) runs the timers it passes (D89)
        │   ├── server.ts          # e2e server: createServer on a SkipClock + POST /e2e/clock/advance, loopback only
        │   ├── client.ts          # Builds core and the production bundle against it, serves it as an SPA
        │   ├── fixtures.ts        # openPlayer (a browser context each, errors fail the journey), skipServerClock
        │   └── flows.ts           # Shared steps: create, join, random fleet, fire; selectors from the *_TEXT constants
        └── journeys/              # One *.spec.ts per journey
```

## Resolving `@battleship/core`

Decision: [ADR-0022](adr/0022-workspace-type-resolution.md).

`packages/core/package.json` lists `"@battleship/source": "./src/index.ts"` ahead of `types`/`default` in its `exports`. Tools that enable the condition read the TypeScript sources; everything else (Node at runtime, production builds) gets `dist/`. Each consumer enables it separately:

| Consumer                                 | Setting                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc` typecheck, ESLint `projectService` | `customConditions: ["@battleship/source"]` in the dependent's `tsconfig.json` | Server `tsconfig.build.json` does not extend `tsconfig.json`, so `pnpm build` still reads `dist/` and `packages/server/dist` holds only server code.                                                                                                                                                                                                                                                            |
| Server tests (Vitest)                    | `ssr.resolve.conditions` in `vitest.config.ts`                                | Node tests run in Vite's SSR environment; the list replaces Vite's server defaults (`module`, `node`, `development\|production`), so it repeats them.                                                                                                                                                                                                                                                           |
| Client app build and `ng serve`          | `conditions` in the `development` build configuration of `angular.json`       | Replaces Angular's defaults, so it repeats `module` and `development`. Angular passes the same list to its TypeScript compiler as `customConditions`, overriding the tsconfig, so types and bundle always agree. The `production` configuration has no `conditions` and bundles `dist/`; the filtered Pages build compiles core first ([Frontend (Cloudflare Pages)](deployment.md#frontend-cloudflare-pages)). |
| Server watch (`pnpm dev`)                | `--conditions=@battleship/source` on `tsx watch` in the server's `dev` script | `tsx` maps the sources' `.js` specifiers to `.ts` and watches core's files through the workspace link ([ADR-0029](adr/0029-watch-mode.md)).                                                                                                                                                                                                                                                                     |
| `ng serve` prebundling                   | `prebundle.exclude: ["@battleship/core"]` on the `serve` target               | Prebundled packages are resolved by Vite, which ignores the build `conditions`; excluded, core is bundled by esbuild with them and rebuilt on every change.                                                                                                                                                                                                                                                     |
| Client tests (`ng test`)                 | `runnerConfig: "vitest-base.config.ts"` with `resolve.conditions`             | The unit-test build leaves packages external and Vitest resolves them at runtime; its conditions are added to the builder's own.                                                                                                                                                                                                                                                                                |
| `ngc`/`tsc` typecheck of the client      | `customConditions` in `packages/client/tsconfig.json`                         | Inherited by `tsconfig.app.json` and `tsconfig.spec.json`.                                                                                                                                                                                                                                                                                                                                                      |

`packages/server/package.json` exports `./server` and `./clock` the same way, for its one consumer, the e2e package; nothing else imports the server, and Render runs `dist/index.js` directly.

| Consumer                            | Setting                                                                          | Notes                                                                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| e2e typecheck and ESLint            | `customConditions` in `packages/e2e/tsconfig.json`                               | With `moduleResolution: "bundler"`, so the client's extensionless specifiers resolve when the journeys import its text constants.                                                                               |
| Playwright runner (`pnpm e2e`)      | `NODE_OPTIONS=--conditions=@battleship/source` in the e2e package's `e2e` script | Playwright loads the journeys, and through them the client's `*.text.ts` and core, with its own TypeScript loader, which honours Node's conditions. Running `playwright test` without the script fails on core. |
| e2e server (`src/server.ts`)        | `tsx --conditions=@battleship/source` in the `webServer` command                 | Server and core from their sources, as `pnpm dev` runs them: no server build before a run.                                                                                                                      |
| e2e client bundle (`src/client.ts`) | none: the production configuration                                               | Builds core first, then the client with `--output-path packages/e2e/dist/client`, so the journeys test what Pages serves.                                                                                       |

A new consumer of core (or a new workspace package consumed the same way) needs the matching row before it works on a checkout without `dist/`.

## Code conventions

Decisions: [ADR-0043](adr/0043-named-constants.md), [ADR-0044](adr/0044-code-formatter.md), [ADR-0059](adr/0059-jsdoc-enforced-by-lint.md).

- **Formatting:** Prettier owns layout in every TypeScript, template, CSS, JSON, YAML and Markdown file (`.prettierrc`: `printWidth: 120`, `singleQuote: true`, `trailingComma: "all"`); ESLint checks correctness only. The pre-commit hook formats staged files and CI fails on any file `pnpm format:check` flags. JSON keys are sorted at every level, with `$schema`, `extends`, `name` and `label` first; arrays and `package.json` files keep their order. A comment in a JSON file sits above the key it describes, since it moves with it. Markdown keeps its prose lines and its code blocks as written; files written by tools are listed in `.prettierignore`.

- **Closed string sets:** each set of values (phases, seats, error codes, event names, violation reasons, a service's states) is an `as const` object with a plural `UPPER_SNAKE_CASE` name and keys. Its type is derived from it under the singular name, and code names every value through the object:

  ```typescript
  export const ROOM_PHASES = {
    WAITING_FOR_OPPONENT: 'WAITING_FOR_OPPONENT',
    // …
    GAME_OVER: 'GAME_OVER',
  } as const;
  export type RoomPhase = (typeof ROOM_PHASES)[keyof typeof ROOM_PHASES];

  if (state.phase === ROOM_PHASES.GAME_OVER) { … }
  ```

  - Comparisons, returns, emits and listeners use the object, type positions too (`typeof ROOM_PHASES.PLACEMENT`). An Angular template reads it from a component field (`protected readonly wakeStatuses = WAKE_STATUSES`).
  - No `enum` and no `const enum`: the values stay plain strings, and the code runs under type stripping.
  - Sets shared by server and client live in core and are exported from `@battleship/core`. A set one package owns stays there, such as `CONNECTION_STATUSES` or `ROOM_VIEWS` in the client and `LOG_FORMATS` in the server.
  - A runtime list is `Object.values(…)`, in declaration order; a guard checks membership against the values, never the keys.

- **Pinned values:** one test per object writes its values out. Renaming a key is a refactor; changing a value changes the protocol (and `PROTOCOL_VERSION`), the logs or the styles.
- **Left as literals:** the `ok` discriminant of acks and results; object keys and property names (`boards.P1`); third-party values (Pino levels, Socket.io and DOM event names, OS signals, keyboard keys); log messages and UI text; comments and the pinning tests.
- **New values:** a new set, or a new value of an existing one, follows the same pattern. A new protocol value also goes into its pinning test and into [Protocol](protocol.md).

- **Documentation comments:** every declaration in `src/` and `scripts/` of the three packages has a JSDoc block, exported or not: functions, classes, constructors, methods, accessors, class fields (injected services and private signals too), module-level constants, interfaces and type aliases with their members, and each value of a closed string set. `pnpm lint` fails on a missing block (`eslint-plugin-jsdoc`); spec, test and config files are left out.

  - The block says what the signature does not: purpose, units (ms, cells), ranges and invariants, side effects (timers, emits, signal writes), when it throws or rejects, and the doc section (`docs/<file>.md#<anchor>`) or ADR behind it.
  - `@param`, `@returns` and `@throws` have descriptions and no types: TypeScript has them. A destructured parameter is described as a whole; a getter needs no `@returns`.
  - A description that only repeats the name (`@param roomId The room's id.`) fails `jsdoc/informative-docs`; one that only restates the type is caught in review. A self-explanatory declaration says why it exists or which invariant it keeps.
  - `@example` on the public `core` API where it helps: placement, engine, validation guards.
  - `CLIENT_EVENTS` and `SERVER_EVENTS` are documented as a whole: each event is documented in its event map.

## Versions

Decision: [ADR-0071](adr/0071-milestone-versioning.md).

- **One number:** the root and the three packages share one version, `0.(n+1).0` after milestone `Mn` (M0 → `0.1.0`, M1 → `0.2.0`), and `1.0.0` waits for a stable protocol and rules. The packages are private, so nothing is published.
- **Closing a milestone:** the last PR of its review issue sets the new version in the four `package.json` files. After the merge, tag the commit that closed the milestone (the PR's merge commit, or the real end of the milestone if the bump came later, as for M1) and publish the release:

  ```bash
  git tag -a v0.3.0 <merge-commit> -m "M2 · Resilience"
  git push origin v0.3.0
  gh release create v0.3.0 --verify-tag --title "v0.3.0 · M2 Resilience" --notes "…"
  ```

- **`PROTOCOL_VERSION`** is separate: it changes with the wire contract, not with a milestone ([ADR-0017](adr/0017-protocol-versioning.md)).

## Local tooling

Decisions: [ADR-0028](adr/0028-local-tooling.md), [ADR-0029](adr/0029-watch-mode.md), [ADR-0044](adr/0044-code-formatter.md), [ADR-0052](adr/0052-server-url-build-variable.md), [ADR-0055](adr/0055-isolated-client-tests.md), [ADR-0062](adr/0062-protocol-version-query.md).

- **Setup:** `cp packages/server/.env.example packages/server/.env && cp packages/client/.env.example packages/client/.env`, once per checkout; a new `git worktree` needs both files too (copy them from the main checkout). Without them the server refuses to start, and `ng serve` (`pnpm dev`) and the client build (`pnpm build`, `pnpm verify`) stop without a `SERVER_URL` ([Deployment: Environment variables](deployment.md#environment-variables)); the client's points at the local server, so `pnpm verify` builds a bundle that talks to `http://localhost:3000`. `ng test` needs neither: the specs override the `SERVER_URL` token.
- **Run:** with the server's `.env` in place (it allows `http://localhost:4200` and sets `LOG_FORMAT=pretty` and `LOG_LEVEL=debug`, so the terminal shows every request and socket event in readable form, [Logging](server.md#logging); without it the server refuses to start, [Backend (Render)](deployment.md#backend-render)), then `pnpm dev`: the server restarts on every change to its own or core's sources (`tsx watch`, sources read through `@battleship/source`), the client rebuilds and reloads (`ng serve`), and every output line is prefixed with its package. Set the server port in `.env`, not in the shell: `ng serve` reads `PORT` too. Ctrl+C kills the server partway through its shutdown (ADR-0029). To run what production runs: `pnpm build && pnpm --filter @battleship/server start` (`start` runs `dist/`, so rebuild after every change).
- **Debug (VS Code, `.vscode/launch.json`):** `Server` (builds core and server, runs `dist/` with source maps in the integrated terminal), `Client` (`ng serve` + Chrome/Chromium), `Server + Client`, `Server tests: current file` (Vitest), `Client tests: current file` (`ng test --debug`, attach on port 9229).
- **Manual checks (Postman):** open the repo folder in the Postman desktop app (Native Git, free plan) and select the `localhost` environment (`baseUrl`, `allowedOrigin`). The `health` folder runs in the Collection Runner; Socket.IO requests are sent by hand: `ECHO`, `ECHO — wrong protocol version` (refused with `PROTOCOL_MISMATCH`), `ECHO — foreign origin`, and a match between `Seat P1` and `Seat P2` (connect both, send `CREATE_ROOM` from P1, copy the `roomId` from its ack into the collection variable `roomId`, then follow the saved messages in order: `UPDATE_RULES`, a stale `CONFIRM_RULES` and both confirmations lead from `JOIN_ROOM` to placement; disconnecting `Seat P2` mid-match lets P1's `SET_PAUSED` messages through, and `LEAVE_ROOM` closes a room P1 created alone). Postman cannot send the handshake `auth`, so every Socket.IO request passes the collection variable `protocolVersion` as a query parameter ([ADR-0062](adr/0062-protocol-version-query.md)); bump it with `PROTOCOL_VERSION`. A session cannot travel that way, so rebinding a seat and `SESSION_REPLACED` (listened to by both seats) are checked by the server tests and a socket.io-client script, not from Postman. Outside the app: `npx postman-cli collection run "postman/collections/Battleship API" -e postman/environments/localhost.environment.yaml -i health` runs the `health` folder against the local server, and `npx postman-cli collection lint "postman/collections/Battleship API"` checks the collection's files. The lint does not read the saved Socket.IO messages: `packages/server/test/postman.test.ts` does, inside `pnpm test`. It replays every `*.message.yaml` against the test server in the order the collection describes and checks each ack, refusals included, and closes a request's connection where the description says to disconnect it; a new or changed message needs a step there with the reply it should get, or the test fails ([ADR-0068](adr/0068-postman-replay-test.md)).
- **What lint checks:** the requests (`*.request.yaml`) and what they reference: the folder definitions (`.resources/definition.yaml`) and the saved examples (`*.example.yaml`). It never reads the saved Socket.IO messages (`*.message.yaml`, 21 of the collection's 34 files): a message with broken YAML, or a `messages:` path to a missing folder, still gets "No issues found". Messages are checked by `packages/server/test/postman.test.ts` instead, which sends each one, in order, against the test server inside `pnpm test` ([ADR-0068](adr/0068-postman-replay-test.md)).
- **Keeping it current:** an issue that adds a REST route or a Socket.IO event adds the matching request, message or listener to the collection, and each new Socket.IO message or request gets a replay step in `postman.test.ts`.
- **Format:** `pnpm format` writes the whole repo, `pnpm format:check` lists the files that differ (the CI step). In VS Code, the recommended Prettier extension formats on save (`.vscode/settings.json`).
- **Client tests:** `ng test` runs each spec file in its own module registry (`"isolate": true` in `angular.json`, against the builder's default), so a `vi.mock` in one file, such as `socket.io-client` in `game-socket.spec.ts`, holds whichever other files share its Vitest worker (ADR-0055). To check that a spec does not lean on its neighbours, run the suite with one worker (`test: { maxWorkers: 1 }` in `vitest-base.config.ts`, not committed). `src/testing/setup.ts` (`setupFiles` in `angular.json`) empties `localStorage` and `sessionStorage` before every test, since jsdom keeps them for a whole file and `SessionStore` reads them when it is created ([ADR-0069](adr/0069-session-storage-layout.md)); a spec simulates a reload by resetting `TestBed`, and a new tab by also clearing `sessionStorage`. Room ids and player secrets in client specs come from `src/testing/session-fixtures.ts`: `createRoomId(seed)` is core's `generateRoomId` over `createSeededRng(seed)`, and `createPlayerSecret()` is core's, the server's own generator; only deliberately malformed ids are derived by hand, from a generated one.
- **Before a pull request:** `pnpm verify` runs `format:check`, `lint`, `typecheck`, `test` and `build` on the whole workspace, stopping at the first failure.
- **Pre-commit hook:** `pnpm install` sets it up (root `prepare` script, Husky). lint-staged runs `prettier --write` on the staged files only and adds the result to the commit; unstaged changes are left alone. It does nothing else, so commits stay fast; `git commit --no-verify` skips it, and CI still checks the format.
- **Blame:** GitHub skips the commits in `.git-blame-ignore-revs`; for local `git blame`, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once. A formatting-only commit (a Prettier or plugin upgrade that changes its output) goes into the file, with its full SHA, and its pull request is merged with a merge commit so the SHA survives.
- **YAML schema:** SchemaStore's CrowdSec schema matches `**/collections/*/*.yaml`, so `.vscode/settings.json` maps `postman/**` to a permissive schema. Postman publishes no JSON schema for Collection v3; `postman-cli collection lint` checks the request files, and the saved messages are checked by sending them (Manual checks above).

## End-to-end journeys

Decision: [ADR-0089](adr/0089-e2e-time-control.md).

`packages/e2e` plays whole matches in Chromium with Playwright, against a local server and the production client bundle; never against Render. The unit and integration tests stay where they are: `pnpm test` and `pnpm verify` do not run the journeys, and CI runs them in a job of its own, `e2e`, next to `ci`.

| Journey (`packages/e2e/journeys/`) | What it plays                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full-match.spec.ts`               | Create, join, random fleets, battle to game over: the winner's and the loser's headings and reasons, and the loser's Enemy waters revealing the winner's whole fleet.                                                                                                                                                                     |
| `reload.spec.ts`                   | A reload mid-match: the same boards and heading come back, the opponent sees "Ada is back.", and both fire once more.                                                                                                                                                                                                                     |
| `leave-room.spec.ts`               | "Leave room" during placement: the leaver is on the home screen, the other player sees "Grace left the room, …" and the waiting screen.                                                                                                                                                                                                   |
| `disconnect-forfeit.spec.ts`       | A page closed mid-match: the opponent's banner and countdown, a clock skip of `DISCONNECT_FORFEIT_MS`, the win by forfeit, the loss on return.                                                                                                                                                                                            |
| `layout.spec.ts`                   | 320×568 (touch) and 1280×800, light and dark: no sideways scroll; "Leave room" in view at the top of the page; "Confirm fleet", under the placement board, whole once scrolled to; "Fire" at the top on the laptop, once scrolled to on the phone; the share dialog whole and not scrolling, with a stubbed `navigator.share` that fails. |

- **Run:** `pnpm e2e` at the root. Playwright starts the stack (`webServer` in `playwright.config.ts`), runs the journeys one at a time and stops the stack. Arguments go to Playwright: `pnpm e2e journeys/reload.spec.ts`, `pnpm e2e -g layout`, `pnpm e2e --repeat-each=3`, `pnpm e2e --headed`. A run takes about a minute, half of it the client build.
- **The stack:** `src/server.ts` runs the production `createServer` on a skip clock, with the clock's control route, on `127.0.0.1` (sources through `tsx`, nothing built). `src/client.ts` builds core and the production bundle with `SERVER_URL` at that server, into `packages/e2e/dist/client`, then serves it as an SPA (every path without a file gets `index.html`, as on Pages). The server allows only the client's origin.
- **Variables**, all optional:

  | Variable            | Default | What                                                                                                           |
  | ------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
  | `E2E_SERVER_PORT`   | `3900`  | The e2e server's port; the defaults clash with neither the dev pair (3000/4200), the worktrees' nor the hub's. |
  | `E2E_CLIENT_PORT`   | `4900`  | The port the bundle is served on, and the server's only allowed origin.                                        |
  | `E2E_CHROMIUM_PATH` | unset   | A Chromium to run instead of Playwright's own, e.g. `/usr/bin/chromium`.                                       |
  | `LOG_LEVEL`         | `warn`  | The e2e server's Pino level; `debug` logs every socket event (`stdout` shows as `[WebServer]` lines).          |
  | `CI`                | unset   | Set by GitHub Actions: `test.only` fails the run, and a stack already listening is not reused.                 |

- **Chromium:** `pnpm install` downloads no browser (Playwright has no install script). Either point `E2E_CHROMIUM_PATH` at the system Chromium (`E2E_CHROMIUM_PATH=/usr/bin/chromium pnpm e2e`; any recent version works), or download Playwright's own once per Playwright version: `pnpm --filter @battleship/e2e exec playwright install chromium` (into `~/.cache/ms-playwright`).
- **Keeping the stack up** between runs: start the two `webServer` commands yourself, from `packages/e2e`, in two terminals: `pnpm exec tsx --conditions=@battleship/source src/server.ts` and `pnpm exec tsx src/client.ts`. Outside CI, `pnpm e2e` reuses a stack already listening on its ports. Restart `client.ts` after a client change: it builds once, at start.
- **A failed journey:** the list output names the failed assertion and its locator. Each failure keeps a screenshot per page and a trace per player (`packages/e2e/test-results/<journey>/trace*.zip`): open one with `pnpm --filter @battleship/e2e exec playwright show-trace <path>`, which steps through every action with the page's DOM, console and network at that moment. `pnpm --filter @battleship/e2e exec playwright show-report` opens the HTML report of the last run. In CI, the `e2e` job uploads both folders as the `playwright-report` artifact when a journey fails; download it from the run's summary page and open the same way. `pnpm e2e --debug` steps through a journey in the Playwright inspector, `pnpm e2e --ui` in its UI mode.
- **Errors fail the journey:** every page error and console error of a player's context is collected, and the journey fails at its end with the list ("no page or console errors").
- **Adding a journey:** a new `journeys/<name>.spec.ts`, importing `test` and `expect` from `../src/fixtures.ts`.
  - Each player is `openPlayer(nickname, contextOptions)`: a browser context of their own, as a separate device; a viewport, touch or a color scheme go in the options. A new page in the same context is the same player (the session lives in the context's storage).
  - Selectors go by ARIA role and the client's `*_TEXT` constants, imported from its sources (`../../client/src/app/…/*.text`), never retyped. Shared steps live in `src/flows.ts` (`createRoom`, `joinRoom`, `confirmRandomFleet`, `startBattle`, `fire`, `shipCells`).
  - Only web-first assertions (`await expect(locator).toHave…`, `expect.poll`), no `waitForTimeout`.
  - A server timer is reached with `skipServerClock(ms)`, after the journey has seen the state the timer belongs to (the opponent shown as away, say). `page.clock` is only for a countdown the page runs by itself between snapshots, on that page only (ADR-0089).
  - A run opens about 8 rooms, which close within 5 minutes of real time; `MAX_ROOMS` (50) therefore allows `--repeat-each` up to 6 on one server.
- **The full match is short by construction:** Ada fires only at the 17 cells of Grace's fleet, read from Grace's own board ("B7, ship"), and Grace only at Ada's empty water, so the match ends after 33 shots, about 9 s on a laptop.
- **CI (`e2e` job):** `pnpm install --frozen-lockfile`, the Playwright browser cache (`~/.cache/ms-playwright`, keyed by the Playwright version), `playwright install --with-deps chromium` (the download is skipped on a cache hit; the system libraries are installed every time), `pnpm e2e`, and on failure the upload of the report and traces. The job is not part of the ruleset's required checks; that is the maintainer's call.
