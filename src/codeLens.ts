/**
 * CodeLens provider for showing "Run" actions above each request block
 */

import * as vscode from 'vscode';

export class HttpCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  public provideCodeLenses(
    document: vscode.TextDocument
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    console.log('CodeLens provider called for:', document.languageId);
    
    if (document.languageId !== 'http') {
      console.log('Not an HTTP document, skipping CodeLens');
      return [];
    }

    const config = vscode.workspace.getConfiguration('httpVortex');
    if (!config.get('enableCodeLens', true)) {
      console.log('CodeLens disabled in settings');
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Find lines starting with ### (request block headers)
      if (line.trim().startsWith('###')) {
        console.log(`Found request block at line ${i}: ${line.trim()}`);
        const range = new vscode.Range(i, 0, i, line.length);
        
        // Add "Run" CodeLens
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: '▶ Run',
            command: 'httpVortex.runCurrent',
            tooltip: 'Run this request',
            arguments: [i],
          })
        );
        
        // Add "Run All from Here" CodeLens
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: '▶▶ Run All from Here',
            command: 'httpVortex.runFromHere',
            tooltip: 'Run all requests starting from this one',
            arguments: [i],
          })
        );
      }
    }

    console.log(`Returning ${codeLenses.length} CodeLens items`);
    return codeLenses;
  }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }
}
