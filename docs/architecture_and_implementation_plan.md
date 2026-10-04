# Battleship Architecture Decision Record (ADR) & Implementation Specification

## Status

**ACCEPTED** — Revision 4 (2026-10-05): D25–D26 added during the Phase 0 client bootstrap (#4). Revision 3 (2026-10-04): D21–D24 added during the Phase 0 server spike (#3). Revision 2 (2026-10-03) followed the requirements analysis session.

---

## 1. Context & Constraints

### 1.1 Product Scope (v1)

* **Game Model:** Real-time 1v1 classic Battleship on a 10×10 board.
* **Out of scope for v1:** team play (dropped entirely, no abstractions designed for it), random matchmaking, spectators, chat, native app.
* **Room access:** private rooms only, shared via link (`/r/<roomId>`).
* **Platforms:** desktop and mobile browsers (Android/iOS). Mobile is a first-class target, not an afterthought. A native app (likely a Capacitor wrapper of the Angular client) may follow later; v1 must not preclude it.
* **Languages:** Italian and English (runtime-switchable i18n).
* **Players** choose a nickname before creating or joining a room.

### 1.2 Design Principle: Good Faith

Players are assumed to be cooperating to play a match. The room is **symmetric**: there is no host, no kick, and either player may edit the rules. Conflicts are resolved by mutual confirmation, not by privilege. Hard limits exist only where needed to bound server memory (timeouts, TTLs, caps), not to police behaviour.

### 1.3 Technical Constraints

* **Cost:** strict zero-cost operational budget. No paid tiers.
* **State lifecycle:** ephemeral, in-memory only. No database.
* **Network topology:** server-authoritative WebSockets. The server holds the full game state; each client only receives its own fleet and the shot history (fog-of-war).
* **Stack:**
  * Package manager: `pnpm` workspaces, Node.js 24 (pinned via `packageManager` field and `.nvmrc`).
  * All packages are ESM (`"type": "module"`).
  * Shared domain core: pure TypeScript, zero runtime dependencies (`packages/core`).
  * Backend: Fastify + Socket.io (`packages/server`) on Render Free.
  * Frontend: Angular 22, zoneless + Signals + OnPush (`packages/client`) on Cloudflare Pages.

### 1.4 Hosting Facts That Shape the Design (Render Free)

Verified against Render documentation:

* The service spins down after **15 minutes without inbound traffic**; inbound WebSocket messages count, so Socket.io heartbeats keep the server awake while any client is connected.
* Spin-up takes **about one minute**, during which Render serves its own HTML loading page (no CORS headers).
* Render **may restart a free service at any time**, and every deploy restarts it. **All in-flight matches are lost on restart. This is an accepted risk.**
* Single instance only: no sticky sessions or Socket.io adapter needed.
* If no client is connected, the service will spin down after 15 minutes and lose every room, so in-memory TTLs longer than that are meaningless for empty rooms.

---

## 2. Decision Summary

| # | Topic | Decision |
|---|-------|----------|
| D1 | Team play | Out of scope. Model is strictly 1v1. |
| D2 | Who starts | Server-side dice roll (d6 each, re-roll ties), repeated every match. |
| D3 | Rules editing | Both players may edit. Any edit resets both confirmations. Match proceeds when both confirm the same `rulesVersion`. |
| D4 | Stale-confirmation protection | Monotonic `rulesVersion` counter (replaces FNV-1a hash). |
| D5 | Placement sync | Incremental: the client sends its full draft layout on every change. Ships are movable until the player confirms; confirmation can be undone until the match starts. |
| D6 | Placement completion | When both have confirmed, a start countdown of `min(5 s, remaining placement time)` runs; either player can unlock during it. At the placement deadline the server auto-completes and locks unconfirmed fleets. |
| D7 | Random placement | "Randomize" button generates a full valid fleet client-side (shared `core` generator); the player can still adjust it. |
| D8 | Disconnection in battle | Match auto-pauses. The connected player can resume/re-pause. Pause freezes the turn timer. The disconnected player forfeits after 5 minutes regardless of pause state. |
| D9 | AFK | Fixed limit of 3 consecutive timed-out turns (not negotiable). Both players AFK → match ends with no winner. |
| D10 | Salvo vs. extra turn | `salvoMode` and `consecutiveTurnOnHit` are mutually exclusive. |
| D11 | Game over | Opponent fleet is revealed. A "Surrender" action exists. |
| D12 | Rematch | Each player chooses `SAME_RULES` / `CHANGE_RULES` / `LEAVE`. `CHANGE_RULES` wins over `SAME_RULES`. |
| D13 | Session persistence | `localStorage`, one entry per room with expiry, behind a `SessionStore` abstraction (swappable for native app). |
| D14 | Duplicate sessions | Latest connection wins; the previous socket is told `SESSION_REPLACED` and disconnected. |
| D15 | Protocol shape | Snapshot-driven: the server pushes a full per-player `STATE` snapshot after every change; a few extra events exist purely for animations. |
| D16 | Payload validation | Hand-written runtime guards in `core` (zero dependencies), applied by the server to every inbound message. |
| D17 | Protocol versioning | `PROTOCOL_VERSION` checked in the Socket.io handshake; mismatched clients are told to reload. |
| D18 | i18n | Small in-house, typed, signal-based translation service (no build-per-locale). |
| D19 | Backend deploy | Native Node build on Render with filtered install (no Docker in v1). Docker multi-stage image with `pnpm deploy` kept as fallback. |
| D20 | Delivery | Phase 0 deploy spike, then vertical slices (see §8). |
| D21 | Origin policy | `ALLOWED_ORIGINS` is enforced, not just advertised: a foreign `Origin` gets `403` on HTTP and its Socket.io handshake (polling and WebSocket) is refused via `allowRequest`. Requests without an `Origin` header (health checks, CLI clients) are allowed. |
| D22 | Workspace type resolution | For now dependents read `@battleship/core` through its `dist/` typings, so CI runs `build` before `typecheck`/`lint`. Planned switch to a source export condition (live types) once the client consumes core: #46. |
| D23 | Socket.io integration | Socket.io is attached directly to Fastify's HTTP server and exposed as `app.io` (Fastify decorator); no `fastify-socket.io` plugin. Shutdown waits for `SERVER_SHUTDOWN` to flush before closing. |
| D24 | Preview origins | `ALLOWED_ORIGINS` accepts single-label wildcards (`https://*.<project>.pages.dev`) so Cloudflare Pages previews work without touching Render (implemented in #5). |
| D25 | Client server URL | The server URL lives in Angular environment files: `environment.ts` holds the Render URL for every Pages build (production and previews share one server), `environment.development.ts` points `ng serve`/`ng test` at `http://localhost:3000`. No Pages environment variable. |
| D26 | Dependency install scripts | pnpm 11 fails the install on unreviewed dependency build scripts, so `pnpm-workspace.yaml` lists them in `allowBuilds`: only `esbuild` runs its script; `lmdb`, `msgpackr-extract` and `@parcel/watcher` (Angular build tooling) use their prebuilt binaries. New entries are reviewed when they appear. |

### 2.1 Alternatives Considered

* **Rules hash (FNV-1a) vs. version counter:** same protection; the hash requires identical canonical serialization on client and server. Counter chosen (D4).
* **`sessionStorage` vs. `localStorage`:** `sessionStorage` is per-tab; on mobile, re-opening the room link (e.g. from WhatsApp) opens a new tab and the player could not rejoin their own match. `localStorage` chosen (D13).
* **"First connection wins" vs. "latest wins":** on mobile a backgrounded tab leaves a zombie socket that the server only detects after the heartbeat timeout (~45 s); "first wins" would lock the returning player out. Latest wins chosen (D14).
* **Event deltas vs. snapshots:** state is tiny (< 5 KB); snapshots make reconnection and client state trivial and remove a whole class of desync bugs (D15).
* **`@angular/localize` vs. runtime i18n:** `@angular/localize` produces one build per locale, which complicates the Cloudflare Pages output and prevents in-app switching. Runtime chosen (D18).
* **Dockerfile vs. native build on Render:** Docker gives reproducibility and portability to other hosts, but a pnpm monorepo image needs `pnpm deploy` and extra config, and builds are slower on the free tier. Native build is simpler and sufficient as long as the install is filtered to the server and its dependencies; Docker remains the fallback if Phase 0 hits a blocker or we need to leave Render (D19).
* **Layer-by-layer roadmap vs. vertical slices:** layer-by-layer only yields a playable game at the end and tests the client/server contract late (D20).
* **Origin enforcement (403) vs. standard CORS vs. no check:** browsers block a foreign origin either way, but standard CORS still executes the HTTP request and does not apply to WebSocket upgrades at all, so any site could open sockets and spend the free tier's resources. Enforcing on both channels gives one rule, testable from outside a browser. The players' data is not at stake (no cookies; credentials travel in the handshake `auth`), so this guards resources, not sessions (D21).
* **`dist/` typings vs. source export condition vs. TypeScript project references:** `dist/` needs no config and tests the same artefact Render runs, but core must be rebuilt after every change. A `"@battleship/source"` condition removes the rebuild at the cost of configuring every consumer (tsconfig, Vitest, Angular) while keeping production builds on `dist/`. Project references (`tsc -b`) add `composite`/build-info constraints that Angular CLI and Vitest ignore anyway. `dist/` now, source condition when the client lands (D22, #46).
* **`fastify-socket.io` plugin vs. direct attach:** the plugin's last release (5.1.0, Aug 2024) requires Fastify 4, has open Fastify 5 typing bugs, is reported abandoned, and its default shutdown disconnects sockets without flushing, which loses `SERVER_SHUTDOWN` for polling clients. It is ~30 lines; the one useful idea, decorating the instance with `io`, is kept (D23).
* **Client server URL — environment files vs. a Pages environment variable:** a `SERVER_URL` variable passed to `ng build --define` would let the dashboard change the URL without a commit, but the value never differs between Pages environments (previews talk to the production server, D24), a missing variable would only show up at runtime, and local and CI builds would need it too. Environment files keep the URL in the repo, typed, and give `ng serve` its local default for free (D25).
* **Dependency install scripts — allow all vs. deny all vs. per package:** allowing every script (`dangerouslyAllowAllBuilds`) gives up the supply-chain protection pnpm 11 enables by default; denying all would also skip esbuild's binary check. The native packages Angular pulls in ship prebuilt binaries as optional dependencies, so their scripts are only a compile-from-source fallback (D26).
* **Cloudflare Pages preview origins — manual list vs. CI automation vs. wildcard:** every preview commit gets a new `<hash>.<project>.pages.dev`; Render applies env var changes only on a new deploy. Pushing each preview origin to Render via its API would restart the single shared server (production included) on every branch push, need a Render API key in GitHub secrets, and grow the list forever. A manual list only covers stable branch aliases. A wildcard limited to one label under our own `pages.dev` project is safe, since only our project can publish there, and needs no redeploys (D24).

---

## 3. Monorepo Topology

```text
battleship/
├── package.json                   # Root scripts, "packageManager": "pnpm@<pinned>"
├── pnpm-workspace.yaml            # packages: ['packages/*']
├── tsconfig.base.json             # Strict compiler options
├── .nvmrc                         # 24
├── docs/
│   └── architecture_and_implementation_plan.md
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
    │   │   ├── server.ts              # Fastify bootstrap, /health, origin policy, Socket.io (app.io), graceful shutdown
    │   │   └── index.ts               # Entry point: listen, SIGTERM/SIGINT → app.close()
    │   ├── scripts/echo-client.ts     # Smoke test against a running server (Phase 0)
    │   └── test/                      # Room unit tests (fake clock) + socket integration tests
    │
    └── client/                    # Angular 22, @angular/build (esbuild), unit tests on Vitest + jsdom
        └── src/
            ├── environments/      # serverUrl per build: production (Render) / development (localhost), D25
            └── app/
                ├── core/          # GameSocketService, GameStateService, SessionStore, I18nService, ServerWakeService
                ├── features/      # home (nickname, create/join), lobby (waiting + rules), placement, battle, game-over
                │                  # (Phase 0: connection-check test page, replaced by home in Phase 1)
                └── shared/        # Board grid, timer, dice, modal, language switch
```

---

## 4. Deployment

### 4.1 Backend (Render Free Web Service)

* **Root directory:** repository root (`packages/server` depends on `packages/core` via workspace link).
* **Build command:**
  ```bash
  corepack enable && pnpm install --frozen-lockfile --filter @battleship/server... && pnpm --filter @battleship/server... build
  ```
  (`...` selects the package plus its workspace dependencies, so the server build never installs Angular.)
* **Start command:** `node packages/server/dist/index.js`
* **Environment:** `PORT` (provided by Render), `ALLOWED_ORIGINS` (comma-separated; Cloudflare Pages production origin plus a `https://*.<project>.pages.dev` wildcard for previews, D24). Malformed values fail the startup.
* **`GET /health`** → `200 { status: "ok", uptime: number }` (`HealthResponse` in `core/protocol.ts`).
* **CORS:** configured twice — `@fastify/cors` for HTTP routes and the `cors` option of the Socket.io server. Both read `ALLOWED_ORIGINS`. A foreign `Origin` is rejected outright: `403` on HTTP (an `onRequest` hook, before any route) and a refused Socket.io handshake (`allowRequest`), since CORS headers alone do not stop WebSocket upgrades (D21).
* **Graceful shutdown:** on `SIGTERM` the server emits `SERVER_SHUTDOWN` to every socket before closing, so clients can say "the server restarted, the match was lost" instead of looping on reconnect. It waits (up to 3 s) for each connection to flush and close first: a long-polling client only receives the message on its next poll (D23).

### 4.2 Frontend (Cloudflare Pages)

* **Root directory:** repository root.
* **Build command:**
  ```bash
  corepack enable && pnpm install --frozen-lockfile --filter @battleship/client... && pnpm --filter @battleship/client... build
  ```
* **Output directory:** `packages/client/dist/client/browser`
* **Environment:** `NODE_VERSION=24`; the server URL is fixed at build time by Angular environment files (D25), so Pages needs no other variable.
* **SPA routing:** Pages serves `index.html` for unknown paths when no `404.html` exists, so `/r/<roomId>` deep links work.
* **Transport:** the client connects to an `https://` server URL, i.e. `wss://` (Pages is HTTPS; `ws://` is blocked as mixed content). Socket.io tries WebSocket first and falls back to HTTPS long-polling on networks that block upgrades.

### 4.3 Cold-Start Handling (client `ServerWakeService`)

1. On app start, `GET /health` with exponential backoff (500 ms doubling, cap 5 s between attempts, give up after 90 s; each attempt times out after 10 s). Giving up shows a retry button.
2. While Render serves its loading page the request fails as a CORS/parse error: treat any non-JSON or failed response as "still waking".
3. UI shows a "Waking up the server…" state; nickname entry stays usable meanwhile.
4. The Socket.io connection is opened only after `/health` succeeds.

---

## 5. Domain Specification (`packages/core`)

### 5.1 Constants (`constants.ts`)

| Constant | Value | Notes |
|---|---|---|
| `PROTOCOL_VERSION` | `1` | Bumped on any breaking protocol change |
| `BOARD_SIZE` | `10` | |
| `PLACEMENT_TIME_LIMIT_MS` | `60_000` | Re-evaluate after mobile playtesting |
| `START_COUNTDOWN_MS` | `5_000` | Capped by remaining placement time |
| `DICE_ANIMATION_MS` | `3_000` | Delay before the first turn timer starts |
| `MAX_CONSECUTIVE_AFK_TURNS` | `3` | Fixed, not negotiable |
| `DISCONNECT_FORFEIT_MS` | `300_000` | Max absence of a seated player, in any phase |
| `EMPTY_ROOM_TTL_MS` | `600_000` | Room with no connected player; must stay < Render's 15 min spin-down |
| `GAME_OVER_TTL_MS` | `600_000` | Room idle in `GAME_OVER` without a rematch agreement |
| `NICKNAME_MAX_LENGTH` | `20` | Trimmed, non-empty, rendered as text only |
| `MAX_ROOMS` | `500` | New rooms rejected with `SERVER_FULL` above this |
| `RATE_LIMIT_EVENTS_PER_SECOND` | `20` | Per socket |
| `SESSION_STORE_TTL_MS` | `86_400_000` | Client-side expiry of stored credentials |

### 5.2 Domain Types (`types.ts`)

```typescript
export type Coordinate = {
  readonly x: number; // integer, 0 ≤ x < BOARD_SIZE
  readonly y: number; // integer, 0 ≤ y < BOARD_SIZE
};

export type ShipType = 'CARRIER' | 'BATTLESHIP' | 'CRUISER' | 'SUBMARINE' | 'DESTROYER';

export const SHIP_LENGTH: Readonly<Record<ShipType, number>> = {
  CARRIER: 5,
  BATTLESHIP: 4,
  CRUISER: 3,
  SUBMARINE: 3,
  DESTROYER: 2,
};

export const FLEET: readonly ShipType[] = ['CARRIER', 'BATTLESHIP', 'CRUISER', 'SUBMARINE', 'DESTROYER'];

export type Orientation = 'HORIZONTAL' | 'VERTICAL';

/** What the client sends: the server never trusts client-computed coordinates. */
export interface ShipPlacement {
  readonly type: ShipType;
  readonly start: Coordinate;
  readonly orientation: Orientation;
}

/** Derived by core from a ShipPlacement. */
export interface PlacedShip extends ShipPlacement {
  readonly coordinates: readonly Coordinate[];
}

export type TurnTimeLimitSeconds = 15 | 30 | 60 | 120;
export type TimeoutAction = 'AUTO_RANDOM_SHOT' | 'PASS_TURN';

/** Invariant: salvoMode && consecutiveTurnOnHit is invalid. */
export interface GameRules {
  readonly consecutiveTurnOnHit: boolean;
  readonly allowAdjacentShips: boolean;
  readonly turnTimeLimitSeconds: TurnTimeLimitSeconds;
  readonly salvoMode: boolean;
  readonly timeoutAction: TimeoutAction;
}

export type ShotOutcome = 'MISS' | 'HIT' | 'SUNK';

export interface ShotResult {
  readonly coordinate: Coordinate;
  readonly outcome: ShotOutcome;
  readonly sunkShip?: PlacedShip; // present only when outcome === 'SUNK'
}

export type Seat = 'P1' | 'P2';

export type RoomPhase =
  | 'WAITING_FOR_OPPONENT'
  | 'RULES_NEGOTIATION'
  | 'PLACEMENT'
  | 'IN_PROGRESS'
  | 'GAME_OVER';

export type GameOverReason =
  | 'FLEET_DESTROYED'
  | 'SURRENDER'
  | 'AFK_FORFEIT'
  | 'DISCONNECT_FORFEIT'
  | 'ABANDONED'; // both players AFK — no winner

export type RematchChoice = 'SAME_RULES' | 'CHANGE_RULES' | 'LEAVE';
```

### 5.3 Rules (`rules.ts`)

* `DEFAULT_RULES`: no extra turn on hit, adjacency not allowed, 60 s turns, no salvo, `AUTO_RANDOM_SHOT`.
* `validateRules(rules)`: checks enum membership and the salvo/extra-turn exclusivity. The client UI disables the incompatible toggle; the server still rejects with `INVALID_RULES`.

### 5.4 Placement (`placement.ts`)

* **Bounds:** every derived coordinate lies on the board.
* **Linearity & length:** derived from `start` + `orientation` + `SHIP_LENGTH[type]`.
* **Uniqueness:** each `ShipType` appears at most once (exactly once for a complete fleet).
* **Overlap:** no cell shared between ships.
* **Adjacency:** when `allowAdjacentShips === false`, no two ships may touch horizontally, vertically or diagonally.
* **Partial layouts** (0–5 ships) are valid drafts if each ship satisfies the rules above.
* **`generateRandomFleet(rules, rng)`:** backtracking search producing a complete valid fleet. Used by the client "Randomize" button and by the server as a fallback.
* **`completeFleet(draft, rules, rng)`:** keeps the draft's ships and places the missing ones. If the remaining ships cannot fit (possible when adjacency is forbidden), it discards the draft and calls `generateRandomFleet`.
* All randomness goes through an injected `Rng` so tests are deterministic with a fixed seed.

### 5.5 Shot Engine (`engine.ts`)

* **Unified model:** every turn fires a list of targets. Standard mode is a salvo of size 1.
* **Shots allowed per turn:** standard → `1`; salvo → `min(shooter's surviving ships, opponent's unshot cells)`.
* **Target constraints:** exact count, on-board, no duplicates within the turn, never previously targeted.
* **Resolution:** targets resolve in order; `SUNK` results carry the full sunk ship; victory is checked after the turn.
* **Next turn:**
  * `consecutiveTurnOnHit` (standard mode only): any `HIT`/`SUNK`, including from an auto shot, gives the same player another turn with a fresh timer.
  * Otherwise the turn passes to the opponent.
* **Auto shots:** uniformly random among unshot cells (no hunting AI).

---

## 6. Server Behaviour (`packages/server`)

### 6.1 Room State Machine

```text
   CREATE_ROOM
        │
        ▼
┌──────────────────────┐  opponent leaves / forfeits seat (any pre-game phase)
│ WAITING_FOR_OPPONENT │◄──────────────────────────────────────────────┐
└──────────┬───────────┘                                               │
           │ JOIN_ROOM                                                 │
           ▼                                                           │
┌──────────────────────┐  both confirm same rulesVersion               │
│  RULES_NEGOTIATION   ├──────────────────┐                            │
└──────────▲───────────┘                  ▼                            │
           │                   ┌──────────────────────┐                │
           │                   │      PLACEMENT       ├────────────────┤
           │                   │  draft ↔ confirmed   │                │
           │                   │  start countdown     │                │
           │                   └──────────┬───────────┘                │
           │                              │ countdown ends or deadline │
           │                              │ → dice roll                │
           │                              ▼                            │
           │                   ┌──────────────────────┐                │
           │                   │     IN_PROGRESS      │                │
           │                   │  running ↔ paused    │                │
           │                   └──────────┬───────────┘                │
           │                              │ fleet destroyed / surrender│
           │                              │ / AFK / disconnect forfeit │
           │                              ▼                            │
           │  any CHANGE_RULES ┌──────────────────────┐  one LEAVE     │
           └───────────────────┤      GAME_OVER       ├────────────────┘
                               └──────────┬───────────┘
                                          │ both SAME_RULES
                                          └──────────► PLACEMENT
```

### 6.2 Transition Rules

#### Room creation & joining

* `CREATE_ROOM` creates the room in `WAITING_FOR_OPPONENT` with `DEFAULT_RULES` and seats the creator as `P1`.
* `JOIN_ROOM` seats the joiner as `P2` and moves to `RULES_NEGOTIATION`.
  * Joining a full room → `ROOM_FULL`; unknown room (or lost after a restart) → `ROOM_NOT_FOUND`.
* A seated player who disconnected keeps the seat for `DISCONNECT_FORFEIT_MS`. This covers the common mobile case: the creator switches app to share the link and the friend joins meanwhile.

#### Rules negotiation

* Either player may send `UPDATE_RULES`. The server validates, stores, increments `rulesVersion`, and clears both confirmations.
* `CONFIRM_RULES { rulesVersion }` with a stale version → `STALE_RULES`.
* When both have confirmed the current version → `PLACEMENT`.
* There is no negotiation timer (good faith). Idle rooms are bounded by the TTLs.

#### Placement

* The deadline is `PLACEMENT_TIME_LIMIT_MS` from phase entry.
* `UPDATE_PLACEMENT { ships }` replaces the player's draft. It is rejected while confirmed (`PLACEMENT_LOCKED`) or invalid (`INVALID_PLACEMENT`).
* `CONFIRM_PLACEMENT` requires a complete valid fleet; `UNLOCK_PLACEMENT` reverts to draft.
* When both are confirmed, a start countdown runs for `min(START_COUNTDOWN_MS, time to deadline)`. An unlock cancels it; a new double confirmation restarts it, still capped by the deadline.
* At the deadline, every unconfirmed fleet is completed with `completeFleet` and locked.
* On phase end: server dice roll → `DICE_ROLLED` → `IN_PROGRESS`. The first turn timer starts after `DICE_ANIMATION_MS`.
* If a player is disconnected at that moment, the match starts paused (see below).

#### Turns

* The active player edits a draft with `UPDATE_TARGETS { targets }` (any count up to the allowance, freely changeable) and commits with `FIRE { targets }`.
* On turn timeout:
  * `AUTO_RANDOM_SHOT`: keep the valid draft targets, fill the rest randomly, resolve.
  * `PASS_TURN`: discard the draft, pass the turn.
* Every timeout increments that player's AFK counter; any `FIRE` resets it.

#### AFK

* When a player's counter reaches `MAX_CONSECUTIVE_AFK_TURNS`:
  * If the opponent's counter is ≥ `MAX_CONSECUTIVE_AFK_TURNS − 1` (both idle) → `GAME_OVER`, reason `ABANDONED`, no winner.
  * Otherwise → `GAME_OVER`, reason `AFK_FORFEIT`, the opponent wins.

#### Disconnection & pause (`IN_PROGRESS`)

* When a player's socket drops, the match auto-pauses. A paused match freezes the turn timer with its remaining time.
* `SET_PAUSED { paused }` is accepted **only from the connected player while the opponent is disconnected**.
* While unpaused, timers run normally: the absent player's turns time out and count as AFK.
* The forfeit clock (`DISCONNECT_FORFEIT_MS`, from the moment of disconnection) runs regardless of pause. On expiry → `GAME_OVER`, reason `DISCONNECT_FORFEIT`.
* On reconnection the match resumes automatically with the remaining turn time.

#### Disconnection in other phases

* The seat is kept for `DISCONNECT_FORFEIT_MS`.
* Placement timers keep running; auto-completion handles the absent player.
* On seat expiry, the player is removed and the other player returns to `WAITING_FOR_OPPONENT`. Rules are kept; confirmations and fleets are cleared.

#### Leaving

* `LEAVE_ROOM` in a pre-game phase frees the seat immediately (same effect as seat expiry).
* In `IN_PROGRESS`, `SURRENDER` and `LEAVE_ROOM` both end the match as `SURRENDER`.

#### Game over & rematch

* The snapshot reveals the opponent's fleet.
* Each player sends `REMATCH_CHOICE`; a player may change their choice until resolution.
  * Both `SAME_RULES` → `PLACEMENT`.
  * Both chosen and at least one `CHANGE_RULES` → `RULES_NEGOTIATION`, with the previous rules pre-filled and confirmations cleared.
  * Any `LEAVE` → the leaver is removed; the other player goes to `WAITING_FOR_OPPONENT` (same room link).

#### Room lifecycle

* A room with no connected player is destroyed after `EMPTY_ROOM_TTL_MS`.
* A room in `GAME_OVER` is destroyed after `GAME_OVER_TTL_MS` without a resolved rematch.

### 6.3 Sessions & Reconnection

* **Credentials:** on `CREATE_ROOM` / `JOIN_ROOM` the server returns a `playerSecret` (`crypto.randomUUID()`). Seats (`P1`/`P2`) are public; secrets are never sent to the other player.
* **Room ids:** 8 characters of a URL-safe, unambiguous alphabet, generated with `crypto`.
* **Client storage:** `SessionStore` writes `{ roomId, playerSecret, expiresAt }` under a per-room key in `localStorage`.
* **Handshake:** the Socket.io client passes `auth` as a callback, re-evaluated on every reconnect attempt: `{ protocolVersion, session?: { roomId, playerSecret } }`.
  * Version mismatch → `connect_error` with `PROTOCOL_MISMATCH`; the client shows "please reload".
  * Valid session → the socket is bound to the seat and receives a `STATE` snapshot immediately.
  * Invalid or expired session → `SESSION_INVALID`; the client drops the stored credentials and returns to the home screen with an explanation.
* **Latest connection wins:** binding a new socket to a seat emits `SESSION_REPLACED` to the previous socket and disconnects it.
* **Mobile:** app switching kills sockets frequently. Reconnection is a primary flow and must be covered by integration tests.

### 6.4 Hardening

* Every inbound payload passes the `core/validation.ts` guards before reaching room logic; failures → `INVALID_PAYLOAD`.
* Socket.io `maxHttpBufferSize` is set to a small value (e.g. 16 KB).
* Per-socket rate limit (`RATE_LIMIT_EVENTS_PER_SECOND`) → `RATE_LIMITED`.
* `MAX_ROOMS` cap → `SERVER_FULL`.

### 6.5 Testability

* Room logic is a pure transition function `(state, command, now) → { state, effects }`; timers are scheduled effects executed by a thin `scheduler.ts` over an injectable `Clock`.
* The `Rng` is injected (dice, auto shots, auto placement).
* Unit tests drive rooms with a fake clock and a fixed seed. Integration tests use real `socket.io-client` instances against an in-process server.

---

## 7. Protocol Contract (`packages/core/src/protocol.ts`)

### 7.1 Client → Server

All commands use Socket.io acknowledgements: `ack({ ok: true, ...data } | { ok: false, error: ErrorCode })`.

| Event | Payload | Ack data | Phase |
|---|---|---|---|
| `CREATE_ROOM` | `{ nickname }` | `{ roomId, playerSecret }` | — |
| `JOIN_ROOM` | `{ roomId, nickname }` | `{ playerSecret }` | `WAITING_FOR_OPPONENT` |
| `UPDATE_RULES` | `{ rules: GameRules }` | `{ rulesVersion }` | `RULES_NEGOTIATION` |
| `CONFIRM_RULES` | `{ rulesVersion }` | — | `RULES_NEGOTIATION` |
| `UPDATE_PLACEMENT` | `{ ships: ShipPlacement[] }` | — | `PLACEMENT` |
| `CONFIRM_PLACEMENT` | `{}` | — | `PLACEMENT` |
| `UNLOCK_PLACEMENT` | `{}` | — | `PLACEMENT` |
| `UPDATE_TARGETS` | `{ targets: Coordinate[] }` | — | `IN_PROGRESS`, own turn |
| `FIRE` | `{ targets: Coordinate[] }` | — | `IN_PROGRESS`, own turn |
| `SET_PAUSED` | `{ paused: boolean }` | — | `IN_PROGRESS`, opponent disconnected |
| `SURRENDER` | `{}` | — | `IN_PROGRESS` |
| `REMATCH_CHOICE` | `{ choice: RematchChoice }` | — | `GAME_OVER` |
| `LEAVE_ROOM` | `{}` | — | any |
| `ECHO` | any | `{ payload, protocolVersion }` | Phase 0 connectivity check only |

### 7.2 Server → Client

| Event | Payload | Purpose |
|---|---|---|
| `STATE` | `PlayerStateSnapshot` | Source of truth; sent after every state change and on (re)connect |
| `SHOT_RESOLVED` | `{ shooter: Seat, results: ShotResult[] }` | Animation/sound only (also reflected in `STATE`) |
| `DICE_ROLLED` | `{ rolls: { P1: number, P2: number }[], starter: Seat }` | Dice animation, including re-rolls |
| `SESSION_REPLACED` | `{}` | This socket was superseded by a newer one |
| `SERVER_SHUTDOWN` | `{}` | Server restarting; the match is lost |

### 7.3 Snapshot

```typescript
export interface PlayerView {
  readonly seat: Seat;
  readonly nickname: string;
  readonly connected: boolean;
  readonly forfeitRemainingMs: number | null; // set while disconnected
}

export interface PlayerStateSnapshot {
  readonly roomId: string;
  readonly phase: RoomPhase;
  readonly me: PlayerView;
  readonly opponent: PlayerView | null;
  readonly rules: GameRules;
  readonly rulesVersion: number;
  readonly rulesConfirmed: { readonly me: boolean; readonly opponent: boolean };
  readonly placement: {
    readonly myShips: readonly PlacedShip[];
    readonly myConfirmed: boolean;
    readonly opponentConfirmed: boolean;
    readonly remainingMs: number;
    readonly startCountdownMs: number | null;
  } | null;
  readonly battle: {
    readonly myShips: readonly PlacedShip[];
    readonly incomingShots: readonly ShotResult[]; // opponent's shots on my board
    readonly outgoingShots: readonly ShotResult[]; // my shots on opponent's board
    readonly currentTurn: Seat;
    readonly shotsAllowed: number;
    readonly myDraftTargets: readonly Coordinate[];
    readonly turnRemainingMs: number | null; // null before the first turn starts
    readonly paused: boolean;
    readonly afkCount: { readonly me: number; readonly opponent: number };
  } | null;
  readonly gameOver: {
    readonly winner: Seat | null;
    readonly reason: GameOverReason;
    readonly opponentShips: readonly PlacedShip[];
    readonly rematch: { readonly me: RematchChoice | null; readonly opponent: RematchChoice | null };
  } | null;
}
```

Timers are sent as **remaining milliseconds** (not absolute timestamps) to avoid client clock skew. The client counts down locally and re-syncs on every snapshot.

### 7.4 Error Codes

`PROTOCOL_MISMATCH`, `INVALID_PAYLOAD`, `RATE_LIMITED`, `SERVER_FULL`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `SESSION_INVALID`, `WRONG_PHASE`, `NOT_YOUR_TURN`, `NOT_ALLOWED`, `INVALID_RULES`, `STALE_RULES`, `INVALID_PLACEMENT`, `PLACEMENT_LOCKED`, `INVALID_TARGETS`.

---

## 8. Client Architecture (`packages/client`)

### 8.1 Reactive Model

* `provideZonelessChangeDetection()`, all components `OnPush`, state in Signals. Both are Angular 22 defaults (no `zone.js` dependency; components omit `changeDetection`); the provider is still listed explicitly in `app.config.ts`.
* Services use Angular 22's `@Service()` decorator (root-provided). The server URL is the `SERVER_URL` injection token, so tests can override it.
* **Services:**
  * `ServerWakeService` — cold-start polling (§4.3).
  * `SessionStore` — credential persistence (§6.3); the only module touching `localStorage` for sessions.
  * `GameSocketService` — Socket.io lifecycle, connection-status signal, typed emit-with-ack helpers.
  * `GameStateService` — `snapshot = signal<PlayerStateSnapshot | null>(null)` plus `computed` views (`isMyTurn`, `myFleet`, `trackingBoard`, `canPause`…), and local countdown signals re-synced from snapshots.
  * `I18nService` — `locale` signal (`it` | `en`), default from `navigator.language`, persisted in `localStorage`. Typed dictionaries where a missing key is a compile error.

### 8.2 Board & Interaction

* The board is a CSS Grid of `<button>` cells rendered with `@for`. 2 × 100 cells is negligible for Signals + OnPush, and buttons give keyboard and screen-reader access for free.
* **Placement (touch-first):**
  * tap a ship in the dock → tap a cell to place it;
  * tap a placed ship to select it → "Rotate" / "Remove" buttons;
  * "Randomize" fills the whole fleet; "Confirm" / "Unlock" toggle the lock.
  * Drag & drop is an optional desktop enhancement.
  * Invalid positions are previewed client-side using the same `core` validators.
* **Targeting:** tap cells to toggle draft targets (synced via `UPDATE_TARGETS`), then "Fire". This also prevents accidental single taps on mobile.

### 8.3 Layout

* Mobile: one board at a time with a toggle ("My fleet" / "Enemy waters"). During the player's turn it auto-focuses on enemy waters, otherwise on their own fleet.
* Desktop: both boards side by side.
* Room link shared via the Web Share API where available, with a copy-to-clipboard fallback.

---

## 9. Implementation Roadmap

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

---

## 10. Open Risks

* **Restart = lost matches** (Render free restarts and deploys). Accepted; mitigated only by `SERVER_SHUTDOWN` messaging.
* **Platform versions:** Node 24 / pnpm support on the Render and Cloudflare Pages build images must be confirmed in Phase 0.
* **Angular 22 ecosystem compatibility:** `socket.io-client` 4.8 bundles with `@angular/build` (esbuild) without CommonJS warnings (#4). `@angular/build` 22 requires Node `^24.15`, so the Pages image must resolve `NODE_VERSION=24` to a recent 24.x (#6).
* **TypeScript held at 6.0.x:** the workspace pins `typescript ~6.0.3` in the pnpm catalog because Angular 22 (`@angular/compiler-cli`) and `typescript-eslint` both require `>=6.0 <6.1`. TypeScript 7 (native compiler) is preferred; upgrade once both accept it. Splitting versions per package was rejected, since lint already ties every package to 6.0.x.
* **Placement time on mobile:** 60 s may be tight with touch placement; tune after playtesting.
* **Empty rooms cannot outlive Render's 15-minute spin-down**, regardless of TTL settings.
