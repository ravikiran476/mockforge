import { useCallback, useEffect, useState } from 'react';
import { api, AuthError, getToken, MOCK_ORIGIN, setToken } from './api.js';
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

function TokenGate({ onSubmit, rejected }) {
  const [value, setValue] = useState('');
  return (
    <form className="card gate" onSubmit={(e) => { e.preventDefault(); onSubmit(value.trim()); }}>
      <h2>Admin token required</h2>
      <p className="muted">
        This MockForge server protects its admin UI. Enter the value of <code>MOCKFORGE_ADMIN_TOKEN</code>. Mock
        endpoints themselves stay public.
      </p>
      {rejected && <p className="error-text">That token was rejected.</p>}
      <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Admin token" />
      <button className="btn primary" disabled={!value.trim()}>Unlock</button>
    </form>
  );
}

const initialTab = () => {
  const hash = window.location.hash.slice(1);
  return TABS.some((t) => t.id === hash) ? hash : 'endpoints';
};

export default function App() {
  const [tab, setTab] = useState(initialTab);
  const [endpoints, setEndpoints] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [toast, setToast] = useState(null);
  const [offline, setOffline] = useState(null);
  const [auth, setAuth] = useState(null); // null | 'required' | 'rejected'
  const [hasToken, setHasToken] = useState(() => Boolean(getToken()));

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
      setOffline(null);
      setAuth(null);
    } catch (err) {
      if (err instanceof AuthError) {
        setAuth(getToken() ? 'rejected' : 'required');
        setOffline(null);
      } else {
        setOffline(err instanceof TypeError ? "Can't reach the MockForge server." : err.message);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const go = (id) => {
    setTab(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  const unlock = (token) => {
    setToken(token);
    setHasToken(true);
    refresh();
  };

  const signOut = () => {
    setToken('');
    setHasToken(false);
    setEndpoints([]);
    setFixtures([]);
    refresh();
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
          {hasToken && <button className="btn ghost small signout" onClick={signOut}>Sign out</button>}
        </div>
      </header>

      {offline && (
        <div className="banner error">
          {offline} Start it locally with <code>npm run dev</code>, or{' '}
          <button className="link" onClick={refresh}>retry</button>.
        </div>
      )}

      <main className="content">
        {auth && <TokenGate onSubmit={unlock} rejected={auth === 'rejected'} />}
        {!auth && tab === 'endpoints' && <EndpointsPage {...shared} />}
        {!auth && tab === 'fixtures' && <FixturesPage {...shared} />}
        {!auth && tab === 'openapi' && <OpenApiPage {...shared} onDone={() => go('endpoints')} />}
        {!auth && tab === 'logs' && <LogsPage notify={notify} />}
        {!auth && tab === 'data' && <DataPage {...shared} />}
      </main>

      {toast && <div key={toast.at} className={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}
