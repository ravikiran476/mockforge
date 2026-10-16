import yaml from 'js-yaml';
import { HttpError } from './model.js';

const OPERATIONS = ['get', 'post', 'put', 'patch', 'delete', 'head'];
const MAX_DEPTH = 8;

export function parseSpec(input) {
  if (input && typeof input === 'object') return input;
  if (typeof input !== 'string' || !input.trim()) throw new HttpError(400, 'OpenAPI spec is empty');
  try {
    return JSON.parse(input);
  } catch {
    try {
      return yaml.load(input);
    } catch (err) {
      throw new HttpError(400, `Could not parse spec as JSON or YAML: ${err.message}`);
    }
  }
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new HttpError(400, `Only local $refs are supported (got "${ref}")`);
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    node = node?.[key];
  }
  if (node === undefined) throw new HttpError(400, `Unresolvable $ref "${ref}"`);
  return node;
}

function deref(root, node) {
  const seen = new Set();
  while (node && node.$ref) {
    if (seen.has(node.$ref)) return {};
    seen.add(node.$ref);
    node = resolveRef(root, node.$ref);
  }
  return node;
}

function sampleString(schema) {
  switch (schema.format) {
    case 'date-time': return '2026-01-01T12:00:00Z';
    case 'date': return '2026-01-01';
    case 'time': return '12:00:00';
    case 'email': return 'user@example.com';
    case 'uuid': return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    case 'uri':
    case 'url': return 'https://example.com';
    case 'hostname': return 'example.com';
    case 'ipv4': return '192.168.0.1';
    case 'ipv6': return '::1';
    case 'byte': return 'U3dhZ2dlciByb2Nrcw==';
    case 'password': return '********';
    default: return 'string';
  }
}

/** Builds a representative example value from a JSON schema. */
export function sampleFromSchema(schema, root, depth = 0, refs = new Set()) {
  if (!schema || depth > MAX_DEPTH) return null;
  if (schema.$ref) {
    if (refs.has(schema.$ref)) return null; // recursive schema
    return sampleFromSchema(resolveRef(root, schema.$ref), root, depth + 1, new Set([...refs, schema.$ref]));
  }
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((acc, part) => {
      const value = sampleFromSchema(part, root, depth + 1, refs);
      return value && typeof value === 'object' && !Array.isArray(value) ? { ...acc, ...value } : acc;
    }, {});
  }
  const variants = schema.oneOf || schema.anyOf;
  if (Array.isArray(variants) && variants.length) return sampleFromSchema(variants[0], root, depth + 1, refs);

  let type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (!type) type = schema.properties ? 'object' : schema.items ? 'array' : undefined;

  switch (type) {
    case 'object': {
      const out = {};
      for (const [key, prop] of Object.entries(schema.properties || {})) {
        out[key] = sampleFromSchema(prop, root, depth + 1, refs);
      }
      return out;
    }
    case 'array': {
      const count = Math.max(1, Math.min(schema.minItems || 1, 3));
      return Array.from({ length: count }, () => sampleFromSchema(schema.items, root, depth + 1, refs));
    }
    case 'string': return sampleString(schema);
    case 'integer': return schema.minimum ?? 1;
    case 'number': return schema.minimum ?? 1.5;
    case 'boolean': return true;
    default: return null;
  }
}

function pickMedia(content) {
  if (!content) return null;
  const types = Object.keys(content);
  const type = types.find((t) => t === 'application/json') || types.find((t) => t.includes('json')) || types[0];
  return type ? { type, media: content[type] || {} } : null;
}

/** Returns { contentType, body } for a single response object, OpenAPI 3 or Swagger 2. */
function exampleForResponse(spec, response, isV2) {
  response = deref(spec, response) || {};
  if (isV2) {
    const examples = response.examples || {};
    const type = Object.keys(examples).find((t) => t.includes('json')) || Object.keys(examples)[0];
    if (type) return { contentType: type, body: examples[type] };
    if (response.schema) return { contentType: 'application/json', body: sampleFromSchema(response.schema, spec) };
    return { contentType: null, body: undefined };
  }
  const picked = pickMedia(response.content);
  if (!picked) return { contentType: null, body: undefined };
  const { type, media } = picked;
  if (media.example !== undefined) return { contentType: type, body: media.example };
  const firstExample = media.examples && Object.values(media.examples)[0];
  if (firstExample) {
    const resolved = deref(spec, firstExample);
    if (resolved.value !== undefined) return { contentType: type, body: resolved.value };
  }
  return { contentType: type, body: media.schema ? sampleFromSchema(media.schema, spec) : undefined };
}

function serialize(body, contentType) {
  if (body === undefined) return '';
  if (typeof body === 'string' && !(contentType || '').includes('json')) return body;
  return JSON.stringify(body, null, 2);
}

function basePathFromSpec(spec, isV2) {
  const raw = isV2 ? spec.basePath : spec.servers?.[0]?.url;
  if (!raw) return '';
  try {
    const pathname = new URL(raw.replace(/\{[^}]+\}/g, 'x'), 'http://placeholder').pathname;
    return pathname === '/' ? '' : pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * Converts an OpenAPI 3.x / Swagger 2.0 document into endpoint drafts.
 * `basePath` overrides the prefix derived from `servers[0].url` / `basePath`.
 */
export function endpointsFromSpec(spec, { basePath } = {}) {
  if (!spec || typeof spec !== 'object' || !spec.paths || typeof spec.paths !== 'object') {
    throw new HttpError(400, 'Not an OpenAPI/Swagger document: missing "paths"');
  }
  const isV2 = typeof spec.swagger === 'string';
  const prefix = (basePath ?? basePathFromSpec(spec, isV2)).replace(/\/+$/, '');
  const endpoints = [];

  for (const [rawPath, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    const path = (prefix + rawPath.replace(/\{([^}]+)\}/g, ':$1')) || '/';

    for (const op of OPERATIONS) {
      const operation = pathItem[op];
      if (!operation) continue;
      const responses = operation.responses || {};
      const codes = Object.keys(responses);
      const success = codes.filter((c) => /^2\d\d$/.test(c)).sort()[0] || (responses.default ? 'default' : codes[0]);
      const error = codes.filter((c) => /^[45]\d\d$/.test(c)).sort()[0];

      const ok = success ? exampleForResponse(spec, responses[success], isV2) : { contentType: null, body: undefined };
      const status = /^\d{3}$/.test(success || '') ? Number(success) : 200;
      const failure = { rate: 0, type: 'status', status: error ? Number(error) : 500 };
      if (error) {
        const bad = exampleForResponse(spec, responses[error], isV2);
        failure.body = bad.body === undefined
          ? JSON.stringify({ error: deref(spec, responses[error])?.description || 'Error' }, null, 2)
          : serialize(bad.body, bad.contentType);
      }

      endpoints.push({
        name: operation.summary || operation.operationId || `${op.toUpperCase()} ${path}`,
        description: operation.description || '',
        method: op.toUpperCase(),
        path,
        tags: Array.isArray(operation.tags) ? operation.tags : [],
        response: {
          status,
          headers: ok.contentType && ok.body !== undefined ? { 'Content-Type': ok.contentType } : {},
          body: serialize(ok.body, ok.contentType),
        },
        latency: { min: 0, max: 0 },
        failure,
      });
    }
  }
  return {
    title: spec.info?.title || 'Untitled API',
    version: spec.info?.version || '',
    basePath: prefix,
    endpoints,
  };
}
