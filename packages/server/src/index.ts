import { PROTOCOL_VERSION } from '@battleship/core';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

const config = loadConfig(process.env);
const { app } = createServer({ allowedOrigins: config.allowedOrigins, logger: true });

if (config.allowedOrigins.length === 0) {
  app.log.warn('ALLOWED_ORIGINS is empty: browser clients from any origin will be rejected');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Shutting down');
    app.close().catch((error: unknown) => {
      app.log.error(error, 'Shutdown failed');
      process.exitCode = 1;
    });
  });
}

// 0.0.0.0 is required on Render; the platform routes traffic to the container port.
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info({ protocolVersion: PROTOCOL_VERSION, allowedOrigins: config.allowedOrigins }, 'Server ready');
