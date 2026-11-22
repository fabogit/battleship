---
status: accepted
date: 2026-11-22
---

# ADR-0126: The game-over controls, and leaving the page at game over

At game over the battle view offers the rematch ([ADR-0123](0123-rematch-choices-and-leave.md)). Any way off the room page in `GAME_OVER` is the `LEAVE` choice: decision 4 of the [M4 decisions on #36](https://github.com/fabogit/battleship/issues/36). Both live in one ADR because the control that leaves is a link, and the leave guard ([ADR-0117](0117-leave-guard.md)) is what turns it into `LEAVE_ROOM`. Details in [Client: Board & interaction](../client.md#board--interaction) and [Client: Routes & lobby flow](../client.md#routes--lobby-flow).

- **The controls** (`RematchControls`, under the reason and the revealed-fleet sentence; the words are in `battle.text.ts`):
  - a group named "Play again?" with two toggles side by side, "Play again" (`SAME_RULES`) and "Change rules" (`CHANGE_RULES`), 2.75 rem (44 px) high;
  - both players' choices in a live region: "You want to play again with the same rules.", "Grace wants to change the rules first.", "Grace has not chosen yet.";
  - while the opponent is away, "The rematch starts once Grace is back." ([ADR-0124](0124-rematch-needs-both-seats.md));
  - a hint: "Change rules" wins, and the room closes 2 minutes after the match without a rematch;
  - "Leave room", a link home. It replaces "New match", which went home and would now leave the room anyway.
- **What a toggle shows:** `aria-pressed` follows the choice the snapshot holds, or the one on its way while it waits for its ack.
  - The pressed toggle has a thicker border, bold text and a check mark, so it does not rest on colour alone.
  - While a choice waits, both toggles are `aria-disabled` and more taps send nothing. Tapping the choice already held sends nothing either, since a choice cannot be taken back.
  - A refusal or a missing ack shows in the controls' alert line, and the toggles show the room's choice again.
  - Both toggles are always rendered, so focus stays on the one pressed whatever the choice: no `@if`/`@else` swaps them.
- **The choice lives in the snapshot**, not in `BattleStore`. The server keeps it, a reload shows it again, and the battle view (with its store) goes away when the rematch resolves.
- **Focus after game over:** when the battle view gives way to another view the player stays seated in, focus moves to the new view's heading once it has rendered. That happens on a resolved rematch (rules screen or placement) and on the waiting screen after the opponent left. The control the player used went away with the battle view.
- **The guard in `GAME_OVER`** (`Room.confirmLeave`, for `confirmSurrenderOnLeave`) sends `LEAVE_ROOM` without a dialog. It covers "Leave room", the header link, Back, and another room's link in the same tab.
  - The navigation waits for the ack, at most `ACK_TIMEOUT_MS` (5 s), and then goes through whatever came back. A refusal (`NOT_ALLOWED`, or a rematch that resolved first), no ack and no connection never block it.
  - After an ack the session and the snapshot are dropped, as after "Leave room" before the match. After `NO_ACK` the socket reconnects, and the handshake tells whether the seat is still held ([ADR-0070](0070-client-handshake-refusals.md)).
  - While `LEAVE_ROOM` waits, "Leave room" reads "Leaving…" with `aria-disabled`. A second navigation in the meantime shares the same `LEAVE_ROOM` (`RoomEntryService.leave`), which also exposes `isLeaving`.
- **A guard-surrender** (`IN_PROGRESS`, confirmed in the dialog) sends `SURRENDER`, then `LEAVE_ROOM`, then lets the navigation through. The `LEAVE_ROOM` goes even when the surrender was refused (the match ended first) or not answered. At worst the navigation waits two ack timeouts.
- **What the app does itself** goes through at once and sends nothing: "Leave room" before the match goes home after its own ack, which dropped the snapshot; `ROOM_CLOSED` and a refused seat drop it too. Closing the tab or reloading is not a navigation. The seat goes away, and the rematch cannot resolve until the TTL.
- **The player left behind** sees the waiting screen, its heading focused. Above it, the presence banner says "Grace left the room, so their seat is free again.". Under the heading, the last match's result stays readable: "You won the last match. Grace surrendered."
  - The share link is the same.
  - A surrender followed at once by the surrenderer's `LEAVE_ROOM` keeps the victory readable that way.
- **Where the result comes from:** the client keeps it from the room's last game-over snapshot when the next snapshot of the same room is `WAITING_FOR_OPPONENT` with the opponent gone (`GameStateService.departedMatch`, beside `opponentDeparted`). Someone taking the seat, another room's snapshot or `clear()` drops it.
  - **Known limit:** the server sends nothing of the finished match once a seat is freed. A reload, or a tab that enters the room afterwards, shows a plain waiting screen.
  - A socket that reconnects into the waiting room after missing the leave still holds the game-over snapshot, so it shows the same lines. Only the other player's leave takes a room from `GAME_OVER` to `WAITING_FOR_OPPONENT` with this seat kept.

## Considered options

- **A dialog before leaving at game over:** the match is over, so leaving costs nothing but the rematch, which the player gives up by going. Decision 4 has no dialog.
- **Keeping "New match" as a plain link:** it would leave the room all the same through the guard, under a name that promises a new match the player does not get.
- **The last result in the waiting snapshot:** it survives a reload, but it adds a field to `STATE` for one sentence the client can keep itself in every case but a reload.
- **The choice in `BattleStore`:** the store goes with the battle view, so a choice made just before a reload or a resolution would have to be read back from the snapshot anyway.
- **One "Rematch" button with a rules switch beside it:** two taps to change the rules, and a switch whose state means nothing until the button is pressed.

## Consequences

- The guard sends a command in two phases now. A test of the room page answers `LEAVE_ROOM` wherever a navigation leaves a finished match.
- `surrender.spec.ts` sees the opponent go to the waiting screen after a guard-surrender, with "Ada surrendered." still on it, instead of staying on the victory screen.
- The status block of the battle view breaks long words, so a 20-letter nickname no longer widens the game-over view past a 320 px phone.
- The initial bundle grows by 7.3 kB raw, 1.4 kB estimated transfer (506.5 → 513.8 kB), further past the 500 kB warning budget. The error budget is 1 MB, and bundle work waits for [#63](https://github.com/fabogit/battleship/issues/63) ([Roadmap: Open risks](../roadmap.md#open-risks)).

## Links

- Added on 2026-11-22 for the rematch flow ([#36](https://github.com/fabogit/battleship/issues/36)), from the M4 decisions on the issue.
- Spec: [Client: Board & interaction](../client.md#board--interaction) · [Client: Routes & lobby flow](../client.md#routes--lobby-flow) · [Client: Game state](../client.md#game-state)
- Amends: [ADR-0117](0117-leave-guard.md) (the guard sends `LEAVE_ROOM` at game over, and after a guard-surrender)
- Related: [ADR-0116](0116-surrender-keeps-the-seat.md) (surrender keeps the seat) · [ADR-0077](0077-opponent-presence-banner.md) (presence banner) · [ADR-0078](0078-leaving-before-the-match.md) (leaving before the match) · [ADR-0123](0123-rematch-choices-and-leave.md) · [ADR-0124](0124-rematch-needs-both-seats.md) · [ADR-0125](0125-what-a-rematch-starts-from.md) · [ADR-0035](0035-command-acks.md) (command acks)
- Issues: [#36](https://github.com/fabogit/battleship/issues/36) · [#35](https://github.com/fabogit/battleship/issues/35)
