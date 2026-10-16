export function MethodBadge({ method }) {
  return <span className={`method m-${method.toLowerCase()}`}>{method}</span>;
}

export function StatusBadge({ status }) {
  const tone = status === 0 ? 'net' : status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx';
  return <span className={`status s-${tone}`}>{status === 0 ? 'DROP' : status}</span>;
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Edits a { name: value } object as rows. */
export function KeyValueEditor({ value, onChange, keyPlaceholder = 'Header', valuePlaceholder = 'Value' }) {
  const rows = Object.entries(value || {});
  const update = (index, key, val) => {
    const next = rows.map((row, i) => (i === index ? [key, val] : row));
    onChange(Object.fromEntries(next));
  };
  const remove = (index) => onChange(Object.fromEntries(rows.filter((_, i) => i !== index)));
  const add = () => {
    let name = 'X-Custom-Header';
    for (let n = 2; Object.hasOwn(value || {}, name); n++) name = `X-Custom-Header-${n}`;
    onChange({ ...value, [name]: '' });
  };

  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <div className="kv-row" key={i}>
          <input value={k} placeholder={keyPlaceholder} onChange={(e) => update(i, e.target.value, v)} />
          <input value={v} placeholder={valuePlaceholder} onChange={(e) => update(i, k, e.target.value)} />
          <button type="button" className="icon-btn" onClick={() => remove(i)} aria-label="Remove">×</button>
        </div>
      ))}
      <button type="button" className="btn ghost small" onClick={add}>+ Add header</button>
    </div>
  );
}

export function formatJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export function download(filename, data) {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
