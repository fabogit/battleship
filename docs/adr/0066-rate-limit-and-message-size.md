---
status: accepted
date: 2026-10-13
---

# ADR-0066: Rate limit and message size

Each socket gets its own limiter (`packages/server/src/rate-limiter.ts`), installed by the `rate-limit` plugin as a Socket.io middleware (`socket.use`), so it runs before every event listener. It is a sliding window over the server's `Clock` ([ADR-0065](0065-clock-and-room-timers.md)): an event is admitted when fewer than `RATE_LIMIT_EVENTS_PER_SECOND` (20) admitted events from the same socket fall in the second before it. Every inbound event counts, `ECHO` and malformed commands included. A refused event is dropped before any guard or handler sees it; its ack, if the client asked for one, gets `{ ok: false, error: 'RATE_LIMITED' }`, and refused events do not count towards the window. The socket stays connected. The first refusal of a run is logged at `info` ("Socket rate limited"); the next ones are not, until an event is admitted again. Inbound messages are capped at `MAX_MESSAGE_BYTES` (16 KiB) through Socket.io's `maxHttpBufferSize`: a larger one closes the connection before anything parses it. Details in [Server: Hardening](../server.md#hardening) (#24).

## Considered options

- **A token bucket** (20 tokens, refilled at 20 per second): the common choice, but it admits a burst of 20 and then 20 more within the same second, 40 in a one-second window, which is not what "more than 20 events per second" says. The window keeps the last 20 admitted times per socket, 20 numbers, and holds to the constant's meaning in every window.
- **A fixed window** (a counter reset at each whole second): cheaper still, but 20 events at the end of one second and 20 at the start of the next pass within 100 ms.
- **Counting refused events:** a flood would keep a client locked out for as long as it floods, but a legitimate client that taps a little too fast would stay refused while its own retries fill the window. Not counting them lets it through as soon as the window allows; a flooding socket gets nothing either way.
- **Disconnecting a socket that keeps flooding:** the client would reconnect with its session and start over ([ADR-0063](0063-session-rebinding.md)), so a disconnection costs the flooder nothing. Dropping the events costs the server one array lookup each, and the logs show the run once.
- **Limiting per IP address:** behind Render's proxy every socket has the same peer address, and the forwarded one is only as trustworthy as the hop count ([ADR-0067](0067-client-address.md)); two players on one home network would also share a budget. The issue keeps the limit per socket.
- **A limit per command type, or exempting `ECHO`:** finer, but nothing in the game sends 20 events a second legitimately. One budget per socket is enough to bound a misbehaving client.
- **Keeping Socket.io's default 1 MB buffer:** the guards already bound arrays before walking them ([Protocol: Payload validation](../protocol.md#payload-validation)), but parsing a megabyte of JSON still costs memory and time on a single free instance. The largest valid command, a full `UPDATE_PLACEMENT`, is under 400 bytes; 16 KiB leaves room for growth (salvo targets, longer rules) without letting a client make the server parse megabytes.

## Consequences

- The client already maps `RATE_LIMITED` to a message in every view that sends commands ("Too many taps at once. Wait a moment and try again."). A full match played in a browser stays well under the limit; the local-stack check of #24 played one end to end.
- An integration test that sends more than 20 events from one socket must advance its `FakeClock` between them ([ADR-0065](0065-clock-and-room-timers.md)).
- An oversized message closes the connection without an ack; Socket.io reports `transport close` or `transport error` to the client, which reconnects like after any drop. Only a modified client can send one: the real client's largest message is far below the cap.
- The polling transport shares the cap: Engine.IO tells the client the server's `maxPayload` at the handshake, and the client splits its batches to fit.

## Links

- Added on 2026-10-13 for server hardening ([#24](https://github.com/fabogit/battleship/issues/24)).
- Spec: [Server: Hardening](../server.md#hardening) · [Protocol: Error codes](../protocol.md#error-codes) · [Domain: Constants](../domain.md#constants)
- Related: [ADR-0016](0016-payload-validation.md) (payload validation), [ADR-0048](0048-echo-smoke-check.md) (`ECHO` counts like any event)
- Issues: [#24](https://github.com/fabogit/battleship/issues/24)
