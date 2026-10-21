import { signal, type Provider } from '@angular/core';
import { vi } from 'vitest';

import { ServerWakeService, WAKE_STATUSES, type WakeStatus } from '../app/core/server-wake';

/**
 * Stands in for `ServerWakeService` in component tests: `status` is a writable signal, `wake` and `startedAt` are
 * mocks the test resolves. By default the server is awake and its start time unknown.
 */
export class FakeServerWake {
  /** Awake by default; tests set it to see the waking states. */
  readonly status = signal<WakeStatus>(WAKE_STATUSES.AWAKE);
  /** Resolves `true` by default; does not change `status`. */
  readonly wake = vi.fn<ServerWakeService['wake']>(() => Promise.resolve(true));
  /** Resolves `null` by default, as when `/health` does not answer. */
  readonly startedAt = vi.fn<ServerWakeService['startedAt']>(() => Promise.resolve(null));
}

/**
 * Provides a fake in place of `ServerWakeService`.
 * @param fake The fake the test drives.
 * @returns The provider.
 */
export function provideFakeServerWake(fake: FakeServerWake): Provider {
  return { provide: ServerWakeService, useValue: fake };
}
