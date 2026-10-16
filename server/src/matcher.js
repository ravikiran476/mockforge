const cache = new Map();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compiles "/users/:id/files/*" into a regex. Static segments score higher than
 * params, which score higher than wildcards, so "/users/me" beats "/users/:id".
 */
export function compilePath(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  const keys = [];
  let source = '';
  let score = 0;
  for (const segment of pattern.split('/').filter(Boolean)) {
    if (segment === '*') {
      keys.push('wildcard');
      source += '(?:/(.*))?';
      score += 1;
    } else if (segment.startsWith(':') && segment.length > 1) {
      keys.push(segment.slice(1));
      source += '/([^/]+)';
      score += 2;
    } else {
      source += '/' + escapeRegex(segment);
      score += 3;
    }
  }
  const compiled = { regex: new RegExp(`^${source}/?$`), keys, score };
  cache.set(pattern, compiled);
  return compiled;
}

export function matchPath(pattern, pathname) {
  const { regex, keys, score } = compilePath(pattern);
  const m = regex.exec(pathname);
  if (!m) return null;
  const params = {};
  keys.forEach((key, i) => {
    if (m[i + 1] !== undefined) params[key] = safeDecode(m[i + 1]);
  });
  return { params, score };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function methodRank(endpointMethod, requestMethod) {
  if (endpointMethod === requestMethod) return 2;
  if (endpointMethod === 'GET' && requestMethod === 'HEAD') return 1;
  if (endpointMethod === 'ANY') return 1;
  return 0;
}

/** Returns the best enabled endpoint for the request, or null. */
export function findEndpoint(endpoints, method, pathname) {
  let best = null;
  for (const endpoint of endpoints) {
    if (!endpoint.enabled) continue;
    const rank = methodRank(endpoint.method, method);
    if (!rank) continue;
    const match = matchPath(endpoint.path, pathname);
    if (!match) continue;
    if (!best || match.score > best.score || (match.score === best.score && rank > best.rank)) {
      best = { endpoint, params: match.params, score: match.score, rank };
    }
  }
  return best;
}
