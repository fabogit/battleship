// Production values; development builds swap in environment.development.ts (angular.json fileReplacements).
export const environment = {
  /** Render web service: one server for both the production site and Cloudflare Pages previews (ADR-0024, ADR-0025). */
  serverUrl: 'https://battleship-server-jumc.onrender.com',
};
