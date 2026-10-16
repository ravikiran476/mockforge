import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { EmptyState, MethodBadge, StatusBadge } from './common.jsx';

export default function LogsPage({ notify }) {
  const [logs, setLogs] = useState([]);
  const [live, setLive] = useState(true);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      setLogs(await api.listLogs());
    } catch {
      /* the app-level banner reports connectivity */
    }
  }, []);

  useEffect(() => {
    load();
    if (!live) return undefined;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load, live]);

  const clear = async () => {
    await api.clearLogs();
    setLogs([]);
    notify('Log cleared');
  };

  return (
    <div className="page">
      <div className="card">
        <div className="editor-head">
          <div>
            <h2>Request log</h2>
            <span className="muted small">Last {logs.length} mock requests (kept in memory, newest first)</span>
          </div>
          <div className="actions">
            <label className="inline-check">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live
            </label>
            <button className="btn ghost" onClick={load}>Refresh</button>
            <button className="btn danger ghost" onClick={clear} disabled={!logs.length}>Clear</button>
          </div>
        </div>
        {logs.length === 0 ? (
          <EmptyState title="No requests yet">
            <p>Call any mock endpoint and it will show up here.</p>
          </EmptyState>
        ) : (
          <table className="table logs">
            <thead>
              <tr><th>Time</th><th>Request</th><th>Status</th><th>Duration</th><th>Endpoint</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <Fragment key={l.id}>
                  <tr className="clickable" onClick={() => setOpen(open === l.id ? null : l.id)}>
                    <td className="nowrap muted">{new Date(l.time).toLocaleTimeString()}</td>
                    <td><MethodBadge method={l.method} /> <code>{l.url}</code></td>
                    <td className="nowrap">
                      <StatusBadge status={l.status} />
                      {l.simulatedFailure && <span className="chip warn">simulated</span>}
                    </td>
                    <td className="nowrap">{l.duration} ms{l.delay ? <span className="muted"> ({l.delay} delay)</span> : null}</td>
                    <td>{l.matched ? l.endpointName : <span className="muted">no match</span>}</td>
                  </tr>
                  {open === l.id && (
                    <tr className="detail">
                      <td colSpan={5}>
                        {l.note && <p className="warn-text">{l.note}</p>}
                        {l.query && <><h4>Query</h4><pre className="code">{l.query}</pre></>}
                        {l.requestBody && <><h4>Request body</h4><pre className="code">{l.requestBody}</pre></>}
                        {l.responseBody && <><h4>Response body</h4><pre className="code">{l.responseBody}</pre></>}
                        {!l.note && !l.query && !l.requestBody && !l.responseBody && <p className="muted">No body.</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
