/**
 * Diagnostics provider for HTTP runbook files.
 * Validates syntax on open/change and reports problems to the Problems panel.
 */

import * as vscode from 'vscode';

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT']);

/**
 * Return the 0-based line index of a character offset within text.
 */
function offsetToLine(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length - 1;
}

/**
 * Validate a single .http document and return an array of diagnostics.
 */
export function validateHttpDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
  const text = document.getText();
  const diagnostics: vscode.Diagnostic[] = [];

  // Check for unmatched {{ ... }} placeholders (missing closing }})
  const unclosed = /\{\{(?![^}]*\}\})/g;
  let match: RegExpExecArray | null;
  while ((match = unclosed.exec(text)) !== null) {
    const line = offsetToLine(text, match.index);
    const col = match.index - text.lastIndexOf('\n', match.index - 1) - 1;
    const range = new vscode.Range(line, col, line, col + match[0].length);
    diagnostics.push(new vscode.Diagnostic(range, `Unclosed variable placeholder '{{' — add closing '}}'`, vscode.DiagnosticSeverity.Error));
  }

  // Split into blocks (split on ### to get per-block content + line offset)
  const lines = text.split('\n');
  let currentBlockStart = -1;
  let currentBlockName = '';
  let blockLines: string[] = [];
  const blockNames = new Set<string>();

  const analyzeBlock = (blockStart: number, name: string, bLines: string[]) => {
    // Check for duplicate block names
    const normalizedName = name.trim().toLowerCase();
    if (normalizedName && blockNames.has(normalizedName)) {
      const range = new vscode.Range(blockStart, 0, blockStart, lines[blockStart]?.length ?? 0);
      diagnostics.push(new vscode.Diagnostic(range, `Duplicate block name: '${name.trim()}'`, vscode.DiagnosticSeverity.Warning));
    }
    if (normalizedName) {
      blockNames.add(normalizedName);
    }

    // Find the METHOD URL line
    let foundRequest = false;
    for (let i = 0; i < bLines.length; i++) {
      const line = bLines[i].trim();
      const absoluteLine = blockStart + 1 + i;

      if (!line || line.startsWith('#') || line.startsWith('@') || line.startsWith('>')) {
        continue;
      }

      // Found candidate request line
      const parts = line.split(/\s+/);
      const method = parts[0]?.toUpperCase();
      const url = parts[1];

      if (!VALID_METHODS.has(method)) {
        const range = new vscode.Range(absoluteLine, 0, absoluteLine, parts[0]?.length ?? 1);
        diagnostics.push(new vscode.Diagnostic(range, `Invalid HTTP method '${parts[0]}'. Expected one of: ${[...VALID_METHODS].join(', ')}`, vscode.DiagnosticSeverity.Error));
        foundRequest = true;
        break;
      }

      if (!url) {
        const range = new vscode.Range(absoluteLine, 0, absoluteLine, line.length);
        diagnostics.push(new vscode.Diagnostic(range, `Missing URL after HTTP method '${method}'`, vscode.DiagnosticSeverity.Error));
        foundRequest = true;
        break;
      }

      // Validate URL — allow {{vars}}, relative paths, and absolute http/https
      const resolvedUrl = url.replace(/\{\{[^}]+\}\}/g, 'https://placeholder.example');
      if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://') && !resolvedUrl.startsWith('/')) {
        const col = line.indexOf(url);
        const range = new vscode.Range(absoluteLine, col, absoluteLine, col + url.length);
        diagnostics.push(new vscode.Diagnostic(range, `URL '${url}' should start with http://, https://, / or a {{variable}}`, vscode.DiagnosticSeverity.Warning));
      }

      foundRequest = true;
      break;
    }

    if (!foundRequest && bLines.some(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('@') && !l.trim().startsWith('>'))) {
      // Block has non-comment content but no valid request line
      const range = new vscode.Range(blockStart, 0, blockStart, lines[blockStart]?.length ?? 0);
      diagnostics.push(new vscode.Diagnostic(range, `Block '${name.trim() || 'unnamed'}' has no HTTP request line (e.g. GET https://example.com)`, vscode.DiagnosticSeverity.Warning));
    }

    // Validate header lines (lines between method line and blank line)
    let inHeaders = false;
    for (let i = 0; i < bLines.length; i++) {
      const line = bLines[i];
      const trimmed = line.trim();
      const absoluteLine = blockStart + 1 + i;

      if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+\S+/i.test(trimmed)) {
        inHeaders = true;
        continue;
      }

      if (inHeaders) {
        if (trimmed === '') {
          break; // End of headers
        }
        if (trimmed.startsWith('#') || trimmed.startsWith('@') || trimmed.startsWith('>')) {
          continue;
        }
        // Header line should have a colon
        if (!trimmed.includes(':')) {
          const range = new vscode.Range(absoluteLine, 0, absoluteLine, line.length);
          diagnostics.push(new vscode.Diagnostic(range, `Header line missing ':' separator — expected 'Name: Value'`, vscode.DiagnosticSeverity.Error));
        }
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^###/.test(line)) {
      if (currentBlockStart !== -1) {
        analyzeBlock(currentBlockStart, currentBlockName, blockLines);
      }
      currentBlockStart = i;
      currentBlockName = line.replace(/^###\s*/, '');
      blockLines = [];
    } else if (currentBlockStart !== -1) {
      blockLines.push(line);
    }
  }

  // Process last block
  if (currentBlockStart !== -1) {
    analyzeBlock(currentBlockStart, currentBlockName, blockLines);
  }

  return diagnostics;
}

/**
 * Create and register a diagnostics collection that validates HTTP runbook files.
 * Returns the collection so the caller can dispose it on deactivation.
 */
export function registerHttpDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('httpVortex');

  function updateDiagnostics(document: vscode.TextDocument) {
    if (document.languageId !== 'http') {
      return;
    }
    collection.set(document.uri, validateHttpDocument(document));
  }

  // Validate all open http documents on startup
  for (const doc of vscode.workspace.textDocuments) {
    updateDiagnostics(doc);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) => updateDiagnostics(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    collection
  );

  return collection;
}
