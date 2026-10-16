import { normalizeEndpoint, normalizeFixture } from './model.js';

/** Example data written on first start so the UI isn't empty. */
export function seedData() {
  const fixtures = [
    normalizeFixture({
      name: 'users',
      description: 'Sample users shared by the /api/users endpoints',
      data: [
        { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin' },
        { id: 2, name: 'Alan Turing', email: 'alan@example.com', role: 'member' },
        { id: 3, name: 'Grace Hopper', email: 'grace@example.com', role: 'member' },
      ],
    }),
  ];

  const endpoints = [
    normalizeEndpoint({
      name: 'List users',
      method: 'GET',
      path: '/api/users',
      response: { status: 200, body: '{{fixtures.users}}' },
      latency: { min: 100, max: 300 },
    }),
    normalizeEndpoint({
      name: 'Get user by id',
      method: 'GET',
      path: '/api/users/:id',
      response: { status: 200, body: '{{find fixtures.users id=params.id ?? null}}' },
    }),
    normalizeEndpoint({
      name: 'Create user',
      method: 'POST',
      path: '/api/users',
      response: {
        status: 201,
        headers: { 'X-Request-Id': '{{uuid}}' },
        body: '{\n  "id": "{{uuid}}",\n  "name": "{{body.name ?? \'New user\'}}",\n  "createdAt": "{{now}}"\n}',
      },
    }),
    normalizeEndpoint({
      name: 'Flaky service',
      description: 'Slow and fails ~30% of the time — useful for testing loading and retry states.',
      method: 'GET',
      path: '/api/flaky',
      response: { status: 200, body: '{\n  "ok": true\n}' },
      latency: { min: 300, max: 1500 },
      failure: { rate: 0.3, type: 'status', status: 503, body: '{\n  "error": "Service unavailable"\n}' },
    }),
  ];

  return { endpoints, fixtures };
}
