/**
 * Webview panel for displaying HTTP request results
 */

import * as vscode from 'vscode';
import { RequestResult } from './requester';

export class ResultsPanel {
  private static currentPanel: ResultsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private results: RequestResult[] = [];

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    // If we already have a panel, show it
    if (ResultsPanel.currentPanel) {
      ResultsPanel.currentPanel.panel.reveal(column);
      return ResultsPanel.currentPanel;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'httpVortexResults',
      'HTTP Results',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    ResultsPanel.currentPanel = new ResultsPanel(panel, extensionUri);
    return ResultsPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Set the webview's initial html content
    this.update();

    // Listen for when the panel is disposed
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'copy':
            vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage('Copied to clipboard');
            break;
          case 'exportMarkdown':
            vscode.commands.executeCommand('httpVortex.generateMarkdown');
            break;
          case 'exportSingleResult':
            vscode.commands.executeCommand('httpVortex.exportSingleResult', message.index);
            break;
          case 'copyResult': {
            const r = this.results[message.index];
            if (r && r.data) {
              const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
              vscode.env.clipboard.writeText(text);
              vscode.window.showInformationMessage('Response copied to clipboard');
            }
            break;
          }
        }
      },
      null,
      this.disposables
    );
  }

  public addResult(result: RequestResult) {
    this.results.push(result);
    this.update();
  }

  public clearResults() {
    this.results = [];
    this.update();
  }

  public getResults(): RequestResult[] {
    return this.results;
  }

  public dispose() {
    ResultsPanel.currentPanel = undefined;

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private update() {
    this.panel.webview.html = this.getHtmlContent();
  }

  private getHtmlContent(): string {
    const nonce = getNonce();


    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>HTTP Results</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      padding: 0;
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }

    /* ── Container ───────────────────────────── */
    .container {
      padding: 12px 16px 24px;
    }

    /* ── Cards ───────────────────────────────── */
    .result-card {
      margin-bottom: 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
      transition: box-shadow 0.15s;
    }
    .result-card:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    }
    .result-card.ok {
      border-left: 3px solid #4ec97b;
    }
    .result-card.err {
      border-left: 3px solid #f48771;
    }

    .result-header {
      padding: 10px 14px;
      background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-inactiveSelectionBackground));
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      user-select: none;
    }
    .result-header:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .chevron {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      opacity: 0.6;
      transition: transform 0.15s;
    }
    .result-card.expanded .chevron {
      transform: rotate(90deg);
    }

    .result-name {
      font-weight: 600;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .method-badge {
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .method-GET    { background: #0e4429; color: #4ec97b; }
    .method-POST   { background: #4d3800; color: #e2a620; }
    .method-PUT    { background: #0b3d6b; color: #4db6f5; }
    .method-PATCH  { background: #3b1f6b; color: #c586c0; }
    .method-DELETE { background: #4c1414; color: #f48771; }

    .status-badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .status-2xx { background: #0e4429; color: #4ec97b; }
    .status-3xx { background: #0b3d6b; color: #4db6f5; }
    .status-4xx { background: #4d3800; color: #e2a620; }
    .status-5xx { background: #4c1414; color: #f48771; }
    .status-err { background: #4c1414; color: #f48771; }

    .duration {
      font-size: 11px;
      opacity: 0.55;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .export-single-btn, .copy-result-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-foreground);
      padding: 1px 5px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      opacity: 0;
      transition: opacity 0.15s;
      flex-shrink: 0;
    }
    .result-header:hover .export-single-btn,
    .result-header:hover .copy-result-btn {
      opacity: 0.6;
    }
    .export-single-btn:hover,
    .copy-result-btn:hover {
      opacity: 1 !important;
      border-color: var(--vscode-panel-border);
      background: var(--vscode-list-hoverBackground);
    }

    /* ── Expanded body ───────────────────────── */
    .result-body {
      display: none;
    }
    .result-card.expanded .result-body {
      display: block;
    }

    .result-section {
      padding: 10px 14px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .section-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.55;
    }

    .copy-btn {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-panel-border);
      padding: 1px 7px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      font-family: inherit;
      opacity: 0.6;
      transition: opacity 0.1s;
    }
    .copy-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }

    .url-line {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      word-break: break-all;
      opacity: 0.9;
    }

    pre {
      margin: 0;
      padding: 10px 12px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.6;
      max-height: 320px;
    }

    /* ── Debug entries ───────────────────────── */
    .debug-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 14px;
      margin-bottom: 6px;
      background: var(--vscode-textCodeBlock-background);
      border-left: 3px solid var(--vscode-debugIcon-breakpointForeground);
      border-radius: 0 4px 4px 0;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }
    .debug-label {
      opacity: 0.5;
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding-top: 1px;
    }
    .debug-value { flex: 1; white-space: pre-wrap; word-break: break-all; }

    /* ── Empty state ─────────────────────────── */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 64px 24px;
      gap: 10px;
      opacity: 0.5;
    }
    .empty-icon {
      font-size: 36px;
      line-height: 1;
    }
    .empty-title {
      font-size: 14px;
      font-weight: 600;
    }
    .empty-sub {
      font-size: 12px;
    }
    .export-all-bar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 10px;
    }
    .export-all-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 5px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      font-weight: 500;
      transition: background 0.1s;
      white-space: nowrap;
    }
    .export-all-btn:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="container">
    ${this.results.length > 0 ? `<div class="export-all-bar"><button class="export-all-btn" id="export-md-btn">&#x1F4C4;&nbsp; Export All as Markdown</button></div>` : ''}
    ${this.results.length === 0 ? this.getEmptyState() : this.results.map((r, i) => this.renderResult(r, i)).join('')}
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.addEventListener('click', (e) => {
      const target = e.target;

      // Toggle expansion
      const header = target.closest('.result-header');
      if (header && !target.classList.contains('copy-btn')) {
        header.closest('.result-card').classList.toggle('expanded');
      }

      // Copy button
      if (target.classList.contains('copy-btn')) {
        const text = target.dataset.text;
        vscode.postMessage({ command: 'copy', text });
        const orig = target.textContent;
        target.textContent = 'Copied!';
        setTimeout(() => { target.textContent = orig; }, 1200);
      }

      // Export single result
      if (target.classList.contains('export-single-btn') || target.closest('.export-single-btn')) {
        const btn = target.closest('.export-single-btn') || target;
        vscode.postMessage({ command: 'exportSingleResult', index: parseInt(btn.dataset.index, 10) });
      }

      // Copy single result response body
      if (target.classList.contains('copy-result-btn') || target.closest('.copy-result-btn')) {
        const btn = target.closest('.copy-result-btn') || target;
        vscode.postMessage({ command: 'copyResult', index: parseInt(btn.dataset.index, 10) });
      }

      // Export all as Markdown
      if (target.id === 'export-md-btn' || target.closest('#export-md-btn')) {
        vscode.postMessage({ command: 'exportMarkdown' });
      }
    });
  </script>
</body>
</html>`;
  }

  private getEmptyState(): string {
    return `
      <div class="empty-state">
        <div class="empty-icon">&#x1F310;</div>
        <div class="empty-title">No results yet</div>
        <div class="empty-sub">Run requests from an .http file to see results here.</div>
      </div>
    `;
  }

  private renderResult(result: RequestResult, index: number): string {
    if (result.type === 'debug') {
      return `
        <div class="debug-card">
          <span class="debug-label">debug</span>
          <span class="debug-value">${this.escapeHtml(result.name)}: ${this.escapeHtml(JSON.stringify(result.value, null, 2))}</span>
        </div>
      `;
    }

    const cardClass = result.ok ? 'ok' : 'err';
    const methodClass = `method-${result.method}`;
    const statusClass = result.status
      ? result.status < 300 ? 'status-2xx'
      : result.status < 400 ? 'status-3xx'
      : result.status < 500 ? 'status-4xx'
      : 'status-5xx'
      : 'status-err';

    const bodyText = result.data
      ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2))
      : null;

    return `
      <div class="result-card ${cardClass}">
        <div class="result-header">
          <svg class="chevron" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4"/></svg>
          <span class="result-name">${this.escapeHtml(result.name)}</span>
          <span class="method-badge ${methodClass}">${result.method}</span>
          ${result.status ? `<span class="status-badge ${statusClass}">${result.status} ${this.escapeHtml(result.statusText || '')}</span>` : ''}
          ${result.duration ? `<span class="duration">${result.duration}ms</span>` : ''}
          <button class="copy-result-btn" data-index="${index}" title="Copy response body">&#x1F4CB;</button>
          <button class="export-single-btn" data-index="${index}" title="Export this result as Markdown">&#x1F4C4;</button>
        </div>
        <div class="result-body">
          <div class="result-section">
            <div class="section-header"><span class="section-label">Request URL</span></div>
            <div class="url-line">${this.escapeHtml(result.method)} ${this.escapeHtml(result.url)}</div>
          </div>
          ${result.requestHeaders && Object.keys(result.requestHeaders).length > 0 ? `
            <div class="result-section">
              <div class="section-header">
                <span class="section-label">Request Headers</span>
                <button class="copy-btn" data-text="${this.escapeHtml(JSON.stringify(result.requestHeaders, null, 2))}">Copy</button>
              </div>
              <pre>${this.escapeHtml(JSON.stringify(result.requestHeaders, null, 2))}</pre>
            </div>
          ` : ''}
          ${result.captures && Object.keys(result.captures).length > 0 ? `
            <div class="result-section">
              <div class="section-header"><span class="section-label">Captured Variables</span></div>
              <pre>${this.escapeHtml(JSON.stringify(result.captures, null, 2))}</pre>
            </div>
          ` : ''}
          ${result.error ? `
            <div class="result-section">
              <div class="section-header"><span class="section-label">Error</span></div>
              <pre>${this.escapeHtml(result.error)}</pre>
            </div>
          ` : ''}
          ${bodyText ? `
            <div class="result-section">
              <div class="section-header">
                <span class="section-label">Response Body</span>
                <button class="copy-btn" data-text="${this.escapeHtml(bodyText)}">Copy</button>
              </div>
              <pre>${this.escapeHtml(bodyText)}</pre>
            </div>
          ` : ''}
          ${result.headers ? `
            <div class="result-section">
              <div class="section-header">
                <span class="section-label">Response Headers</span>
                <button class="copy-btn" data-text="${this.escapeHtml(JSON.stringify(result.headers, null, 2))}">Copy</button>
              </div>
              <pre>${this.escapeHtml(JSON.stringify(result.headers, null, 2))}</pre>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private escapeHtml(text: string | undefined | null): string {
    if (text === undefined || text === null) {
      return '';
    }
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
