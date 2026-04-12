/**
 * postman.ts — Postman Collection ↔ HTTP DSL conversion utilities.
 *
 * Export spec: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
 * Import supports both v2.0 and v2.1 collections, including nested folders.
 */

import { HttpBlock } from './parser';

/**
 * Parse a Postman Collection JSON string and return a HTTP runbook string.
 *
 * @param json - Raw JSON content of a .postman_collection.json file
 * @returns HTTP DSL text ready to load into the editor
 * @throws Error - If the JSON is invalid or not a Postman collection
 */
export function parsePostmanCollection(json: string): string {
  let col: any;
  try {
    col = JSON.parse(json);
  } catch {
    throw new Error('File is not valid JSON.');
  }

  if (!Array.isArray(col.item)) {
    throw new Error('Not a recognised Postman collection (missing "item" array).');
  }

  // Collection-level variables → @key = value declarations
  const vars: Record<string, string> = {};
  if (Array.isArray(col.variable)) {
    for (const v of col.variable) {
      if (v.key && v.value !== undefined && !v.disabled) {
        vars[v.key] = v.value;
      }
    }
  }

  const parts: string[] = [];

  // Global var block at the top
  for (const [k, v] of Object.entries(vars)) {
    parts.push(`@${k} = ${v}`);
  }
  if (parts.length) parts.push('');

  // Flatten folders recursively, convert each request to a ### block
  for (const block of flattenItems(col.item)) {
    parts.push(block, '');
  }

  return parts.join('\n').trimEnd() + '\n';
}

/** Recursively flatten folder items, returning an array of DSL block strings. */
function flattenItems(items: any[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (Array.isArray(item.item)) {
      // Folder — recurse
      out.push(...flattenItems(item.item));
    } else if (item.request) {
      const block = itemToBlock(item);
      if (block) {
        out.push(block);
      }
    }
  }
  return out;
}

/** Convert a single Postman request item to a HTTP DSL block string. */
function itemToBlock(item: any): string | null {
  const req = item.request;
  if (!req) return null;

  const name = (item.name || 'Request').trim();
  const method = (req.method || 'GET').toUpperCase();
  const url = resolveUrl(req.url);

  // Active headers only (skip disabled)
  const headers = (req.header ?? [])
    .filter((h: any) => !h.disabled && h.key)
    .map((h: any) => ({ key: h.key, value: h.value ?? '' }));

  // Body — may add or replace Content-Type
  const { bodyText, contentTypeValue } = resolveBody(req.body, headers);

  // Rebuild header lines
  const headerLines = buildHeaderLines(headers, contentTypeValue);

  const lines = [`### ${name}`, `${method} ${url}`, ...headerLines];
  if (bodyText !== null) {
    lines.push('', bodyText);
  }

  return lines.join('\n');
}

/** Resolve a Postman URL (string or object) to the raw URL string. */
function resolveUrl(url: any): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  return url.raw ?? url.host?.join('.') ?? '';
}

/**
 * Resolve body from Postman body descriptor.
 */
function resolveBody(
  body: any,
  headers: Array<{ key: string; value: string }>
): { bodyText: string | null; contentTypeValue: string | null } {
  if (!body || !body.mode) return { bodyText: null, contentTypeValue: null };

  const existingCT = headers.find((h) => h.key.toLowerCase() === 'content-type');

  if (body.mode === 'raw') {
    const text = body.raw ?? '';
    const lang = body.options?.raw?.language ?? 'text';
    const ct = existingCT
      ? null
      : lang === 'json'
      ? 'application/json'
      : lang === 'xml'
      ? 'application/xml'
      : null;
    return { bodyText: text, contentTypeValue: ct };
  }

  if (body.mode === 'urlencoded') {
    const pairs = (body.urlencoded ?? [])
      .filter((p: any) => !p.disabled)
      .map((p: any) => `${p.key ?? ''}=${p.value ?? ''}`)
      .join('&');
    const ct = existingCT ? null : 'application/x-www-form-urlencoded';
    return { bodyText: pairs, contentTypeValue: ct };
  }

  if (body.mode === 'formdata') {
    const pairs = (body.formdata ?? [])
      .filter((p: any) => !p.disabled && p.type !== 'file')
      .map((p: any) => `${p.key ?? ''}=${p.value ?? ''}`)
      .join('&');
    const ct = existingCT ? null : 'application/x-www-form-urlencoded';
    return { bodyText: pairs || null, contentTypeValue: pairs ? ct : null };
  }

  if (body.mode === 'graphql') {
    const gql = body.graphql ?? {};
    const text = JSON.stringify({ query: gql.query ?? '', variables: gql.variables ?? {} }, null, 2);
    const ct = existingCT ? null : 'application/json';
    return { bodyText: text, contentTypeValue: ct };
  }

  return { bodyText: null, contentTypeValue: null };
}

