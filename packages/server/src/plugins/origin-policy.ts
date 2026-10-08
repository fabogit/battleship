// HTTP side of the origin policy (ADR-0021): the 403 hook and CORS. The Socket.io handshake applies the same matcher
// in the `socket-io` plugin.

import cors from '@fastify/cors';
import fp from 'fastify-plugin';

import { corsOrigin, type OriginMatcher } from '../origins.js';

/** What the `origin-policy` plugin needs. */
export interface OriginPolicyOptions {
  /** The matcher built from `ALLOWED_ORIGINS` (ADR-0021, ADR-0024); the `socket-io` plugin gets the same one. */
  readonly isOriginAllowed: OriginMatcher;
}

/**
 * Refuses HTTP requests from foreign origins with a plain 403 before any route runs, and answers CORS for the allowed
 * ones. Wrapped with `fastify-plugin`, so the hook applies to the routes of the instance that registers it.
 */
export default fp<OriginPolicyOptions>(
  (app, options, done) => {
    const { isOriginAllowed } = options;

    app.addHook('onRequest', async (request, reply) => {
      if (!isOriginAllowed(request.headers.origin)) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Origin not allowed' });
      }
    });

    // Socket.io handles /socket.io/ requests before Fastify sees them, so CORS is configured on both.
    // Both apply the matcher, so the policy does not depend on the hook above running first.
    void app.register(cors, {
      origin: (origin, callback) => {
        callback(null, corsOrigin(isOriginAllowed, origin));
      },
    });

    done();
  },
  { name: 'origin-policy', fastify: '5.x' },
);
