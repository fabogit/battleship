import { HttpClient } from '@angular/common/http';
import { Service, inject, signal } from '@angular/core';
import type { HealthResponse } from '@battleship/core';
import { firstValueFrom } from 'rxjs';

import { SERVER_URL } from './server-url';

export type WakeStatus = 'idle' | 'waking' | 'awake' | 'unreachable';

/** Delay before the first retry; doubles after every failed attempt up to `MAX_RETRY_DELAY_MS`. */
export const FIRST_RETRY_DELAY_MS = 500;
export const MAX_RETRY_DELAY_MS = 5_000;
/** Render needs about a minute to spin up a free service (ADR §1.4). */
export const GIVE_UP_AFTER_MS = 90_000;
/** Per attempt, so the last one can end slightly after `GIVE_UP_AFTER_MS`. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Polls `GET /health` until the server answers, so the Socket.io connection is only opened on a
 * running server (ADR §4.3). While Render spins up it serves its own HTML page without CORS headers:
 * every failed, non-JSON or unexpected response counts as "still waking".
 */
@Service()
export class ServerWakeService {
  private readonly http = inject(HttpClient);
  private readonly healthUrl = `${inject(SERVER_URL)}/health`;

  private readonly statusSignal = signal<WakeStatus>('idle');
  readonly status = this.statusSignal.asReadonly();

  private polling: Promise<boolean> | undefined;

  /** Resolves `true` once the server is up, `false` after giving up. Concurrent calls share one poll. */
  wake(): Promise<boolean> {
    if (this.statusSignal() === 'awake') {
      return Promise.resolve(true);
    }
    this.polling ??= this.poll().finally(() => {
      this.polling = undefined;
    });
    return this.polling;
  }

  private async poll(): Promise<boolean> {
    this.statusSignal.set('waking');
    const deadline = Date.now() + GIVE_UP_AFTER_MS;
    for (let delay = FIRST_RETRY_DELAY_MS; ; delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)) {
      if (await this.isHealthy()) {
        this.statusSignal.set('awake');
        return true;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.statusSignal.set('unreachable');
        return false;
      }
      await sleep(Math.min(delay, remaining));
    }
  }

  private async isHealthy(): Promise<boolean> {
    try {
      const body = await firstValueFrom(this.http.get<unknown>(this.healthUrl, { timeout: REQUEST_TIMEOUT_MS }));
      return isHealthResponse(body);
    } catch {
      return false;
    }
  }
}

function isHealthResponse(body: unknown): body is HealthResponse {
  return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
