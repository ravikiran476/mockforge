import { useMemo, useState } from 'react';
import { Field, KeyValueEditor, formatJson } from './common.jsx';
import TryIt from './TryIt.jsx';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'ANY'];
const QUICK_STATUSES = [200, 201, 204, 400, 401, 403, 404, 422, 500, 503];

function BodyEditor({ value, onChange, fixtures, rows = 12 }) {
  const formatted = formatJson(value);
  return (
    <div className="body-editor">
      <textarea className="code" rows={rows} spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="body-tools">
        <button type="button" className="btn ghost small" disabled={!formatted} onClick={() => onChange(formatted)}>
          Format JSON
        </button>
        {fixtures.length > 0 && <span className="muted small">Insert fixture:</span>}
        {fixtures.map((f) => (
          <button
            type="button"
            key={f.id}
            className="chip button"
            onClick={() => onChange(value.trim() ? `${value}{{fixtures.${f.name}}}` : `{{fixtures.${f.name}}}`)}
          >
            {f.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function EndpointEditor({ endpoint, isNew, fixtures, onSave, onDelete, onDuplicate, onCancel }) {
  const [draft, setDraft] = useState(endpoint);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(endpoint), [draft, endpoint]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setIn = (key, patch) => setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  };

  const params = [...draft.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);

  return (
    <form className="editor" onSubmit={submit}>
      <div className="editor-head">
        <div>
          <h2>{isNew ? 'New endpoint' : draft.name || `${draft.method} ${draft.path}`}</h2>
          {dirty && <span className="unsaved">Unsaved changes</span>}
        </div>
        <div className="actions">
          {!isNew && <button type="button" className="btn ghost" onClick={onDuplicate}>Duplicate</button>}
          {!isNew && <button type="button" className="btn danger ghost" onClick={onDelete}>Delete</button>}
          {isNew && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
          <button type="submit" className="btn primary" disabled={saving || (!dirty && !isNew)}>
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="route">
          <select value={draft.method} onChange={(e) => set({ method: e.target.value })}>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <input
            className="mono grow"
            value={draft.path}
            onChange={(e) => set({ path: e.target.value })}
            placeholder="/api/users/:id"
            required
          />
          <label className="inline-check">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled
          </label>
        </div>
        <p className="field-hint">
          Use <code>:name</code> for path params and <code>*</code> for a trailing wildcard.
          {params.length > 0 && <> Params: {params.map((p) => <code key={p}>{`{{params.${p}}}`}</code>)}</>}
        </p>
        <div className="grid-2">
          <Field label="Name"><input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="List users" /></Field>
          <Field label="Description"><input value={draft.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
      </div>

      <div className="card">
        <h3>Response</h3>
        <div className="status-row">
          <Field label="Status">
            <input
              type="number"
              min="100"
              max="599"
              value={draft.response.status}
              onChange={(e) => setIn('response', { status: Number(e.target.value) })}
            />
          </Field>
          <div className="quick">
            {QUICK_STATUSES.map((s) => (
              <button
                type="button"
                key={s}
                className={`chip button ${draft.response.status === s ? 'selected' : ''}`}
                onClick={() => setIn('response', { status: s })}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <Field label="Headers">
          <KeyValueEditor value={draft.response.headers} onChange={(headers) => setIn('response', { headers })} />
        </Field>
        <Field label="Body" hint="Content-Type defaults to application/json when the rendered body is valid JSON.">
          <BodyEditor value={draft.response.body} onChange={(body) => setIn('response', { body })} fixtures={fixtures} />
        </Field>
        <details className="help">
          <summary>Template reference</summary>
          <table>
            <tbody>
              <tr><td><code>{'{{params.id}}'}</code></td><td>Path parameter</td></tr>
              <tr><td><code>{'{{query.page ?? 1}}'}</code></td><td>Query string value with a fallback</td></tr>
              <tr><td><code>{'{{body.name}}'}</code></td><td>Field from the JSON / form request body</td></tr>
              <tr><td><code>{'{{headers.authorization}}'}</code></td><td>Request header (lower-case name)</td></tr>
              <tr><td><code>{'{{fixtures.users}}'}</code></td><td>Whole fixture, inserted as JSON</td></tr>
              <tr><td><code>{'{{find fixtures.users id=params.id}}'}</code></td><td>First item whose <code>id</code> matches</td></tr>
              <tr><td><code>{'{{filter fixtures.users role="admin"}}'}</code></td><td>All matching items</td></tr>
              <tr><td><code>{'{{length fixtures.users}}'}</code></td><td>Array length</td></tr>
              <tr><td><code>{'{{uuid}} {{now}} {{timestamp}} {{randomInt 1 100}}'}</code></td><td>Generated values</td></tr>
            </tbody>
          </table>
          <p className="muted small">Strings are inserted as-is (wrap them in quotes inside JSON); objects, arrays and numbers are inserted as JSON.</p>
        </details>
      </div>

      <div className="card">
        <h3>Latency</h3>
        <div className="grid-3">
          <Field label="Min (ms)">
            <input type="number" min="0" value={draft.latency.min} onChange={(e) => setIn('latency', { min: Number(e.target.value) })} />
          </Field>
          <Field label="Max (ms)">
            <input type="number" min="0" value={draft.latency.max} onChange={(e) => setIn('latency', { max: Number(e.target.value) })} />
          </Field>
          <div className="quick end">
            {[[0, 0, 'None'], [200, 600, 'Typical'], [1500, 3000, 'Slow 3G'], [8000, 10000, 'Very slow']].map(([min, max, label]) => (
              <button type="button" key={label} className="chip button" onClick={() => setIn('latency', { min, max })}>{label}</button>
            ))}
          </div>
        </div>
        <p className="field-hint">Each request waits a random time between min and max.</p>
      </div>

      <div className="card">
        <h3>Failure simulation</h3>
        <div className="grid-3">
          <Field label={`Failure rate: ${Math.round(draft.failure.rate * 100)}%`}>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round(draft.failure.rate * 100)}
              onChange={(e) => setIn('failure', { rate: Number(e.target.value) / 100 })}
            />
          </Field>
          <Field label="Failure type">
            <select value={draft.failure.type} onChange={(e) => setIn('failure', { type: e.target.value })}>
              <option value="status">Error response</option>
              <option value="network">Network error (drop connection)</option>
            </select>
          </Field>
          {draft.failure.type === 'status' && (
            <Field label="Error status">
              <input
                type="number"
                min="100"
                max="599"
                value={draft.failure.status}
                onChange={(e) => setIn('failure', { status: Number(e.target.value) })}
              />
            </Field>
          )}
        </div>
        {draft.failure.type === 'status' && (
          <Field label="Error body">
            <BodyEditor value={draft.failure.body} onChange={(body) => setIn('failure', { body })} fixtures={[]} rows={4} />
          </Field>
        )}
        <p className="field-hint">
          Tests can bypass randomness with the header <code>X-MockForge-Force: failure</code> or <code>success</code>.
        </p>
      </div>

      {!isNew && <TryIt endpoint={endpoint} dirty={dirty} />}
    </form>
  );
}
