# MockForge — Smart Mock API Server

A configurable mock backend for frontend teams waiting for real APIs.

- Create mock endpoints from a web UI, with no backend code
- Configure status codes, headers and response bodies, with templating
- Simulate latency, error responses, dropped connections and intermittent failures
- Generate endpoints from an OpenAPI 3.x / Swagger 2.0 spec (JSON or YAML)
- Share fixtures across development and testing through one committed JSON file

**Stack:** Node.js + Express 5 (server), React 18 + Vite (admin UI)

## Quick start

```bash
npm install
npm run dev          # mock server on :4000, admin UI on http://localhost:5173/__mockforge/
```

Production-style (the server also hosts the UI):

```bash
npm run build
npm start            # http://localhost:4000/__mockforge/
```

Point your frontend's API base URL at `http://localhost:4000`. CORS is open, so any dev server origin can call it.

On first start, `data/mockforge.json` is seeded with example endpoints (`/api/users`, `/api/users/:id`, `/api/flaky`) and a `users` fixture.

| Env var          | Default                 | Purpose                                         |
| ---------------- | ----------------------- | ----------------------------------------------- |
| `PORT`           | `4000`                  | Port for the mock server                         |
| `MOCKFORGE_DATA` | `data/mockforge.json`   | Data file (e.g. a separate one for e2e tests)   |
| `MOCKFORGE_ADMIN_TOKEN` | unset           | Require this token (`X-MockForge-Token` or `Authorization: Bearer`) for the admin UI and API |

## Deploy to Vercel

The repo deploys as-is: `vercel.json` builds the UI as static files at `/__mockforge/`, and every other request goes to one Express function (`api/index.js`).

1. Import the GitHub repo in Vercel (**Add New → Project**). Keep the defaults, since `vercel.json` sets the build.
2. Under **Storage**, add **Upstash for Redis** (it has a free plan) and connect it to the project. This sets `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_*` equivalents).
3. Under **Settings → Environment Variables**, add `MOCKFORGE_ADMIN_TOKEN` with a long random value.
4. Redeploy. Open `https://<project>.vercel.app/__mockforge/` and enter the token.

How it behaves on Vercel:

- **Storage:** the first request copies the committed `data/mockforge.json` into Redis, and after that Redis is the source of truth. To bring changes back into the repo, export them from **Share & sync** and commit the file. To reset the deploy, delete the `mockforge:data` key in Upstash.
- **Admin API:** it stays disabled (503) until `MOCKFORGE_ADMIN_TOKEN` is set. Mock endpoints are always public.
- **Without Redis:** edits only last for the life of one serverless instance.
- **Network failures:** a simulated network failure shows up as a platform error (usually 502) rather than a raw connection reset.
- **Latency:** each request is capped by the function's `maxDuration` (60 s).

## Endpoints

- **Paths:** `/users/:id` for params, `/files/*` for a trailing wildcard. Static segments win over params (`/users/me` beats `/users/:id`).
- **Methods:** `GET POST PUT PATCH DELETE HEAD ANY`. A `GET` mock also answers `HEAD`.
- **Content-Type** defaults to `application/json` when the rendered body is valid JSON, and `text/plain` otherwise.
- **Latency:** each request waits a random time between `min` and `max` ms.
- **Failures:** at `rate` (0–1), the endpoint returns its error status and body, or drops the connection (`network`).

### Templates

Response bodies and header values support `{{ … }}`:

| Expression                               | Result                                 |
| ---------------------------------------- | -------------------------------------- |
| `{{params.id}}`                          | Path parameter                         |
| `{{query.page ?? 1}}`                    | Query value with a fallback            |
| `{{body.name}}`                          | Field from the JSON or form request body |
| `{{headers.authorization}}`              | Request header (lower-case name)       |
| `{{fixtures.users}}`                     | A whole fixture as JSON                |
| `{{fixtures.users.0.name}}`              | A nested value                         |
| `{{find fixtures.users id=params.id}}`   | First item whose `id` matches          |
| `{{filter fixtures.users role="admin"}}` | All matching items                     |
| `{{length fixtures.users}}`              | Count                                  |
| `{{uuid}}` `{{now}}` `{{timestamp}}` `{{randomInt 1 100}}` | Generated values     |

Strings are inserted raw, so quote them inside JSON (`"name": "{{body.name}}"`). Objects, arrays, numbers and `null` are inserted as JSON.

## OpenAPI import

In the UI, open **OpenAPI import**, then paste or upload a spec, preview it and pick operations. For each operation, MockForge:

- converts `{petId}` to `:petId` and adds the path prefix from `servers[0].url` (or `basePath`), unless you override it;
- uses the documented example if there is one, or else generates a sample from the schema (`$ref`, `allOf`/`oneOf`, enums and formats are handled);
- uses the first 2xx response as the success response and the first 4xx/5xx response as the failure response (failure rate starts at 0).

## Using it in tests

These request headers make runs deterministic:

| Header                         | Effect                                |
| ------------------------------ | ------------------------------------- |
| `X-MockForge-Force: failure`   | Always return the failure response    |
| `X-MockForge-Force: success`   | Never simulate a failure              |
| `X-MockForge-Delay: 0`         | Override latency (ms) for one request |

Responses include `X-MockForge-Endpoint` (the matched endpoint id) and, for simulated failures, `X-MockForge-Simulated: failure`.

Run against a dedicated fixture file:

```bash
MOCKFORGE_DATA=e2e/mocks.json npm start
```

## Admin API

All routes live under `/__mockforge/api`:

| Route                                          | Purpose                                      |
| ---------------------------------------------- | -------------------------------------------- |
| `GET/POST /endpoints`, `GET/PUT/DELETE /endpoints/:id` | CRUD for endpoints                   |
| `POST /endpoints/:id/duplicate`                | Copy an endpoint (the copy starts disabled)  |
| `GET/POST /fixtures`, `PUT/DELETE /fixtures/:id` | CRUD for fixtures (names are unique)       |
| `POST /openapi/preview`, `POST /openapi/import` | `{ spec, basePath?, mode?: skip\|replace, select? }` |
| `GET/DELETE /logs`                             | Recent requests (in memory, last 300)        |
| `GET /export`, `POST /import`                  | `{ data, mode: merge\|replace }`             |
| `GET /health`                                  | Status and the data file path                |

## Project layout

```
server/src/
  index.js      local entry point (listen)
  bootstrap.js  picks storage (file or Upstash Redis), auth, UI path
  app.js        Express wiring: CORS, admin API, UI hosting, mock catch-all
  api.js        admin REST routes
  engine.js     serves mocks: matching, latency, failures, templating, logging
  matcher.js    path patterns and specificity
  template.js   {{ }} template evaluator
  openapi.js    spec parsing and example/schema sampling
  model.js      validation and defaults
  store.js      JSON-file persistence
api/index.js    Vercel serverless entry
server/test/    node:test integration tests (npm test)
client/src/     React admin UI
data/           mockforge.json (commit this to share mocks)
```
