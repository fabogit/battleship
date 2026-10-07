import { PROTOCOL_VERSION } from '@battleship/core';

import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { handleShutdownSignals } from './shutdown.js';

const config = loadConfig(process.env);
const app = createServer({
  allowedOrigins: config.allowedOrigins,
  // pino-pretty is a dev dependency: `LOG_FORMAT=pretty` is meant for local runs only.
  logger: config.logFormat === 'pretty' ? { transport: { target: 'pino-pretty' } } : true,
});

handleShutdownSignals(app);

// 0.0.0.0 is required on Render; the platform routes traffic to the container port.
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info({ protocolVersion: PROTOCOL_VERSION, allowedOrigins: config.allowedOrigins }, 'Server ready');
