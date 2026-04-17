import { describe, it, expect } from 'vitest';
import { parseBlocks, parseGlobalVars, HttpBlock } from '../parser';

// ─── parseGlobalVars ─────────────────────────────────────────────────────────

describe('parseGlobalVars', () => {
  it('parses simple @key = value declarations', () => {
    const text = '@baseUrl = https://api.example.com\n@token = abc123\n';
    const vars = parseGlobalVars(text);
    expect(vars).toEqual({ baseUrl: 'https://api.example.com', token: 'abc123' });
  });

  it('ignores capture rules (res.* values)', () => {
    const text = '@myVar = res.data.id\n@other = hello\n';
    const vars = parseGlobalVars(text);
    expect(vars).toEqual({ other: 'hello' });
  });

  it('only reads preamble before first ###', () => {
    const text = '@a = 1\n### Block\n@b = 2\nGET https://x.com\n';
    const vars = parseGlobalVars(text);
    expect(vars).toEqual({ a: '1' });
  });
});

// ─── parseBlocks – basic structure ───────────────────────────────────────────

describe('parseBlocks – basic structure', () => {
  it('parses a minimal GET block', () => {
    const text = '### My Request\nGET https://api.example.com/users\n';
    const blocks = parseBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('My Request');
    expect(blocks[0].method).toBe('GET');
    expect(blocks[0].url).toBe('https://api.example.com/users');
    expect(blocks[0].body).toBeNull();
  });

  it('parses headers', () => {
    const text = '### Test\nGET https://api.example.com\nAuthorization: Bearer tok\nAccept: application/json\n';
    const [block] = parseBlocks(text);
    expect(block.headers['Authorization']).toBe('Bearer tok');
    expect(block.headers['Accept']).toBe('application/json');
  });

  it('parses JSON body after blank line', () => {
    const text = '### Post\nPOST https://api.example.com/items\nContent-Type: application/json\n\n{"name":"test"}\n';
    const [block] = parseBlocks(text);
    expect(block.body).toBe('{"name":"test"}');
  });

  it('parses pre-request @var declarations', () => {
    const text = '### Block\n@localVar = localValue\nGET https://api.example.com\n';
    const [block] = parseBlocks(text);
    expect(block.preVars).toEqual({ localVar: 'localValue' });
  });

  it('filters out blocks without a method line', () => {
    const text = '### Bad Block\nThis is just text, no method line\n### Good Block\nGET https://api.example.com\n';
    const blocks = parseBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('Good Block');
  });

  it('parses multiple blocks', () => {
    const text = [
      '### First\nGET https://a.com\n',
      '### Second\nPOST https://b.com\n',
    ].join('');
    const blocks = parseBlocks(text);
    expect(blocks).toHaveLength(2);
  });
});

// ─── parseBlocks – captures ───────────────────────────────────────────────────

describe('parseBlocks – captures', () => {
  it('parses @key = res.* capture rules', () => {
    const text = '### Login\nPOST https://api.example.com/token\n\n{}\n\n@token = res.data.access_token\n';
    const [block] = parseBlocks(text);
    expect(block.captures).toEqual([{ key: 'token', path: 'data.access_token' }]);
  });

  it('does not include res.* assignments in preVars', () => {
    const text = '### Login\n@local = notRes\nPOST https://api.example.com\n\n@token = res.data.token\n';
    const [block] = parseBlocks(text);
    expect(block.preVars).toEqual({ local: 'notRes' });
    expect(block.captures).toEqual([{ key: 'token', path: 'data.token' }]);
  });
});

// ─── parseBlocks – debug lines ───────────────────────────────────────────────

describe('parseBlocks – debug lines', () => {
  it('parses pre-request > debug() directives', () => {
    const text = '### Test\n> debug(@baseUrl)\nGET https://api.example.com\n';
    const [block] = parseBlocks(text);
    expect(block.preDebugs).toEqual([{ expr: '@baseUrl' }]);
  });

  it('parses post-request > debug() directives', () => {
    const text = '### Test\nGET https://api.example.com\n\n> debug(res.status)\n';
    const [block] = parseBlocks(text);
    expect(block.debugs).toEqual([{ expr: 'res.status' }]);
  });
});

// ─── continuation lines ───────────────────────────────────────────────────────

describe('parseBlocks – continuation lines', () => {
  it('joins backslash-continued URL lines', () => {
    const text = '### Long URL\nGET https://api.example.com/users\\\n    ?page=1\\\n    &limit=10\n';
    const [block] = parseBlocks(text);
    expect(block.url).toBe('https://api.example.com/users?page=1&limit=10');
  });
});
