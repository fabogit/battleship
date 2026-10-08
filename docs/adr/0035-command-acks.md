---
status: accepted
date: 2026-10-07
---

# ADR-0035: Command acks

The client sends every command through `GameSocketService.emitWithAck(event, payload)`. Its event names, payloads and replies come from `ClientToServerEvents` in core (`CommandEvent`, `CommandPayload`, the ack's parameter), so the client declares no event or payload of its own. The promise never rejects. It resolves with the server's `AckResponse` as it is, or with a client-side `{ ok: false, error: TransportError }`, which has the same discriminant as `AckFailure`, so one `if (!result.ok)` branch handles both. `NOT_CONNECTED` means nothing was sent: while the socket is not connected the command is dropped, never queued in Socket.io's buffer. `NO_ACK` means the command was sent but no ack came within `ACK_TIMEOUT_MS` (5 s), or the connection dropped first (Socket.io reports both as an error to the ack). The client does not retry: after `NO_ACK` the next `STATE` shows whether the command took effect. Details in [Client: Socket service](../client.md#socket-service) (#16).

## Considered options

- **Rejecting on transport errors, as `socket.timeout().emitWithAck()` does:** callers would need both a `try` and an `ok` check, the rejection is untyped, and socket.io-client types that promise as `Promise<any>`.
- **Adding the transport errors to `ErrorCode` in core:** `ERROR_CODES` lists what the server can answer, and the protocol contract is closed ([ADR-0031](0031-payload-guard-strictness.md)). A separate client-side union keeps them apart; the UI maps both unions to messages.
- **Letting Socket.io buffer commands while disconnected:** a buffered `FIRE` or `UPDATE_PLACEMENT` would reach the server after the reconnection, against a state the player no longer sees. Meanwhile the player sees the reconnecting state (#25), and the first `STATE` after the reconnection shows the real one.
- **Retrying (`retries` option):** commands are not idempotent (`UPDATE_RULES` bumps `rulesVersion`), and the server does not deduplicate.
- **A method per command (`createRoom()`, `fire()`, …):** thirteen methods to keep in step with the contract by hand, for no extra type safety.
- **Using Socket.io's typed `Socket<ServerToClientEvents, ClientToServerEvents>` inside the service:** its `emit` and `on` resolve payload types through conditional types that a generic event name cannot narrow, so the generic helper would need casts that hide real mismatches. The socket keeps Socket.io's untyped event maps, and the three methods that reach it (`emitWithAck`, `on`, the private `send`) carry the contract's types.
- **A shorter or longer timeout:** the server acks right after a synchronous transition, so a healthy round trip takes well under a second, even over polling. 5 s keeps a spinner from hanging on a dead connection without failing slow mobile networks.

## Consequences

- The UI needs a message for every `ErrorCode` and for both `TransportError`s.
- After `NO_ACK` a command may or may not have been applied: the UI waits for `STATE` instead of resending.
- The Phase 0 `ECHO` goes through the same path; `echo()` turns a failure into a thrown `Error` for the connection check page until #17 retires it.

## Links

- Added on 2026-10-07 for the client game services ([#16](https://github.com/fabogit/battleship/issues/16)).
- Spec: [Client: Socket service](../client.md#socket-service) · [Protocol: Client → server](../protocol.md#client--server)
- Related: [ADR-0015](0015-protocol-shape.md) (snapshots as the source of truth), [ADR-0031](0031-payload-guard-strictness.md) (the closed contract)
- Issues: [#16](https://github.com/fabogit/battleship/issues/16)
