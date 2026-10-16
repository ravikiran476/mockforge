// Vercel serverless entry: every non-static request is rewritten here (see vercel.json).
import { buildApp } from '../server/src/bootstrap.js';

let ready;

export default async function handler(req, res) {
  ready ??= buildApp().catch((err) => {
    ready = undefined; // retry on the next request instead of caching the failure
    throw err;
  });
  const { app } = await ready;
  return app(req, res);
}
