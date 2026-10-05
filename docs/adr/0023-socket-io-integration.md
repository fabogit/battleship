---
status: accepted
date: 2026-10-04
---

# ADR-0023: Socket.io integration

Socket.io is attached directly to Fastify's HTTP server and exposed as `app.io` (Fastify decorator); no `fastify-socket.io` plugin. Shutdown waits for `SERVER_SHUTDOWN` to flush before closing.

## Considered options

* **`fastify-socket.io` plugin vs. direct attach:** the plugin's last release (5.1.0, Aug 2024) requires Fastify 4, has open Fastify 5 typing bugs, is reported abandoned, and its default shutdown disconnects sockets without flushing, which loses `SERVER_SHUTDOWN` for polling clients. It is ~30 lines; the one useful idea, decorating the instance with `io`, is kept (D23).

## Links

* Added on 2026-10-04 during the Phase 0 server spike ([#3](https://github.com/fabogit/battleship/issues/3)).
* Spec: [4.1 Backend (Render Free Web Service)](../deployment.md#41-backend-render-free-web-service)
