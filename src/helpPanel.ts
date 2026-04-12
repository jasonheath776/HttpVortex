/**
 * helpPanel.ts — Reference / help webview panel.
 * Content migrated from the desktop app's HelpModal (App.jsx HELP_SECTIONS).
 */

import * as vscode from 'vscode';

interface HelpSection {
  title: string;
  content?: string;
  body?: string;
  note?: string;
}

const HELP_SECTIONS: HelpSection[] = [
  {
    title: 'Quick start',
    content: `Write HTTP requests separated by ### block headers, then use "Run All Requests" (Ctrl+Shift+R) or the ▶ CodeLens above any block to run it individually.

Declare variables with @name = value and reference them anywhere as {{name}}.
Capture response values with @name = res.data.field.
Inspect values inline with > debug(expr).

Enable Parallel mode (toolbar toggle) to run independent blocks concurrently (up to 3 at a time). Blocks that depend on a captured variable automatically wait for that capture before starting.`,
  },
  {
    title: 'Global variables',
    body: `@baseUrl = https://api.example.com
@clientId = my-client`,
    note: 'Declared before the first ### block. Available in every request.',
  },
  {
    title: 'GET request',
    body: `### Get Users
GET {{baseUrl}}/users
Authorization: Bearer {{token}}
Accept: application/json`,
  },
  {
    title: 'POST with JSON body',
    body: `### Create User
POST {{baseUrl}}/users
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "name": "Jane Doe",
  "email": "jane@example.com"
}

@newUserId = res.data.id`,
    note: '@newUserId = res.data.id captures the id field from the JSON response body.',
  },
  {
    title: 'Capture syntax',
    content: 'Place @var = res.* lines after the request body, before the next ### block.',
    body: `@token    = res.data.access_token   # top-level field
@userId   = res.data.id             # top-level field
@itemId   = res.data.items.0.id     # nested / array path (lodash.get)`,
  },
  {
    title: 'Debug / inspect values',
    content: '> debug(expr) emits a debug card in the results panel showing the resolved value. Place it anywhere inside a block.',
    body: `### Check a variable before sending
> debug(@token)
GET {{baseUrl}}/users
Authorization: Bearer {{token}}

### Inspect the full response body
> debug(res.data)

### Inspect a nested field
> debug(res.data.items.0.id)

### Inspect a captured var after it is set
@userId = res.data.id
> debug(@userId)`,
    note: 'Lines before the method line can only reference @vars. Lines after the body can reference both res.* paths and @vars.',
  },
  {
    title: 'OAuth2 / IdentityServer token (runbook)',
    body: `@idpUrl = https://localhost:5001

### Get Access Token
POST {{idpUrl}}/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=my-client&client_secret=my-secret&scope=my-api

@token = res.data.access_token
> debug(@token)`,
    note: 'Must use application/x-www-form-urlencoded — not JSON. The captured token is injected into all following requests. For a GUI-driven alternative with saved credentials, use Manage Auth Profiles.',
  },
  {
    title: 'Auth Profiles & secret storage',
    content: `Use "Manage Auth Profiles" (command palette) to create reusable credential sets for Bearer, Basic, API Key, and OAuth2 flows. The active profile's token is automatically injected as {{token}} before every run.

🔒 Secret storage: tokens, passwords, and API keys are stored in VS Code's SecretStorage API, which is backed by the OS keychain (Windows Credential Manager, macOS Keychain, libsecret on Linux). They are never written to disk in plain text and are encrypted at rest by the operating system.

Only non-sensitive metadata (profile name, type, username, header name) is stored in VS Code's settings store.`,
  },
  {
    title: 'Chaining requests',
    body: `### Step 1 — create order
POST {{baseUrl}}/orders
Authorization: Bearer {{token}}
Content-Type: application/json

{ "item": "Widget" }

@orderId = res.data.id

### Step 2 — confirm order
POST {{baseUrl}}/orders/{{orderId}}/confirm
Authorization: Bearer {{token}}`,
    note: 'Requests run top-to-bottom. Captured variables are available immediately in the next block.',
  },
  {
    title: 'Comments',
    body: `# This line is a comment and is ignored by the parser`,
  },
  {
    title: 'Line continuation',
    content: 'End any line with \\ to continue it on the next line. Leading whitespace on the continuation line is stripped. Useful for long URLs, query strings, and header values.',
    body: `### Long URL with query parameters
GET {{baseUrl}}/reports\\
    ?from=2024-01-01\\
    &to=2024-12-31\\
    &format=json
Authorization: Bearer {{token}}`,
    note: 'The \\ and any leading whitespace on the continuation line are removed before the request is sent.',
  },
  {
    title: 'Snippet templates',
    content: 'Trigger IntelliSense (Ctrl+Space) in an .http file to insert snippet templates.',
    body: `GET              → read a resource
POST             → create with JSON body
PUT              → replace with JSON body
PATCH            → partial update with JSON body
DELETE           → remove a resource
bearer-auth      → Authorization: Bearer {{token}} header
basic-auth       → Authorization: Basic header
api-key          → X-API-Key header`,
  },
  {
    title: 'Parallel execution',
    content: `Click the parallel toggle in the editor toolbar to run blocks concurrently (up to 3 at a time).

The scheduler is dependency-aware — it inspects each block's {{variables}} before starting it:
  • Blocks whose variables are all already resolved start immediately.
  • Blocks that reference a {{variable}} captured from a prior block are queued and start the moment that capture lands.`,
    body: `@idpUrl  = https://identity.example.com
@apiUrl  = https://api.example.com

### Get Token                      ← starts immediately
POST {{idpUrl}}/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=app&client_secret=s3cr3t&scope=api

@token = res.data.access_token

### GET Countries (no token)       ← starts immediately, runs in parallel
GET {{apiUrl}}/standingdata/countries

### GET Users (needs token)        ← waits for token, then starts
GET {{apiUrl}}/users
Authorization: Bearer {{token}}`,
    note: 'If your runbook is a strict step-by-step chain where every block feeds into the next, leave Parallel off.',
  },
  {
    title: 'Keyboard shortcuts',
    body: `Ctrl+Shift+R       Run All Requests
Ctrl+Alt+R         Run Current Request
Ctrl+Shift+M       Generate Markdown Report
Ctrl+Shift+C       Generate Code (C# / JS / Java)`,
  },
  {
    title: 'Toolbar buttons (editor title bar)',
    body: `▶ Run All            Execute all blocks in the document
⊞ Show Results       Open the results panel
📄 Generate Markdown  Export results as a Markdown report
{} Generate Code      Export as C# / JavaScript / Java
⊞ Parallel toggle    Enable / disable concurrent execution`,
  },
  {
    title: 'Results panel buttons',
    body: `📄 Export Markdown    Export ALL results as a single Markdown report
📄 (per card)         Export a single request result as its own Markdown file
Copy (per section)    Copy the response body or headers to clipboard`,
  },
  {
    title: 'Exporting',
    body: `Generate Markdown Report   Saves an .md file with all request results, timings, captured variables, and a pass/fail summary.
Export to Postman           Saves a Postman Collection v2.1 JSON file.
Generate Code              Generates equivalent C#, JavaScript, or Java code for all requests.`,
  },
];

