import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleShutdownSignals, type Closable } from '../src/shutdown.js';

const DEADLINE_MS = 1_000;

class FakeProcess extends EventEmitter {
  readonly exit = vi.fn<(code: number) => void>();
}

let target: FakeProcess;

/** The mocks are returned on their own: asserting on `app.close` would detach a method from its object. */
function fakeApp(onClose: () => Promise<unknown>) {
  const info = vi.fn();
  const error = vi.fn();
  const close = vi.fn(onClose);
  const app: Closable = { log: { info, error }, close };
  return { app, info, error, close };
}

const neverSettles = (): Promise<unknown> => new Promise(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
  target = new FakeProcess();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleShutdownSignals', () => {
  it('closes once when pnpm delivers SIGINT twice', async () => {
    const { app, info, close } = fakeApp(() => Promise.resolve());
    handleShutdownSignals(app, { process: target, deadlineMs: DEADLINE_MS });

    target.emit('SIGINT');
    target.emit('SIGINT');
    await vi.advanceTimersByTimeAsync(0);

    expect(close).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(target.exit).not.toHaveBeenCalled();
  });

  it('ignores a different signal once closing', () => {
    const { app, close } = fakeApp(neverSettles);
    handleShutdownSignals(app, { process: target, deadlineMs: DEADLINE_MS });

    target.emit('SIGTERM');
    target.emit('SIGINT');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps a listener for repeated signals, so they never fall back to the default kill', () => {
    handleShutdownSignals(fakeApp(neverSettles).app, { process: target, deadlineMs: DEADLINE_MS });

    target.emit('SIGINT');

    expect(target.listenerCount('SIGINT')).toBe(1);
    expect(target.listenerCount('SIGTERM')).toBe(1);
  });

  it('exits with code 1 when the close never completes', async () => {
    const { app, error } = fakeApp(neverSettles);
    handleShutdownSignals(app, { process: target, deadlineMs: DEADLINE_MS });

    target.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(target.exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(target.exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith({ deadlineMs: DEADLINE_MS }, 'Shutdown timed out');
  });

  it('exits with code 1 when the close fails', async () => {
    const failure = new Error('close failed');
    const { app, error } = fakeApp(() => Promise.reject(failure));
    handleShutdownSignals(app, { process: target, deadlineMs: DEADLINE_MS });

    target.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(target.exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(failure, 'Shutdown failed');
  });
});
