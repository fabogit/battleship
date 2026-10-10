// Smoke test for a running server, run after every deploy (ADR-0048): connects, sends ECHO and prints the ack. ECHO
// takes no room, so it never uses up MAX_ROOMS.
// Usage: pnpm --filter @battleship/server echo [url] [--origin <origin>] [--transport websocket|polling]
// Exits 0 when the echo comes back, 1 on connection error or timeout.
import { parseArgs } from 'node:util';

import {
  CLIENT_EVENTS,
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type HandshakeAuth,
  type ServerToClientEvents,
} from '@battleship/core';
import { io, type Socket } from 'socket.io-client';

/** How long the connection, and then the ack, may each take before the check fails. */
const TIMEOUT_MS = 10_000;

/** The command line: `--origin` sets the `Origin` header, to check the origin policy; `--transport` the transport. */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    origin: { type: 'string' },
    transport: { type: 'string', default: 'websocket' },
  },
});

/** The server to check; the local default port when none is given. */
const url = positionals[0] ?? 'http://localhost:3000';
/** Only `polling` or `websocket`; anything else falls back to `websocket`, the default. */
const transport = values.transport === 'polling' ? 'polling' : 'websocket';

/** One attempt, no reconnection: the script reports the first failure. */
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
  // The handshake of a client without a room, so the server's protocol check (#22) lets the smoke test in.
  auth: { protocolVersion: PROTOCOL_VERSION } satisfies HandshakeAuth,
  transports: [transport],
  reconnection: false,
  timeout: TIMEOUT_MS,
  ...(values.origin === undefined ? {} : { extraHeaders: { origin: values.origin } }),
});

socket.on('connect_error', (error) => {
  console.error(`connect_error (${transport}): ${error.message}`);
  socket.close();
  process.exitCode = 1;
});

socket.on('connect', () => {
  const payload = { hello: 'battleship', sentAt: new Date().toISOString() };
  socket
    .timeout(TIMEOUT_MS)
    .emitWithAck(CLIENT_EVENTS.ECHO, payload)
    .then(
      (response: unknown) => {
        console.log(`echo (${transport}):`, JSON.stringify(response));
      },
      (error: unknown) => {
        console.error('no echo:', error);
        process.exitCode = 1;
      },
    )
    .finally(() => socket.close());
});
