import { buildApp } from './bootstrap.js';
import { ADMIN_PREFIX } from './model.js';

const port = Number(process.env.PORT) || 4000;
// Local by default. HOST=0.0.0.0 shares the mocks with other devices (a phone, a VM); the
// admin API then still needs MOCKFORGE_ADMIN_TOKEN for any request that is not from this machine.
const hosts = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'];
const { app, store } = await buildApp();

const listening = await Promise.all(
  hosts.map(
    (host) =>
      new Promise((resolve, reject) => {
        const server = app.listen(port, host);
        server.once('listening', () => resolve(host));
        server.once('error', (err) => {
          // A machine without IPv6 has no ::1; 127.0.0.1 is enough there.
          if (host === '::1' && (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT')) resolve(null);
          else reject(err);
        });
      }),
  ),
);

const shown = hosts.length > 1 ? 'localhost' : process.env.HOST;
console.log(`MockForge mock server  http://${shown}:${port}  (listening on ${listening.filter(Boolean).join(', ')})`);
console.log(`Admin UI               http://${shown}:${port}${ADMIN_PREFIX}/  (after "npm run build"; use :5173 in dev)`);
console.log(`Storage                ${store.location}`);
if (process.env.MOCKFORGE_ADMIN_TOKEN) console.log('Admin API              protected by MOCKFORGE_ADMIN_TOKEN');
else console.log('Admin API              local requests only (set MOCKFORGE_ADMIN_TOKEN to allow others)');
