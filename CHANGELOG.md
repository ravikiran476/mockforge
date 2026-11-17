# Changelog

## 0.2.0

### Security

- The server listens on `127.0.0.1` and `::1` only. Set `HOST=0.0.0.0` to reach the mocks from other devices.
- Without `MOCKFORGE_ADMIN_TOKEN`, the admin API answers only requests addressed to localhost from localhost pages. Before, any website open in a developer's browser could read and change the mocks, and so could anyone on the same network.
- The admin API no longer sends CORS headers. Mock endpoints keep `Access-Control-Allow-Origin: *`.
- `X-MockForge-Delay` and configured latency are capped at `MOCKFORGE_MAX_DELAY_MS` (default 30 s).

### Fixes

- Template values inside JSON strings are escaped, so a quote, backslash or line break in request data no longer produces invalid JSON. Header values are kept on one line.
- Saves are checked against a revision number, so concurrent edits on different serverless instances are no longer lost.
- An OpenAPI import is saved in one write instead of one per operation, and the import merge applies to the latest data.

### Redis usage on Vercel

- Instances check a small revision key instead of re-reading the whole dataset on every request, at most once a second for mock traffic.
- Request log writes are limited to 10 a second per instance, and unmatched requests are not logged on Vercel unless `MOCKFORGE_LOG_UNMATCHED=true`.

### Dependencies

- `npm audit fix`: patched body-parser (high) and Vite (moderate) within the existing version ranges. `npm audit` reports 0 vulnerabilities.
- CI (GitHub Actions) runs the tests and the UI build on every push and pull request.

### Upgrading

Nothing to migrate: existing Redis data is read as before, and the revision key is created on the first save. If you call the admin API from another machine without a token, set `MOCKFORGE_ADMIN_TOKEN` and `HOST=0.0.0.0`.

## 0.1.0

First release.
