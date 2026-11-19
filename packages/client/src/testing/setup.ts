import { beforeAll, beforeEach } from 'vitest';

// jsdom has `<dialog>` without its methods; these do what the lobby's share dialog and the battle view's surrender
// dialog rely on. Esc is a `cancel` event, then `close` unless a listener prevents it: see `pressEscape` in the specs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) {
      return;
    }
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

// Every spec starts with empty web storage, as a first visit does: `SessionStore` reads both when it is created, and
// jsdom keeps them for the whole spec file.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
