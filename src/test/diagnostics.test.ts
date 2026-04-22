import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  class Range {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number
    ) {}
  }

  class Diagnostic {
    constructor(
      public range: Range,
      public message: string,
      public severity: number
    ) {}
  }

  return {
    Range,
    Diagnostic,
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
  };
});

import { validateHttpDocument } from '../diagnostics';

function makeDocument(text: string) {
  return {
    getText: () => text,
  } as const;
}

describe('validateHttpDocument', () => {
  it('does not flag variables captured in an earlier block as undefined', () => {
    const document = makeDocument([
      '### Login',
      'POST https://api.example.com/login',
      'Content-Type: application/json',
      '',
      '{}',
      '@token = res.data.token',
      '### Profile',
      'GET https://api.example.com/profile',
      'Authorization: Bearer {{token}}',
    ].join('\n'));

    const diagnostics = validateHttpDocument(document as never);

    expect(diagnostics.map((d) => d.message)).not.toContain(
      "Variable 'token' is not defined in this file — define it with '@token = value' or check your environment"
    );
  });

  it('does not flag variables declared in an earlier block as undefined', () => {
    const document = makeDocument([
      '### Setup',
      '@baseUrl = https://api.example.com',
      'GET https://health.example.com',
      '### Use Local',
      'GET {{baseUrl}}/users',
    ].join('\n'));

    const diagnostics = validateHttpDocument(document as never);

    expect(diagnostics.map((d) => d.message)).not.toContain(
      "Variable 'baseUrl' is not defined in this file — define it with '@baseUrl = value' or check your environment"
    );
  });
});