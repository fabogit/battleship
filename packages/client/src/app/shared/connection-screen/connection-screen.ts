import { DOCUMENT } from '@angular/common';
import { Component, InjectionToken, inject, input } from '@angular/core';

import { CLOSE_REASONS, GameSocketService } from '../../core/game-socket';
import { CONNECTION_SCREEN_TEXT } from './connection-screen.text';

/** The close reasons that stop the app until the player acts, each with its own screen (ADR-0075). */
export const SCREEN_CLOSE_REASONS = [CLOSE_REASONS.PROTOCOL_MISMATCH, CLOSE_REASONS.SESSION_REPLACED] as const;

/** One of the `SCREEN_CLOSE_REASONS`. */
export type ScreenCloseReason = (typeof SCREEN_CLOSE_REASONS)[number];

/** Reloads the page; a token, so specs can tell that "Reload" was pressed without reloading jsdom. */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  providedIn: 'root',
  factory: () => {
    const location = inject(DOCUMENT).location;
    return () => {
      location.reload();
    };
  },
});

/**
 * The screen the app shell shows instead of the page when the server ended the connection for a reason that retrying
 * cannot fix (docs/client.md#connection-states, ADR-0075): "Please reload the page" after `PROTOCOL_MISMATCH`, whose
 * only way out is a newer client, and "This match is open somewhere else" after `SESSION_REPLACED`, with "Play here"
 * to take the seat back (latest connection wins, ADR-0014).
 */
@Component({
  selector: 'app-connection-screen',
  templateUrl: './connection-screen.html',
  styleUrl: './connection-screen.css',
})
export class ConnectionScreen {
  /** Why the connection ended; picks the screen. */
  readonly reason = input.required<ScreenCloseReason>();

  /** Reconnects for "Play here". */
  private readonly socket = inject(GameSocketService);
  /** Reloads for "Reload". */
  protected readonly reload = inject(RELOAD_PAGE);

  /** The words of the screens. */
  protected readonly text = CONNECTION_SCREEN_TEXT;
  /** The close reasons, for the template's `@switch`. */
  protected readonly closeReasons = CLOSE_REASONS;

  /**
   * Takes the seat back: the handshake sends this tab's session again, the server binds it here and sends
   * `SESSION_REPLACED` to the other tab or device (ADR-0063). The shell shows the page again as the connection opens.
   */
  protected playHere(): void {
    this.socket.connect();
  }
}
