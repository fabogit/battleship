import type { Routes } from '@angular/router';

import { Home } from './features/home/home';
import { confirmSurrenderOnLeave } from './features/room/leave-guard';
import { Room } from './features/room/room';

/**
 * The app's pages (docs/client.md#routes--lobby-flow): the home screen and one page per room, whose address is the
 * link players share (ADR-0049). Leaving a room page during its match asks first (ADR-0117). Any other address goes
 * home.
 */
export const routes: Routes = [
  { path: '', component: Home, title: 'Battleship' },
  { path: 'r/:roomId', component: Room, title: 'Battleship room', canDeactivate: [confirmSurrenderOnLeave] },
  { path: '**', redirectTo: '' },
];
