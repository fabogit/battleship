---
status: accepted
date: 2026-10-04
---

# ADR-0023: Socket.io integration

Socket.io is attached directly to Fastify's HTTP server and exposed as `app.io` (Fastify decorator); no `fastify-socket.io` plugin. The attachment is an internal plugin, `packages/server/src/plugins/socket-io.ts`, wrapped with `fastify-plugin` (`name: 'socket-io'`) so that the decorator and its hooks reach the root instance: it creates the server, applies the origin policy in `allowRequest`, decorates `app.io`, logs connections, and owns the shutdown (`preClose` flushes `SERVER_SHUTDOWN`, `onClose` closes Socket.io). Event handlers, and later rate limiting (#24), are separate `fastify-plugin` plugins that declare `dependencies: ['socket-io']`; `createServer` only composes plugins and routes. Details in [Server: Plugins](../server.md#plugins).

## Considered options

- **`fastify-socket.io` plugin vs. direct attach:** the plugin's last release (5.1.0, Aug 2024) requires Fastify 4, has open Fastify 5 typing bugs, is reported abandoned, and its default shutdown disconnects sockets without flushing, which loses `SERVER_SHUTDOWN` for polling clients. It is ~30 lines; the one useful idea, decorating the instance with `io`, is kept (D23).
- **Keeping the wiring inline in `createServer`** (as in #3): fine for one `ECHO` handler, but handlers and rate limiting would all grow one function. Plugins with declared dependencies make the order explicit, and Fastify refuses to boot when a dependency is missing.
- **Plain encapsulated plugins** (without `fastify-plugin`): the `io` decorator and the shutdown hooks would stay inside the plugin's own context, invisible to the handlers and to `app.close()` on the root instance.

## Links

- Added on 2026-10-04 during the Phase 0 server spike ([#3](https://github.com/fabogit/battleship/issues/3)); the internal plugin added on 2026-10-08 with the socket handlers ([#15](https://github.com/fabogit/battleship/issues/15)).
- Spec: [Deployment: Backend (Render)](../deployment.md#backend-render) · [Server: Plugins](../server.md#plugins)
