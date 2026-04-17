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
import { SecretsManager } from './secretsManager';
import { CredentialsPanel } from './credentialsPanel';

let currentVariables: Record<string, unknown> = {};
let resultsPanel: ResultsPanel | undefined;
let parallelMode = false;
let authManager: AuthProfileManager;
let historyManager: RequestHistoryManager;
let envManager: EnvironmentManager;
let secretsManager: SecretsManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('HTTP Vortex extension activated');
  vscode.window.showInformationMessage('HTTP Vortex extension is now active!');

  // Initialize managers
  authManager = new AuthProfileManager(context);
  historyManager = new RequestHistoryManager(context);
  envManager = new EnvironmentManager();
  secretsManager = new SecretsManager(context);

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
    vscode.commands.registerCommand('httpVortex.manageAuthProfiles', () => {
      CredentialsPanel.createOrShow(authManager, secretsManager, 'auth');
    })
  );

  // httpVortex.loginProfile [profileName]
  // Triggers the OAuth2 Authorization Code browser flow for the named auth profile.
  // If profileName is omitted a quick-pick lists all authcode profiles.
  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.loginProfile', async (profileName?: string) => {
      let name = profileName;
      if (!name) {
        const list = await authManager.getProfileListWithStatus();
        const authcodeProfiles = list.filter(p => p.type === 'authcode');
        if (authcodeProfiles.length === 0) {
          vscode.window.showWarningMessage(
            'No OAuth2 Auth Code profiles found. Create one via "HTTP Vortex: Manage Auth Profiles".',
          );
          return;
        }
        const picked = await vscode.window.showQuickPick(
          authcodeProfiles.map(p => ({
            label: p.name,
            description: p.hasToken ? '$(check) token stored' : '$(circle-slash) not signed in',
          })),
          { placeHolder: 'Select a profile to sign in with' },
        );
        if (!picked) { return; }
        name = picked.label;
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Signing in: ${name}`, cancellable: false },
        async () => {
          const err = await authManager.startAuthCodeFlow(name!);
          if (err) {
            vscode.window.showErrorMessage(`Sign-in failed for "${name}": ${err}`);
          } else {
            vscode.window.showInformationMessage(`Signed in successfully as profile "${name}"`);
          }
        },
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('httpVortex.manageSecrets', () => {
      CredentialsPanel.createOrShow(authManager, secretsManager, 'secrets');
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

    // Merge secrets < active profile < env vars < global vars (later spread wins)
    const secrets = await secretsManager.getAllSecrets();
    const profileVars = await authManager.getActiveProfileVariables();
    const envVars = envManager.getAllVariables();
    currentVariables = { ...secrets, ...profileVars, ...envVars, ...globalVars };
    
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
    const globalVars = parseGlobalVars(text);

    // Find all ### block start positions
    const hashRe = /^###/gm;
    const hashPositions: number[] = [];
    let hm: RegExpExecArray | null;
    while ((hm = hashRe.exec(text)) !== null) {
      hashPositions.push(hm.index);
    }

    // Find which block's range contains the cursor
    let blockStart = -1;
    let blockEnd = text.length;
    for (let i = 0; i < hashPositions.length; i++) {
      if (cursorOffset >= hashPositions[i]) {
        blockStart = hashPositions[i];
        blockEnd = i + 1 < hashPositions.length ? hashPositions[i + 1] : text.length;
      }
    }

    if (blockStart === -1) {
      vscode.window.showWarningMessage('Cursor is not inside a request block — place the cursor on or below a ### line');
      return;
    }

    // Parse just the block the cursor is in
    const parsedBlocks = parseBlocks(text.slice(blockStart, blockEnd));
    const targetBlock = parsedBlocks[0] ?? null;

    if (!targetBlock) {
      vscode.window.showWarningMessage('Block has no HTTP request line — add e.g. "GET https://..."');
      return;
    }

    // Use current variables or build from secrets + active profile + env + globals
    if (Object.keys(currentVariables).length === 0) {
      const secrets = await secretsManager.getAllSecrets();
      const profileVars = await authManager.getActiveProfileVariables();
      const envVars = envManager.getAllVariables();
      currentVariables = { ...secrets, ...profileVars, ...envVars, ...globalVars };
    }
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

    const secrets = await secretsManager.getAllSecrets();
    const profileVars = await authManager.getActiveProfileVariables();
    const envVarsFrom = envManager.getAllVariables();
    currentVariables = { ...secrets, ...profileVars, ...envVarsFrom, ...globalVars };
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
