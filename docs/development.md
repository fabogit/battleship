# Development

## Monorepo topology

```text
battleship/
├── package.json                   # Root scripts, "packageManager": "pnpm@<pinned>", "engines" (Node range)
├── pnpm-workspace.yaml            # packages, allowBuilds (D26), catalogs (default + angular), engineStrict
├── tsconfig.base.json             # Strict compiler options
├── eslint.config.js               # Flat config for every package (typescript-eslint strictTypeChecked)
├── .prettierrc                    # Prettier options; Angular parser for client templates (D44)
├── .prettierignore                # Files written by tools: lockfiles, postman/, .postman/
├── .husky/                        # pre-commit hook: lint-staged, prettier --write on the staged files (D44)
├── .git-blame-ignore-revs         # Formatting-only commits, skipped by git blame
├── .editorconfig
├── .nvmrc                         # 24
├── .github/workflows/ci.yml       # install → format:check → typecheck → lint → test → build, required on main
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
    │   │   ├── rules.ts           # Defaults, rules validation
    │   │   ├── placement.ts       # Layout validation, random generation, completion
    │   │   ├── engine.ts          # Shot resolution, shot count, victory check
    │   │   ├── random.ts          # Rng interface, seeded (tests) and crypto (production) implementations
    │   │   ├── protocol.ts        # Socket.io event maps and names, snapshot, error codes
    │   │   ├── validation.ts      # Runtime guards for every client→server payload
    │   │   └── index.ts
    │   └── test/                  # Vitest
    │
    ├── server/
    │   ├── src/
    │   │   ├── room/
    │   │   │   ├── room.ts            # Pure transition logic (state, command, now) → (state, effects)
    │   │   │   ├── room-manager.ts    # Room registry, TTL sweeps, capacity cap
    │   │   │   └── scheduler.ts       # Thin timer shell over an injectable Clock
    │   │   ├── socket/
    │   │   │   ├── connection.ts      # Handshake (auth, protocol version), session binding
    │   │   │   ├── handlers.ts        # Validate → dispatch to room → emit snapshots
    │   │   │   └── rate-limit.ts
    │   │   ├── config.ts              # PORT / ALLOWED_ORIGINS parsing, validated at startup
    │   │   ├── origins.ts             # Origin matcher: exact origins + https://*.<domain> wildcards (D21, D24)
    │   │   ├── server.ts              # Fastify bootstrap, /health, origin policy, Socket.io (app.io), graceful shutdown
    │   │   ├── shutdown.ts            # SIGTERM/SIGINT → app.close(); repeats ignored, 10 s deadline (D27)
    │   │   └── index.ts               # Entry point: config, server, signal handling, listen
    │   ├── scripts/echo-client.ts     # Smoke test against a running server (Phase 0)
    │   ├── .env.example               # Local PORT / ALLOWED_ORIGINS / LOG_*: copy to .env (Local tooling)
    │   └── test/                      # Room unit tests (fake clock) + socket integration tests
    │
    └── client/                    # Angular 22, @angular/build (esbuild), unit tests on Vitest + jsdom
        ├── vitest-base.config.ts  # `ng test` runnerConfig: resolves core from source (D22)
        └── src/
            ├── environments/      # serverUrl per build: production (Render) / development (localhost), D25
            └── app/
                ├── core/          # GameSocketService, GameStateService, SessionStore, I18nService, ServerWakeService
                ├── features/      # home (nickname, create/join), lobby (waiting + rules), placement, battle, game-over
                │                  # (Phase 0: connection-check test page, replaced by home in Phase 1)
                └── shared/        # Board grid, timer, dice, modal, language switch
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

A new consumer of core (or a new workspace package consumed the same way) needs the matching row before it works on a checkout without `dist/`.

## Code conventions

Decisions: [ADR-0043](adr/0043-named-constants.md), [ADR-0044](adr/0044-code-formatter.md).

- **Formatting:** Prettier owns layout in every TypeScript, template, CSS, JSON, YAML and Markdown file (`.prettierrc`: `printWidth: 120`, `singleQuote: true`, `trailingComma: "all"`); ESLint checks correctness only. The pre-commit hook formats staged files and CI fails on any file `pnpm format:check` flags. Markdown keeps its prose lines and its code blocks as written; files written by tools are listed in `.prettierignore`.

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
  - Sets shared by server and client live in core and are exported from `@battleship/core`. A set one package owns stays there: `CELL_STATES`, `CONNECTION_STATUSES`, `TRANSPORT_ERRORS` and `WAKE_STATUSES` in the client, `LOG_FORMATS` in the server.
  - A runtime list is `Object.values(…)`, in declaration order; a guard checks membership against the values, never the keys.

- **Pinned values:** one test per object writes its values out. Renaming a key is a refactor; changing a value changes the protocol (and `PROTOCOL_VERSION`), the logs or the styles.
- **Left as literals:** the `ok` discriminant of acks and results; object keys and property names (`boards.P1`); third-party values (Pino levels, Socket.io and DOM event names, OS signals, keyboard keys); log messages and UI text; comments and the pinning tests.
- **New values:** a new set, or a new value of an existing one, follows the same pattern. A new protocol value also goes into its pinning test and into [Protocol](protocol.md).

## Local tooling

Decisions: [ADR-0028](adr/0028-local-tooling.md), [ADR-0029](adr/0029-watch-mode.md), [ADR-0044](adr/0044-code-formatter.md).

- **Run:** `cp packages/server/.env.example packages/server/.env` (allows `http://localhost:4200` and sets `LOG_FORMAT=pretty` and `LOG_LEVEL=debug`, so the terminal shows every request and socket event in readable form, [Logging](server.md#logging); without it the server refuses to start, [Backend (Render)](deployment.md#backend-render)), then `pnpm dev`: the server restarts on every change to its own or core's sources (`tsx watch`, sources read through `@battleship/source`), the client rebuilds and reloads (`ng serve`), and every output line is prefixed with its package. Set the server port in `.env`, not in the shell: `ng serve` reads `PORT` too. Ctrl+C kills the server partway through its shutdown (ADR-0029). To run what production runs: `pnpm build && pnpm --filter @battleship/server start` (`start` runs `dist/`, so rebuild after every change).
- **Debug (VS Code, `.vscode/launch.json`):** `Server` (builds core and server, runs `dist/` with source maps in the integrated terminal), `Client` (`ng serve` + Chrome/Chromium), `Server + Client`, `Server tests: current file` (Vitest), `Client tests: current file` (`ng test --debug`, attach on port 9229).
- **Manual checks (Postman):** open the repo folder in the Postman desktop app (Native Git, free plan) and select the `localhost` environment (`baseUrl`, `allowedOrigin`). The `health` folder runs in the Collection Runner; Socket.IO requests (`ECHO`, `ECHO — foreign origin`) are sent by hand. Outside the app: `npx postman-cli collection lint "postman/collections/Battleship API"` and `npx postman-cli collection run "postman/collections/Battleship API" -e postman/environments/localhost.environment.yaml -i health`.
- **Keeping it current:** an issue that adds a REST route or a Socket.IO event adds the matching request, message or listener to the collection.
- **Format:** `pnpm format` writes the whole repo, `pnpm format:check` lists the files that differ (the CI step). In VS Code, the recommended Prettier extension formats on save (`.vscode/settings.json`).
- **Before a pull request:** `pnpm verify` runs `format:check`, `lint`, `typecheck`, `test` and `build` on the whole workspace, stopping at the first failure.
- **Pre-commit hook:** `pnpm install` sets it up (root `prepare` script, Husky). lint-staged runs `prettier --write` on the staged files only and adds the result to the commit; unstaged changes are left alone. It does nothing else, so commits stay fast; `git commit --no-verify` skips it, and CI still checks the format.
- **Blame:** GitHub skips the commits in `.git-blame-ignore-revs`; for local `git blame`, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once. A formatting-only commit (a Prettier upgrade that changes its output) goes into the file, with its full SHA, and its pull request is merged with a merge commit so the SHA survives.
- **YAML schema:** SchemaStore's CrowdSec schema matches `**/collections/*/*.yaml`, so `.vscode/settings.json` maps `postman/**` to a permissive schema. Postman publishes no JSON schema for Collection v3; `postman-cli collection lint` is the real check.
