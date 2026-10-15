import { HttpClient } from '@angular/common/http';
import { Service, inject, signal } from '@angular/core';
import type { HealthResponse } from '@battleship/core';
import { firstValueFrom } from 'rxjs';

import { SERVER_URL } from './server-url';

/** The states of the wake-up poll, as `ServerWakeService.status` reports them (ADR-0043). */
export const WAKE_STATUSES = {
  /** No poll started yet. */
  IDLE: 'idle',
  /** Polling `GET /health`. */
  WAKING: 'waking',
  /** The server answered. */
  AWAKE: 'awake',
  /** No answer within `GIVE_UP_AFTER_MS`. */
  UNREACHABLE: 'unreachable',
} as const;

/** One of the `WAKE_STATUSES`. */
export type WakeStatus = (typeof WAKE_STATUSES)[keyof typeof WAKE_STATUSES];

/** Delay before the first retry; doubles after every failed attempt up to `MAX_RETRY_DELAY_MS`. */
export const FIRST_RETRY_DELAY_MS = 500;
/** Longest pause between two attempts, so the poll keeps trying every few seconds near the end of a long wake-up. */
export const MAX_RETRY_DELAY_MS = 5_000;
/** Render's free tier wakes up in ~24 s as measured (docs/deployment.md#hosting-facts-render-free); 90 s leaves room for slow starts. */
export const GIVE_UP_AFTER_MS = 90_000;
/**
 * How long `startedAt` waits for `/health`, in ms. It asks a server the socket has just reached, so an answer is quick;
 * without one the room page explains a refused seat without telling a restart apart (ADR-0075).
 */
export const STARTED_AT_TIMEOUT_MS = 10_000;

/** Milliseconds in a second: `HealthResponse.uptime` is in seconds. */
const MS_PER_SECOND = 1_000;

/** Options of `ServerWakeService.wake`. */
export interface WakeOptions {
  /**
   * Polls even when the server already answered, e.g. after it announced a restart (`SERVER_SHUTDOWN`, #51 F15): the
   * instance that answered is gone, and the next one may still be starting.
   */
  readonly isForced?: boolean;
}

/**
 * Polls `GET /health` until the server answers, so the Socket.io connection is only opened on a
 * running server (docs/client.md#cold-start-handling). While Render spins up it serves its own HTML
 * page without CORS headers: every failed, non-JSON or unexpected response counts as "still waking".
 */
@Service()
export class ServerWakeService {
  /** For the poll: plain HTTP, so the Socket.io connection opens only once the server is up. */
  private readonly http = inject(HttpClient);
  /** The server's `GET /health`, under the `SERVER_URL` baked in at build time (ADR-0052). */
  private readonly healthUrl = `${inject(SERVER_URL)}/health`;

  /** Written by `poll()` only; read through `status`. */
  private readonly statusSignal = signal<WakeStatus>(WAKE_STATUSES.IDLE);
  /** Where the poll stands; the server status banner shows it (docs/client.md#cold-start-handling). */
  readonly status = this.statusSignal.asReadonly();

  /** The poll in progress, shared by concurrent `wake()` calls; `undefined` between polls. */
  private polling: Promise<boolean> | undefined;

  /**
   * Starts polling, or joins the poll in progress; returns at once when the server already answered, unless forced. A
   * poll that gave up does not stop later calls from starting a new one.
   * @param options `isForced` polls again after the server answered.
   * @returns Resolves `true` once the server is up, `false` after `GIVE_UP_AFTER_MS` without an answer; never rejects.
   */
  wake(options: WakeOptions = {}): Promise<boolean> {
    if (this.statusSignal() === WAKE_STATUSES.AWAKE && options.isForced !== true) {
      return Promise.resolve(true);
    }
    this.polling ??= this.poll().finally(() => {
      this.polling = undefined;
    });
    return this.polling;
  }

  /**
   * Asks the server when it started, so the client can tell whether it restarted since a seat was taken: rooms live in
   * the server's memory, and a restart loses them (ADR-0075). One request, no retries; `status` does not change.
   * @returns `Date.now()` minus the server's `uptime`, in epoch ms on this device's clock; `null` when `/health` does not
   * answer with a `HealthResponse` within `STARTED_AT_TIMEOUT_MS`. Never rejects.
   */
  async startedAt(): Promise<number | null> {
    try {
      const body = await firstValueFrom(this.http.get<unknown>(this.healthUrl, { timeout: STARTED_AT_TIMEOUT_MS }));
      const uptime = uptimeOf(body);
      return uptime === null ? null : Date.now() - uptime * MS_PER_SECOND;
    } catch {
      return null;
    }
  }

  /**
   * Retries `/health` with exponential backoff until it answers or `GIVE_UP_AFTER_MS` passes, setting `status` to
   * `WAKING`, then `AWAKE` or `UNREACHABLE`.
   * @returns Whether the server answered before the deadline.
   */
  private async poll(): Promise<boolean> {
    this.statusSignal.set(WAKE_STATUSES.WAKING);
    const deadline = Date.now() + GIVE_UP_AFTER_MS;
    for (let delay = FIRST_RETRY_DELAY_MS; ; delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.statusSignal.set(WAKE_STATUSES.UNREACHABLE);
        return false;
      }
      // Render holds `/health` open until the instance is ready, so an attempt may use all the time left;
      // the backoff only spaces out fast failures (CORS errors, its loading page).
      if (await this.isHealthy(remaining)) {
        this.statusSignal.set(WAKE_STATUSES.AWAKE);
        return true;
      }
      await sleep(Math.min(delay, deadline - Date.now()));
    }
  }

  /**
   * Makes one attempt.
   * @param timeoutMs How long the request may stay open: the time left before the deadline.
   * @returns Whether the server answered with a `HealthResponse`; network errors, timeouts, CORS failures and Render's
   * loading page all count as not yet.
   */
  private async isHealthy(timeoutMs: number): Promise<boolean> {
    try {
      const body = await firstValueFrom(this.http.get<unknown>(this.healthUrl, { timeout: timeoutMs }));
      return isHealthResponse(body);
    } catch {
      return false;
    }
  }
}

/**
 * Checks the body as well as the status: any answer but the server's own counts as still waking.
 * @param body The parsed response body.
 * @returns Whether it is an object with `status: 'ok'`; `uptime` is not checked.
 */
function isHealthResponse(body: unknown): body is HealthResponse {
  return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
}

/**
 * Reads the server's uptime from a `/health` body, which `isHealthResponse` accepts without it.
 * @param body The parsed response body.
 * @returns The uptime in seconds (`process.uptime()` on the server), or `null` when the body is not a `HealthResponse`
 * with a finite, non-negative `uptime`.
 */
function uptimeOf(body: unknown): number | null {
  if (!isHealthResponse(body)) {
    return null;
  }
  const uptime: unknown = body.uptime;
  return typeof uptime === 'number' && Number.isFinite(uptime) && uptime >= 0 ? uptime : null;
}

/**
 * Waits between two attempts.
 * @param ms The pause, in milliseconds; zero or negative resolves on the next timer tick.
 * @returns Resolves after the pause; never rejects.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
