import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { GameSocketService } from './core/game-socket';
import {
  ConnectionScreen,
  SCREEN_CLOSE_REASONS,
  type ScreenCloseReason,
} from './shared/connection-screen/connection-screen';
import { ServerStatus } from './shared/server-status/server-status';

/**
 * The shell: the app name linking home and the server status above every page (docs/client.md#routes--lobby-flow).
 * When the server ends the connection for a reason that retrying cannot fix, a connection screen replaces the page
 * until the player acts (docs/client.md#connection-states).
 */
@Component({
  selector: 'app-root',
  imports: [ConnectionScreen, RouterLink, RouterOutlet, ServerStatus],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  /** Read for its close reason only. */
  private readonly socket = inject(GameSocketService);

  /** The close reason whose screen replaces the page; `null` while the page shows. */
  protected readonly screenReason = computed<ScreenCloseReason | null>(() => {
    const reason = this.socket.closeReason();
    return SCREEN_CLOSE_REASONS.find((screenReason) => screenReason === reason) ?? null;
  });
}
