import { randomUUID } from 'node:crypto';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'ANY'];
export const FAILURE_TYPES = ['status', 'network'];
export const ADMIN_PREFIX = '/__mockforge';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function toNumber(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
  return n;
}

function toBodyString(body) {
  if (body === undefined || body === null) return '';
  return typeof body === 'string' ? body : JSON.stringify(body, null, 2);
}

function toHeaders(headers, label) {
  if (headers === undefined || headers === null) return {};
  if (!isPlainObject(headers)) throw new HttpError(400, `${label} must be an object of name/value pairs`);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const name = k.trim();
    if (!name) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new HttpError(400, `Invalid header name "${name}"`);
    out[name] = String(v);
  }
  return out;
}

function toStatus(value, fallback, label) {
  const status = toNumber(value, fallback, label);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new HttpError(400, `${label} must be an integer between 100 and 599`);
  }
  return status;
}

/**
 * Validates and fills defaults for an endpoint definition.
 * `existing` is the stored version when updating; `input` is merged over it.
 */
export function normalizeEndpoint(input = {}, existing = {}) {
  if (!isPlainObject(input)) throw new HttpError(400, 'Endpoint must be an object');
  const merged = { ...existing, ...input };

  const method = String(merged.method || 'GET').toUpperCase();
  if (!METHODS.includes(method)) throw new HttpError(400, `Unsupported method "${merged.method}"`);

  const path = String(merged.path || '').trim();
  if (!path.startsWith('/')) throw new HttpError(400, 'Path must start with "/"');
  if (path.toLowerCase().startsWith(ADMIN_PREFIX)) {
    throw new HttpError(400, `Paths under ${ADMIN_PREFIX} are reserved for MockForge`);
  }

  const rawResponse = { ...existing.response, ...input.response };
  const response = {
    status: toStatus(rawResponse.status, 200, 'Response status'),
    headers: toHeaders(rawResponse.headers, 'Response headers'),
    body: toBodyString(rawResponse.body),
  };

  const rawLatency = { ...existing.latency, ...input.latency };
  const min = Math.max(0, toNumber(rawLatency.min, 0, 'Latency min'));
  const max = Math.max(min, toNumber(rawLatency.max, min, 'Latency max'));

  const rawFailure = { ...existing.failure, ...input.failure };
  const rate = toNumber(rawFailure.rate, 0, 'Failure rate');
  if (rate < 0 || rate > 1) throw new HttpError(400, 'Failure rate must be between 0 and 1');
  const type = rawFailure.type || 'status';
  if (!FAILURE_TYPES.includes(type)) throw new HttpError(400, `Failure type must be one of: ${FAILURE_TYPES.join(', ')}`);

  const now = new Date().toISOString();
  return {
    id: existing.id || (typeof input.id === 'string' && input.id) || randomUUID(),
    name: String(merged.name || '').trim() || `${method} ${path}`,
    description: String(merged.description || ''),
    method,
    path,
    enabled: merged.enabled !== false,
    tags: Array.isArray(merged.tags) ? merged.tags.map(String) : [],
    response,
    latency: { min, max },
    failure: {
      rate,
      type,
      status: toStatus(rawFailure.status, 500, 'Failure status'),
      body: rawFailure.body === undefined ? '{\n  "error": "Simulated failure"\n}' : toBodyString(rawFailure.body),
    },
    createdAt: existing.createdAt || merged.createdAt || now,
    updatedAt: now,
  };
}

export const FIXTURE_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function normalizeFixture(input = {}, existing = {}) {
  if (!isPlainObject(input)) throw new HttpError(400, 'Fixture must be an object');
  const merged = { ...existing, ...input };
  const name = String(merged.name || '').trim();
  if (!FIXTURE_NAME.test(name)) {
    throw new HttpError(400, 'Fixture name must start with a letter or "_" and contain only letters, digits, "_" or "-"');
  }
  if (merged.data === undefined) throw new HttpError(400, 'Fixture data is required');
  const now = new Date().toISOString();
  return {
    id: existing.id || (typeof input.id === 'string' && input.id) || randomUUID(),
    name,
    description: String(merged.description || ''),
    data: merged.data,
    createdAt: existing.createdAt || merged.createdAt || now,
    updatedAt: now,
  };
}
