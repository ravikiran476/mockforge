import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { seedData } from './seed.js';
import { ADMIN_PREFIX } from './model.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.PORT) || 4000;
const dataFile = path.resolve(process.env.MOCKFORGE_DATA || path.join(repoRoot, 'data', 'mockforge.json'));

const store = createStore(dataFile, { seed: seedData() });
const app = createApp({ store, clientDist: path.join(repoRoot, 'client', 'dist') });

app.listen(port, () => {
  console.log(`MockForge mock server  http://localhost:${port}`);
  console.log(`Admin UI               http://localhost:${port}${ADMIN_PREFIX}/  (after "npm run build"; use :5173 in dev)`);
  console.log(`Data file              ${dataFile}`);
});
