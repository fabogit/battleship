# Development

## Monorepo topology

```text
battleship/
├── package.json                   # Root scripts, "packageManager": "pnpm@<pinned>", "engines" (Node range)
├── pnpm-workspace.yaml            # packages, allowBuilds (D26), catalogs (default + angular), engineStrict
├── tsconfig.base.json             # Strict compiler options
├── eslint.config.js               # Flat config for every package (typescript-eslint strictTypeChecked)
├── .editorconfig
├── .nvmrc                         # 24
├── .github/workflows/ci.yml       # install → typecheck → lint → test → build, required on main
├── .vscode/                       # Debug configurations, YAML schema override for postman/ (D28)
├── .postman/                      # Postman Native Git workspace link (D28)
├── postman/                       # Collection v3 YAML + localhost environment (Local tooling, D28)
├── docs/                          # Specification, one document per topic
│   └── adr/                       # One file per decision (ADR-0001 …)
└── packages/
    ├── core/                      # Pure domain + protocol contract (zero runtime deps)
    │   ├── src/
    │   │   ├── constants.ts       # Board size, timings, limits, PROTOCOL_VERSION
    │   │   ├── types.ts           # Domain entities
    │   │   ├── rules.ts           # Defaults, rules validation
    │   │   ├── placement.ts       # Layout validation, random generation, completion
    │   │   ├── engine.ts          # Shot resolution, shot count, victory check
    │   │   ├── random.ts          # Rng interface + seedable implementation
    │   │   ├── protocol.ts        # Socket.io event maps, snapshot, error codes
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
    │   ├── .env.example               # Local PORT / ALLOWED_ORIGINS: copy to .env (Local tooling)
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

| Consumer | Setting | Notes |
|----------|---------|-------|
| `tsc` typecheck, ESLint `projectService` | `customConditions: ["@battleship/source"]` in the dependent's `tsconfig.json` | Server `tsconfig.build.json` does not extend `tsconfig.json`, so `pnpm build` still reads `dist/` and `packages/server/dist` holds only server code. |
| Server tests (Vitest) | `ssr.resolve.conditions` in `vitest.config.ts` | Node tests run in Vite's SSR environment; the list replaces Vite's server defaults (`module`, `node`, `development\|production`), so it repeats them. |
| Client app build and `ng serve` | `conditions` in the `development` build configuration of `angular.json` | Replaces Angular's defaults, so it repeats `module` and `development`. Angular passes the same list to its TypeScript compiler as `customConditions`, overriding the tsconfig, so types and bundle always agree. The `production` configuration has no `conditions` and bundles `dist/`; the filtered Pages build compiles core first ([Frontend (Cloudflare Pages)](deployment.md#frontend-cloudflare-pages)). |
| `ng serve` prebundling | `prebundle.exclude: ["@battleship/core"]` on the `serve` target | Prebundled packages are resolved by Vite, which ignores the build `conditions`; excluded, core is bundled by esbuild with them and rebuilt on every change. |
| Client tests (`ng test`) | `runnerConfig: "vitest-base.config.ts"` with `resolve.conditions` | The unit-test build leaves packages external and Vitest resolves them at runtime; its conditions are added to the builder's own. |
| `ngc`/`tsc` typecheck of the client | `customConditions` in `packages/client/tsconfig.json` | Inherited by `tsconfig.app.json` and `tsconfig.spec.json`. |

A new consumer of core (or a new workspace package consumed the same way) needs the matching row before it works on a checkout without `dist/`.

## Local tooling

Decision: [ADR-0028](adr/0028-local-tooling.md).

* **Run:** `cp packages/server/.env.example packages/server/.env` (allows `http://localhost:4200`; without it the server refuses to start, [Backend (Render)](deployment.md#backend-render)), then `pnpm build && pnpm --filter @battleship/server start` (`start` runs `dist/`, so rebuild after every change) and `pnpm --filter @battleship/client start`.
* **Debug (VS Code, `.vscode/launch.json`):** `Server` (builds core and server, runs `dist/` with source maps in the integrated terminal), `Client` (`ng serve` + Chrome/Chromium), `Server + Client`, `Server tests: current file` (Vitest), `Client tests: current file` (`ng test --debug`, attach on port 9229).
* **Manual checks (Postman):** open the repo folder in the Postman desktop app (Native Git, free plan) and select the `localhost` environment (`baseUrl`, `allowedOrigin`). The `health` folder runs in the Collection Runner; Socket.IO requests (`ECHO`, `ECHO — foreign origin`) are sent by hand. Outside the app: `npx postman-cli collection lint "postman/collections/Battleship API"` and `npx postman-cli collection run "postman/collections/Battleship API" -e postman/environments/localhost.environment.yaml -i health`.
* **Keeping it current:** an issue that adds a REST route or a Socket.IO event adds the matching request, message or listener to the collection.
* **YAML schema:** SchemaStore's CrowdSec schema matches `**/collections/*/*.yaml`, so `.vscode/settings.json` maps `postman/**` to a permissive schema. Postman publishes no JSON schema for Collection v3; `postman-cli collection lint` is the real check.
