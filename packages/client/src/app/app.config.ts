import { provideHttpClient } from '@angular/common/http';
import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';

/** The root providers, passed to `bootstrapApplication` in `main.ts`; services are provided where they are declared. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Already the Angular 22 default; explicit because the app relies on it (no zone.js, docs/client.md#reactive-model).
    provideZonelessChangeDetection(),
    provideHttpClient(),
    // Route parameters reach the page components as inputs, e.g. `Room.roomId`.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
