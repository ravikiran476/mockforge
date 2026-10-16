import { randomUUID } from 'node:crypto';
import { findEndpoint } from './matcher.js';
import { render } from './template.js';
import { ADMIN_PREFIX } from './model.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pickDelay({ min = 0, max = 0 } = {}) {
  return Math.round(min + Math.random() * (max - min));
}

function looksLikeJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function preview(value, limit = 2000) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Express handler that serves every non-admin request from the configured endpoints.
 *
 * Per-request overrides (handy in automated tests):
 *   X-MockForge-Force: failure | success   bypass the random failure roll
 *   X-MockForge-Delay: <ms>                override configured latency
 */
export function mockHandler({ store, logs }) {
  return async (req, res) => {
    const started = Date.now();
    const entry = {
      id: randomUUID(),
      time: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      query: preview(Object.keys(req.query || {}).length ? req.query : undefined),
      requestBody: preview(req.body),
    };
    const finish = (fields) => logs.add({ ...entry, duration: Date.now() - started, ...fields });

    if (req.path.toLowerCase().startsWith(ADMIN_PREFIX)) {
      res.status(404).json({ error: 'Unknown MockForge admin route' });
      return;
    }

    const match = findEndpoint(store.list('endpoints'), req.method, req.path);
    if (!match) {
      res.status(404).json({
        error: 'No mock endpoint matches this request',
        method: req.method,
        path: req.path,
        hint: `Create one in the MockForge UI at ${ADMIN_PREFIX}/`,
      });
      finish({ status: 404, matched: false });
      return;
    }

    const { endpoint, params } = match;
    const fixtures = Object.fromEntries(store.list('fixtures').map((f) => [f.name, f.data]));
    const ctx = {
      params,
      query: { ...req.query },
      headers: req.headers,
      body: req.body ?? null,
      method: req.method,
      path: req.path,
      fixtures,
    };

    const force = String(req.get('x-mockforge-force') || '').toLowerCase();
    const delayHeader = req.get('x-mockforge-delay');
    const delay = delayHeader !== undefined && Number.isFinite(Number(delayHeader))
      ? Math.max(0, Number(delayHeader))
      : pickDelay(endpoint.latency);
    const failed = force === 'failure' ? true : force === 'success' ? false : Math.random() < endpoint.failure.rate;

    if (delay) await sleep(delay);
    const logged = { matched: true, endpointId: endpoint.id, endpointName: endpoint.name, delay, simulatedFailure: failed };

    if (failed && endpoint.failure.type === 'network') {
      finish({ ...logged, status: 0, note: 'Connection dropped (simulated network error)' });
      req.socket.destroy();
      return;
    }

    const spec = failed
      ? { status: endpoint.failure.status, headers: {}, body: endpoint.failure.body }
      : endpoint.response;

    let body;
    const headers = {};
    try {
      body = render(spec.body, ctx);
      for (const [name, value] of Object.entries(spec.headers || {})) headers[name] = render(value, ctx);
    } catch (err) {
      res.status(500).json({ error: 'MockForge template error', message: err.message, endpoint: endpoint.name });
      finish({ ...logged, status: 500, note: `Template error: ${err.message}` });
      return;
    }

    res.status(spec.status);
    res.set('X-MockForge-Endpoint', endpoint.id);
    if (failed) res.set('X-MockForge-Simulated', 'failure');
    res.set(headers);

    const noBody = spec.status === 204 || spec.status === 304 || req.method === 'HEAD' || !body;
    if (!noBody && !res.get('Content-Type')) {
      res.type(looksLikeJson(body) ? 'application/json' : 'text/plain');
    }
    if (noBody) res.end();
    else res.send(body);

    finish({ ...logged, status: spec.status, responseBody: preview(body) });
  };
}
