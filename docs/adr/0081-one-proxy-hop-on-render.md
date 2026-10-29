---
status: accepted
date: 2026-10-22
---

# ADR-0081: One trusted proxy hop on Render

[ADR-0067](0067-client-address.md) reads the logged client address `TRUST_PROXY_HOPS` entries from the right of `X-Forwarded-For`, and assumed that one count fits every request. Calibrating it on Render on 2026-10-22 (#53, addendum) showed that what Render appends depends on the transport. A WebSocket handshake gets one entry, the client's address, after whatever `X-Forwarded-For` the client sent. Plain HTTP, Socket.io polling included, gets three: the client's address, a Cloudflare address (`172.70.x`) and Render's internal load balancer (`10.30.x`). The TCP peer is always `127.0.0.1`.

`TRUST_PROXY_HOPS` is **`1`** on Render:

- Browsers try `websocket` first (`game-socket.ts`), so their "Socket connected" lines log the right address, and a made-up `X-Forwarded-For` never becomes the logged address.
- HTTP request lines (`/health`, any route) and the rare client that falls back to polling log Render's internal address instead. Only the logs read the address, and the rate limit stays per socket ([ADR-0066](0066-rate-limit-and-message-size.md)), so nothing else changes.

Details in [Deployment: Render](../deployment.md#render-service-battleship-server) (both paths, how to calibrate, how to check spoofing) and [Server: Logging](../server.md#logging).

## Considered options

- **`3`:** right for HTTP and polling, but on a WebSocket handshake it reads past the one entry Render appends, into what the client sent: a client sending `X-Forwarded-For: 198.51.100.7` would be logged as `198.51.100.7`. A spoofable address in the logs is worse than a proxy's.
- **A hop count per transport** (`clientAddress` with 1 for a WebSocket upgrade and 3 otherwise, Fastify `trustProxy` with 3): it would fix the HTTP and polling lines, but only in the logs, and it relies on how Render routes each path, which Render does not document and could change without notice. Dropped in the triage of #53; it comes back only if something besides the logs needs the address, such as a per-address cap (#113).
- **`0`** (the default, never set on Render until the calibration): every line logs `127.0.0.1`, which tells no clients apart, the reason ADR-0067 keeps the address.

## Consequences

- A per-address cap on sockets or rooms (#113, option (c) of #53 F5) is out while the count is `1`: every polling client would share Render's internal addresses, and a cap on WebSocket handshakes alone is dodged by forcing polling.
- Calibration reads the WebSocket path: the "Socket address chain" of a browser's WebSocket handshake. `curl` and polling exercise the HTTP path only. Spoofing is checked with a WebSocket-only client that sends a made-up `X-Forwarded-For`.
- Render's variables live only in its dashboard (the repo has no `render.yaml`), so the value is recorded in [Deployment: Environment variables](../deployment.md#render-service-battleship-server). `packages/server/.env.example` leaves it unset, since there is no proxy locally.
- The privacy cost of ADR-0067 applies: the WebSocket lines hold each client's public IP address.

## Links

- Added on 2026-10-22 for the M2 review ([#53](https://github.com/fabogit/battleship/issues/53), F21).
- Spec: [Deployment: Render](../deployment.md#render-service-battleship-server) · [Server: Logging](../server.md#logging)
- Amends: [ADR-0067](0067-client-address.md) (the hop count on Render, calibrated on the WebSocket path)
- Related: [ADR-0066](0066-rate-limit-and-message-size.md) (the rate limit stays per socket)
- Issues: [#53](https://github.com/fabogit/battleship/issues/53) · [#113](https://github.com/fabogit/battleship/issues/113) · [#24](https://github.com/fabogit/battleship/issues/24)
