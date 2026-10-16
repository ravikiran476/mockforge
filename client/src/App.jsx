import { useCallback, useEffect, useState } from 'react';
import { api, MOCK_ORIGIN } from './api.js';
import EndpointsPage from './components/EndpointsPage.jsx';
import FixturesPage from './components/FixturesPage.jsx';
import OpenApiPage from './components/OpenApiPage.jsx';
import LogsPage from './components/LogsPage.jsx';
import DataPage from './components/DataPage.jsx';

const TABS = [
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'openapi', label: 'OpenAPI import' },
  { id: 'logs', label: 'Request log' },
  { id: 'data', label: 'Share & sync' },
];

const initialTab = () => {
  const hash = window.location.hash.slice(1);
  return TABS.some((t) => t.id === hash) ? hash : 'endpoints';
};

export default function App() {
  const [tab, setTab] = useState(initialTab);
  const [endpoints, setEndpoints] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [toast, setToast] = useState(null);
  const [offline, setOffline] = useState(false);

  const notify = useCallback((message, kind = 'ok') => {
    setToast({ message, kind, at: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(async () => {
    try {
      const [e, f] = await Promise.all([api.listEndpoints(), api.listFixtures()]);
      setEndpoints(e);
      setFixtures(f);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const go = (id) => {
    setTab(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  const shared = { endpoints, fixtures, refresh, notify };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">M</span>
          <span>MockForge</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => go(t.id)}>
              {t.label}
              {t.id === 'endpoints' && <span className="count">{endpoints.length}</span>}
              {t.id === 'fixtures' && <span className="count">{fixtures.length}</span>}
            </button>
          ))}
        </nav>
        <div className="origin" title="Point your frontend at this base URL">
          Mocks at <code>{MOCK_ORIGIN}</code>
        </div>
      </header>

      {offline && (
        <div className="banner error">
          Can't reach the MockForge server. Start it with <code>npm run dev</code> and{' '}
          <button className="link" onClick={refresh}>retry</button>.
        </div>
      )}

      <main className="content">
        {tab === 'endpoints' && <EndpointsPage {...shared} />}
        {tab === 'fixtures' && <FixturesPage {...shared} />}
        {tab === 'openapi' && <OpenApiPage {...shared} onDone={() => go('endpoints')} />}
        {tab === 'logs' && <LogsPage notify={notify} />}
        {tab === 'data' && <DataPage {...shared} />}
      </main>

      {toast && <div key={toast.at} className={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}
