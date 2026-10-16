import { useState } from 'react';
import { MOCK_ORIGIN } from '../api.js';
import { StatusBadge, formatJson } from './common.jsx';

const examplePath = (path) => path.replace(/:([A-Za-z0-9_]+)/g, '1').replace(/\*$/, 'example');

export default function TryIt({ endpoint, dirty }) {
  const [url, setUrl] = useState(() => MOCK_ORIGIN + examplePath(endpoint.path));
  const [method, setMethod] = useState(endpoint.method === 'ANY' ? 'GET' : endpoint.method);
  const [body, setBody] = useState(['POST', 'PUT', 'PATCH'].includes(endpoint.method) ? '{\n  "name": "Test"\n}' : '');
  const [force, setForce] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const send = async () => {
    setLoading(true);
    setResult(null);
    const started = performance.now();
    try {
      const headers = {};
      if (force) headers['X-MockForge-Force'] = force;
      if (body && method !== 'GET' && method !== 'HEAD') headers['Content-Type'] = 'application/json';
      const res = await fetch(url, { method, headers, body: method === 'GET' || method === 'HEAD' || !body ? undefined : body });
      const text = await res.text();
      setResult({
        status: res.status,
        ms: Math.round(performance.now() - started),
        headers: [...res.headers.entries()],
        body: formatJson(text) ?? text,
        simulated: res.headers.get('x-mockforge-simulated') === 'failure',
      });
    } catch (err) {
      setResult({ error: err.message || 'Network error', ms: Math.round(performance.now() - started) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h3>Try it</h3>
      {dirty && <p className="field-hint warn-text">Save first — requests hit the saved version.</p>}
      <div className="route">
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => <option key={m}>{m}</option>)}
        </select>
        <input className="mono grow" value={url} onChange={(e) => setUrl(e.target.value)} />
        <select value={force} onChange={(e) => setForce(e.target.value)} title="X-MockForge-Force">
          <option value="">Random outcome</option>
          <option value="success">Force success</option>
          <option value="failure">Force failure</option>
        </select>
        <button type="button" className="btn primary" onClick={send} disabled={loading}>
          {loading ? 'Waiting…' : 'Send'}
        </button>
      </div>
      {method !== 'GET' && method !== 'HEAD' && (
        <textarea className="code" rows={3} spellCheck={false} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Request body (JSON)" />
      )}
      {result && (
        <div className="result">
          <div className="result-head">
            {result.error ? <span className="status s-net">ERROR</span> : <StatusBadge status={result.status} />}
            <span className="muted">{result.ms} ms</span>
            {result.simulated && <span className="chip warn">simulated failure</span>}
            {result.error && <span className="muted">{result.error} (connection dropped or server unreachable)</span>}
          </div>
          {result.headers && (
            <details>
              <summary>Headers ({result.headers.length})</summary>
              <pre className="code">{result.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
            </details>
          )}
          {result.body && <pre className="code">{result.body}</pre>}
        </div>
      )}
    </div>
  );
}
