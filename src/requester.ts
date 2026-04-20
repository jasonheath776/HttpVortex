/**
 * HTTP request executor for runbooks
 */

import axios, { AxiosError } from 'axios';
import * as http from 'http';
import * as https from 'https';
import * as lodash from 'lodash';
import { HttpBlock } from './parser';

// Module-level agents so connection pools are reused across requests.
const _httpAgent          = new http.Agent();
const _httpsAgent         = new https.Agent({ rejectUnauthorized: true });
const _httpsAgentNoVerify = new https.Agent({ rejectUnauthorized: false });

export interface RequestResult {
  id: string;
  name: string;
  method: string;
  url: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  data?: unknown;
  error?: string;
  duration?: number;
  captures?: Record<string, unknown>;
  type?: 'debug';
  value?: unknown;
}

export interface RequestOptions {
  timeout?: number;
  followRedirects?: boolean;
  validateSSL?: boolean;
}

/**
 * Replace all {{key}} placeholders in text with values from the variable store.
 * Unresolved placeholders are left as-is.
 */
export function interpolate(text: string, vars: Record<string, unknown>): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text.replace(/\{\{(.*?)\}\}/g, (match, key) => {
    const val = vars[key.trim()];
    return val !== undefined ? String(val) : match;
  });
}

/**
 * Resolve a debug expression against the current variable store and result.
 * Supports @varName and res.* paths.
 */
function resolveDebugExpr(expr: string, result: unknown, vars: Record<string, unknown>): unknown {
  if (expr.startsWith('@')) {
    return vars[expr.slice(1)];
  }
  if (expr.startsWith('res.') && result) {
    return lodash.get(result, expr.slice(4));
  }
  return undefined;
}

/**
 * Generate a unique ID for results
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Send a single HTTP request
 */
async function sendRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | null,
  options: RequestOptions
): Promise<RequestResult> {
  const startTime = Date.now();
  
  try {
    const config: Record<string, unknown> = {
      method,
      url,
      headers,
      timeout: options.timeout || 30000,
      maxRedirects: options.followRedirects ? 5 : 0,
      validateStatus: () => true, // Don't throw on any status code
      proxy: false, // bypass VS Code proxy env vars
      httpAgent: _httpAgent,
      httpsAgent: options.validateSSL !== false ? _httpsAgent : _httpsAgentNoVerify,
    };

    if (body) {
      // Try to parse as JSON, otherwise send as-is
      try {
        config.data = JSON.parse(body);
      } catch {
        config.data = body;
      }
    }

    const response = await axios(config);
    const duration = Date.now() - startTime;

    return {
      id: generateId(),
      name: '',
      method,
      url,
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as Record<string, string>,
      data: response.data,
      duration,
    };
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const axiosError = error as AxiosError;
    
    return {
      id: generateId(),
      name: '',
      method,
      url,
      ok: false,
      error: axiosError.message || 'Request failed',
      status: axiosError.response?.status,
      statusText: axiosError.response?.statusText,
      data: axiosError.response?.data,
      duration,
    };
  }
}

/**
 * Execute a parsed runbook sequentially.
 * Each block is resolved, sent, and its captures are applied before the next block runs.
 */
export async function runAll(
  blocks: HttpBlock[],
  initialVars: Record<string, unknown>,
  onResult: (result: RequestResult) => void,
  onVariableUpdate: (vars: Record<string, unknown>) => void,
  options: RequestOptions = {}
): Promise<void> {
  const vars: Record<string, unknown> = { ...initialVars };

  for (const block of blocks) {
    // Apply block-level pre-declarations
    for (const [k, v] of Object.entries(block.preVars || {})) {
      vars[k] = interpolate(v || '', vars);
    }
    onVariableUpdate({ ...vars });

    // Emit pre-request debug values
    for (const d of block.preDebugs || []) {
      onResult({
        id: generateId(),
        type: 'debug',
        name: d.expr,
        method: '',
        url: '',
        ok: true,
        value: resolveDebugExpr(d.expr, null, vars),
      });
    }

    // Resolve {{variables}} in URL, headers, and body
    const resolvedUrl = interpolate(block.url || '', vars);
    const resolvedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(block.headers || {})) {
      resolvedHeaders[k] = interpolate(v || '', vars).trim();
    }
    const resolvedBody = block.body ? interpolate(block.body, vars) : null;

    // Validate URL
    if (!resolvedUrl) {
      onResult({
        id: generateId(),
        name: block.name,
        method: block.method,
        url: 'INVALID',
        ok: false,
        error: 'Request URL is empty or undefined',
      });
      continue;
    }

    // Send the request
    const result = await sendRequest(
      block.method,
      resolvedUrl,
      resolvedHeaders,
      resolvedBody,
      options
    );

    // Extract captured values from the response using lodash.get
    const capturedVars: Record<string, unknown> = {};
    if (result.ok && block.captures?.length) {
      for (const capture of block.captures) {
        const value = lodash.get(result, capture.path);
        if (value !== undefined) {
          capturedVars[capture.key] = value;
          vars[capture.key] = value;
        }
      }
      if (Object.keys(capturedVars).length) {
        onVariableUpdate({ ...vars });
      }
    }

    // Emit post-request debug values
    for (const d of block.debugs || []) {
      onResult({
        id: generateId(),
        type: 'debug',
        name: d.expr,
        method: '',
        url: '',
        ok: true,
        value: resolveDebugExpr(d.expr, result, vars),
      });
    }

    onResult({
      ...result,
      name: block.name,
      captures: capturedVars,
    });
  }
}
/**
 * Execute parsed runbook blocks with limited concurrency and dependency awareness.
 *
 * A block is only started once every {{variable}} it references is resolvable
 * from the shared runtime vars (global declarations + captures emitted so far).
 * Independent blocks (e.g. a public endpoint that needs no token) start
 * immediately and run alongside the token request. Dependent blocks (those that
 * reference a captured variable) are held in the pending queue and start as soon
 * as the capturing block completes.
 */
