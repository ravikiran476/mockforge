import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './model.js';

const empty = () => ({ version: 1, endpoints: [], fixtures: [] });

/*
 * A backend stores the whole dataset plus a revision number that goes up on every write.
 *
 *   read()                  -> { data | null, revision }
 *   revision()              -> number (cheap: lets instances skip re-reading unchanged data)
 *   write(data, expected)   -> new revision, or null when `expected` is no longer current
 *
 * The compare-and-set write means two instances saving at the same time cannot silently
 * overwrite each other's changes: the loser re-reads and applies its change again.
 */

/** JSON file on disk. Meant to be committed so a team shares the same mocks and fixtures. */
export function fileBackend(file) {
  // One process owns the file, so the revision only needs to live in memory.
  let revision = 0;
  return {
    describe: file,
    async read() {
      if (!fs.existsSync(file)) return { data: null, revision };
      try {
        return { data: JSON.parse(fs.readFileSync(file, 'utf8')), revision };
      } catch (err) {
        throw new Error(`Could not parse MockForge data file ${file}: ${err.message}`);
      }
    },
    revision: async () => revision,
    async write(data, expected) {
      if (expected !== revision) return null;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
      fs.renameSync(tmp, file);
      return ++revision;
    },
  };
}

/** Process memory only (tests). Shared by every store created from the same backend. */
export function memoryBackend() {
  let saved = null;
  let revision = 0;
  return {
    describe: 'memory',
    read: async () => ({ data: saved ? structuredClone(saved) : null, revision }),
    revision: async () => revision,
    async write(data, expected) {
      if (expected !== revision) return null;
      saved = structuredClone(data);
      return ++revision;
    },
  };
}

// Writes the data only if nobody else has written since `expected`, and bumps the revision.
const COMPARE_AND_SET = `
local current = tonumber(redis.call('GET', KEYS[2]) or '0')
if current ~= tonumber(ARGV[2]) then return -1 end
redis.call('SET', KEYS[1], ARGV[1])
return redis.call('INCR', KEYS[2])`;

/** Upstash Redis (serverless deployments). The whole dataset lives in one JSON key. */
export function redisBackend(redis, key = 'mockforge:data') {
  const revisionKey = `${key}:revision`;
  return {
    describe: `redis (${key})`,
    async read() {
      // MGET is atomic, so the data and its revision always belong together.
      const [data, revision] = await redis.mget(key, revisionKey);
      return { data: data ?? null, revision: Number(revision ?? 0) };
    },
    revision: async () => Number((await redis.get(revisionKey)) ?? 0),
    async write(data, expected) {
      // A JSON string is stored exactly as redis.set(key, object) would store it.
      const result = Number(await redis.eval(COMPARE_AND_SET, [key, revisionKey], [JSON.stringify(data), String(expected)]));
      return result === -1 ? null : result;
    },
  };
}

const MAX_ATTEMPTS = 5;

/**
 * Reads are synchronous against an in-memory copy. With `shared: true` (several serverless
 * instances writing the same backend) call `refresh()` per request: it only re-reads the
 * data when another instance has changed it, and checks at most every `maxStaleMs`.
 */
export async function createStore(backend, { seed, shared = false, maxStaleMs = 1000 } = {}) {
  let data;
  let revision;
  let exists = false;
  let checkedAt = 0;

  const load = async () => {
    const current = await backend.read();
    exists = current.data != null;
    data = { ...empty(), ...(current.data ?? {}) };
    revision = current.revision;
    checkedAt = Date.now();
  };

  /** Applies `change` to a copy of the latest data and saves it; retried if another write wins the race. */
  async function update(change) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const draft = structuredClone(data);
      const result = change(draft);
      if (result === NO_CHANGE) return undefined;
      const saved = await backend.write(draft, revision);
      if (saved !== null) {
        data = draft;
        revision = saved;
        return result;
      }
      await load();
    }
    throw new HttpError(409, 'The data kept changing while saving. Try again.');
  }

  await load();
  // Seed an empty backend. If another instance seeds it first, the retry sees its data and stops.
  await update((draft) => (exists ? NO_CHANGE : Object.assign(draft, structuredClone(seed ?? {}))));

  return {
    location: backend.describe,
    async refresh({ force = false } = {}) {
      if (!shared) return;
      if (!force && Date.now() - checkedAt < maxStaleMs) return;
      checkedAt = Date.now();
      if ((await backend.revision()) !== revision) await load();
    },
    snapshot: () => structuredClone(data),
    list: (kind) => data[kind],
    get: (kind, id) => data[kind].find((item) => item.id === id),
    /** Several changes saved as one write: `change(draft)` mutates the draft and returns a result. */
    update,
    insert: (kind, item) =>
      update((draft) => {
        draft[kind].push(item);
        return item;
      }),
    replace: (kind, id, item) =>
      update((draft) => {
        const index = draft[kind].findIndex((x) => x.id === id);
        if (index === -1) return NO_CHANGE;
        draft[kind][index] = item;
        return item;
      }).then((result) => result ?? null),
    remove: (kind, id) =>
      update((draft) => {
        const before = draft[kind].length;
        draft[kind] = draft[kind].filter((x) => x.id !== id);
        return draft[kind].length === before ? NO_CHANGE : true;
      }).then((result) => result ?? false),
    /** Replace whole collections at once (used by bulk import). */
    setAll: (next) =>
      update((draft) => {
        Object.assign(draft, next);
      }),
  };
}

/** Returned from an `update` change function to skip the write. */
export const NO_CHANGE = Symbol('no change');
