# Client

Architecture of the Angular client, `packages/client`.

## Reactive model

* `provideZonelessChangeDetection()`, all components `OnPush`, state in Signals. Both are Angular 22 defaults (no `zone.js` dependency; components omit `changeDetection`); the provider is still listed explicitly in `app.config.ts`.
* Services use Angular 22's `@Service()` decorator (root-provided). The server URL is the `SERVER_URL` injection token, so tests can override it.
* **Services:**
  * `ServerWakeService` — cold-start polling ([Cold-start handling](#cold-start-handling)).
  * `SessionStore` — credential persistence ([Sessions & reconnection](server.md#sessions--reconnection)); the only module touching `localStorage` for sessions.
  * `GameSocketService` — Socket.io lifecycle, connection-status signal, typed emit-with-ack helpers.
  * `GameStateService` — `snapshot = signal<PlayerStateSnapshot | null>(null)` plus `computed` views (`isMyTurn`, `myFleet`, `trackingBoard`, `canPause`…), and local countdown signals re-synced from snapshots.
  * `I18nService` — `locale` signal (`it` | `en`), default from `navigator.language`, persisted in `localStorage`. Typed dictionaries where a missing key is a compile error.

## Board & interaction

* The board is a CSS Grid of `<button>` cells rendered with `@for`. 2 × 100 cells is negligible for Signals + OnPush, and buttons give keyboard and screen-reader access for free.
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
