import { buildApp } from './bootstrap.js';
import { ADMIN_PREFIX } from './model.js';

const port = Number(process.env.PORT) || 4000;
const { app, store } = await buildApp();

app.listen(port, () => {
  console.log(`MockForge mock server  http://localhost:${port}`);
  console.log(`Admin UI               http://localhost:${port}${ADMIN_PREFIX}/  (after "npm run build"; use :5173 in dev)`);
  console.log(`Storage                ${store.location}`);
  if (process.env.MOCKFORGE_ADMIN_TOKEN) console.log('Admin API              protected by MOCKFORGE_ADMIN_TOKEN');
});
