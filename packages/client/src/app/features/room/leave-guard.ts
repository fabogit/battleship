import type { CanDeactivateFn } from '@angular/router';

import type { Room } from './room';

/**
 * Runs before the router leaves a room page (ADR-0117, ADR-0126): the header's link home, the browser's back button,
 * "Leave room" at game over, another room's link opened in the same tab (`/r/A` to `/r/B` reuses `Room`, and the guard
 * still runs for the changed parameter). While the last known phase of the room being left is `IN_PROGRESS`, the
 * battle view's surrender dialog asks; confirming sends `SURRENDER`, then `LEAVE_ROOM`, and lets the navigation through,
 * cancelling keeps the player in the room. In `GAME_OVER` it sends `LEAVE_ROOM` without asking and lets the navigation
 * through once it is answered, or after `ACK_TIMEOUT_MS`. In any other phase, and once the tab has no snapshot of that
 * room (after "Leave room" before the match, or `ROOM_CLOSED`), the navigation goes through at once: the app's own
 * navigations are never held. Closing the tab or reloading is not a navigation, so it sends nothing: the seat goes away.
 * @param room The room page being left, which knows its room's snapshot and shows the dialog.
 * @returns Whether to leave: `true` at once before the match, after `LEAVE_ROOM` at game over, else the answer of the
 * dialog.
 */
export const confirmSurrenderOnLeave: CanDeactivateFn<Room> = (room) => room.confirmLeave();
