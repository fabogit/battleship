/**
 * Server URL fixed at build time: `scripts/build.ts` defines it from `SERVER_URL` for production builds, the
 * `development` configuration in angular.json defines it as `http://localhost:3000` for `ng serve` and `ng test`.
 * Read it only through the `SERVER_URL` injection token.
 */
declare const BUILD_SERVER_URL: string;
