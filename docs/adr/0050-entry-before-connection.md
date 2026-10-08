---
status: accepted
date: 2026-10-08
---

# ADR-0050: Room entry before the connection

The home and join screens are usable while the server wakes up (up to about 25 s on a cold start): the player types a nickname meanwhile. Their submit button ("Create room", "Join room") stays in the tab order but is inactive until the socket is connected: it carries `aria-disabled="true"` instead of `disabled`, a submit does nothing, and a hint next to it, which the button names with `aria-describedby`, says "Available once the server is connected". The server status above every page says where the wake-up stands. The command is sent only on a submit made while connected, so it is never queued. Details in [Client: Routes & lobby flow](../client.md#routes--lobby-flow) (#17).

## Considered options

- **The `disabled` attribute:** a disabled button leaves the tab order, so a keyboard or screen-reader user would not find it, nor learn why it does nothing.
- **Accepting the submit and sending the command once connected:** the player would wait on a spinner with no control, and a command queued for later goes against [ADR-0035](0035-command-acks.md), under which nothing is sent while the socket is not connected.
- **Hiding the form until connected:** the player could not use the cold start to type a nickname, which the cold-start handling promises (docs/client.md#cold-start-handling).

## Links

- Added on 2026-10-08 for the home and lobby screens ([#17](https://github.com/fabogit/battleship/issues/17)).
- Spec: [Client: Routes & lobby flow](../client.md#routes--lobby-flow) · [Client: Cold-start handling](../client.md#cold-start-handling)
- Related: [ADR-0035](0035-command-acks.md) (no command queued while disconnected)
- Issues: [#17](https://github.com/fabogit/battleship/issues/17), [#39](https://github.com/fabogit/battleship/issues/39) (accessibility pass)
