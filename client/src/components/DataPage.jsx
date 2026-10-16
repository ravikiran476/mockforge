import { useEffect, useState } from 'react';
import { api, MOCK_ORIGIN } from '../api.js';
import { download, readFile } from './common.jsx';

export default function DataPage({ refresh, notify }) {
  const [health, setHealth] = useState(null);
  const [mode, setMode] = useState('merge');

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
  }, []);

  const exportAll = async () => {
    try {
      download('mockforge.json', await api.exportData());
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const importFile = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await readFile(file));
      if (mode === 'replace' && !window.confirm('Replace ALL endpoints and fixtures with the contents of this file?')) return;
      const result = await api.importData(data, mode);
      await refresh();
      setHealth(await api.health());
      notify(`Imported ${result.endpoints} endpoints and ${result.fixtures} fixtures (${result.mode})`);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="page narrow">
      <div className="card">
        <h2>Share across development and testing</h2>
        <p>
          Locally, everything you configure is saved to a single JSON file. Commit it so the whole team and your CI use
          the same mocks and fixtures. A Vercel deploy starts from that file and then keeps changes in Redis — export
          from here to bring them back into the repo.
        </p>
        {health && (
          <dl className="facts">
            <dt>Storage</dt><dd><code>{health.storage}</code></dd>
            <dt>Endpoints</dt><dd>{health.endpoints}</dd>
            <dt>Fixtures</dt><dd>{health.fixtures}</dd>
          </dl>
        )}
        <p className="muted small">
          Point the server at another file with <code>MOCKFORGE_DATA=path/to/file.json npm start</code> — e.g. a
          dedicated file for end-to-end tests.
        </p>
      </div>

      <div className="card">
        <h3>Export / import</h3>
        <div className="body-tools">
          <button className="btn primary" onClick={exportAll}>Download mockforge.json</button>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="merge">Merge (endpoints by id, fixtures by name)</option>
            <option value="replace">Replace everything</option>
          </select>
          <label className="btn ghost file">
            Import file…
            <input type="file" accept=".json" onChange={(e) => { importFile(e.target.files[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Using mocks in tests</h3>
        <p>Set your app's API base URL to <code>{MOCK_ORIGIN}</code>. These request headers make tests deterministic:</p>
        <table className="table">
          <tbody>
            <tr><td><code>X-MockForge-Force: failure</code></td><td>Always return the endpoint's failure response</td></tr>
            <tr><td><code>X-MockForge-Force: success</code></td><td>Never simulate a failure</td></tr>
            <tr><td><code>X-MockForge-Delay: 0</code></td><td>Override latency (ms) for this request</td></tr>
          </tbody>
        </table>
        <p className="muted small">The admin API lives at <code>/__mockforge/api</code>, so test setup can create endpoints and fixtures programmatically:</p>
        <pre className="code">{`await fetch('${MOCK_ORIGIN}/__mockforge/api/fixtures', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',${health?.adminProtected ? "\n    'X-MockForge-Token': process.env.MOCKFORGE_ADMIN_TOKEN," : ''}
  },
  body: JSON.stringify({ name: 'cart', data: { items: [] } }),
});`}</pre>
      </div>
    </div>
  );
}
