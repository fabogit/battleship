---
status: accepted
date: 2026-11-19
---

# ADR-0117: Leave guard

During `IN_PROGRESS`, the battle view has two ways to give up, and both ask first in the same in-page dialog. "Surrender" opens the dialog directly. A navigation away from the room page goes through a `canDeactivate` guard, which opens it. Confirming sends `SURRENDER` ([ADR-0116](0116-surrender-keeps-the-seat.md)). Details in [Client: Board & interaction](../client.md#board--interaction) and [Client: Routes & lobby flow](../client.md#routes--lobby-flow).

- **The dialog:** one `<dialog>` in `Battle`, opened with `showModal()`, with "Keep playing" focused first and the confirm button after it. Its words depend on what opened it:

  | Opened by       | Heading                | Text                                                            | Confirm               |
  | --------------- | ---------------------- | --------------------------------------------------------------- | --------------------- |
  | "Surrender"     | "Surrender the match?" | "Grace wins at once. You stay in the room and see both fleets." | "Surrender"           |
  | The leave guard | "Leave the match?"     | "Leaving the room surrenders the match: Grace wins at once."    | "Surrender and leave" |

  Esc and "Keep playing" close it, and focus goes back to "Surrender". The confirm button sends `SURRENDER` once: it reads "Surrendering…" with `aria-disabled` until the ack, more clicks send nothing, and Esc does nothing while the ack is pending. The dialog closes when the ack arrives. A refusal shows in the page's error line (`WRONG_PHASE`: "The match is over."). When the match ends with the dialog open, the dialog closes. Focus that was in the dialog or on "Surrender" moves to the heading, which names the result, since the button goes away at game over.

- **The button:** "Surrender" is a secondary button, 2.75 rem (44 px) high. On a narrow screen it closes the page on the right, under the feedback and error lines: below "Fire", which leads its own row on the left, at least 3 rem (48 px) apart. It also sits outside the lines that keep "Fire" in view at 320×568 ([ADR-0110](0110-compact-presence-banner.md)), so a phone scrolls a little to reach it. From 52 rem (832 px) up, it moves beside the heading row, the way "Leave room" sits before the match ([ADR-0080](0080-leave-room-beside-the-heading.md)).
- **The guard:** `confirmSurrenderOnLeave`, a functional `CanDeactivateFn<Room>` on `r/:roomId`, calls `Room.confirmLeave()`. While the page's own room has a last snapshot in `IN_PROGRESS` and the battle view is shown, that opens the dialog with the leave words. Otherwise it answers `true` at once. The guard covers the header's link home, the browser's Back button, and another room's link opened in the same tab: `/r/A` to `/r/B` reuses `Room`, and the router runs the guard for the changed parameter. Confirming lets the navigation through once the ack arrives. After a refusal (the match ended first), at once while offline (`NOT_CONNECTED`), or after `ACK_TIMEOUT_MS` (5 s) without an ack, the navigation also goes through: the disconnect forfeit covers what the server did not get. "Keep playing" cancels the navigation. When the match ends before the player answers, the navigation is also cancelled, and the player sees the result.
- **History:** the router uses `canceledNavigationResolution: 'computed'`, so a cancelled Back puts the history back where it was, and the next Back asks again.
- **What the app does itself:** "Leave room" goes home after its ack, which has dropped the snapshot. `ROOM_CLOSED` drops it too. A refused seat shows another view than the battle. "New match" at game over leaves a room that is no longer `IN_PROGRESS`. None of them is asked.

## Considered options

- **The browser's `confirm()`:** it cannot be styled or worded per case. It blocks the page's own rendering while it is open, so a `STATE` that ends the match cannot close it. Some embedded browsers suppress it.
- **A `beforeunload` prompt:** browsers show their own generic sentence, only after the page was interacted with, and never for an in-app navigation. Closing the tab or reloading stays silent, and a reload comes back to the same seat anyway.
- **No guard, leaving it to the disconnect forfeit:** the opponent would wait 3 minutes (`DISCONNECT_FORFEIT_MS`) for a player who had already left. And a stray tap on the header link would cost a match without a word.

## Consequences

- The silent exit through `bind` (creating or joining another room from an `IN_PROGRESS` seat) needs the player to leave the room page first, so the guard asks before it on the client. On the server it stays the away-and-forfeit path ([ADR-0072](0072-seat-presence.md)), for a client that bypasses the guard.
- After a confirmed leave, the surrenderer's socket stays bound to its `GAME_OVER` seat until `bind` moves it or the game-over TTL closes the room ([ADR-0116](0116-surrender-keeps-the-seat.md)). The opponent sees the victory, "Ada surrendered.", with Ada still shown as connected.
- The jsdom `<dialog>` stand-in moves from the lobby's spec to `src/testing/setup.ts`, shared by every spec.
- The initial bundle grows by 4.8 kB raw, 1.0 kB estimated transfer (496.8 → 501.6 kB), past the 500 kB warning budget. The error budget is 1 MB, and bundle work waits for #63 ([Roadmap: Open risks](../roadmap.md#open-risks)).

## Links

- Added on 2026-11-19 for surrender ([#35](https://github.com/fabogit/battleship/issues/35)), from the M4 decisions on the issue.
- Spec: [Client: Board & interaction](../client.md#board--interaction) · [Client: Routes & lobby flow](../client.md#routes--lobby-flow)
- Amended on 2026-11-22 ([#36](https://github.com/fabogit/battleship/issues/36)): in `GAME_OVER` the guard sends `LEAVE_ROOM` without a dialog, and after a confirmed guard-surrender it sends `LEAVE_ROOM` once `SURRENDER` is answered; "New match" is now "Leave room" ([ADR-0126](0126-leaving-the-page-at-game-over.md)).
- Related: [ADR-0116](0116-surrender-keeps-the-seat.md) (surrender keeps the seat) · [ADR-0078](0078-leaving-before-the-match.md) (leaving before the match) · [ADR-0080](0080-leave-room-beside-the-heading.md) ("Leave room" beside the heading) · [ADR-0110](0110-compact-presence-banner.md) ("Fire" in view) · [ADR-0035](0035-command-acks.md) (command acks)
- Issues: [#35](https://github.com/fabogit/battleship/issues/35) · [#63](https://github.com/fabogit/battleship/issues/63)
