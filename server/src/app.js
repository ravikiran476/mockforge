import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { adminRouter } from './api.js';
import { mockHandler } from './engine.js';
import { createLogBuffer } from './logs.js';
import { ADMIN_PREFIX } from './model.js';

const digest = (value) => createHash('sha256').update(String(value)).digest();

/**
 * Protects the admin API when `token` is set. With `requireToken` (public deploys)
 * the admin API stays closed until a token is configured.
 */
function adminAuth({ token, requireToken }) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (!token) {
      if (!requireToken) return next();
      return res.status(503).json({ error: 'Admin API is disabled until MOCKFORGE_ADMIN_TOKEN is set on the server' });
    }
    const given = req.get('x-mockforge-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (given && timingSafeEqual(digest(given), digest(token))) return next();
    res.status(401).json({ error: 'Admin token required', auth: true });
  };
}

export function createApp({ store, logs = createLogBuffer(), clientDist, adminToken, requireToken = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // mocks should never answer 304 from a cached ETag

  app.use(cors({ exposedHeaders: ['X-MockForge-Endpoint', 'X-MockForge-Simulated'] }));

  if (clientDist && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(ADMIN_PREFIX, express.static(clientDist));
    app.use(ADMIN_PREFIX, (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Pick up writes made by other instances (no-op for the local file store).
  app.use(async (req, res, next) => {
    if (req.method !== 'OPTIONS') await store.refresh();
    next();
  });

  app.use(
    `${ADMIN_PREFIX}/api`,
    adminAuth({ token: adminToken, requireToken }),
    express.json({ limit: '10mb' }),
    adminRouter({ store, logs }),
  );

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
