import { useState } from 'react';
import { api } from '../api.js';
import { EmptyState, Field } from './common.jsx';

const blank = { name: '', description: '', data: [] };

function FixtureEditor({ fixture, isNew, endpoints, onSave, onDelete, onCancel }) {
  const [name, setName] = useState(fixture.name);
  const [description, setDescription] = useState(fixture.description);
  const [text, setText] = useState(() => JSON.stringify(fixture.data, null, 2));
  const [saving, setSaving] = useState(false);

  let parseError = null;
  try {
    JSON.parse(text);
  } catch (err) {
    parseError = err.message;
  }

  const usedBy = isNew ? [] : endpoints.filter((e) =>
    `${e.response.body}\n${e.failure.body}`.includes(`fixtures.${fixture.name}`));

  const submit = async (e) => {
    e.preventDefault();
    if (parseError) return;
    setSaving(true);
    await onSave({ name, description, data: JSON.parse(text) });
    setSaving(false);
  };

  return (
    <form className="editor" onSubmit={submit}>
      <div className="editor-head">
        <h2>{isNew ? 'New fixture' : fixture.name}</h2>
        <div className="actions">
          {!isNew && <button type="button" className="btn danger ghost" onClick={onDelete}>Delete</button>}
          {isNew && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
          <button className="btn primary" disabled={saving || !!parseError}>{isNew ? 'Create' : 'Save'}</button>
        </div>
      </div>
      <div className="card">
        <div className="grid-2">
          <Field label="Name" hint={name ? <>Reference as <code>{`{{fixtures.${name}}}`}</code></> : 'Letters, digits, _ and -'}>
            <input className="mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="users" required />
          </Field>
          <Field label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <Field label="Data (JSON)">
          <textarea className="code" rows={22} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="body-tools">
          {parseError ? <span className="error-text">{parseError}</span> : <span className="ok-text">Valid JSON</span>}
          {!parseError && (
            <button type="button" className="btn ghost small" onClick={() => setText(JSON.stringify(JSON.parse(text), null, 2))}>
              Format
            </button>
          )}
        </div>
      </div>
      {!isNew && (
        <div className="card">
          <h3>Used by</h3>
          {usedBy.length ? (
            <ul className="plain">{usedBy.map((e) => <li key={e.id}><code>{e.method} {e.path}</code> — {e.name}</li>)}</ul>
          ) : (
            <p className="muted">No endpoints reference this fixture yet.</p>
          )}
        </div>
      )}
    </form>
  );
}

export default function FixturesPage({ fixtures, endpoints, refresh, notify }) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = selectedId === 'new' ? null : fixtures.find((f) => f.id === selectedId) ?? fixtures[0] ?? null;
  const isNew = selectedId === 'new' || !selected;

  const save = async (data) => {
    try {
      const saved = isNew ? await api.createFixture(data) : await api.updateFixture(selected.id, data);
      await refresh();
      setSelectedId(saved.id);
      notify(isNew ? 'Fixture created' : 'Fixture saved');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete fixture "${selected.name}"? Endpoints referencing it will render empty values.`)) return;
    try {
      await api.deleteFixture(selected.id);
      await refresh();
      setSelectedId(null);
      notify('Fixture deleted');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="muted">Reusable JSON data shared by endpoints and tests</span>
          <button className="btn primary" onClick={() => setSelectedId('new')}>+ New</button>
        </div>
        <ul className="list">
          {fixtures.map((f) => (
            <li key={f.id}>
              <button className={`list-item ${!isNew && selected?.id === f.id ? 'active' : ''}`} onClick={() => setSelectedId(f.id)}>
                <div className="list-row"><span className="path">{f.name}</span></div>
                <div className="list-meta">
                  <span className="muted">{f.description || '—'}</span>
                  <span className="chip">{Array.isArray(f.data) ? `${f.data.length} items` : typeof f.data}</span>
                </div>
              </button>
            </li>
          ))}
          {fixtures.length === 0 && <li className="muted pad">No fixtures yet.</li>}
        </ul>
      </aside>
      <section className="panel">
        {isNew || selected ? (
          <FixtureEditor
            key={isNew ? 'new' : `${selected.id}:${selected.updatedAt}`}
            fixture={isNew ? blank : selected}
            isNew={isNew}
            endpoints={endpoints}
            onSave={save}
            onDelete={remove}
            onCancel={() => setSelectedId(null)}
          />
        ) : (
          <EmptyState title="No fixture selected" />
        )}
      </section>
    </div>
  );
}
