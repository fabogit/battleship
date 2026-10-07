import type { FastifyBaseLogger } from 'fastify';

/** Hard stop for a shutdown that never completes, well below Render's SIGKILL 30 s after SIGTERM. */
export const SHUTDOWN_DEADLINE_MS = 10_000;

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** The part of `process` the handler uses; tests pass a fake. */
export interface SignalProcess {
  on(event: NodeJS.Signals, listener: () => void): unknown;
  exit(code: number): void;
}

/** The part of the Fastify instance the handler uses; `app.close()` runs the graceful shutdown. */
export interface Closable {
  readonly log: Pick<FastifyBaseLogger, 'info' | 'error'>;
  close(): PromiseLike<unknown>;
}

export interface ShutdownOptions {
  readonly process?: SignalProcess;
  readonly deadlineMs?: number;
}

/**
 * Closes the app on the first `SIGTERM`/`SIGINT` and ignores the ones that follow (ADR-0027): pnpm and
 * npm forward Ctrl+C to the script, which also gets it from the terminal, so node sees SIGINT twice.
 * Exits with code 1 when the close fails or does not finish within the deadline; a clean close lets the
 * process exit on its own.
 */
export function handleShutdownSignals(app: Closable, options: ShutdownOptions = {}): void {
  const { process: target = process, deadlineMs = SHUTDOWN_DEADLINE_MS } = options;
  let isClosing = false;

  for (const signal of SHUTDOWN_SIGNALS) {
    // `on`, not `once`: without a listener a repeated signal falls back to Node's default and kills the process.
    target.on(signal, () => {
      if (isClosing) {
        return;
      }
      isClosing = true;
      app.log.info({ signal }, 'Shutting down');

      // Unref'd, so it only fires when something still keeps the process alive.
      setTimeout(() => {
        app.log.error({ deadlineMs }, 'Shutdown timed out');
        target.exit(1);
      }, deadlineMs).unref();

      app.close().then(undefined, (error: unknown) => {
        app.log.error(error, 'Shutdown failed');
        target.exit(1);
      });
    });
  }
}