export async function runAllParallel(
  blocks: HttpBlock[],
  initialVars: Record<string, unknown>,
  onResult: (result: RequestResult) => void,
  onVariableUpdate: (vars: Record<string, unknown>) => void,
  options: RequestOptions = {},
  concurrency: number = 3
): Promise<void> {
  // Shared mutable state updated as each block's captures arrive
  const vars: Record<string, unknown> = { ...initialVars };

  // Returns true when every {{placeholder}} in the block can be resolved
  function canRun(block: HttpBlock): boolean {
    const merged = { ...vars };
    for (const [k, v] of Object.entries(block.preVars || {})) {
      merged[k] = interpolate(v || '', merged);
    }
    const parts = [
      block.url ?? '',
      ...Object.values(block.headers ?? {}),
      block.body ?? '',
    ];
    return parts.every((p) => !/\{\{.*?\}\}/.test(interpolate(p, merged)));
  }

  async function runBlock(block: HttpBlock): Promise<void> {
    // Snapshot vars at the moment the block starts
    const localVars = { ...vars };
    for (const [k, v] of Object.entries(block.preVars || {})) {
      localVars[k] = interpolate(v || '', localVars);
    }

    // Emit pre-request debug values
    for (const d of block.preDebugs || []) {
      onResult({
        id: generateId(),
        type: 'debug',
        name: d.expr,
        method: '',
        url: '',
        ok: true,
        value: resolveDebugExpr(d.expr, null, localVars),
      });
    }

    // Resolve {{variables}} in URL, headers, and body
    const resolvedUrl = interpolate(block.url || '', localVars);
    const resolvedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(block.headers || {})) {
      resolvedHeaders[k] = interpolate(v || '', localVars).trim();
    }
    const resolvedBody = block.body ? interpolate(block.body, localVars) : null;

    // Validate URL
    if (!resolvedUrl) {
      onResult({
        id: generateId(),
        name: block.name,
        method: block.method,
        url: 'INVALID',
        ok: false,
        error: 'Request URL is empty or undefined',
      });
      return;
    }

    // Send the request
    const result = await sendRequest(
      block.method,
      resolvedUrl,
      resolvedHeaders,
      resolvedBody,
      options
    );

    // Apply captures to shared vars so waiting blocks can unblock
    const capturedVars: Record<string, unknown> = {};
    if (result.ok && block.captures?.length) {
      for (const capture of block.captures) {
        const value = lodash.get(result, capture.path);
        if (value !== undefined) {
          capturedVars[capture.key] = value;
          vars[capture.key] = value;
        }
      }
      if (Object.keys(capturedVars).length) {
        onVariableUpdate({ ...vars });
      }
    }

    // Emit post-request debug values
    for (const d of block.debugs || []) {
      onResult({
        id: generateId(),
        type: 'debug',
        name: d.expr,
        method: '',
        url: '',
        ok: true,
        value: resolveDebugExpr(d.expr, result, localVars),
      });
    }

    onResult({
      ...result,
      name: block.name,
      captures: capturedVars,
    });
  }

  // Pending blocks waiting for dependencies
  const pending = [...blocks];
  const running = new Set<Promise<void>>();

  // Fill up to `concurrency` with any blocks whose dependencies are satisfied.
  function tryStart(): void {
    while (running.size < concurrency && pending.length > 0) {
      const idx = pending.findIndex((b) => canRun(b));
      if (idx === -1) { break; } // remaining blocks are waiting on captures
      const block = pending.splice(idx, 1)[0];
      let p!: Promise<void>;
      p = runBlock(block)
        .catch((error: unknown) => {
          onResult({
            id: generateId(),
            name: block.name,
            method: block.method,
            url: '',
            ok: false,
            error: (error as Error).message,
          });
        })
        .then(() => { running.delete(p); });
      running.add(p);
    }
  }

  tryStart();
  while (running.size > 0) {
    await Promise.race(running); // wait for first slot to free, then fill
    tryStart();
  }
}