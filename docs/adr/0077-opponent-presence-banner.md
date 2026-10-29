---
status: accepted
date: 2026-10-15
---

# ADR-0077: Opponent presence banner

The room page shows one `Presence` banner above the waiting screen, placement and battle, and keeps it while the view below changes. It reads the snapshot ([ADR-0072](0072-seat-presence.md)):

- **Away:** "Grace is disconnected." while `opponent.isConnected` is `false`, in every phase, game over included.
- **Forfeit countdown:** from `opponentForfeitRemainingMs`, in a `role="timer"` line: "Grace loses the match in 2:41 unless they come back." during the match, "Grace's seat is freed in 2:41 unless they come back." before it. It is not a live region, so it is not read out every second.
- **Pause:** during the match, "The match is paused." from `battle.isPaused`, or "The match is running." while the opponent is away and the match runs; "Pause match" / "Resume match" when `canPause` / `canResume`, which send `SET_PAUSED` ([ADR-0074](0074-pause.md)), read "Pausing…" / "Resuming…" while the command waits and ignore further taps; a failure shows its message in an alert.
- **Back:** "Grace is back." for one snapshot after the opponent's seat got a socket again.
- **Left:** "Grace left the room, so their seat is free again." after a seat freed before the match sent the player back to the waiting screen ([ADR-0073](0073-room-lifecycle-with-forfeits.md)), until someone takes the seat.

Every sentence but the countdown sits in one polite live region that exists before anything is announced. `GameStateService` computes "back" and "left" when each `STATE` arrives (`opponentReturned`, `opponentDeparted`), comparing it with the previous snapshot of the same room. Details in [Client: Connection states](../client.md#connection-states) (#25).

## Considered options

- **A line inside each view (the battle view had "Grace is disconnected." outside any live region, #52):** a freed seat switches the view from placement to the waiting screen, and a live region created with its content already in it is usually not announced. One banner kept by the room page announces the change as the view switches.
- **`linkedSignal` in the banner for "back" and "left":** it computes only when read, and the template reads it only when the lines before it are empty, so it missed snapshots: "left" never showed after an away opponent's seat was freed (caught by the banner's specs). The service sees every `STATE`.
- **A shared announcer service with one hidden live region in the shell:** robust, but a new pattern next to the views' own live regions; the banner's region lives as long as the room page, which is enough.
- **Wording that says when the opponent dropped ("Grace left a moment ago"):** in production the server notices a closed tab about 10 s after it closes, through Render's proxy (measured in #23), and a phone that switches apps may keep its socket for a while. The banner says what the server knows now, and the countdown is the server's own.

## Consequences

- In production "Grace is disconnected." shows about 10 s after the opponent's tab closes, and on the local stack at once; the countdown starts from the server's detection either way.
- The waiting screen shows a countdown only in `RULES_NEGOTIATION`, which it stands in for until #27: in `WAITING_FOR_OPPONENT` the opponent's seat is empty.
- `SET_PAUSED` has a control, but pausing freezes nothing visible until the turn timer lands (#30).

## Links

- Added on 2026-10-15 for the connection-state UX ([#25](https://github.com/fabogit/battleship/issues/25)).
- Amended on 2026-10-29 for the rules negotiation UI ([#27](https://github.com/fabogit/battleship/issues/27)): in `RULES_NEGOTIATION` the banner, and the forfeit countdown before the match, sit above the rules screen instead of the waiting screen.
- Spec: [Client: Connection states](../client.md#connection-states) · [Client: Game state](../client.md#game-state) · [Server: Seat presence](../server.md#seat-presence)
- Related: [ADR-0036](0036-countdown-resync.md) (countdown resync) · [ADR-0072](0072-seat-presence.md) (seat presence) · [ADR-0073](0073-room-lifecycle-with-forfeits.md) (room lifecycle) · [ADR-0074](0074-pause.md) (pause)
- Issues: [#25](https://github.com/fabogit/battleship/issues/25) · [#52](https://github.com/fabogit/battleship/issues/52) (the line outside a live region) · [#30](https://github.com/fabogit/battleship/issues/30) (turn timer)
