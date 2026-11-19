import type { CanDeactivateFn } from '@angular/router';

import type { Room } from './room';

/**
 * Asks before the router leaves a room page whose match is on (ADR-0117): the header's link home, the browser's back
 * button, another room's link opened in the same tab (`/r/A` to `/r/B` reuses `Room`, and the guard still runs for the
 * changed parameter). While the last known phase of the room being left is `IN_PROGRESS`, the battle view's surrender
 * dialog asks; confirming sends `SURRENDER` and lets the navigation through, cancelling keeps the player in the room. In
 * any other phase, and once the tab has no snapshot of that room (after `LEAVE_ROOM` or `ROOM_CLOSED`), the navigation
 * goes through at once. Closing the tab or reloading is not a navigation, so the disconnect forfeit covers it.
 * @param room The room page being left, which knows its room's snapshot and shows the dialog.
 * @returns Whether to leave: `true` at once outside a match, else the answer of the dialog.
 */
export const confirmSurrenderOnLeave: CanDeactivateFn<Room> = (room) => room.confirmLeave();
