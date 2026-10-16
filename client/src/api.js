const BASE = '/__mockforge/api';

/** Where mocks are served. In dev the UI runs on Vite (:5173) and mocks on :4000. */
export const MOCK_ORIGIN =
  import.meta.env.VITE_MOCK_ORIGIN || (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);

const TOKEN_KEY = 'mockforge.adminToken';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the token lasts for this page load only */
  }
  memoryToken = token;
}

let memoryToken = getToken();

export class AuthError extends Error {}

async function request(method, url, body) {
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
  if (memoryToken) headers['X-MockForge-Token'] = memoryToken;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status === 401) throw new AuthError(data?.error || 'Admin token required');
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  health: () => request('GET', '/health'),

  listEndpoints: () => request('GET', '/endpoints'),
  createEndpoint: (e) => request('POST', '/endpoints', e),
  updateEndpoint: (id, e) => request('PUT', `/endpoints/${id}`, e),
  duplicateEndpoint: (id) => request('POST', `/endpoints/${id}/duplicate`),
  deleteEndpoint: (id) => request('DELETE', `/endpoints/${id}`),

  listFixtures: () => request('GET', '/fixtures'),
  createFixture: (f) => request('POST', '/fixtures', f),
  updateFixture: (id, f) => request('PUT', `/fixtures/${id}`, f),
  deleteFixture: (id) => request('DELETE', `/fixtures/${id}`),

  previewOpenApi: (body) => request('POST', '/openapi/preview', body),
  importOpenApi: (body) => request('POST', '/openapi/import', body),

  listLogs: () => request('GET', '/logs'),
  clearLogs: () => request('DELETE', '/logs'),

  exportData: () => request('GET', '/export'),
  importData: (data, mode) => request('POST', '/import', { data, mode }),
};
