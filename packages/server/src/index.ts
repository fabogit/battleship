import { PROTOCOL_VERSION } from '@battleship/core';

import { LOG_FORMATS, loadConfig } from './config.js';
import { createServer } from './server.js';
import { handleShutdownSignals } from './shutdown.js';

/** Read once, before anything listens: a missing or malformed variable throws here and the deploy fails at startup. */
const config = loadConfig(process.env);
/** The one server instance; closed by the signal handler (ADR-0027). */
const app = createServer({
  allowedOrigins: config.allowedOrigins,
  logger: {
    level: config.logLevel,
    // pino-pretty is a dev dependency: `LOG_FORMAT=pretty` is meant for local runs only.
    ...(config.logFormat === LOG_FORMATS.PRETTY ? { transport: { target: 'pino-pretty' } } : {}),
  },
});

handleShutdownSignals(app);

// 0.0.0.0 is required on Render; the platform routes traffic to the container port.
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info({ protocolVersion: PROTOCOL_VERSION, allowedOrigins: config.allowedOrigins }, 'Server ready');
