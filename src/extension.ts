/**
 * HTTP Vortex VS Code extension
 * Text-first HTTP runbook editor
 */

import * as vscode from 'vscode';
import { parseBlocks, parseGlobalVars } from './parser';
import { runAll, runAllParallel, RequestOptions } from './requester';
import { ResultsPanel } from './resultsPanel';
import { HttpCodeLensProvider } from './codeLens';
import { AuthProfileManager } from './authManager';
import { RequestHistoryManager } from './historyManager';
import { EnvironmentManager } from './environmentManager';
import { registerHttpDiagnostics } from './diagnostics';
import { parsePostmanCollection, buildPostmanCollection } from './postman';
import { generateCode } from './codegen';
import { buildMarkdownReport } from './markdown';
import { registerSnippetsProvider } from './snippetsProvider';
import { HelpPanel } from './helpPanel';
import { RecentFilesProvider } from './recentFilesProvider';

let currentVariables: Record<string, unknown> = {};
let resultsPanel: ResultsPanel | undefined;
let parallelMode = false;
let authManager: AuthProfileManager;
let historyManager: RequestHistoryManager;
let envManager: EnvironmentManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('HTTP Vortex extension activated');
  vscode.window.showInformationMessage('HTTP Vortex extension is now active!');

  // Initialize managers
  authManager = new AuthProfileManager(context);
  historyManager = new RequestHistoryManager(context);
  envManager = new EnvironmentManager();

  // Recent files tree view
  const recentFilesProvider = new RecentFilesProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('httpVortex.recentFilesView', recentFilesProvider)
  );

  // Track recently opened .http files
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && editor.document.languageId === 'http' && editor.document.uri.scheme === 'file') {
        recentFilesProvider.recordFile(editor.document.uri.fsPath);
      }
    })
  );

  // Register recent files commands
  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.openRecentFile', (arg: unknown) => {
      // When invoked from the item's command, arg is a string path.
      // When invoked from the inline context menu button, arg is the TreeItem object.
      const filePath = typeof arg === 'string' ? arg : (arg as { filePath: string }).filePath;
      vscode.workspace.openTextDocument(vscode.Uri.file(filePath)).then(doc => {
        vscode.window.showTextDocument(doc);
      });
    }),
    vscode.commands.registerCommand('httpVortex.clearRecentFiles', () => {
      recentFilesProvider.clearAll();
    })
  );

  // Track HTTP file open state for context menu buttons
  const updateHttpFileContext = () => {
    const activeEditor = vscode.window.activeTextEditor;
    let isHttpFile: boolean;
    if (activeEditor) {
      isHttpFile = activeEditor.document.languageId === 'http';
    } else {
      // A non-editor panel (e.g. results webview) has focus — check visible editors
      isHttpFile = vscode.window.visibleTextEditors.some(
        e => e.document.languageId === 'http'
      );
    }
    vscode.commands.executeCommand('setContext', 'httpVortex.httpFileOpen', isHttpFile);
  };

  // Update context when editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateHttpFileContext();
    })
  );

  // Initial context check
  updateHttpFileContext();

  // Register syntax diagnostics
  registerHttpDiagnostics(context);

  // Register snippets provider
  registerSnippetsProvider(context);

  // Register CodeLens provider
  const codeLensProvider = new HttpCodeLensProvider();
  const selector: vscode.DocumentSelector = [
    { language: 'http', scheme: 'file' },
    { language: 'http', scheme: 'untitled' }
  ];
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, codeLensProvider)
  );
  console.log('CodeLens provider registered for http language');

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.runAll', async () => {
      await runAllRequests(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.runCurrent', async () => {
      await runCurrentRequest(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.showResults', () => {
      resultsPanel = ResultsPanel.createOrShow(context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.clearVariables', () => {
      currentVariables = {};
      vscode.window.showInformationMessage('Variables cleared');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.exportPostman', async () => {
      await exportToPostman();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.showHelp', () => {
      HelpPanel.createOrShow();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.importPostman', async () => {
      await importFromPostman();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.generateMarkdown', async () => {
      await generateMarkdownReport();
    })
  );

  // Parallel mode toggle
  const setParallel = (value: boolean) => {
    parallelMode = value;
    vscode.commands.executeCommand('setContext', 'httpVortex.parallelMode', value);
  };
  setParallel(false); // initialize context key

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.enableParallel', () => setParallel(true))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.disableParallel', () => setParallel(false))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.generateCode', async () => {
      await generateCodeHandler();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.exportSingleResult', async (index: number) => {
      await exportSingleResult(index);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.manageAuthProfiles', async () => {
      await authManager.manageProfiles();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.runFromHere', async (startLine: number) => {
      await runFromHere(context, startLine);
    })
  );

  // Environment management commands
  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.loadEnvironment', async () => {
      await envManager.loadEnvironmentFile();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.selectEnvironment', async () => {
      await envManager.selectEnvironment();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.createEnvironment', async () => {
      await envManager.createEnvironmentFile();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.showEnvironmentVars', async () => {
      await envManager.showCurrentVariables();
    })
  );

  // History management commands
  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.showHistory', async () => {
      await historyManager.showHistory();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.clearHistory', async () => {
      await historyManager.clearHistory();
    })
  );
}

