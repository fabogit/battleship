import { DOCUMENT, Location } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { LOBBY_TEXT } from './lobby.text';

/** The outcomes of sharing the room link, as `Lobby` reports them. */
export const SHARE_OUTCOMES = {
  /** Copied to the clipboard. */
  COPIED: 'copied',
  /** The clipboard refused it; the player copies the link from the field. */
  COPY_FAILED: 'copy-failed',
} as const;

/** One of the `SHARE_OUTCOMES`. */
export type ShareOutcome = (typeof SHARE_OUTCOMES)[keyof typeof SHARE_OUTCOMES];

/**
 * The waiting screen of a room in `WAITING_FOR_OPPONENT` (docs/client.md#routes--lobby-flow): the room link, shared
 * with the Web Share API where the browser has it, copied to the clipboard otherwise. The rules part of the lobby comes
 * with #27.
 */
@Component({
  selector: 'app-lobby',
  templateUrl: './lobby.html',
  styleUrl: './lobby.css',
})
export class Lobby {
  /** The room's id. */
  readonly roomId = input.required<string>();
  /** The player's own nickname, as the server stored it. */
  readonly nickname = input.required<string>();

  /** Builds the room's path, so the link follows the route table. */
  private readonly router = inject(Router);
  /** Prefixes the path with the base href the app is served under. */
  private readonly location = inject(Location);
  /** The page's origin and `navigator`, read through Angular rather than as globals. */
  private readonly document = inject(DOCUMENT);
  /** The browser's `navigator`; absent outside a browser. */
  private readonly navigator = this.document.defaultView?.navigator;

  /** The words of the screen. */
  protected readonly text = LOBBY_TEXT;
  /** The outcomes, for the template. */
  protected readonly shareOutcomes = SHARE_OUTCOMES;
  /** Whether the browser offers the Web Share API (most phones; few desktop browsers). */
  protected readonly canShare = typeof this.navigator?.share === 'function';
  /** What the last share or copy did; `null` before the first one. */
  protected readonly shareOutcome = signal<ShareOutcome | null>(null);

  /** The absolute address of this room's page, `/r/<roomId>` under the app's base href (ADR-0049). */
  protected readonly roomUrl = computed(() => {
    const path = this.router.serializeUrl(this.router.createUrlTree(['/r', this.roomId()]));
    return new URL(this.location.prepareExternalUrl(path), this.document.location.origin).href;
  });

  /**
   * Opens the system share sheet. Closing the sheet is not an error; a sheet that fails to open falls back to copying.
   */
  protected async share(): Promise<void> {
    try {
      await this.navigator?.share({ title: this.text.shareTitle, text: this.text.shareMessage, url: this.roomUrl() });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        await this.copy();
      }
    }
  }

  /** Copies the room link to the clipboard; without clipboard access the player copies it from the field. */
  protected async copy(): Promise<void> {
    try {
      if (this.navigator?.clipboard === undefined) {
        throw new Error('No clipboard');
      }
      await this.navigator.clipboard.writeText(this.roomUrl());
      this.shareOutcome.set(SHARE_OUTCOMES.COPIED);
    } catch {
      this.shareOutcome.set(SHARE_OUTCOMES.COPY_FAILED);
    }
  }

  /**
   * Selects the whole link when the field gets focus, so it can be copied by hand.
   * @param event The focus event of the link field.
   */
  protected selectAll(event: FocusEvent): void {
    if (event.target instanceof HTMLInputElement) {
      event.target.select();
    }
  }
}
