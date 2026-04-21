import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interpolate, runAll } from '../requester';
import { HttpBlock } from '../parser';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// ─── interpolate ─────────────────────────────────────────────────────────────

describe('interpolate', () => {
  it('replaces {{key}} placeholders', () => {
    expect(interpolate('Hello {{name}}!', { name: 'world' })).toBe('Hello world!');
  });

  it('leaves unresolved placeholders as-is', () => {
    expect(interpolate('{{missing}}', {})).toBe('{{missing}}');
  });

  it('handles multiple placeholders', () => {
    expect(interpolate('{{a}} and {{b}}', { a: '1', b: '2' })).toBe('1 and 2');
  });

  it('handles empty string', () => {
    expect(interpolate('', {})).toBe('');
  });

  it('trims key whitespace', () => {
    expect(interpolate('{{ key }}', { key: 'val' })).toBe('val');
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeBlock(overrides: Partial<HttpBlock> = {}): HttpBlock {
  return {
    name: 'Test',
    method: 'GET',
    url: 'https://api.example.com',
    headers: {},
    body: null,
    preVars: {},
    preDebugs: [],
    captures: [],
    debugs: [],
    ...overrides,
  };
}

function makeSuccessResponse(data: unknown = {}) {
  return {
    status: 200,
    statusText: 'OK',
    headers: {},
    data,
    config: {},
    request: {},
  };
}

function makeErrorResponse(status: number, data: unknown = {}) {
  return {
    status,
    statusText: 'Error',
    headers: {},
    data,
    config: {},
    request: {},
  };
}

// ─── runAll – basic execution ─────────────────────────────────────────────────

describe('runAll – basic execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.mockResolvedValue(makeSuccessResponse({ id: 1 }));
  });

  it('calls onResult once per block', async () => {
    const onResult = vi.fn();
    const blocks = [makeBlock(), makeBlock({ name: 'Second', url: 'https://b.com' })];
    await runAll(blocks, {}, onResult, vi.fn());
    const requestResults = onResult.mock.calls.filter(([r]) => r.type !== 'debug');
    expect(requestResults).toHaveLength(2);
  });

  it('resolves {{variables}} in the URL before sending', async () => {
    const onResult = vi.fn();
    const block = makeBlock({ url: 'https://{{host}}/users' });
    await runAll([block], { host: 'api.example.com' }, onResult, vi.fn());
    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.example.com/users' }),
    );
  });

  it('resolves {{variables}} in headers', async () => {
    const block = makeBlock({ headers: { Authorization: 'Bearer {{token}}' } });
    await runAll([block], { token: 'abc123' }, vi.fn(), vi.fn());
    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer abc123' }) }),
    );
  });

  it('emits ok=true result on 2xx response', async () => {
    const onResult = vi.fn();
    await runAll([makeBlock()], {}, onResult, vi.fn());
    const result = onResult.mock.calls[0][0];
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it('emits ok=false result on 4xx response', async () => {
    mockedAxios.mockResolvedValue(makeErrorResponse(404));
    const onResult = vi.fn();
    await runAll([makeBlock()], {}, onResult, vi.fn());
    const result = onResult.mock.calls[0][0];
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('emits an error result when axios throws', async () => {
    mockedAxios.mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true }));
    const onResult = vi.fn();
    await runAll([makeBlock()], {}, onResult, vi.fn());
    const result = onResult.mock.calls[0][0];
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network Error');
  });

  it('emits an error result when URL is missing', async () => {
    const block = makeBlock({ url: '' });
    const onResult = vi.fn();
    await runAll([block], {}, onResult, vi.fn());
    expect(mockedAxios).not.toHaveBeenCalled();
    expect(onResult.mock.calls[0][0].ok).toBe(false);
  });
});

// ─── runAll – captures ────────────────────────────────────────────────────────

describe('runAll – captures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures a value from the response and injects into next block', async () => {
    mockedAxios
      .mockResolvedValueOnce(makeSuccessResponse({ access_token: 'tok-abc' }))
      .mockResolvedValueOnce(makeSuccessResponse({}));

    const loginBlock = makeBlock({
      name: 'Login',
      method: 'POST',
      url: 'https://api.example.com/token',
      captures: [{ key: 'token', path: 'data.access_token' }],
    });
    const apiBlock = makeBlock({
      name: 'API Call',
      url: 'https://api.example.com/me',
      headers: { Authorization: 'Bearer {{token}}' },
    });

    const onVarUpdate = vi.fn();
    await runAll([loginBlock, apiBlock], {}, vi.fn(), onVarUpdate);

    expect(mockedAxios).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-abc' }) }),
    );
  });

  it('does NOT capture when response is not 2xx', async () => {
    mockedAxios.mockResolvedValue(makeErrorResponse(401, { access_token: 'leaked' }));

    const block = makeBlock({
      captures: [{ key: 'token', path: 'data.access_token' }],
    });
    const onVarUpdate = vi.fn();
    await runAll([block], {}, vi.fn(), onVarUpdate);
    // onVariableUpdate should only be called for preVars, not captures
    const updatesWithToken = onVarUpdate.mock.calls.filter(([v]) => 'token' in v);
    expect(updatesWithToken).toHaveLength(0);
  });
});

// ─── runAll – pre-request vars ────────────────────────────────────────────────

