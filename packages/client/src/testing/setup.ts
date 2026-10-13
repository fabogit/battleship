import { beforeEach } from 'vitest';

// Every spec starts with empty web storage, as a first visit does: `SessionStore` reads both when it is created, and
// jsdom keeps them for the whole spec file.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
