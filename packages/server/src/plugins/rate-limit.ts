// The per-socket rate limit (docs/server.md#hardening, ADR-0066): a Socket.io middleware ahead of every event listener.

import { ERROR_CODES, RATE_LIMIT_EVENTS_PER_SECOND, type AckFailure } from '@battleship/core';
import fp from 'fastify-plugin';

import type { Clock } from '../clock.js';
import { createRateLimiter } from '../rate-limiter.js';

/** The rate limit's window: `RATE_LIMIT_EVENTS_PER_SECOND` counts events per second. */
const RATE_LIMIT_WINDOW_MS = 1_000;

/** What the `rate-limit` plugin needs. */
export interface RateLimitOptions {
  /** The server's clock, which times each inbound event; tests pass a fake one (ADR-0065). */
  readonly clock: Clock;
}

/**
 * Gives every socket its own limiter: an inbound event beyond `RATE_LIMIT_EVENTS_PER_SECOND` in any second is dropped
 * before any listener sees it, `ECHO` and malformed commands included, and its ack, if it has one, gets
 * `{ ok: false, error: 'RATE_LIMITED' }`. The first refusal of a run is logged at `info`; the next ones are not, so a
 * flood cannot flood the log. The socket stays connected.
 */
export default fp<RateLimitOptions>(
  (app, { clock }, done) => {
    app.io.on('connection', (socket) => {
      const limiter = createRateLimiter(RATE_LIMIT_EVENTS_PER_SECOND, RATE_LIMIT_WINDOW_MS);
      /** Whether the last event was refused, so only the first refusal of a run is logged. */
      let isLimited = false;
      socket.use((packet, next) => {
        if (limiter.tryAcquire(clock.now())) {
          isLimited = false;
          next();
          return;
        }
        if (!isLimited) {
          isLimited = true;
          app.log.info({ socketId: socket.id, event: packet[0] }, 'Socket rate limited');
        }
        // Socket.io appends the ack callback to the packet's arguments when the client asked for one.
        const ack: unknown = packet.at(-1);
        if (typeof ack === 'function') {
          const refusal: AckFailure = { ok: false, error: ERROR_CODES.RATE_LIMITED };
          (ack as (response: AckFailure) => void)(refusal);
        }
      });
    });
    done();
  },
  { name: 'rate-limit', fastify: '5.x', dependencies: ['socket-io'] },
);
