import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from '@upstash/redis';
import { createApp } from './app.js';
import { createStore, fileBackend, redisBackend } from './store.js';
import { createLogBuffer, redisLogBuffer } from './logs.js';
import { seedData } from './seed.js';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const committedData = path.join(repoRoot, 'data', 'mockforge.json');

/** Supports both the Upstash integration's and the legacy Vercel KV variable names. */
function redisFromEnv(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

/** Redis starts from the committed data file, so a fresh deploy has the team's mocks. */
function initialRedisData() {
  try {
    return JSON.parse(fs.readFileSync(committedData, 'utf8'));
  } catch {
    return seedData();
  }
}

export async function buildApp(env = process.env) {
  const redis = redisFromEnv(env);
  const onVercel = Boolean(env.VERCEL);
  if (onVercel && !redis) {
    console.warn('MockForge: no Upstash Redis env vars found; edits will not persist across serverless instances.');
  }

  const dataFile = path.resolve(env.MOCKFORGE_DATA || committedData);
  const store = redis
    ? await createStore(redisBackend(redis), { seed: initialRedisData(), shared: true })
    : await createStore(fileBackend(onVercel ? path.join('/tmp', 'mockforge.json') : dataFile), {
        seed: onVercel ? initialRedisData() : seedData(),
      });

  const app = createApp({
    store,
    logs: redis ? redisLogBuffer(redis) : createLogBuffer(),
    clientDist: path.join(repoRoot, 'client', 'dist', '__mockforge'),
    adminToken: env.MOCKFORGE_ADMIN_TOKEN || undefined,
    requireToken: onVercel,
  });
  return { app, store };
}