export class HelpPanel {
  private static currentPanel: HelpPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow() {
    if (HelpPanel.currentPanel) {
      HelpPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'httpVortexHelp',
      'HTTP Vortex — Reference',
      vscode.ViewColumn.Beside,
      { enableScripts: false, retainContextWhenHidden: true }
    );
    HelpPanel.currentPanel = new HelpPanel(panel);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => {
      HelpPanel.currentPanel = undefined;
      while (this.disposables.length) {
        this.disposables.pop()?.dispose();
      }
    }, null, this.disposables);
  }

  private esc(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private renderSection(s: HelpSection): string {
    const parts: string[] = [];
    if (s.content) {
      parts.push(`<p class="content">${this.esc(s.content).replace(/\n/g, '<br>')}</p>`);
    }
    if (s.body) {
      parts.push(`<pre>${this.esc(s.body)}</pre>`);
    }
    if (s.note) {
      parts.push(`<p class="note">${this.esc(s.note)}</p>`);
    }
    return `
      <details open>
        <summary>${this.esc(s.title)}</summary>
        <div class="section-body">${parts.join('\n')}</div>
      </details>`;
  }

  private getHtml(): string {
    const sections = HELP_SECTIONS.map(s => this.renderSection(s)).join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>HTTP Vortex Reference</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 0 0 32px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      line-height: 1.6;
    }

    /* ── Sticky header ─────────────────────────── */
    .page-header {
      position: sticky;
      top: 0;
      z-index: 10;
      padding: 10px 20px;
      background: var(--vscode-titleBar-activeBackground, var(--vscode-editor-background));
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: baseline;
      gap: 12px;
    }
    .page-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--vscode-textLink-activeForeground, #c586c0);
    }
    .page-sub {
      font-size: 11px;
      opacity: 0.5;
    }

    /* ── Sections ──────────────────────────────── */
    .sections {
      padding: 12px 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    details {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
    }

    summary {
      padding: 9px 14px;
      background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-inactiveSelectionBackground));
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    summary::-webkit-details-marker { display: none; }
    summary::before {
      content: '›';
      display: inline-block;
      width: 14px;
      transition: transform 0.15s;
      opacity: 0.6;
      font-size: 14px;
    }
    details[open] > summary::before {
      transform: rotate(90deg);
    }
    summary:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .section-body {
      padding: 10px 14px 12px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    p {
      margin: 0;
      font-size: 12px;
    }
    p.note {
      font-size: 11px;
      opacity: 0.65;
      font-style: italic;
    }
    p.content {
      opacity: 0.9;
    }

    pre {
      margin: 0;
      padding: 10px 12px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.55;
      overflow-x: auto;
      white-space: pre;
    }

    /* ── Secret storage callout ─────────────────── */
    .callout-lock {
      background: color-mix(in srgb, var(--vscode-textLink-activeForeground, #c586c0) 10%, transparent);
      border-left: 3px solid var(--vscode-textLink-activeForeground, #c586c0);
      border-radius: 0 4px 4px 0;
      padding: 8px 12px;
      font-size: 12px;
      opacity: 0.95;
    }
  </style>
</head>
<body>
  <div class="page-header">
    <span class="page-title">HTTP Vortex — Reference</span>
    <span class="page-sub">Click any section to expand / collapse</span>
  </div>
  <div class="sections">
    ${sections}
  </div>
</body>
</html>`;
  }
}
