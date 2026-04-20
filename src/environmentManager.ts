/**
 * Environment File Manager
 * Loads variables from .env files
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class EnvironmentManager {
  private environments: Map<string, Record<string, string>> = new Map();
  private activeEnvironment: string = 'default';

  async loadEnvironmentFile(filePath?: string) {
    if (!filePath) {
      // Try to find .env files in workspace
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const envFiles = await vscode.workspace.findFiles('**/.env*', '**/node_modules/**');
      
      if (envFiles.length === 0) {
        vscode.window.showInformationMessage('No .env files found in workspace');
        return;
      }

      const selected = await vscode.window.showQuickPick(
        envFiles.map((uri) => ({
          label: path.basename(uri.fsPath),
          description: vscode.workspace.asRelativePath(uri.fsPath),
          uri,
        })),
        { placeHolder: 'Select environment file to load' }
      );

      if (!selected) {
        return;
      }

      filePath = selected.uri.fsPath;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const vars = this.parseEnvFile(content);
      const envName = path.basename(filePath);
      
      this.environments.set(envName, vars);
      this.activeEnvironment = envName;

      vscode.window.showInformationMessage(
        `Loaded ${Object.keys(vars).length} variables from ${envName}`
      );
    } catch (error: unknown) {
      vscode.window.showErrorMessage(`Failed to load environment file: ${(error as Error).message}`);
    }
  }

  private parseEnvFile(content: string): Record<string, string> {
    const vars: Record<string, string> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse KEY=VALUE
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();

        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1).trim();
        }

        vars[key] = value;
      }
    }

    return vars;
  }

  getActiveEnvironment(): Record<string, string> {
    return this.environments.get(this.activeEnvironment) || {};
  }

  async selectEnvironment() {
    if (this.environments.size === 0) {
      vscode.window.showInformationMessage('No environments loaded. Load a .env file first.');
      await this.loadEnvironmentFile();
      return;
    }

    const selected = await vscode.window.showQuickPick(
      Array.from(this.environments.keys()).map((name) => ({
        label: name,
        description: name === this.activeEnvironment ? '(active)' : '',
      })),
      { placeHolder: 'Select environment' }
    );

    if (selected) {
      this.activeEnvironment = selected.label;
      vscode.window.showInformationMessage(`Switched to environment: ${selected.label}`);
    }
  }

  async createEnvironmentFile() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Enter environment name',
      placeHolder: 'e.g., dev, staging, production',
    });

    if (!name) {
      return;
    }

    const fileName = name === 'default' ? '.env' : `.env.${name}`;
    const filePath = path.join(workspaceFolders[0].uri.fsPath, fileName);

    const template = `# Environment: ${name}
# Created: ${new Date().toISOString()}

# API Configuration
BASE_URL=https://api.example.com
API_KEY=your-api-key-here

# Authentication
USERNAME=
PASSWORD=

# Other Variables
TIMEOUT=30000
`;

    fs.writeFileSync(filePath, template, 'utf-8');
    
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
    
    vscode.window.showInformationMessage(`Environment file created: ${fileName}`);
  }

  async showCurrentVariables() {
    const env = this.getActiveEnvironment();
    
    if (Object.keys(env).length === 0) {
      vscode.window.showInformationMessage('No environment variables loaded');
      return;
    }

    const content = `# Environment Variables: ${this.activeEnvironment}

${Object.entries(env).map(([key, value]) => `**${key}:** \`${value}\``).join('\n')}
`;

    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  clearEnvironments() {
    this.environments.clear();
    this.activeEnvironment = 'default';
    vscode.window.showInformationMessage('All environments cleared');
  }

  getAllVariables(): Record<string, string> {
    return this.getActiveEnvironment();
  }
}
