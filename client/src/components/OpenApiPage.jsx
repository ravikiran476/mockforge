import { useState } from 'react';
import { api } from '../api.js';
import { Field, MethodBadge, readFile } from './common.jsx';

const SAMPLE = `openapi: 3.0.3
info:
  title: Pet Store
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
paths:
  /pets:
    get:
      summary: List pets
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/Pet" }
  /pets/{petId}:
    get:
      summary: Get a pet
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Pet" }
        "404":
          description: Pet not found
components:
  schemas:
    Pet:
      type: object
      properties:
        id: { type: integer, example: 42 }
        name: { type: string, example: Rex }
        status: { type: string, enum: [available, sold] }
`;

export default function OpenApiPage({ refresh, notify, onDone }) {
  const [spec, setSpec] = useState('');
  const [basePath, setBasePath] = useState('');
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [mode, setMode] = useState('skip');
  const [busy, setBusy] = useState(false);

  const load = async (file) => {
    if (!file) return;
    setSpec(await readFile(file));
    setPreview(null);
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      const result = await api.previewOpenApi({ spec, basePath });
      setPreview(result);
      setSelected(new Set(result.endpoints.map((e) => e.key)));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    try {
      const summary = await api.importOpenApi({ spec, basePath, mode, select: [...selected] });
      await refresh();
      notify(`Imported: ${summary.created} created, ${summary.replaced} replaced, ${summary.skipped} skipped`);
      onDone();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const allSelected = preview && selected.size === preview.endpoints.length;

  return (
    <div className="page">
      <div className="card">
        <h2>Generate endpoints from OpenAPI</h2>
        <p className="muted">
          Paste or upload an OpenAPI 3.x or Swagger 2.0 document (JSON or YAML). Each operation becomes a mock that
          returns its documented example, or a sample generated from its schema. The first documented 4xx/5xx response
          becomes the endpoint's failure response.
        </p>
        <div className="body-tools">
          <label className="btn ghost small file">
            Upload file
            <input type="file" accept=".json,.yaml,.yml" onChange={(e) => load(e.target.files[0])} />
          </label>
          <button type="button" className="btn ghost small" onClick={() => { setSpec(SAMPLE); setPreview(null); }}>
            Use sample spec
          </button>
        </div>
        <textarea
          className="code"
          rows={16}
          spellCheck={false}
          value={spec}
          onChange={(e) => { setSpec(e.target.value); setPreview(null); }}
          placeholder="openapi: 3.0.0 …"
        />
        <div className="grid-2">
          <Field label="Path prefix" hint="Leave empty to use the path from servers[0].url (or basePath in Swagger 2). Use / for none.">
            <input className="mono" value={basePath} onChange={(e) => { setBasePath(e.target.value); setPreview(null); }} placeholder="auto" />
          </Field>
          <div className="actions end">
            <button className="btn primary" disabled={!spec.trim() || busy} onClick={runPreview}>Preview endpoints</button>
          </div>
        </div>
      </div>

      {preview && (
        <div className="card">
          <div className="editor-head">
            <div>
              <h3>{preview.title} {preview.version && <span className="muted">v{preview.version}</span>}</h3>
              <span className="muted small">{preview.endpoints.length} operations · prefix <code>{preview.basePath || '(none)'}</code></span>
            </div>
            <div className="actions">
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="skip">Skip existing routes</option>
                <option value="replace">Replace existing routes</option>
              </select>
              <button className="btn primary" disabled={!selected.size || busy} onClick={runImport}>
                Import {selected.size} endpoint{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(preview.endpoints.map((e) => e.key)))}
                  />
                </th>
                <th>Route</th>
                <th>Name</th>
                <th>Status</th>
                <th>Sample body</th>
              </tr>
            </thead>
            <tbody>
              {preview.endpoints.map((e) => (
                <tr key={e.key}>
                  <td><input type="checkbox" checked={selected.has(e.key)} onChange={() => toggle(e.key)} /></td>
                  <td className="nowrap">
                    <MethodBadge method={e.method} /> <code>{e.path}</code>
                    {e.exists && <span className="chip warn">exists</span>}
                  </td>
                  <td>{e.name}</td>
                  <td>{e.response.status}</td>
                  <td><pre className="code tiny">{e.response.body.slice(0, 300) || '—'}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
