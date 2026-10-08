import { InjectionToken } from '@angular/core';

/** Base URL of the game server (HTTP and Socket.io), fixed at build time (src/build-defines.d.ts). Tests override it. */
export const SERVER_URL = new InjectionToken<string>('SERVER_URL', {
  factory: () => BUILD_SERVER_URL,
});
