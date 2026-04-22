/**
 * Diagnostics provider for HTTP runbook files.
 * Validates syntax on open/change and reports problems to the Problems panel.
 */

import * as vscode from 'vscode';
import { parseGlobalVars } from './parser';

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

  // Collect globally defined variables from preamble (@key = value)
  const globalVars = parseGlobalVars(text);

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
    // --- Empty block ---
    const contentLines = bLines.filter(l => {
      const t = l.trim();
      return t && !t.startsWith('#');
    });
    if (contentLines.length === 0) {
      const range = new vscode.Range(blockStart, 0, blockStart, lines[blockStart]?.length ?? 0);
      diagnostics.push(new vscode.Diagnostic(range, `Block '${name.trim() || 'unnamed'}' is empty`, vscode.DiagnosticSeverity.Warning));
      return;
    }

    // --- Duplicate block names ---
    const normalizedName = name.trim().toLowerCase();
    if (normalizedName && blockNames.has(normalizedName)) {
      const range = new vscode.Range(blockStart, 0, blockStart, lines[blockStart]?.length ?? 0);
      diagnostics.push(new vscode.Diagnostic(range, `Duplicate block name: '${name.trim()}'`, vscode.DiagnosticSeverity.Warning));
    }
    if (normalizedName) {
      blockNames.add(normalizedName);
    }

    // Collect pre-request @var declarations defined in this block
    const blockVars: Set<string> = new Set(Object.keys(globalVars));
    for (const l of bLines) {
      const t = l.trim();
      if (t.startsWith('@') && t.includes('=')) {
        const key = t.slice(1, t.indexOf('=')).trim();
        if (key) blockVars.add(key);
      }
    }

    // --- Find the METHOD URL line(s) ---
    let foundRequest = false;

    for (let i = 0; i < bLines.length; i++) {
      const line = bLines[i].trim();
      const absoluteLine = blockStart + 1 + i;

      if (!line || line.startsWith('#') || line.startsWith('@') || line.startsWith('>')) {
        continue;
      }

      const parts = line.split(/\s+/);
      const method = parts[0]?.toUpperCase();
      const url = parts[1];

      // Detect a bare URL with no method (e.g. https://example.com)
      if (/^https?:\/\//i.test(parts[0]) || parts[0] === '/') {
        const range = new vscode.Range(absoluteLine, 0, absoluteLine, line.length);
        diagnostics.push(new vscode.Diagnostic(
          range,
          `Line looks like a URL but has no HTTP method — did you mean 'GET ${line}'?`,
          vscode.DiagnosticSeverity.Error
        ));
        foundRequest = true;
        break;
      }

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

      // Scan remaining lines for a second request line (multiple requests in one block).
      // Stop at the blank line that separates headers from body — anything after is body content.
      for (let j = i + 1; j < bLines.length; j++) {
        const next = bLines[j].trim();
        if (!next) {
          break; // blank line = start of body, stop scanning
        }
        if (next.startsWith('#') || next.startsWith('@') || next.startsWith('>')) {
          continue;
        }
        const nextMethod = next.split(/\s+/)[0]?.toUpperCase();
        if (VALID_METHODS.has(nextMethod)) {
          const absLine = blockStart + 1 + j;
          const range = new vscode.Range(absLine, 0, absLine, bLines[j].length);
          diagnostics.push(new vscode.Diagnostic(
            range,
            `Multiple request lines in one block — only the first will be executed. Split with '###'`,
            vscode.DiagnosticSeverity.Warning
          ));
        }
      }
      break;
    }

    if (!foundRequest) {
      const range = new vscode.Range(blockStart, 0, blockStart, lines[blockStart]?.length ?? 0);
      diagnostics.push(new vscode.Diagnostic(range, `Block '${name.trim() || 'unnamed'}' has no HTTP request line (e.g. GET https://example.com)`, vscode.DiagnosticSeverity.Warning));
    }

    // --- Validate header lines & detect duplicate headers ---
    let inHeaders = false;
    const seenHeaders = new Map<string, number>(); // header name (lower) -> first absolute line
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
        if (!trimmed.includes(':')) {
          const range = new vscode.Range(absoluteLine, 0, absoluteLine, line.length);
          diagnostics.push(new vscode.Diagnostic(range, `Header line missing ':' separator — expected 'Name: Value'`, vscode.DiagnosticSeverity.Error));
        } else {
          const headerName = trimmed.slice(0, trimmed.indexOf(':')).trim().toLowerCase();
          if (seenHeaders.has(headerName)) {
            const range = new vscode.Range(absoluteLine, 0, absoluteLine, line.length);
            diagnostics.push(new vscode.Diagnostic(
              range,
              `Duplicate header '${trimmed.slice(0, trimmed.indexOf(':')).trim()}' — already defined on line ${seenHeaders.get(headerName)! + 1}`,
              vscode.DiagnosticSeverity.Warning
            ));
          } else {
            seenHeaders.set(headerName, absoluteLine);
          }
        }
      }
    }

    // --- Undefined variables ---
    const varUsage = /\{\{([^}]+)\}\}/g;
    for (let i = 0; i < bLines.length; i++) {
      const line = bLines[i];
      const absoluteLine = blockStart + 1 + i;
      let vm: RegExpExecArray | null;
      while ((vm = varUsage.exec(line)) !== null) {
        const varName = vm[1].trim();
        // Skip $-prefixed built-ins like {{$guid}}, {{$timestamp}}, {{$randomInt}}
        if (!varName.startsWith('$') && !blockVars.has(varName)) {
          const col = vm.index;
          const range = new vscode.Range(absoluteLine, col, absoluteLine, col + vm[0].length);
          diagnostics.push(new vscode.Diagnostic(
            range,
            `Variable '${varName}' is not defined in this file — define it with '@${varName} = value' or check your environment`,
            vscode.DiagnosticSeverity.Warning
          ));
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
