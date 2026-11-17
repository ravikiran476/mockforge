import { randomUUID } from 'node:crypto';

/**
 * Tiny template language for response bodies and header values.
 *
 *   {{params.id}}            path param          {{query.page ?? 1}}   fallback
 *   {{body.name}}            parsed request body {{headers.authorization}}
 *   {{fixtures.users}}       whole fixture       {{fixtures.users.0.name}}
 *   {{find fixtures.users id=params.id}}         first item whose id matches
 *   {{filter fixtures.users role="admin"}}       all matching items
 *   {{length fixtures.users}}  {{uuid}}  {{now}}  {{timestamp}}  {{randomInt 1 100}}
 *
 * Strings are inserted raw; everything else is inserted as JSON. With `{ json: true }`, a value
 * inside a JSON string literal ("name": "{{body.name}}") is escaped for that string instead, so
 * quotes, backslashes and line breaks in the data keep the document valid.
 */
const TOKEN = /\{\{\s*(.+?)\s*\}\}/g;

export function render(template, ctx, { json = false } = {}) {
  if (!template) return '';
  const text = String(template);
  if (!json) return text.replace(TOKEN, (_, expr) => stringify(evaluate(expr, ctx)));
  let out = '';
  let last = 0;
  let inString = false;
  for (const m of text.matchAll(TOKEN)) {
    const literal = text.slice(last, m.index);
    inString = endsInsideString(literal, inString);
    const value = evaluate(m[1], ctx);
    out += literal + (inString ? escapeForJsonString(value) : stringify(value));
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

function stringify(value) {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Tracks whether a run of template text leaves us inside a double-quoted JSON string. */
function endsInsideString(literal, inString) {
  for (let i = 0; i < literal.length; i++) {
    if (inString && literal[i] === '\\') i++;
    else if (literal[i] === '"') inString = !inString;
  }
  return inString;
}

function escapeForJsonString(value) {
  if (value === undefined) return '';
  return JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value)).slice(1, -1);
}

export function evaluate(expr, ctx) {
  const alternatives = expr.split('??').map((s) => s.trim());
  for (let i = 0; i < alternatives.length; i++) {
    const value = evaluateOne(alternatives[i], ctx);
    const isLast = i === alternatives.length - 1;
    if (isLast || (value !== undefined && value !== null)) return value;
  }
  return undefined;
}

function evaluateOne(expr, ctx) {
  const [name, ...args] = expr.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  if (name === undefined) return undefined;
  if (Object.hasOwn(HELPERS, name)) return HELPERS[name](args, ctx);
  if (args.length) throw new Error(`Unknown template helper "${name}"`);
  return resolve(name, ctx);
}

function resolve(token, ctx) {
  if (/^(["']).*\1$/.test(token)) return token.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;
  return lookup(ctx, token);
}

export function lookup(obj, path) {
  let current = obj;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    if (!Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function predicate(args, ctx, helper) {
  if (args.length !== 2 || !args[1].includes('=')) {
    throw new Error(`Usage: {{${helper} <list> <key>=<value>}}`);
  }
  const list = resolve(args[0], ctx);
  const eq = args[1].indexOf('=');
  const key = args[1].slice(0, eq);
  const expected = resolve(args[1].slice(eq + 1), ctx);
  const test = (item) => item !== null && typeof item === 'object' && String(item[key]) === String(expected);
  return { list: Array.isArray(list) ? list : [], test };
}

const HELPERS = {
  uuid: () => randomUUID(),
  now: () => new Date().toISOString(),
  timestamp: () => Date.now(),
  randomInt(args, ctx) {
    const min = Number(resolve(args[0] ?? '0', ctx));
    const max = Number(resolve(args[1] ?? '100', ctx));
    return Math.floor(min + Math.random() * (max - min + 1));
  },
  length(args, ctx) {
    const value = resolve(args[0] ?? '', ctx);
    if (Array.isArray(value) || typeof value === 'string') return value.length;
    return value && typeof value === 'object' ? Object.keys(value).length : 0;
  },
  find(args, ctx) {
    const { list, test } = predicate(args, ctx, 'find');
    return list.find(test);
  },
  filter(args, ctx) {
    const { list, test } = predicate(args, ctx, 'filter');
    return list.filter(test);
  },
};
