import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createStore, memoryBackend } from '../src/store.js';
import { seedData } from '../src/seed.js';

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
  await b.refresh();
  assert.equal(b.list('endpoints').length, a.list('endpoints').length);
});
