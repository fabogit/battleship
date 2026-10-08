---
status: accepted
date: 2026-10-04
---

# ADR-0021: Origin policy

`ALLOWED_ORIGINS` is enforced, not just advertised: a foreign `Origin` gets `403` on HTTP and its Socket.io handshake (polling and WebSocket) is refused via `allowRequest`. Requests without an `Origin` header (health checks, CLI clients) are allowed.

## Considered options

- **Origin enforcement (403) vs. standard CORS vs. no check:** browsers block a foreign origin either way, but standard CORS still executes the HTTP request and does not apply to WebSocket upgrades at all, so any site could open sockets and spend the free tier's resources. Enforcing on both channels gives one rule, testable from outside a browser. The players' data is not at stake (no cookies; credentials travel in the handshake `auth`), so this guards resources, not sessions (D21).

## Links

- Added on 2026-10-04 during the Phase 0 server spike ([#3](https://github.com/fabogit/battleship/issues/3)).
- Spec: [Development: Monorepo topology](../development.md#monorepo-topology) · [Deployment: Backend (Render)](../deployment.md#backend-render) · [Client: Cold-start handling](../client.md#cold-start-handling)
