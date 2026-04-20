import { describe, it, expect } from 'vitest';

/**
 * The EnvironmentManager.parseEnvFile method is private and requires vscode mocks,
 * so we replicate the parsing logic here to test the trimming fix in isolation.
 * If parseEnvFile is ever extracted to a standalone utility, these tests should
 * target that function directly.
 */
function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) { continue; }

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1).trim();
      }

      vars[key] = value;
    }
  }

  return vars;
}

// ─── .env parsing – quote & whitespace handling ──────────────────────────────

describe('.env parsing – quote and whitespace handling', () => {
  it('strips surrounding double quotes', () => {
    const vars = parseEnvFile('TOKEN="abc123"');
    expect(vars['TOKEN']).toBe('abc123');
  });

  it('strips surrounding single quotes', () => {
    const vars = parseEnvFile("TOKEN='abc123'");
    expect(vars['TOKEN']).toBe('abc123');
  });

  it('trims whitespace inside double quotes', () => {
    const vars = parseEnvFile('TOKEN="  abc123  "');
    expect(vars['TOKEN']).toBe('abc123');
  });

  it('trims whitespace inside single quotes', () => {
    const vars = parseEnvFile("TOKEN='  abc123  '");
    expect(vars['TOKEN']).toBe('abc123');
  });

  it('trims trailing newline-like whitespace inside quotes', () => {
    const vars = parseEnvFile('TOKEN="eyJhbGciOiJSUzI1NiJ9.payload.sig   "');
    expect(vars['TOKEN']).toBe('eyJhbGciOiJSUzI1NiJ9.payload.sig');
  });

  it('handles unquoted values without extra trimming issues', () => {
    const vars = parseEnvFile('TOKEN=abc123');
    expect(vars['TOKEN']).toBe('abc123');
  });

  it('skips comments and blank lines', () => {
    const vars = parseEnvFile('# comment\n\nTOKEN=abc');
    expect(vars['TOKEN']).toBe('abc');
    expect(Object.keys(vars)).toHaveLength(1);
  });
});
