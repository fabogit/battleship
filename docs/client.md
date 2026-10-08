# Client

Architecture of the Angular client, `packages/client`.

## Reactive model

* `provideZonelessChangeDetection()`, all components `OnPush`, state in Signals. Both are Angular 22 defaults (no `zone.js` dependency; components omit `changeDetection`); the provider is still listed explicitly in `app.config.ts`.
* Services use Angular 22's `@Service()` decorator (root-provided). The server URL is the `SERVER_URL` injection token, so tests can override it.
* **Services:**
  * `ServerWakeService` — cold-start polling ([Cold-start handling](#cold-start-handling)).
  * `SessionStore` — credential persistence ([Sessions & reconnection](server.md#sessions--reconnection)); the only module touching `localStorage` for sessions.
  * `GameSocketService` — Socket.io lifecycle, connection-status signal, typed emit-with-ack helper and server-event listeners ([Socket service](#socket-service)).
  * `GameStateService` — a read-only `snapshot` signal (`PlayerStateSnapshot | null`, `null` until the first `STATE`) plus `computed` views, and local countdown signals re-synced from snapshots ([Game state](#game-state)).
  * `I18nService` — `locale` signal (`it` | `en`), default from `navigator.language`, persisted in `localStorage`. Typed dictionaries where a missing key is a compile error.

### Socket service

* The socket is created with the service, idle (`autoConnect: false`): services can listen to server events before the server is awake, and `connect()` opens it once `ServerWakeService` reports the server up. `connect()` does nothing while the socket is connected or retrying, and reopens one that Socket.io gave up on.
* Transports: WebSocket first, then polling (`tryAllTransports: true`), so networks that block WebSocket still connect.
* `status` is one of `CONNECTION_STATUSES`: `disconnected` | `connecting` | `connected`. A drop or a `connect_error` while Socket.io keeps retrying stays `connecting`, a handshake refused by the origin check included. Only a socket that gave up is `disconnected`: closed by the client, disconnected by the server, or refused by a middleware error such as `PROTOCOL_MISMATCH`.
* `emitWithAck(event, payload)` accepts only the commands of `ClientToServerEvents`, each with its own payload type. It resolves with the command's `AckResponse`, or with `{ ok: false, error: TransportError }` (one of `TRANSPORT_ERRORS`) when the server did not reply. It never rejects and never queues a command while disconnected ([ADR-0035](adr/0035-command-acks.md)):
  * `NOT_CONNECTED`: the socket was not connected, so nothing was sent.
  * `NO_ACK`: no reply within `ACK_TIMEOUT_MS` (5 s), or the connection dropped first. The server may or may not have applied the command; the next `STATE` tells.
* `on(event, listener)` listens to a server event and returns the function that removes the listener; listeners survive reconnections.

### Game state

`GameStateService` listens to `STATE` and keeps the latest snapshot; `clear()` forgets it (e.g. after leaving the room). Views:

| View | Value |
|---|---|
| `phase` | The room's phase; `null` without a snapshot |
| `isMyTurn` | `IN_PROGRESS` and `currentTurn` is the receiver's seat, dice animation and pause included |
| `myFleet` | `{ ships, shots }`: the fleet without shots in `PLACEMENT`, the fleet and the incoming shots in `IN_PROGRESS`; `null` otherwise |
| `trackingBoard` | `{ ships, shots, draftTargets }`: in `IN_PROGRESS` the outgoing shots, the ships they sank and the turn's draft; in `GAME_OVER` the revealed opponent fleet without shots (the game-over snapshot carries none); `null` otherwise |
| `canPause` / `canResume` | `IN_PROGRESS` with the opponent disconnected, and the match running / paused: when `SET_PAUSED` is accepted |
| `hasWon` | `null` until `GAME_OVER`; `false` for a match without a winner |

Countdowns are in ms, `null` when the snapshot does not carry them ([ADR-0036](adr/0036-countdown-resync.md)):

| Countdown | Snapshot field | Frozen while |
|---|---|---|
| `turnRemainingMs` | `battle.turnRemainingMs` (`null` during the dice animation) | `battle.isPaused` |
| `placementRemainingMs` | `placement.remainingMs` | — |
| `startCountdownMs` | `placement.startCountdownMs` | — |
| `opponentForfeitRemainingMs` | `opponent.forfeitRemainingMs` | — (it runs regardless of pause) |

Each one is the value sent minus the time elapsed since the snapshot arrived (`performance.now()`), never below zero, and every snapshot re-syncs all of them. They tick every `COUNTDOWN_TICK_MS` (250 ms) while one is running, and stop when the longest reaches zero.

## Board & interaction

* The board is a CSS Grid of `<button>` cells rendered with `@for`. 2 × 100 cells is negligible for Signals + OnPush, and buttons give keyboard and screen-reader access for free.
* **Board grid** (`BoardGrid`, `shared/board-grid`): draws one board from its inputs and reports activated cells. It does not read `GameStateService` or the phase, so the same component serves placement, "My fleet" and "Enemy waters".
  * Inputs: `label` (the board's accessible name), `ships`, `shots`, `draftTargets`, `invalidPreview` and `isInteractive` (default `true`). `myFleet` and `trackingBoard` ([Game state](#game-state)) map onto them as they are.
  * Output: `cellActivate`, the `Coordinate` clicked or activated with Enter / Space. A board that is not interactive emits nothing; its cells stay focusable, so it can still be read cell by cell, and report `aria-disabled`.
  * Cell states (`CELL_STATES`, rendered as the button's `data-state`, which the styles select on): `empty`, `ship`, `miss`, `hit`, `sunk`. Every cell of a sunk ship is `sunk`: a cell is sunk when its shot is `SUNK` or when every cell of the ship drawn there was hit. Draft target and invalid preview are overlays on a state. Each state and overlay has its own shape (dot, cross, dark cross, ring, stripes), so colour is never the only cue.
* **Cell names** ([ADR-0040](adr/0040-cell-names.md)): rows are letters `A`–`J` from the top, columns numbers `1`–`10` from the left, so `B7` is `{ x: 6, y: 1 }`. Both axes are drawn around the board and hidden from assistive technologies, since every cell carries its name.
* **Accessible labels:** the cell name, then its state and overlays, comma-separated: "A2", "B7, hit", "F5, ship, invalid position", "J10, target". An untouched cell has no state word, so a cell of "Enemy waters" never claims to be empty. The words live in one typed object, `BOARD_GRID_TEXT`, for `I18nService` to provide per locale.
* **Keyboard** ([ADR-0041](adr/0041-board-keyboard-navigation.md)): each board is an ARIA `grid` with a single tab stop (roving `tabindex`): the cell last focused or clicked, `A1` at first.

  | Key | Moves focus to |
  |---|---|
  | Arrows | The next cell in that direction; nowhere at the edge (no wrapping) |
  | Home / End | The first / last cell of the row |
  | Ctrl (or ⌘) + Home / End | `A1` / `J10` |
  | Page Up / Page Down | The top / bottom cell of the column |
  | Enter / Space | — (activates the cell, as any button) |

  Other keys, and arrows with a modifier, keep their browser behaviour.
* **Cell size** ([ADR-0042](adr/0042-board-cell-size.md)): cells share the board's width, between 1.5 rem (24 px, WCAG 2.5.8) and 3 rem (48 px), and reach 2.75 rem (44 px) when the board is about 29 rem (466 px) wide. Phones in portrait get cells of about 1.9–2.3 rem (30–37 px) on 360–430 px viewports with 1 rem (16 px) gutters; the page never scrolls sideways.
* **Placement (touch-first):**
  * tap a ship in the dock → tap a cell to place it;
  * tap a placed ship to select it → "Rotate" / "Remove" buttons;
  * "Randomize" fills the whole fleet; "Confirm" / "Unlock" toggle the lock.
  * Drag & drop is an optional desktop enhancement.
  * Invalid positions are previewed client-side using the same `core` validators.
* **Targeting:** tap cells to toggle draft targets (synced via `UPDATE_TARGETS`), then "Fire". This also prevents accidental single taps on mobile.

## Layout

* Mobile: one board at a time with a toggle ("My fleet" / "Enemy waters"). During the player's turn it auto-focuses on enemy waters, otherwise on their own fleet.
* Desktop: both boards side by side.
* Room link shared via the Web Share API where available, with a copy-to-clipboard fallback.

## Cold-start handling

`ServerWakeService` handles the cold start:

1. On app start, `GET /health` until it answers, giving up after 90 s. Each attempt may use all the time left before giving up, since Render holds the request open until the instance is ready (step 2); failed attempts are spaced by an exponential backoff (500 ms doubling, cap 5 s). Giving up shows a retry button.
2. While Render serves its loading page the request fails as a CORS/parse error: treat any non-JSON or failed response as "still waking". *Measured (#8):* Render held `fetch` requests open until the instance was up rather than serving the loading page. With the original 10 s per-attempt timeout, two attempts were aborted and the third succeeded about 23 s after the page opened (24.4 s to a connected socket, three requests). *Re-measured after the fix (#51):* one request, held open by Render and answered with 200 after 22.8 s; connected after 23.2 s. The gain (about 1 s) is within noise: the fix removes the aborted requests rather than shortening the wait. The non-JSON handling stays as a fallback. The waking hint says a sleeping server "usually takes about half a minute".
3. UI shows a "Waking up the server…" state; nickname entry stays usable meanwhile.
4. The Socket.io connection is opened only after `/health` succeeds.

*A refused origin looks like a cold start (#51):* `/health` answers a foreign origin with a 403 without CORS headers ([D21](adr/0021-origin-policy.md)), which the browser cannot tell apart from Render's loading page, so the page shows "Waking up the server…" for 90 s and then "The server is not responding". A Socket.io handshake refused by `allowRequest` likewise keeps the socket active and retrying; only a middleware error (`next(err)`, used by #22 for `PROTOCOL_MISMATCH`/`SESSION_INVALID`) stops it. Telling "refused" apart from "retrying" is deferred to #25.
