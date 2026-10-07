import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SERVER_URL } from './server-url';
import { GIVE_UP_AFTER_MS, ServerWakeService } from './server-wake';

const HEALTH_URL = 'https://server.test/health';
const HEALTHY = { status: 'ok', uptime: 1 };

let service: ServerWakeService;
let http: HttpTestingController;

beforeEach(() => {
  vi.useFakeTimers();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SERVER_URL, useValue: 'https://server.test' }],
  });
  service = TestBed.inject(ServerWakeService);
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  http.verify();
  vi.useRealTimers();
});

/** What a browser sees while Render serves its loading page: no CORS headers, so the request fails. */
function failAsWaking(): void {
  http.expectOne(HEALTH_URL).error(new ProgressEvent('error'), { status: 0 });
}

describe('ServerWakeService', () => {
  it('reports awake as soon as /health answers', async () => {
    const isAwake = service.wake();
    expect(service.status()).toBe('waking');

    http.expectOne(HEALTH_URL).flush(HEALTHY);

    await expect(isAwake).resolves.toBe(true);
    expect(service.status()).toBe('awake');
  });

  it('treats failed, non-JSON and unexpected responses as still waking', async () => {
    const isAwake = service.wake();

    failAsWaking();
    await vi.advanceTimersToNextTimerAsync();
    http.expectOne(HEALTH_URL).flush('<!doctype html><title>Service waking up</title>');
    await vi.advanceTimersToNextTimerAsync();
    http.expectOne(HEALTH_URL).flush({ status: 'starting' });
    await vi.advanceTimersToNextTimerAsync();
    expect(service.status()).toBe('waking');
    http.expectOne(HEALTH_URL).flush(HEALTHY);

    await expect(isAwake).resolves.toBe(true);
  });

  it('backs off exponentially, capped at 5 s between attempts', async () => {
    const start = Date.now();
    void service.wake();

    const attemptsAt: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      if (attempt > 0) {
        await vi.advanceTimersToNextTimerAsync();
      }
      attemptsAt.push(Date.now() - start);
      failAsWaking();
    }

    expect(attemptsAt).toEqual([0, 500, 1_500, 3_500, 7_500, 12_500, 17_500]);
  });

  it('gives every attempt the time left before giving up as its timeout', async () => {
    void service.wake();

    const first = http.expectOne(HEALTH_URL);
    expect(first.request.timeout).toBe(GIVE_UP_AFTER_MS);
    first.error(new ProgressEvent('error'), { status: 0 });
    await vi.advanceTimersToNextTimerAsync();

    expect(http.expectOne(HEALTH_URL).request.timeout).toBe(GIVE_UP_AFTER_MS - 500);
  });

  it('waits for a /health request that Render holds open while the instance starts', async () => {
    const isAwake = service.wake();
    const held = http.expectOne(HEALTH_URL);

    await vi.advanceTimersByTimeAsync(20_000);
    http.expectNone(HEALTH_URL);
    held.flush(HEALTHY);

    await expect(isAwake).resolves.toBe(true);
  });

  it('gives up without a new attempt when a held request times out at the deadline', async () => {
    let isAwake: boolean | undefined;
    void service.wake().then((result) => (isAwake = result));
    const held = http.expectOne(HEALTH_URL);

    await vi.advanceTimersByTimeAsync(GIVE_UP_AFTER_MS);
    held.error(new ProgressEvent('timeout'), { status: 0, statusText: 'Request timeout' });
    await vi.runAllTimersAsync();

    expect(isAwake).toBe(false);
    expect(service.status()).toBe('unreachable');
    http.expectNone(HEALTH_URL);
  });

  it('gives up after about 90 s and can be retried', async () => {
    const start = Date.now();
    let isAwake: boolean | undefined;
    void service.wake().then((result) => (isAwake = result));

    while (isAwake === undefined && Date.now() - start <= GIVE_UP_AFTER_MS) {
      failAsWaking();
      await vi.advanceTimersToNextTimerAsync();
    }

    expect(isAwake).toBe(false);
    expect(Date.now() - start).toBe(GIVE_UP_AFTER_MS);
    expect(service.status()).toBe('unreachable');

    const retried = service.wake();
    expect(service.status()).toBe('waking');
    http.expectOne(HEALTH_URL).flush(HEALTHY);
    await expect(retried).resolves.toBe(true);
  });

  it('shares one poll between concurrent callers and skips polling once awake', async () => {
    const first = service.wake();
    const second = service.wake();
    http.expectOne(HEALTH_URL).flush(HEALTHY);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);

    await expect(service.wake()).resolves.toBe(true);
    http.expectNone(HEALTH_URL);
  });
});