describe('runAll – preVars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.mockResolvedValue(makeSuccessResponse({}));
  });

  it('applies preVars before sending', async () => {
    const block = makeBlock({
      preVars: { host: 'pre.example.com' },
      url: 'https://{{host}}/path',
    });
    await runAll([block], {}, vi.fn(), vi.fn());
    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://pre.example.com/path' }),
    );
  });

  it('preVars can reference global vars', async () => {
    const block = makeBlock({
      preVars: { endpoint: '{{base}}/users' },
      url: '{{endpoint}}',
    });
    await runAll([block], { base: 'https://api.example.com' }, vi.fn(), vi.fn());
    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.example.com/users' }),
    );
  });
});

// ─── runAll – header value trimming ───────────────────────────────────────────

describe('runAll – header value trimming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.mockResolvedValue(makeSuccessResponse({}));
  });

  it('trims trailing whitespace from interpolated header values', async () => {
    const block = makeBlock({
      headers: { Authorization: 'Bearer {{token}}' },
    });
    await runAll([block], { token: 'abc123   ' }, vi.fn(), vi.fn());
    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer abc123' }),
      }),
    );
  });

  it('trims trailing newline from interpolated header values', async () => {
    const block = makeBlock({
      headers: { Authorization: 'Bearer {{token}}' },
    });
    await runAll([block], { token: 'abc123\n' }, vi.fn(), vi.fn());
    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer abc123' }),
      }),
    );
  });

  it('trims leading whitespace from interpolated header values', async () => {
    const block = makeBlock({
      headers: { 'X-Custom': '{{val}}' },
    });
    await runAll([block], { val: '  trimmed' }, vi.fn(), vi.fn());
    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Custom': 'trimmed' }),
      }),
    );
  });

  it('trims captured token with whitespace used in next request header', async () => {
    mockedAxios
      .mockResolvedValueOnce(makeSuccessResponse({ access_token: 'tok-xyz  \n' }))
      .mockResolvedValueOnce(makeSuccessResponse({}));

    const loginBlock = makeBlock({
      name: 'Login',
      method: 'POST',
      url: 'https://auth.example.com/token',
      captures: [{ key: 'token', path: 'data.access_token' }],
    });
    const apiBlock = makeBlock({
      name: 'API',
      url: 'https://api.example.com/me',
      headers: { Authorization: 'Bearer {{token}}' },
    });

    await runAll([loginBlock, apiBlock], {}, vi.fn(), vi.fn());
    expect(mockedAxios).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-xyz' }),
      }),
    );
  });

  it('replaces captured token in Bearer header for next request', async () => {
    mockedAxios
      .mockResolvedValueOnce(makeSuccessResponse({ 
        access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJhY2ZkZFNtIn0.eyJleHAiOjE3NzY3NzUsImlhdCI6MTc3NjcsImp0aSI6IjliZGY3Y2E3In0.N2OgtWkKpj0alYiF4W_8QIz879stcq70sJOlPlMeLcx1k8zw'
      }))
      .mockResolvedValueOnce(makeSuccessResponse({ user: { id: 1 } }));

    const loginBlock = makeBlock({
      name: 'GetToken',
      method: 'POST',
      url: 'https://localhost:8080/realms/neon/protocol/openid-connect/token',
      captures: [{ key: 'token', path: 'data.access_token' }],
    });
    const apiBlock = makeBlock({
      name: 'GetUser',
      url: 'https://api.example.com/me',
      headers: { Authorization: 'Bearer {{token}}' },
    });

    const results: any[] = [];
    await runAll([loginBlock, apiBlock], {}, (r) => results.push(r), vi.fn());
    
    expect(mockedAxios).toHaveBeenCalledTimes(2);
    // Check the second call (GetUser) has Authorization header
    const secondCall = mockedAxios.mock.calls[1][0] as any;
    expect(secondCall.headers.Authorization).toBeDefined();
    expect(secondCall.headers.Authorization).toContain('Bearer');
    expect(secondCall.headers.Authorization).not.toContain('{{token}}');
  });
});

// ─── runAllParallel – token capture and dependency injection ─────────────────

describe('runAllParallel – token capture & dependency injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for token capture before running dependent request', async () => {
    let tokenRequestTime = 0;
    let apiRequestTime = 0;

    mockedAxios
      .mockImplementationOnce(async () => {
        tokenRequestTime = Date.now();
        return makeSuccessResponse({ access_token: 'captured-token-xyz' });
      })
      .mockImplementationOnce(async () => {
        apiRequestTime = Date.now();
        return makeSuccessResponse({ user: { id: 1 } });
      });

    const loginBlock = makeBlock({
      name: 'GetToken',
      method: 'POST',
      url: 'https://localhost:8080/token',
      captures: [{ key: 'token', path: 'data.access_token' }],
    });
    const apiBlock = makeBlock({
      name: 'GetUser',
      url: 'https://api.example.com/me',
      headers: { Authorization: 'Bearer {{token}}' },
    });

    const { runAllParallel } = await import('../requester');
    const results: any[] = [];
    await runAllParallel([loginBlock, apiBlock], {}, (r) => results.push(r), vi.fn(), {}, 3);
    
    expect(mockedAxios).toHaveBeenCalledTimes(2);
    // API request should have the token
    const apiCall = mockedAxios.mock.calls[1][0] as any;
    expect(apiCall.headers.Authorization).toBe('Bearer captured-token-xyz');
  });
});
