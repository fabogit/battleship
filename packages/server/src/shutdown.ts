import type { FastifyBaseLogger } from 'fastify';

/** Hard stop for a shutdown that never completes, well below Render's SIGKILL 30 s after SIGTERM. */
export const SHUTDOWN_DEADLINE_MS = 10_000;

/** `SIGTERM` is how Render stops an instance on deploy; `SIGINT` is Ctrl+C in a local run. */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** The part of `process` the handler uses; tests pass a fake. */
export interface SignalProcess {
  /**
   * Registers a signal listener, as `process.on` does.
   * @param event The signal to listen for.
   * @param listener Called on every delivery of the signal, repeats included.
   * @returns Ignored; `process.on` returns `process` for chaining.
   */
  on(event: NodeJS.Signals, listener: () => void): unknown;
  /**
   * Ends the process at once, as `process.exit` does; called only when the shutdown failed or timed out.
   * @param code The exit code; always 1 here.
   */
  exit(code: number): void;
}

/** The part of the Fastify instance the handler uses; `app.close()` runs the graceful shutdown. */
export interface Closable {
  /** The app's logger: `info` for the signal received, `error` for a failed or timed-out shutdown. */
  readonly log: Pick<FastifyBaseLogger, 'info' | 'error'>;
  /**
   * Runs the graceful shutdown (`preClose` and `onClose` hooks, then the HTTP server).
   * @returns Settles once the app is closed; a rejection makes the handler exit with code 1.
   */
  close(): PromiseLike<unknown>;
}

/** Overrides for tests; production passes none. */
export interface ShutdownOptions {
  /** Where signals come from and how the process exits; the real `process` by default. */
  readonly process?: SignalProcess;
  /** How long the close may take before the process exits with code 1; `SHUTDOWN_DEADLINE_MS` by default. */
  readonly deadlineMs?: number;
}

/**
 * Closes the app on the first `SIGTERM`/`SIGINT` and ignores the ones that follow (ADR-0027): pnpm and npm forward
 * Ctrl+C to the script, which also gets it from the terminal, so node sees SIGINT twice. Exits with code 1 when the
 * close fails or does not finish within the deadline; a clean close lets the process exit on its own.
 * @param app The instance to close.
 * @param options The process and the deadline, for tests.
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