async function runAllRequests(context: vscode.ExtensionContext) {
  const editor =
    (vscode.window.activeTextEditor?.document.languageId === 'http'
      ? vscode.window.activeTextEditor
      : vscode.window.visibleTextEditors.find(e => e.document.languageId === 'http'));

  if (!editor) {
    vscode.window.showErrorMessage('No active HTTP runbook file');
    return;
  }

  const text = editor.document.getText();
  
  try {
    // Parse global variables and blocks
    const globalVars = parseGlobalVars(text);
    const blocks = parseBlocks(text);

    if (blocks.length === 0) {
      vscode.window.showWarningMessage('No requests found in the current file');
      return;
    }

    // Merge environment variables with global variables (global vars take precedence)
    const envVars = envManager.getAllVariables();
    currentVariables = { ...envVars, ...globalVars };
    
    resultsPanel = ResultsPanel.createOrShow(context.extensionUri);
    resultsPanel.clearResults();

    // Get request options from configuration
    const config = vscode.workspace.getConfiguration('httpVortex');
    const options: RequestOptions = {
      timeout: config.get<number>('timeout', 30000),
      followRedirects: config.get('followRedirects', true),
      validateSSL: config.get('validateSSL', true),
    };

    // Show progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: parallelMode ? 'Running HTTP requests (parallel)' : 'Running HTTP requests',
        cancellable: false,
      },
      async (progress) => {
        let completed = 0;
        const runner = parallelMode ? runAllParallel : runAll;
        
        await runner(
          blocks,
          currentVariables,
          (result) => {
            if (resultsPanel) {
              resultsPanel.addResult(result);
            }
            if (result.type !== 'debug') {
              completed++;
              progress.report({
                message: `${completed}/${blocks.length} requests completed`,
                increment: (100 / blocks.length),
              });
            }
          },
          (vars) => {
            currentVariables = vars;
          },
          options
        );
      }
    );

    vscode.window.showInformationMessage(`Completed ${blocks.length} request(s)`);
  } catch (error: unknown) {
    vscode.window.showErrorMessage(`Error running requests: ${(error as Error).message}`);
  }
}

async function runCurrentRequest(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }

  if (editor.document.languageId !== 'http') {
    vscode.window.showErrorMessage('Current file is not an HTTP runbook (.http or .rest)');
    return;
  }

  const text = editor.document.getText();
  const cursorPosition = editor.selection.active;
  const cursorOffset = editor.document.offsetAt(cursorPosition);

  try {
    // Parse all blocks to find the one containing the cursor
    const globalVars = parseGlobalVars(text);
    const blocks = parseBlocks(text);

    // Find which block contains the cursor
    let targetBlock = null;
    let currentOffset = 0;
    const lines = text.split('\n');
    let inBlock = false;
    let blockIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineOffset = currentOffset;
      const lineLength = line.length + 1; // +1 for newline

      if (line.trim().startsWith('###')) {
        inBlock = true;
        blockIndex++;
      }

      if (inBlock && cursorOffset >= lineOffset && cursorOffset < lineOffset + lineLength) {
        targetBlock = blocks[blockIndex];
        break;
      }

      currentOffset += lineLength;
    }

    if (!targetBlock) {
      vscode.window.showWarningMessage('Cursor is not inside a request block');
      return;
    }

    // Use current variables or parse globals
    currentVariables = Object.keys(currentVariables).length > 0 ? currentVariables : { ...globalVars };
    resultsPanel = ResultsPanel.createOrShow(context.extensionUri);

    const config = vscode.workspace.getConfiguration('httpVortex');
    const options: RequestOptions = {
      timeout: config.get<number>('timeout', 30000),
      followRedirects: config.get('followRedirects', true),
      validateSSL: config.get('validateSSL', true),
    };

    await runAll(
      [targetBlock],
      currentVariables,
      (result) => {
        if (resultsPanel) {
          resultsPanel.addResult(result);
        }
      },
      (vars) => {
        currentVariables = vars;
      },
      options
    );

    vscode.window.showInformationMessage(`Request "${targetBlock.name}" completed`);
  } catch (error: unknown) {
    vscode.window.showErrorMessage(`Error running request: ${(error as Error).message}`);
  }
}

