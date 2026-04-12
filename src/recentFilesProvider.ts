import * as vscode from 'vscode';
import * as path from 'path';

const STORAGE_KEY = 'httpVortex.recentFiles';
const MAX_RECENT = 15;

export class RecentFilesProvider implements vscode.TreeDataProvider<RecentFileItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  getTreeItem(element: RecentFileItem): vscode.TreeItem {
    return element;
  }

  getChildren(): RecentFileItem[] {
    const paths = this.context.globalState.get<string[]>(STORAGE_KEY, []);
    return paths.map(p => new RecentFileItem(p));
  }

  /** Call this when an .http file is opened to add it to the list. */
  recordFile(filePath: string): void {
    const paths = this.context.globalState.get<string[]>(STORAGE_KEY, []);
    const filtered = paths.filter(p => p !== filePath);
    filtered.unshift(filePath);
    const trimmed = filtered.slice(0, MAX_RECENT);
    this.context.globalState.update(STORAGE_KEY, trimmed);
    this._onDidChangeTreeData.fire();
  }

  clearAll(): void {
    this.context.globalState.update(STORAGE_KEY, []);
    this._onDidChangeTreeData.fire();
  }

  removeFile(filePath: string): void {
    const paths = this.context.globalState.get<string[]>(STORAGE_KEY, []);
    this.context.globalState.update(STORAGE_KEY, paths.filter(p => p !== filePath));
    this._onDidChangeTreeData.fire();
  }
}

class RecentFileItem extends vscode.TreeItem {
  constructor(public readonly filePath: string) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
    this.description = vscode.workspace.asRelativePath(path.dirname(filePath), true);
    this.tooltip = filePath;
    this.iconPath = new vscode.ThemeIcon('file');
    this.command = {
      command: 'httpVortex.openRecentFile',
      title: 'Open File',
      arguments: [filePath]
    };
    this.contextValue = 'recentFile';
  }
}
