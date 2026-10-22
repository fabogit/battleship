---
status: accepted
date: 2026-10-13
---

# ADR-0067: Client address behind the proxy

The logs name the client's address as the proxy in front of the server saw it, read from `X-Forwarded-For` with a fixed number of trusted hops: `TRUST_PROXY_HOPS` (0–5, default 0). Fastify gets it as a `trustProxy` function (`hop < TRUST_PROXY_HOPS`), so the `req.remoteAddress` of its request lines is `request.ip`; Socket.io, which does not read Fastify's setting, gets the same rule from `clientAddress` (`packages/server/src/client-address.ts`) for the `address` of "Socket connected". The chain is read from the right: the TCP peer, then the forwarded entries from the last one appended; each trusted hop moves one entry to the left. With 0 the header is ignored and the peer is logged, as before. At `debug` "Socket address chain" also logs the raw header and the peer, to calibrate the hop count. The rate limit stays per socket ([ADR-0066](0066-rate-limit-and-message-size.md)). Details in [Server: Logging](../server.md#logging) and [Deployment: Render](../deployment.md#render-service-battleship-server) (#24, #52 addendum).

## Considered options

- **Dropping the address from the logs** (the alternative the issue offered): behind Render's proxy it is always the proxy's address, so it carries nothing, and dropping it keeps personal data out of the logs altogether. Chosen against by the maintainer on 2026-10-13, to keep a way to tell clients apart when looking into abuse.
- **`trustProxy: true`:** Fastify would take the leftmost entry, which is whatever the client sent: Render appends to an incoming `X-Forwarded-For` rather than replacing it, so anyone could log any address. A hop count only trusts what the proxies wrote.
- **A list of trusted proxy addresses or ranges:** more precise than a count, but Render does not publish the addresses of its proxies, and they can change. The count is a deployment setting that can be corrected without a release.
- **Reading a provider header (`CF-Connecting-IP`, `True-Client-IP`):** Render's edge may set them, but Render does not document them, and a header the platform does not set is one a client can. `X-Forwarded-For` with a counted hop is the documented mechanism.
- **Hashing or truncating the address:** less personal data, but a hash of an IPv4 address is reversible by enumeration, and a truncated one stops telling clients apart, which is the reason to log it.

## Consequences

- **Privacy cost:** with `TRUST_PROXY_HOPS` set, every connection and HTTP request logs the client's public IP address, which is personal data under the GDPR. It sits in Render's logs for their retention period next to the `socketId`, and with it the room ids and nicknames of the same lines. The address is logged at `info` only in "Socket connected" and in Fastify's request lines; it is never sent to the other player or stored outside the logs.
- **Calibration:** Render does not document how many entries its proxies append. After the deploy, set `TRUST_PROXY_HOPS=1`, set `LOG_LEVEL=debug` for one connection, and compare the "Socket address chain" line with one's own public address: the hop count is the position of that address counted from the right of `forwardedFor`, the peer being 0. Then put `LOG_LEVEL` back ([Deployment: Render](../deployment.md#render-service-battleship-server)).
- A count that is too high logs an address the client wrote; one that is too low logs a proxy. Neither affects the game: nothing but the logs reads the address.
- A test pins the agreement between `clientAddress` and Fastify's `request.ip` for the same peer, header and hop count, so the socket lines and the request lines name the same client.

## Links

- Added on 2026-10-13 for server hardening ([#24](https://github.com/fabogit/battleship/issues/24)), from the M1 review addendum ([#52](https://github.com/fabogit/battleship/issues/52)).
- Amended on 2026-10-22 for the M2 review ([#53](https://github.com/fabogit/battleship/issues/53), F21): `TRUST_PROXY_HOPS` is `1` on Render. A WebSocket handshake crosses one proxy and plain HTTP three, so the count is calibrated from a browser's WebSocket handshake, and HTTP lines log Render's internal address ([ADR-0081](0081-one-proxy-hop-on-render.md)).
- Spec: [Server: Logging](../server.md#logging) · [Deployment: Render](../deployment.md#render-service-battleship-server)
- Related: [ADR-0019](0019-backend-deploy.md) (backend on Render), [ADR-0066](0066-rate-limit-and-message-size.md) (the rate limit stays per socket)
- Issues: [#24](https://github.com/fabogit/battleship/issues/24), [#52](https://github.com/fabogit/battleship/issues/52)
