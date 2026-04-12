/**
 * Request History Manager
 * Tracks and allows replay of executed requests
 */

import * as vscode from 'vscode';
import { RequestResult } from './requester';

export interface HistoryEntry {
  id: string;
  timestamp: Date;
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  result: RequestResult;
}

export class RequestHistoryManager {
  private context: vscode.ExtensionContext;
  private history: HistoryEntry[] = [];
  private maxHistory: number = 100;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadHistory();
  }

  private loadHistory() {
    const saved = this.context.workspaceState.get<Array<{
      id: string; timestamp: string; name: string; method: string; url: string;
      headers: Record<string, string>; body: string | null; result: RequestResult;
    }>>('requestHistory', []);
    this.history = saved.map((entry) => ({
      ...entry,
      timestamp: new Date(entry.timestamp),
    }));
  }

  private async saveHistory() {
    await this.context.workspaceState.update('requestHistory', this.history);
  }

  addEntry(
    name: string,
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | null,
    result: RequestResult
  ) {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      name,
      method,
      url,
      headers,
      body,
      result,
    };

    this.history.unshift(entry);

    // Keep only the latest maxHistory entries
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }

    this.saveHistory();
  }

  async showHistory() {
    if (this.history.length === 0) {
      vscode.window.showInformationMessage('No request history available');
      return;
    }

    const items = this.history.map((entry) => ({
      label: `${entry.method} ${entry.name}`,
      description: entry.url,
      detail: `${entry.timestamp.toLocaleString()} - Status: ${entry.result.status || 'N/A'}`,
      entry,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a request from history',
    });

    if (!selected) {
      return;
    }

    const action = await vscode.window.showQuickPick(
      ['View Details', 'Copy Request', 'Copy Response', 'Replay Request'],
      { placeHolder: 'What would you like to do?' }
    );

    if (!action) {
      return;
    }

    switch (action) {
      case 'View Details':
        await this.viewDetails(selected.entry);
        break;
      case 'Copy Request':
        await this.copyRequest(selected.entry);
        break;
      case 'Copy Response':
        await this.copyResponse(selected.entry);
        break;
      case 'Replay Request':
        await this.replayRequest(selected.entry);
        break;
    }
  }

  private async viewDetails(entry: HistoryEntry) {
    const details = `# Request Details

**Name:** ${entry.name}
**Method:** ${entry.method}
**URL:** ${entry.url}
**Timestamp:** ${entry.timestamp.toLocaleString()}
**Status:** ${entry.result.status || 'N/A'} ${entry.result.statusText || ''}
**Duration:** ${entry.result.duration}ms

## Request Headers
\`\`\`json
${JSON.stringify(entry.headers, null, 2)}
\`\`\`

## Request Body
\`\`\`json
${entry.body || 'No body'}
\`\`\`

## Response
\`\`\`json
${JSON.stringify(entry.result.data, null, 2)}
\`\`\`
`;

    const doc = await vscode.workspace.openTextDocument({
      content: details,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  private async copyRequest(entry: HistoryEntry) {
    let request = `### ${entry.name}\n`;
    request += `${entry.method} ${entry.url}\n`;
    
    for (const [key, value] of Object.entries(entry.headers)) {
      request += `${key}: ${value}\n`;
    }
    
    if (entry.body) {
      request += `\n${entry.body}\n`;
    }

    await vscode.env.clipboard.writeText(request);
    vscode.window.showInformationMessage('Request copied to clipboard');
  }

  private async copyResponse(entry: HistoryEntry) {
    const response = JSON.stringify(entry.result.data, null, 2);
    await vscode.env.clipboard.writeText(response);
    vscode.window.showInformationMessage('Response copied to clipboard');
  }

  private async replayRequest(entry: HistoryEntry) {
    vscode.window.showInformationMessage('Request replay will execute in the current context');
    // This would integrate with the main request execution
    // For now, just copy the request to a new file
    await this.copyRequest(entry);
  }

  async clearHistory() {
    const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
      placeHolder: 'Clear all request history?',
    });

    if (confirm === 'Yes') {
      this.history = [];
      await this.saveHistory();
      vscode.window.showInformationMessage('Request history cleared');
    }
  }

  getRecentRequests(count: number = 10): HistoryEntry[] {
    return this.history.slice(0, count);
  }
}
