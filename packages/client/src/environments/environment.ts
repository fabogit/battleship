// Production values; development builds swap in environment.development.ts (angular.json fileReplacements).
export const environment = {
  /** Render web service: one server for both the production site and Cloudflare Pages previews (ADR D24, D25). */
  serverUrl: 'https://battleship-server-jumc.onrender.com',
};
