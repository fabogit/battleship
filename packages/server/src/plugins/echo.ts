// The Phase 0 `ECHO` connectivity check (#3), kept for the production smoke test (`pnpm --filter @battleship/server echo`).

import { CLIENT_EVENTS, PROTOCOL_VERSION, type Ack, type EchoResponse } from '@battleship/core';
import fp from 'fastify-plugin';

/** Acks every `ECHO` with the payload it carried and the server's `PROTOCOL_VERSION`; no guard checks the payload. */
export default fp(
  (app, _options, done) => {
    app.io.on('connection', (socket) => {
      // Inbound arguments are untrusted: a client can emit without an ack, so it is checked before use.
      socket.on(CLIENT_EVENTS.ECHO, (payload: unknown, ack: unknown) => {
        if (typeof ack !== 'function') {
          return;
        }
        const response: EchoResponse = { ok: true, payload, protocolVersion: PROTOCOL_VERSION };
        (ack as Ack<EchoResponse>)(response);
      });
    });
    done();
  },
  { name: 'echo', fastify: '5.x', dependencies: ['socket-io'] },
);
