import type { Routes } from '@angular/router';

import { ConnectionCheck } from './features/connection-check/connection-check';

export const routes: Routes = [
  { path: '', component: ConnectionCheck },
  { path: '**', redirectTo: '' },
];
