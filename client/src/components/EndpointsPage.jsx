import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { EmptyState, MethodBadge } from './common.jsx';
import EndpointEditor from './EndpointEditor.jsx';

export const blankEndpoint = () => ({
  name: '',
  description: '',
  method: 'GET',
  path: '/api/',
  enabled: true,
  response: { status: 200, headers: {}, body: '{\n  "message": "Hello from MockForge"\n}' },
  latency: { min: 0, max: 0 },
  failure: { rate: 0, type: 'status', status: 500, body: '{\n  "error": "Simulated failure"\n}' },
});

export default function EndpointsPage({ endpoints, fixtures, refresh, notify }) {
  const [selectedId, setSelectedId] = useState(() => endpoints[0]?.id ?? null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? endpoints.filter((e) => `${e.method} ${e.path} ${e.name} ${e.tags.join(' ')}`.toLowerCase().includes(q))
      : endpoints;
    return [...list].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  }, [endpoints, query]);

  const selected = selectedId === 'new' ? null : endpoints.find((e) => e.id === selectedId) ?? filtered[0] ?? null;
  const isNew = selectedId === 'new' || (!selected && endpoints.length === 0);

  const save = async (draft) => {
    try {
      const saved = isNew ? await api.createEndpoint(draft) : await api.updateEndpoint(selected.id, draft);
      await refresh();
      setSelectedId(saved.id);
      notify(isNew ? 'Endpoint created' : 'Endpoint saved');
      return true;
    } catch (err) {
      notify(err.message, 'error');
      return false;
    }
  };

  const toggle = async (endpoint) => {
    try {
      await api.updateEndpoint(endpoint.id, { enabled: !endpoint.enabled });
      await refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${selected.name}"?`)) return;
    try {
      await api.deleteEndpoint(selected.id);
      await refresh();
      setSelectedId(null);
      notify('Endpoint deleted');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const duplicate = async () => {
    try {
      const copy = await api.duplicateEndpoint(selected.id);
      await refresh();
      setSelectedId(copy.id);
      notify('Duplicated (disabled until you enable it)');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-head">
          <input className="search" placeholder="Filter endpoints…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn primary" onClick={() => setSelectedId('new')}>+ New</button>
        </div>
        <ul className="list">
          {filtered.map((e) => (
            <li key={e.id}>
              <button
                className={`list-item ${!isNew && selected?.id === e.id ? 'active' : ''} ${e.enabled ? '' : 'disabled'}`}
                onClick={() => setSelectedId(e.id)}
              >
                <div className="list-row">
                  <MethodBadge method={e.method} />
                  <span className="path">{e.path}</span>
                </div>
                <div className="list-meta">
                  <span className="muted">{e.name}</span>
                  <span className="chips">
                    <span className="chip">{e.response.status}</span>
                    {e.latency.max > 0 && <span className="chip">{e.latency.min === e.latency.max ? `${e.latency.max}ms` : `${e.latency.min}–${e.latency.max}ms`}</span>}
                    {e.failure.rate > 0 && <span className="chip warn">{Math.round(e.failure.rate * 100)}% fail</span>}
                  </span>
                </div>
              </button>
              <label className="switch" title={e.enabled ? 'Enabled' : 'Disabled'}>
                <input type="checkbox" checked={e.enabled} onChange={() => toggle(e)} />
                <span />
              </label>
            </li>
          ))}
          {filtered.length === 0 && <li className="muted pad">{query ? 'No matches.' : 'No endpoints yet.'}</li>}
        </ul>
      </aside>

      <section className="panel">
        {isNew || selected ? (
          <EndpointEditor
            key={isNew ? 'new' : `${selected.id}:${selected.updatedAt}`}
            endpoint={isNew ? blankEndpoint() : selected}
            isNew={isNew}
            fixtures={fixtures}
            onSave={save}
            onDelete={remove}
            onDuplicate={duplicate}
            onCancel={() => setSelectedId(null)}
          />
        ) : (
          <EmptyState title="Select an endpoint">
            <p>Pick an endpoint on the left, create one, or import an OpenAPI spec.</p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}
