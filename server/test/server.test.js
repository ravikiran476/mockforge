import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { redisLogBuffer } from '../src/logs.js';
import { normalizeEndpoint } from '../src/model.js';
import { createStore, memoryBackend, redisBackend } from '../src/store.js';
import { seedData } from '../src/seed.js';
import { render } from '../src/template.js';

let server;
let base;

before(async () => {
  const app = createApp({ store: await createStore(memoryBackend(), { seed: seedData() }) });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const admin = (path, init = {}) =>
  fetch(`${base}/__mockforge/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

test('serves a fixture through a template', async () => {
  const res = await fetch(`${base}/api/users`, { headers: { 'X-MockForge-Delay': '0' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const users = await res.json();
  assert.equal(users.length, 3);
});

test('path params and the find helper', async () => {
  const res = await fetch(`${base}/api/users/2`);
  assert.deepEqual((await res.json()).name, 'Alan Turing');
  const missing = await fetch(`${base}/api/users/99`);
  assert.equal(await missing.text(), 'null');
});

test('request body templating', async () => {
  const res = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Linus' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.name, 'Linus');
  assert.ok(res.headers.get('x-request-id'));
});

test('forced failures return the configured error', async () => {
  const res = await fetch(`${base}/api/flaky`, { headers: { 'X-MockForge-Force': 'failure', 'X-MockForge-Delay': '0' } });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('x-mockforge-simulated'), 'failure');
  const ok = await fetch(`${base}/api/flaky`, { headers: { 'X-MockForge-Force': 'success', 'X-MockForge-Delay': '0' } });
  assert.equal(ok.status, 200);
});

test('network failures drop the connection', async () => {
  const created = await (await admin('/endpoints', {
    method: 'POST',
    body: { method: 'GET', path: '/net', failure: { rate: 1, type: 'network' } },
  })).json();
  await assert.rejects(fetch(`${base}/net`));
  await admin(`/endpoints/${created.id}`, { method: 'DELETE' });
});

test('latency is applied', async () => {
  await admin('/endpoints', { method: 'POST', body: { method: 'GET', path: '/slow', latency: { min: 150, max: 150 } } });
  const started = Date.now();
  await fetch(`${base}/slow`);
  assert.ok(Date.now() - started >= 140);
});

test('static paths beat params; unknown paths 404', async () => {
  await admin('/endpoints', { method: 'POST', body: { method: 'GET', path: '/api/users/me', response: { body: '"me"' } } });
  assert.equal(await (await fetch(`${base}/api/users/me`)).json(), 'me');
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test('browsers opening "/" are sent to the admin UI; API clients get JSON', async () => {
  const page = await fetch(`${base}/`, { headers: { Accept: 'text/html' }, redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/__mockforge/');
  const api = await fetch(`${base}/`, { headers: { Accept: 'application/json' } });
  assert.equal(api.status, 404);
});

test('validates endpoint input', async () => {
  const res = await admin('/endpoints', { method: 'POST', body: { method: 'GET', path: 'no-slash' } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /must start/);
});

test('imports endpoints from an OpenAPI spec', async () => {
  const spec = `
openapi: 3.0.3
info: { title: Pets, version: "1.0" }
servers: [{ url: https://api.example.com/v1 }]
paths:
  /pets/{petId}:
    get:
      summary: Get pet
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Pet" }
        "404":
          description: Not found
components:
  schemas:
    Pet:
      type: object
      properties:
        id: { type: integer }
        name: { type: string, example: Rex }
        tags: { type: array, items: { type: string } }
`;
  const preview = await (await admin('/openapi/preview', { method: 'POST', body: { spec } })).json();
  assert.equal(preview.endpoints[0].path, '/v1/pets/:petId');
  assert.equal(preview.endpoints[0].failure.status, 404);

  const summary = await (await admin('/openapi/import', { method: 'POST', body: { spec } })).json();
  assert.equal(summary.created, 1);
  const pet = await (await fetch(`${base}/v1/pets/7`)).json();
  assert.deepEqual(pet, { id: 1, name: 'Rex', tags: ['string'] });

  const again = await (await admin('/openapi/import', { method: 'POST', body: { spec } })).json();
  assert.equal(again.skipped, 1);
});

test('fixture names are unique and export/import round-trips', async () => {
  const dup = await admin('/fixtures', { method: 'POST', body: { name: 'users', data: [] } });
  assert.equal(dup.status, 409);

  const exported = await (await admin('/export')).json();
  const res = await admin('/import', { method: 'POST', body: { data: exported, mode: 'replace' } });
  assert.equal(res.status, 200);
  const health = await (await admin('/health')).json();
  assert.equal(health.endpoints, exported.endpoints.length);
});

test('request log records mock traffic', async () => {
  await fetch(`${base}/api/users/1?debug=1`);
  const logs = await (await admin('/logs')).json();
  assert.equal(logs[0].endpointName, 'Get user by id');
  assert.equal(logs[0].status, 200);
});

async function listen(app) {
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { srv, url: `http://127.0.0.1:${srv.address().port}` };
}

test('admin token protects the admin API but not mocks', async () => {
  const app = createApp({ store: await createStore(memoryBackend(), { seed: seedData() }), adminToken: 's3cret' });
  const { srv, url } = await listen(app);
  try {
    assert.equal((await fetch(`${url}/__mockforge/api/endpoints`)).status, 401);
    assert.equal((await fetch(`${url}/__mockforge/api/endpoints`, { headers: { 'X-MockForge-Token': 'nope' } })).status, 401);
    const ok = await fetch(`${url}/__mockforge/api/endpoints`, { headers: { Authorization: 'Bearer s3cret' } });
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`${url}/api/users/1`)).status, 200);
  } finally {
    srv.close();
  }
});

test('public deploys keep the admin API closed until a token is set', async () => {
  const app = createApp({ store: await createStore(memoryBackend(), { seed: seedData() }), requireToken: true });
  const { srv, url } = await listen(app);
  try {
    assert.equal((await fetch(`${url}/__mockforge/api/health`)).status, 503);
  } finally {
    srv.close();
  }
});

test('shared stores pick up writes from other instances', async () => {
  const backend = memoryBackend();
  const a = await createStore(backend, { seed: seedData(), shared: true });
  const b = await createStore(backend, { shared: true });
  await a.remove('endpoints', a.list('endpoints')[0].id);
  await b.refresh(); // checked less than a second ago: may still be stale
  await b.refresh({ force: true });
  assert.equal(b.list('endpoints').length, a.list('endpoints').length);
});

test('concurrent writes from two instances are both kept', async () => {
  const backend = memoryBackend();
  const a = await createStore(backend, { seed: seedData(), shared: true });
  const b = await createStore(backend, { shared: true });
  const before = a.list('endpoints').length;
  // b has not seen a's write; its save must not overwrite it.
  await a.insert('endpoints', normalizeEndpoint({ path: '/from-a' }));
  await b.insert('endpoints', normalizeEndpoint({ path: '/from-b' }));
  const reader = await createStore(backend, { shared: true });
  assert.deepEqual(reader.list('endpoints').slice(before).map((e) => e.path), ['/from-a', '/from-b']);
  // Seeding an existing backend never replaces its data.
  const late = await createStore(backend, { seed: { endpoints: [], fixtures: [] }, shared: true });
  assert.equal(late.list('endpoints').length, before + 2);
});

test('redis backend stores what redis.set did and refuses stale writes', async () => {
  const redis = fakeRedis();
  // An existing deployment: data written by the previous version, no revision key yet.
  await redis.set('mockforge:data', { version: 1, endpoints: [], fixtures: [{ id: 'f', name: 'old', data: 1 }] });
  const backend = redisBackend(redis);
  const store = await createStore(backend, { seed: seedData(), shared: true });
  assert.deepEqual(store.list('fixtures').map((f) => f.name), ['old']);

  await store.insert('endpoints', normalizeEndpoint({ path: '/x' }));
  assert.equal(await backend.revision(), 1);
  assert.equal(typeof redis.raw('mockforge:data'), 'string');
  assert.equal(JSON.parse(redis.raw('mockforge:data')).endpoints[0].path, '/x');
  assert.equal(await backend.write({}, 0), null);
  assert.equal(redis.calls.filter((c) => c === 'get mockforge:data').length, 0); // never a full read per request

  await store.refresh({ force: true });
  assert.deepEqual(redis.calls.slice(-1), ['get mockforge:data:revision']);
});

test('openapi import saves once, however many operations it has', async () => {
  const inner = memoryBackend();
  let writes = 0;
  const counting = { ...inner, write: (d, r) => (writes++, inner.write(d, r)) };
  const { srv, url } = await listen(createApp({ store: await createStore(counting, { seed: seedData() }) }));
  try {
    const paths = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`/things${i}`, { get: { responses: { 200: { description: 'ok' } } } }]));
    writes = 0;
    const res = await fetch(`${url}/__mockforge/api/openapi/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: { openapi: '3.0.0', info: { title: 't', version: '1' }, paths } }),
    });
    assert.deepEqual(await res.json(), { created: 25, replaced: 0, skipped: 0 });
    assert.equal(writes, 1);
  } finally {
    srv.close();
  }
});

test('values inside JSON strings are escaped', async () => {
  const name = 'Ada "the first"\nLovelace\\';
  const res = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  assert.equal((await res.json()).name, name);

  // Outside quotes values are still inserted as written, and plain-text bodies are untouched.
  assert.equal(render('{"n": {{query.n}}, "s": "{{query.s}}"}', { query: { n: '2', s: 'a"b' } }, { json: true }), '{"n": 2, "s": "a\\"b"}');
  assert.equal(render('Hello "{{query.s}}"', { query: { s: 'a"b' } }), 'Hello "a"b"');
  assert.equal(render('{"u": "{{fixtures.u}}"}', { fixtures: { u: { id: 1 } } }, { json: true }), '{"u": "{\\"id\\":1}"}');
});

test('requested delays are capped', async () => {
  const { srv, url } = await listen(createApp({ store: await createStore(memoryBackend(), { seed: seedData() }), maxDelayMs: 50 }));
  try {
    const started = Date.now();
    const res = await fetch(`${url}/api/users`, { headers: { 'X-MockForge-Delay': '600000' } });
    assert.equal(res.status, 200);
    assert.ok(Date.now() - started < 1000);
  } finally {
    srv.close();
  }
});

test('without a token the admin API only answers this machine', async () => {
  const admin = (headers = {}) => fetch(`${base}/__mockforge/api/endpoints`, { headers });
  assert.equal((await admin()).status, 200);
  assert.equal((await admin({ Origin: 'http://localhost:5173' })).status, 200); // the Vite dev UI
  const foreign = await admin({ Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  // fetch() ignores a Host header, so these two go through node:http.
  const withHost = (host) =>
    new Promise((resolve, reject) => {
      http.get(`${base}/__mockforge/api/endpoints`, { headers: { Host: host } }, (res) => resolve(res.resume().statusCode)).on('error', reject);
    });
  assert.equal(await withHost('attacker.example'), 403); // DNS rebinding
  assert.equal(await withHost('192.168.1.20:4000'), 403); // another machine on the LAN
  assert.equal(await withHost('localhost:4000'), 200);

  const preflight = await fetch(`${base}/__mockforge/api/import`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);

  // Mocks stay open to every origin.
  const mock = await fetch(`${base}/api/users/1`, { headers: { Origin: 'https://app.example' } });
  assert.equal(mock.headers.get('access-control-allow-origin'), '*');
});

test('redis log writes are rate-limited', async () => {
  const redis = fakeRedis();
  const logs = redisLogBuffer(redis, { perSecond: 3 });
  for (let i = 0; i < 10; i++) await logs.add({ id: i });
  assert.equal((await logs.list()).length, 3);
});

/** Just enough of @upstash/redis for the backend: values are JSON-serialized like the real client. */
function fakeRedis() {
  const values = new Map();
  const lists = new Map();
  const calls = [];
  const parse = (v) => {
    if (v === undefined) return null;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  const ser = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v));
  const api = {
    calls,
    raw: (k) => values.get(k),
    async get(k) {
      calls.push(`get ${k}`);
      return parse(values.get(k));
    },
    async set(k, v) {
      values.set(k, ser(v));
      return 'OK';
    },
    async mget(...keys) {
      calls.push(`mget ${keys.join(' ')}`);
      return keys.map((k) => parse(values.get(k)));
    },
    // Runs the store's compare-and-set script with the same semantics as the Lua.
    async eval(script, [dataKey, revisionKey], [data, expected]) {
      assert.match(script, /redis\.call\('SET', KEYS\[1\], ARGV\[1\]\)/);
      const current = Number(values.get(revisionKey) ?? 0);
      if (current !== Number(expected)) return -1;
      values.set(dataKey, data);
      values.set(revisionKey, String(current + 1));
      return current + 1;
    },
    pipeline() {
      const ops = [];
      const p = {
        lpush: (k, v) => (ops.push(() => lists.set(k, [ser(v), ...(lists.get(k) ?? [])])), p),
        ltrim: (k, a, b) => (ops.push(() => lists.set(k, (lists.get(k) ?? []).slice(a, b + 1))), p),
        exec: async () => ops.forEach((op) => op()),
      };
      return p;
    },
    async lrange(k, a, b) {
      return (lists.get(k) ?? []).slice(a, b + 1).map(parse);
    },
    async del(k) {
      lists.delete(k);
    },
  };
  return api;
}
