import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { adminRouter } from './api.js';
import { mockHandler } from './engine.js';
import { createLogBuffer } from './logs.js';
import { ADMIN_PREFIX } from './model.js';

export function createApp({ store, logs = createLogBuffer(), clientDist } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // mocks should never answer 304 from a cached ETag

  app.use(cors({ exposedHeaders: ['X-MockForge-Endpoint', 'X-MockForge-Simulated'] }));

  app.use(`${ADMIN_PREFIX}/api`, express.json({ limit: '10mb' }), adminRouter({ store, logs }));

  if (clientDist && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(ADMIN_PREFIX, express.static(clientDist));
    app.use(ADMIN_PREFIX, (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(
    express.json({ limit: '5mb', strict: false }),
    express.urlencoded({ extended: true }),
    express.text({ type: ['text/*', 'application/xml'] }),
    mockHandler({ store, logs }),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return app;
}
