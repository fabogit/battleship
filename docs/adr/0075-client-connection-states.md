---
status: accepted
date: 2026-10-15
---

# ADR-0075: Client connection states

`GameSocketService` reports, next to `status` (`disconnected` | `connecting` | `connected`), three signals that tell the player what is going on:

- **`closeReason`**, one of `CLOSE_REASONS`: why the server ended or refused the last connection. `PROTOCOL_MISMATCH` and `REFUSED` (any other middleware code) come from a `connect_error` that stops Socket.io (`active` false); `SESSION_REPLACED` and `SERVER_SHUTDOWN` from the server event of that name, which arrives just before the server's disconnect; `SERVER_DISCONNECT` from an `io server disconnect` with no event before it. It clears on `connect()` and on the next successful handshake. `SESSION_INVALID` for a sent session is not a close reason: the client drops the session and connects again at once ([ADR-0070](0070-client-handshake-refusals.md)).
- **`retryError`**: the message of the last `connect_error` while Socket.io keeps retrying, such as `xhr poll error` for a handshake refused by the origin check (#51 F9). It clears once connected.
- **`isReconnecting`**: whether the attempt in progress follows a drop of an open connection, as opposed to a first connection or a reconnection the client asked for (`reconnect()`).

The views use them in three places:

- **Status line** (`ServerStatus`, in the shell): "Connection lost. Reconnecting…" after a drop, with "Your seat is kept for 3 minutes after you lose the connection." when the tab holds a seat; "The last attempt failed (xhr poll error). Trying again…" under "Connecting…" or "Reconnecting…" while Socket.io retries; for a socket that gave up, a sentence per close reason: "Refused by the server: this page is out of date.", "Disconnected: this match is open in another tab or on another device.", "The server refused the connection." or "Disconnected from the server.". "Try again" follows only when retrying may help (`REFUSED`, `SERVER_DISCONNECT`, an unreachable server) and polls `/health` again before connecting. The line stays a polite live region.
- **Connection screens** (`ConnectionScreen`, in the shell): for `PROTOCOL_MISMATCH` and `SESSION_REPLACED` the shell shows a screen instead of the page, since nothing on the page works until the player acts. "Please reload the page" has a "Reload" button; "This match is open somewhere else" has "Play here", which connects again: the handshake sends this tab's session, the server binds it here and sends `SESSION_REPLACED` to the other tab or device ([ADR-0063](0063-session-rebinding.md)). The page comes back as soon as the close reason clears.
- **Restart after `SERVER_SHUTDOWN`** (#51 F15): when the server announced a restart and disconnected the socket, `ServerStatus` polls `/health` again with `wake({ isForced: true })`, which polls even after the server answered once, and connects when the next instance answers. Meanwhile the line reads "The server is restarting…" with "You are reconnected as soon as it is back.". The new instance does not know the room, so the handshake ends in `SESSION_INVALID` and the room page explains it ([ADR-0076](0076-refused-seat-explanation.md)). When the transport closes before the server's disconnect is read, Socket.io retries on its own and the same line shows.

Details in [Client: Connection states](../client.md#connection-states) (#25).

## Considered options

- **A new `CONNECTION_STATUSES` value per case (`refused`, `replaced`, `reconnecting`):** every view that only asks "can I send a command?" would have to list them. `status` keeps the three states the commands care about, and the reason sits beside it.
- **The `SESSION_REPLACED` screen as a room view:** the tab may be on the home page when it happens, and its "Create room" button would wait for a connection that never comes. A shell screen works on every page. Its "Play here" is the only action: the status line has no retry for this reason, so the page never shows two buttons that do the same thing.
- **Retrying `PROTOCOL_MISMATCH` or `SESSION_REPLACED` from the status line:** a mismatch is refused again until the page loads a newer client, and an automatic retry after a replacement would steal the seat back and forth between two tabs.
- **Resetting `ServerWakeService` to `idle` on any server-side disconnect (the other F15 option):** a `SESSION_REPLACED` disconnect is also server-side, and a poll there would only delay "Play here". A forced `wake()` is called only where a restart is known.
- **Delaying the "Reconnecting…" line to hide short drops:** Socket.io reconnects in about a second after a short drop, and the line is a small change in the header; hiding the drop would also hide the first second of a long one.
- **Translating Socket.io's error messages:** they are technical and few (`xhr poll error`, `websocket error`, `timeout`); the sentence around them is translated, the message is shown as it is, so a player can quote it.

## Consequences

- A tab opened before a deploy that changes `PROTOCOL_VERSION` shows "Please reload the page" as soon as it reconnects to the new server. Cloudflare Pages may still serve the old client for a short while after Render has deployed, so the screen says to wait a minute if it comes back.
- `ServerWakeService.wake()` takes `{ isForced }`; `ServerStatus` uses it for the retry button and after `SERVER_SHUTDOWN`.
- Measured on the local stack: a `SIGINT` delivers `SERVER_SHUTDOWN` and the server disconnect, and the tab shows "The server is restarting…" until the server is back. On a Render deploy the event is not delivered ([Deployment: Backend](../deployment.md#backend-render)); the tab shows "Connection lost. Reconnecting…" and then the restart explanation of [ADR-0076](0076-refused-seat-explanation.md).

## Links

- Added on 2026-10-15 for the connection-state UX ([#25](https://github.com/fabogit/battleship/issues/25)).
- Spec: [Client: Connection states](../client.md#connection-states) · [Client: Socket service](../client.md#socket-service) · [Client: Cold-start handling](../client.md#cold-start-handling)
- Amends: [ADR-0070](0070-client-handshake-refusals.md) (`PROTOCOL_MISMATCH` and `SESSION_REPLACED` get their screens)
- Related: [ADR-0014](0014-duplicate-sessions.md) (latest connection wins) · [ADR-0027](0027-shutdown-signals.md) (shutdown signals) · [ADR-0061](0061-handshake-checks.md) (handshake checks) · [ADR-0063](0063-session-rebinding.md) (session rebinding) · [ADR-0076](0076-refused-seat-explanation.md) (refused seat)
- Issues: [#25](https://github.com/fabogit/battleship/issues/25) · [#51](https://github.com/fabogit/battleship/issues/51) (F9, F15)
