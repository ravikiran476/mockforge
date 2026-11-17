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

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** Hostname without the port, for "localhost:4000", "127.0.0.1" and "[::1]:4000". */
function hostOf(value) {
  if (!value) return '';
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return '';
  }
}

/**
 * Protects the admin API.
 *
 * With a token, every request must carry it. Without one (local development), requests are
 * only accepted from this machine: the Host header must be a loopback name, which stops other
 * machines on the network and DNS-rebinding pages, and a browser Origin must be loopback too,
 * which stops other websites from driving the API from a developer's browser.
 * With `requireToken` (public deploys) the admin API stays closed until a token is configured.
 */
function adminAuth({ token, requireToken }) {
  return (req, res, next) => {
    if (!token) {
      if (requireToken) {
        return res.status(503).json({ error: 'Admin API is disabled until MOCKFORGE_ADMIN_TOKEN is set on the server' });
      }
      const origin = req.get('origin');
      let originHost = '';
      try {
        originHost = origin && origin !== 'null' ? new URL(origin).hostname : '';
      } catch {
        originHost = 'invalid';
      }
      if (!LOOPBACK.test(hostOf(req.get('host'))) || (origin && !LOOPBACK.test(originHost))) {
        return res.status(403).json({
          error: 'Without MOCKFORGE_ADMIN_TOKEN, the admin API only accepts requests from this machine. Set a token to use it from elsewhere.',
        });
      }
      return next();
    }
    const given = req.get('x-mockforge-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (given && timingSafeEqual(digest(given), digest(token))) return next();
    res.status(401).json({ error: 'Admin token required', auth: true });
  };
}

export function createApp({
  store,
  logs = createLogBuffer(),
  clientDist,
  adminToken,
  requireToken = false,
  maxDelayMs = 30_000,
  logUnmatched = true,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // mocks should never answer 304 from a cached ETag

  if (clientDist && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(ADMIN_PREFIX, express.static(clientDist));
    app.use(ADMIN_PREFIX, (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Pick up writes made by other instances (no-op for the local file store). The admin API
  // always reads the latest data; mocks may be up to a second behind.
  app.use(async (req, res, next) => {
    if (req.method !== 'OPTIONS') await store.refresh({ force: req.path.toLowerCase().startsWith(`${ADMIN_PREFIX}/api`) });
    next();
  });

  // No CORS headers here: the admin UI is served from the same origin (or through the Vite proxy).
  app.use(
    `${ADMIN_PREFIX}/api`,
    adminAuth({ token: adminToken, requireToken }),
    express.json({ limit: '10mb' }),
    adminRouter({ store, logs, adminProtected: Boolean(adminToken) }),
  );

  // Mocks are open to any origin, since any frontend dev server may call them.
  app.use(
    cors({ exposedHeaders: ['X-MockForge-Endpoint', 'X-MockForge-Simulated'] }),
    express.json({ limit: '5mb', strict: false }),
    express.urlencoded({ extended: true }),
    express.text({ type: ['text/*', 'application/xml'] }),
    mockHandler({ store, logs, maxDelayMs, logUnmatched }),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return app;
}
