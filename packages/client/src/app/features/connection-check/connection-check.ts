import { Component, effect, inject, signal, untracked } from '@angular/core';
import { PROTOCOL_VERSION } from '@battleship/core';

import { GameSocketService } from '../../core/game-socket';
import { ServerWakeService } from '../../core/server-wake';

export type EchoResult =
  | { readonly ok: true; readonly roundTripMs: number; readonly protocolVersion: number }
  | { readonly ok: false; readonly message: string };

/** Phase 0 test page (issue #4): wakes the server, connects and shows an echo round-trip. */
@Component({
  selector: 'app-connection-check',
  templateUrl: './connection-check.html',
  styleUrl: './connection-check.css',
})
export class ConnectionCheck {
  protected readonly wake = inject(ServerWakeService);
  protected readonly socket = inject(GameSocketService);

  protected readonly protocolVersion = PROTOCOL_VERSION;
  protected readonly echo = signal<EchoResult | undefined>(undefined);

  constructor() {
    void this.start();
    // Echo on every (re)connection, so the page always shows a fresh round-trip.
    effect(() => {
      if (this.socket.status() === 'connected') {
        untracked(() => void this.sendEcho());
      }
    });
  }

  protected async start(): Promise<void> {
    if (await this.wake.wake()) {
      this.socket.connect();
    }
  }

  protected async sendEcho(): Promise<void> {
    const sentAt = performance.now();
    try {
      const response = await this.socket.echo({ sentAt });
      this.echo.set({
        ok: true,
        roundTripMs: Math.round(performance.now() - sentAt),
        protocolVersion: response.protocolVersion,
      });
    } catch (error) {
      this.echo.set({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }
}