async function exportToPostman() {
  const editor =
    (vscode.window.activeTextEditor?.document.languageId === 'http'
      ? vscode.window.activeTextEditor
      : vscode.window.visibleTextEditors.find(e => e.document.languageId === 'http'));

  if (!editor) {
    vscode.window.showErrorMessage('No active HTTP runbook file');
    return;
  }

  const text = editor.document.getText();
  const globalVars = parseGlobalVars(text);
  const blocks = parseBlocks(text);

  if (blocks.length === 0) {
    vscode.window.showWarningMessage('No requests found to export');
    return;
  }

  // Use the standardized postman collection builder
  const json = buildPostmanCollection(
    editor.document.fileName.split(/[\\/]/).pop()?.replace(/\.(http|rest)$/, '') || 'HTTP Runbook',
    globalVars,
    blocks
  );

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('collection.postman_collection.json'),
    filters: {
      'json': ['json'],
    },
  });

  if (uri) {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf8'));
    vscode.window.showInformationMessage('Postman collection exported successfully');
  }
}

async function importFromPostman() {
  const uri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    filters: {
      'json': ['json'],
    },
  });

  if (!uri || uri.length === 0) {
    return;
  }

  try {
    const content = await vscode.workspace.fs.readFile(uri[0]);
    const json = content.toString();
    
    // Use the standardized postman collection parser
    const httpContent = parsePostmanCollection(json);

    // Create new document with the converted content
    const doc = await vscode.workspace.openTextDocument({
      content: httpContent,
      language: 'http',
    });
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('Postman collection imported successfully');
  } catch (error: unknown) {
    vscode.window.showErrorMessage(`Failed to import: ${(error as Error).message}`);
  }
}

async function generateMarkdownReport() {
  if (!resultsPanel) {
    vscode.window.showWarningMessage('No results available. Run some requests first.');
    return;
  }

  // Allow calling from results panel (no active HTTP editor) by checking visible editors
  const editor =
    (vscode.window.activeTextEditor?.document.languageId === 'http'
      ? vscode.window.activeTextEditor
      : vscode.window.visibleTextEditors.find(e => e.document.languageId === 'http'));

  if (!editor) {
    vscode.window.showErrorMessage('No active HTTP runbook file');
    return;
  }

  const results = resultsPanel.getResults();
  const fileName = editor.document.fileName.split(/[\\/]/).pop() || 'Unknown';
  const reportTitle = fileName.replace(/\.(http|rest)$/, '');

  // Use the standardized markdown report builder
  const markdown = buildMarkdownReport(reportTitle, results, currentVariables);

  const defaultName = editor.document.fileName.replace(/\.(http|rest)$/, '') + '-report.md';
  const defaultUri = vscode.Uri.file(defaultName);
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'markdown': ['md'] },
  });

  if (!saveUri) {
    return;
  }

  await vscode.workspace.fs.writeFile(saveUri, Buffer.from(markdown, 'utf8'));
  const doc = await vscode.workspace.openTextDocument(saveUri);
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  vscode.window.showInformationMessage('Markdown report saved: ' + saveUri.fsPath.split(/[\\/]/).pop());
}

