import { Router } from 'express';
import { HttpError, normalizeEndpoint, normalizeFixture } from './model.js';
import { endpointsFromSpec, parseSpec } from './openapi.js';

const routeKey = (e) => `${e.method} ${e.path}`;

export function adminRouter({ store, logs, adminProtected = false }) {
  const router = Router();

  const mustGet = (kind, id) => {
    const item = store.get(kind, id);
    if (!item) throw new HttpError(404, `${kind === 'fixtures' ? 'Fixture' : 'Endpoint'} not found`);
    return item;
  };

  const assertUniqueFixtureName = (name, ignoreId) => {
    if (store.list('fixtures').some((f) => f.name === name && f.id !== ignoreId)) {
      throw new HttpError(409, `A fixture named "${name}" already exists`);
    }
  };

  router.get('/health', async (req, res) => {
    res.json({
      ok: true,
      storage: store.location,
      adminProtected: Boolean(adminProtected),
      endpoints: store.list('endpoints').length,
      fixtures: store.list('fixtures').length,
    });
  });

  // ---- Endpoints -----------------------------------------------------------
  router.get('/endpoints', async (req, res) => res.json(store.list('endpoints')));

  router.get('/endpoints/:id', async (req, res) => res.json(mustGet('endpoints', req.params.id)));

  router.post('/endpoints', async (req, res) => {
    const { id, ...input } = req.body ?? {};
    res.status(201).json(await store.insert('endpoints', normalizeEndpoint(input)));
  });

  router.put('/endpoints/:id', async (req, res) => {
    const current = mustGet('endpoints', req.params.id);
    const next = normalizeEndpoint(req.body ?? {}, current);
    res.json(await store.replace('endpoints', current.id, next));
  });

  router.post('/endpoints/:id/duplicate', async (req, res) => {
    const { id, createdAt, ...source } = mustGet('endpoints', req.params.id);
    const copy = normalizeEndpoint({ ...source, name: `${source.name} (copy)`, enabled: false });
    res.status(201).json(await store.insert('endpoints', copy));
  });

  router.delete('/endpoints/:id', async (req, res) => {
    if (!(await store.remove('endpoints', req.params.id))) throw new HttpError(404, 'Endpoint not found');
    res.status(204).end();
  });

  // ---- Fixtures ------------------------------------------------------------
  router.get('/fixtures', async (req, res) => res.json(store.list('fixtures')));

  router.post('/fixtures', async (req, res) => {
    const { id, ...input } = req.body ?? {};
    const fixture = normalizeFixture(input);
    assertUniqueFixtureName(fixture.name);
    res.status(201).json(await store.insert('fixtures', fixture));
  });

  router.put('/fixtures/:id', async (req, res) => {
    const current = mustGet('fixtures', req.params.id);
    const next = normalizeFixture(req.body ?? {}, current);
    assertUniqueFixtureName(next.name, current.id);
    res.json(await store.replace('fixtures', current.id, next));
  });

  router.delete('/fixtures/:id', async (req, res) => {
    if (!(await store.remove('fixtures', req.params.id))) throw new HttpError(404, 'Fixture not found');
    res.status(204).end();
  });

  // ---- OpenAPI -------------------------------------------------------------
  const generate = (body = {}) => {
    const basePath = typeof body.basePath === 'string' && body.basePath.trim() ? body.basePath.trim() : undefined;
    return endpointsFromSpec(parseSpec(body.spec), { basePath });
  };

  router.post('/openapi/preview', async (req, res) => {
    const result = generate(req.body);
    const existing = new Set(store.list('endpoints').map(routeKey));
    res.json({
      ...result,
      endpoints: result.endpoints.map((e) => ({ ...e, key: routeKey(e), exists: existing.has(routeKey(e)) })),
    });
  });

  router.post('/openapi/import', async (req, res) => {
    const { endpoints } = generate(req.body);
    const mode = req.body?.mode === 'replace' ? 'replace' : 'skip';
    const selected = Array.isArray(req.body?.select) ? new Set(req.body.select) : null;
    const drafts = endpoints.filter((e) => !selected || selected.has(routeKey(e))).map((e) => normalizeEndpoint(e));

    // One write for the whole import, however many operations the spec has.
    const summary = await store.update((data) => {
      const counts = { created: 0, replaced: 0, skipped: 0 };
      for (const draft of drafts) {
        const index = data.endpoints.findIndex((e) => routeKey(e) === routeKey(draft));
        if (index !== -1 && mode === 'skip') {
          counts.skipped++;
        } else if (index !== -1) {
          const existing = data.endpoints[index];
          data.endpoints[index] = { ...draft, id: existing.id, createdAt: existing.createdAt };
          counts.replaced++;
        } else {
          data.endpoints.push(draft);
          counts.created++;
        }
      }
      return counts;
    });
    res.json(summary);
  });

  // ---- Request log ---------------------------------------------------------
  router.get('/logs', async (req, res) => res.json(await logs.list()));
  router.delete('/logs', async (req, res) => {
    await logs.clear();
    res.status(204).end();
  });

  // ---- Export / import (share fixtures across dev & test) -------------------
  router.get('/export', async (req, res) => {
    const { endpoints, fixtures } = store.snapshot();
    res.set('Content-Disposition', 'attachment; filename="mockforge.json"');
    res.json({ version: 1, exportedAt: new Date().toISOString(), endpoints, fixtures });
  });

  router.post('/import', async (req, res) => {
    const { data, mode = 'merge' } = req.body ?? {};
    if (!data || typeof data !== 'object') throw new HttpError(400, 'Expected { data: <exported MockForge JSON> }');
    const incomingEndpoints = (data.endpoints || []).map((e) => normalizeEndpoint(e, { id: e.id, createdAt: e.createdAt }));
    const incomingFixtures = (data.fixtures || []).map((f) => normalizeFixture(f, { id: f.id, createdAt: f.createdAt }));

    const names = new Set();
    for (const f of incomingFixtures) {
      if (names.has(f.name)) throw new HttpError(400, `Duplicate fixture name "${f.name}" in import`);
      names.add(f.name);
    }

    if (mode === 'replace') {
      await store.setAll({ endpoints: incomingEndpoints, fixtures: incomingFixtures });
    } else {
      // Merged into the latest data, so a concurrent edit elsewhere is kept.
      await store.update((data) => {
        const endpoints = new Map(data.endpoints.map((e) => [e.id, e]));
        for (const e of incomingEndpoints) endpoints.set(e.id, e);
        const fixtures = new Map(data.fixtures.map((f) => [f.name, f]));
        for (const f of incomingFixtures) fixtures.set(f.name, { ...f, id: fixtures.get(f.name)?.id ?? f.id });
        data.endpoints = [...endpoints.values()];
        data.fixtures = [...fixtures.values()];
      });
    }
    res.json({ mode, endpoints: incomingEndpoints.length, fixtures: incomingFixtures.length });
  });

  router.use((req, res) => res.status(404).json({ error: `Unknown admin route ${req.method} ${req.path}` }));

  return router;
}
