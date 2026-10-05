import { provideHttpClient } from '@angular/common/http';
import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Already the Angular 22 default; explicit because the app relies on it (no zone.js, docs/client.md#81-reactive-model).
    provideZonelessChangeDetection(),
    provideHttpClient(),
    provideRouter(routes),
  ],
};