async function runFromHere(context: vscode.ExtensionContext, startLine: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }

  if (editor.document.languageId !== 'http') {
    vscode.window.showErrorMessage('Current file is not an HTTP runbook (.http or .rest)');
    return;
  }

  const text = editor.document.getText();
  
  try {
    const globalVars = parseGlobalVars(text);
    const allBlocks = parseBlocks(text);

    if (allBlocks.length === 0) {
      vscode.window.showWarningMessage('No requests found in the current file');
      return;
    }

    // Find which block index corresponds to the start line
    const lines = text.split('\n');
    let blockIndex = 0;

    for (let i = 0; i < lines.length && i <= startLine; i++) {
      if (lines[i].trim().startsWith('###')) {
        if (i === startLine) {
          break;
        }
        if (i < startLine) {
          blockIndex++;
        }
      }
    }

    // Get blocks from this index onwards
    const blocksToRun = allBlocks.slice(blockIndex);

    if (blocksToRun.length === 0) {
      vscode.window.showWarningMessage('No requests found from this point onwards');
      return;
    }

    currentVariables = { ...globalVars };
    resultsPanel = ResultsPanel.createOrShow(context.extensionUri);
    resultsPanel.clearResults();

    const config = vscode.workspace.getConfiguration('httpVortex');
    const options: RequestOptions = {
      timeout: config.get<number>('timeout', 30000),
      followRedirects: config.get('followRedirects', true),
      validateSSL: config.get('validateSSL', true),
    };

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Running HTTP requests',
        cancellable: false,
      },
      async (progress) => {
        let completed = 0;
        
        await runAll(
          blocksToRun,
          currentVariables,
          (result) => {
            if (resultsPanel) {
              resultsPanel.addResult(result);
            }
            if (result.type !== 'debug') {
              completed++;
              progress.report({
                message: `${completed}/${blocksToRun.length} requests completed`,
                increment: (100 / blocksToRun.length),
              });
            }
          },
          (vars) => {
            currentVariables = vars;
          },
          options
        );
      }
    );

    vscode.window.showInformationMessage(`Completed ${blocksToRun.length} request(s)`);
  } catch (error: unknown) {
    vscode.window.showErrorMessage(`Error running requests: ${(error as Error).message}`);
  }
}

async function exportSingleResult(index: number) {
  if (!resultsPanel) {
    vscode.window.showWarningMessage('No results available.');
    return;
  }

  const results = resultsPanel.getResults();
  const result = results[index];
  if (!result) {
    vscode.window.showWarningMessage('Result not found.');
    return;
  }

  const markdown = buildMarkdownReport(result.name || `Request ${index + 1}`, [result], currentVariables);

  const editor = vscode.window.activeTextEditor?.document.languageId === 'http'
    ? vscode.window.activeTextEditor
    : vscode.window.visibleTextEditors.find(e => e.document.languageId === 'http');

  const baseName = (result.name || `request-${index + 1}`)
    .replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  const defaultPath = editor
    ? editor.document.fileName.replace(/[^/\\]+$/, baseName + '.md')
    : baseName + '.md';

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultPath),
    filters: { 'Markdown': ['md'] },
  });

  if (!saveUri) { return; }

  await vscode.workspace.fs.writeFile(saveUri, Buffer.from(markdown, 'utf8'));
  const doc = await vscode.workspace.openTextDocument(saveUri);
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  vscode.window.showInformationMessage('Saved: ' + saveUri.fsPath.split(/[\\/]/).pop());
}

async function generateCodeHandler() {
  const editor =
    (vscode.window.activeTextEditor?.document.languageId === 'http'
      ? vscode.window.activeTextEditor
      : vscode.window.visibleTextEditors.find(e => e.document.languageId === 'http'));

  if (!editor) {
    vscode.window.showErrorMessage('No active HTTP runbook file');
    return;
  }

  const text = editor.document.getText();
  const globalVars = parseGlobalVars(text);
  const blocks = parseBlocks(text);

  if (blocks.length === 0) {
    vscode.window.showWarningMessage('No requests found to generate code for');
    return;
  }

  // Prompt user for language selection
  const language = await vscode.window.showQuickPick(
    [
      { label: 'C#', value: 'csharp' },
      { label: 'JavaScript', value: 'javascript' },
      { label: 'Java', value: 'java' },
    ],
    { placeHolder: 'Select code generation language' }
  );

  if (!language) {
    return;
  }

  try {
    const code = generateCode(language.value as 'csharp' | 'javascript' | 'java', globalVars, blocks);
    
    // Create new document with the generated code
    const fileExtMap: Record<string, string> = {
      csharp: 'cs',
      javascript: 'js',
      java: 'java',
    };
    
    const fileName = editor.document.fileName.split(/[\\/]/).pop()?.replace(/\.(http|rest)$/, '') || 'runbook';
    const ext = fileExtMap[language.value];
    const doc = await vscode.workspace.openTextDocument({
      content: code,
      language: language.value === 'csharp' ? 'csharp' : (language.value === 'javascript' ? 'javascript' : 'java'),
    });
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Generated ${language.label} code from HTTP runbook`);
  } catch (error: unknown) {
    vscode.window.showErrorMessage(`Failed to generate code: ${(error as Error).message}`);
  }
}

export function deactivate() {
  // Cleanup if needed
}
