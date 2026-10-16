import fs from 'node:fs';
import path from 'node:path';

const empty = () => ({ version: 1, endpoints: [], fixtures: [] });

/** JSON file on disk. Meant to be committed so a team shares the same mocks and fixtures. */
export function fileBackend(file) {
  return {
    describe: file,
    async read() {
      if (!fs.existsSync(file)) return null;
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        throw new Error(`Could not parse MockForge data file ${file}: ${err.message}`);
      }
    },
    async write(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
      fs.renameSync(tmp, file);
    },
  };
}

/** Process memory only (tests). */
export function memoryBackend() {
  let saved = null;
  return {
    describe: 'memory',
    read: async () => (saved ? structuredClone(saved) : null),
    write: async (data) => {
      saved = structuredClone(data);
    },
  };
}

/** Upstash Redis (serverless deployments). The whole dataset lives in one JSON key. */
export function redisBackend(redis, key = 'mockforge:data') {
  return {
    describe: `redis (${key})`,
    read: async () => (await redis.get(key)) ?? null,
    write: (data) => redis.set(key, data),
  };
}

/**
 * Reads are synchronous against an in-memory copy. With `shared: true` (several
 * serverless instances writing the same backend) call `refresh()` per request.
 */
export async function createStore(backend, { seed, shared = false } = {}) {
  let data = await backend.read();
  if (data) {
    data = { ...empty(), ...data };
  } else {
    data = { ...empty(), ...structuredClone(seed ?? {}) };
    await backend.write(data);
  }

  const save = () => backend.write(data);

  return {
    location: backend.describe,
    async refresh() {
      if (!shared) return;
      const latest = await backend.read();
      if (latest) data = { ...empty(), ...latest };
    },
    snapshot: () => structuredClone(data),
    list: (kind) => data[kind],
    get: (kind, id) => data[kind].find((item) => item.id === id),
    async insert(kind, item) {
      data[kind].push(item);
      await save();
      return item;
    },
    async replace(kind, id, item) {
      const index = data[kind].findIndex((x) => x.id === id);
      if (index === -1) return null;
      data[kind][index] = item;
      await save();
      return item;
    },
    async remove(kind, id) {
      const before = data[kind].length;
      data[kind] = data[kind].filter((x) => x.id !== id);
      if (data[kind].length === before) return false;
      await save();
      return true;
    },
    /** Replace whole collections at once (used by bulk import). */
    async setAll(next) {
      data = { ...data, ...next };
      await save();
    },
  };
}
