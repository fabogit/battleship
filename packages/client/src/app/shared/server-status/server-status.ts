import { Component, inject } from '@angular/core';

import { CONNECTION_STATUSES, GameSocketService } from '../../core/game-socket';
import { ServerWakeService, WAKE_STATUSES } from '../../core/server-wake';
import { SERVER_STATUS_TEXT } from './server-status.text';

/**
 * Wakes the server and opens the socket when the app starts, and tells the player where that stands
 * (docs/client.md#cold-start-handling). The app shell renders it once, above every page, so nickname entry stays usable
 * while the server wakes up.
 */
@Component({
  selector: 'app-server-status',
  templateUrl: './server-status.html',
  styleUrl: './server-status.css',
})
export class ServerStatus {
  /** The wake-up poll; the template shows its `status`. */
  protected readonly wake = inject(ServerWakeService);
  /** Opened once the server is awake; the template shows its `status`. */
  protected readonly socket = inject(GameSocketService);

  /** The wake-up states, for the template's `@switch`. */
  protected readonly wakeStatuses = WAKE_STATUSES;
  /** The connection states, for the template's `@switch`. */
  protected readonly connectionStatuses = CONNECTION_STATUSES;
  /** The words shown for each state. */
  protected readonly text = SERVER_STATUS_TEXT;

  /** Starts the wake-up poll as soon as the shell is created. */
  constructor() {
    void this.start();
  }

  /**
   * Polls `/health` until the server answers, then opens the socket; the retry buttons call it again. Waking an awake
   * server returns at once, and `connect()` reopens a socket that gave up.
   */
  protected async start(): Promise<void> {
    if (await this.wake.wake()) {
      this.socket.connect();
    }
  }
}