/** Build the final array of "Key: Value" header strings. */
function buildHeaderLines(
  headers: Array<{ key: string; value: string }>,
  contentTypeValue: string | null
): string[] {
  const lines: string[] = [];
  let ctWritten = false;
  for (const h of headers) {
    if (h.key.toLowerCase() === 'content-type') {
      lines.push(`${h.key}: ${contentTypeValue ?? h.value}`);
      ctWritten = true;
    } else {
      lines.push(`${h.key}: ${h.value}`);
    }
  }
  if (!ctWritten && contentTypeValue) {
    lines.push(`Content-Type: ${contentTypeValue}`);
  }
  return lines;
}

/**
 * Build a Postman Collection v2.1 from parsed runbook data.
 *
 * @param name - Collection name (usually the file stem)
 * @param globalVars - Global @var declarations
 * @param blocks - Parsed request blocks
 * @returns Formatted JSON string ready to write to a .json file
 */
export function buildPostmanCollection(
  name: string,
  globalVars: Record<string, string>,
  blocks: HttpBlock[]
): string {
  const items = blocks.map((block) => ({
    name: block.name,
    request: buildRequest(block),
    response: [],
  }));

  // Global declarations become collection-level variables
  const varMap = { ...globalVars };
  for (const block of blocks) {
    for (const [k, v] of Object.entries(block.preVars ?? {})) {
      if (!varMap[k]) varMap[k] = v;
    }
  }

  const variable = Object.entries(varMap).map(([key, value]) => ({
    key,
    value,
    type: 'string',
  }));

  return JSON.stringify(
    {
      info: {
        name,
        _postman_id: generateUUID(),
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: items,
      variable,
    },
    null,
    2
  );
}

function buildRequest(block: HttpBlock): any {
  const req: any = {
    method: block.method.toUpperCase(),
    header: Object.entries(block.headers ?? {}).map(([key, value]) => ({
      key,
      value,
      type: 'text',
    })),
    url: buildUrl(block.url),
  };

  if (block.body) {
    req.body = buildBody(block.body, block.headers ?? {});
  }

  return req;
}

function buildUrl(raw: string): any {
  if (!raw) return { raw: '' };

  // Try to parse URL into parts
  try {
    const u = new URL(raw);
    const obj: any = {
      raw,
      protocol: u.protocol.replace(':', ''),
      host: u.hostname.split('.'),
      path: u.pathname.split('/').filter(Boolean),
    };
    if (u.port) obj.port = u.port;
    if (u.search) obj.query = parseQueryString(u.search.slice(1));
    return obj;
  } catch {
    // URL contains {{variables}} or is otherwise not parseable
    return { raw };
  }
}

function parseQueryString(qs: string): any[] {
  return qs
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eqIdx = pair.indexOf('=');
      const key = decodeURIComponent(pair.slice(0, eqIdx < 0 ? undefined : eqIdx));
      const value = eqIdx < 0 ? '' : decodeURIComponent(pair.slice(eqIdx + 1));
      return { key, value, disabled: false };
    });
}

function buildBody(body: string, headers: Record<string, string>): any {
  const contentType =
    Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const urlencoded = body
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const eqIdx = pair.indexOf('=');
        const key = pair.slice(0, eqIdx < 0 ? undefined : eqIdx).trim();
        const value = eqIdx < 0 ? '' : pair.slice(eqIdx + 1).trim();
        return { key, value, type: 'text' };
      });
    return { mode: 'urlencoded', urlencoded };
  }

  const language = contentType.includes('json') ? 'json' : 'text';
  return {
    mode: 'raw',
    raw: body,
    options: { raw: { language } },
  };
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
