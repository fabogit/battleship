/**
 * Server URL fixed at build time: `scripts/ng.ts` defines it from `SERVER_URL` for `ng build` and `ng serve`. Read it
 * only through the `SERVER_URL` injection token; unit tests override the token, so `ng test` leaves it undefined.
 */
declare const BUILD_SERVER_URL: string;
