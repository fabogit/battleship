import type { Routes } from '@angular/router';

import { Home } from './features/home/home';
import { Room } from './features/room/room';

/**
 * The app's pages (docs/client.md#routes--lobby-flow): the home screen and one page per room, whose address is the
 * link players share (ADR-0049). Any other address goes home.
 */
export const routes: Routes = [
  { path: '', component: Home, title: 'Battleship' },
  { path: 'r/:roomId', component: Room, title: 'Battleship room' },
  { path: '**', redirectTo: '' },
];
