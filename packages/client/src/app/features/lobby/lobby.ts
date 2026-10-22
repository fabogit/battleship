import { DOCUMENT, Location } from '@angular/common';
import { Component, computed, inject, input, signal, viewChild, type ElementRef } from '@angular/core';
import { Router } from '@angular/router';

import { QrCode } from '../../shared/qr-code/qr-code';
import { LOBBY_TEXT } from './lobby.text';

/**
 * An `AbortError` from `navigator.share` sooner than this after the call means no sheet opened, as on desktop Linux
 * Chromium; a person needs longer to see a sheet slide in and close it (ADR-0079).
 */
export const NATIVE_SHEET_FAILURE_MS = 500;

/** The outcomes of sharing the room link, as `Lobby` reports them. */
export const SHARE_OUTCOMES = {
  /** Copied to the clipboard. */
  COPIED: 'copied',
  /** The clipboard refused it; the player copies the link from the field. */
  COPY_FAILED: 'copy-failed',
  /** The system share sheet did not open; the share dialog offers the code and the link instead. */
  SHEET_FAILED: 'sheet-failed',
} as const;

/** One of the `SHARE_OUTCOMES`. */
export type ShareOutcome = (typeof SHARE_OUTCOMES)[keyof typeof SHARE_OUTCOMES];

/**
 * The waiting screen of a room in `WAITING_FOR_OPPONENT` (docs/client.md#routes--lobby-flow): the room link, with
 * "Share link" and "Copy link". "Share link" opens the system share sheet on phones and tablets, and the share dialog
 * (a QR code of the link, the link and "Copy link") everywhere else or when the sheet fails (ADR-0079). The rules part
 * of the lobby comes with #27. Its content goes beside the heading: the room page's "Leave room" (ADR-0080).
 */
@Component({
  selector: 'app-lobby',
  imports: [QrCode],
  templateUrl: './lobby.html',
  styleUrl: './lobby.css',
})
export class Lobby {
  /** Passed by the room page; the share link is built from it. */
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
  /** Whether the browser offers the Web Share API (most phones; some desktop browsers, not all of them working). */
  protected readonly canShare = typeof this.navigator?.share === 'function';
  /** Whether the main pointer is a finger: phones and tablets, whose share sheet "Share link" opens. */
  private readonly hasCoarsePointer =
    typeof this.document.defaultView?.matchMedia === 'function' &&
    this.document.defaultView.matchMedia('(pointer: coarse)').matches;
  /** Whether the share sheet failed to open in this lobby; "Share link" then goes straight to the dialog. */
  protected readonly hasSheetFailed = signal(false);
  /** Whether the share dialog is open; the QR code is drawn only while it is. */
  protected readonly isDialogOpen = signal(false);
  /** What the last share or copy did, on the page or in the dialog; `null` before the first one and across the dialog. */
  protected readonly shareOutcome = signal<ShareOutcome | null>(null);

  /** The share dialog. */
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('shareDialog');
  /** "Share link", which gets focus back when the dialog closes. */
  private readonly shareButton = viewChild.required<ElementRef<HTMLButtonElement>>('shareButton');

  /** The absolute address of this room's page, `/r/<roomId>` under the app's base href (ADR-0049). */
  protected readonly roomUrl = computed(() => {
    const path = this.router.serializeUrl(this.router.createUrlTree(['/r', this.roomId()]));
    return new URL(this.location.prepareExternalUrl(path), this.document.location.origin).href;
  });

  /**
   * Opens the system share sheet on a phone or tablet, and the share dialog elsewhere. A sheet the player closes is not
   * an error; a sheet that fails to open falls back to the dialog, which says so.
   */
  protected async share(): Promise<void> {
    if (!this.canShare || !this.hasCoarsePointer || this.hasSheetFailed()) {
      this.openDialog();
    } else if (!(await this.openSheet())) {
      this.openDialog();
      this.shareOutcome.set(SHARE_OUTCOMES.SHEET_FAILED);
    }
  }

  /** "Other apps…" in the dialog: the system share sheet, or a message when it does not open. */
  protected async shareWithOtherApps(): Promise<void> {
    if (this.hasSheetFailed()) {
      return;
    }
    this.shareOutcome.set(null);
    if (!(await this.openSheet())) {
      this.shareOutcome.set(SHARE_OUTCOMES.SHEET_FAILED);
    }
  }

  /** Closes the share dialog, as Esc does. */
  protected closeDialog(): void {
    this.dialog().nativeElement.close();
  }

  /**
   * Runs whenever the dialog closes, by Esc included: focus goes back to "Share link", and the dialog's last message
   * goes with it rather than showing up again on the page.
   */
  protected onDialogClosed(): void {
    this.isDialogOpen.set(false);
    this.shareOutcome.set(null);
    this.shareButton().nativeElement.focus();
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

  /** Opens the share dialog, modal, with focus on its "Copy link". */
  private openDialog(): void {
    this.shareOutcome.set(null);
    this.isDialogOpen.set(true);
    this.dialog().nativeElement.showModal();
  }

  /**
   * Opens the system share sheet with the room link.
   * @returns Whether the sheet opened: shared, or closed by the player. `false` marks the sheet as failed.
   */
  private async openSheet(): Promise<boolean> {
    const startedAt = Date.now();
    try {
      await this.navigator?.share({ title: this.text.shareTitle, text: this.text.shareMessage, url: this.roomUrl() });
      return true;
    } catch (error) {
      const wasClosed =
        error instanceof DOMException &&
        error.name === 'AbortError' &&
        Date.now() - startedAt >= NATIVE_SHEET_FAILURE_MS;
      if (!wasClosed) {
        this.hasSheetFailed.set(true);
      }
      return wasClosed;
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
