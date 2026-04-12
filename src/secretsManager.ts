/**
 * Secrets Manager
 * Named key-value secrets stored in VS Code SecretStorage (OS keychain).
 * Secret names are persisted in globalState; values are never written to disk.
 * Secrets are available as {{secretName}} interpolation variables at run-time.
 */

import * as vscode from 'vscode';

export class SecretsManager {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private getNames(): string[] {
    return this.context.globalState.get<string[]>('secrets.names', []);
  }

  private async saveNames(names: string[]): Promise<void> {
    await this.context.globalState.update('secrets.names', names);
  }

  private secretKey(name: string): string {
    return `httpVortex.secret.${name}`;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Returns all secrets as a Record for variable interpolation. */
  async getAllSecrets(): Promise<Record<string, string>> {
    const names = this.getNames();
    const result: Record<string, string> = {};
    for (const name of names) {
      const value = await this.context.secrets.get(this.secretKey(name));
      if (value !== undefined) {
        result[name] = value;
      }
    }
    return result;
  }

  /** Returns the list of secret names (no values) for use by the credentials panel. */
  getSecretNames(): string[] {
    return this.getNames();
  }

  /** Create or update a secret. Returns an error string on failure, or undefined on success.
   *  Pass undefined for value when editing to keep the existing secret value. */
  async setSecret(name: string, value: string | undefined, isNew: boolean): Promise<string | undefined> {
    const trimmed = name.trim();
    if (!trimmed) { return 'Secret name is required.'; }
    if (!/^[\w.-]+$/.test(trimmed)) {
      return 'Name may only contain letters, numbers, underscores, hyphens, and dots.';
    }

    const names = this.getNames();
    if (isNew) {
      if (names.includes(trimmed)) { return `A secret named "${trimmed}" already exists.`; }
      if (!value) { return 'Secret value is required.'; }
      names.push(trimmed);
      await this.saveNames(names);
      await this.context.secrets.store(this.secretKey(trimmed), value);
    } else {
      if (!names.includes(trimmed)) { return `Secret "${trimmed}" not found.`; }
      if (value) {
        await this.context.secrets.store(this.secretKey(trimmed), value);
      }
      // undefined value = keep existing, no-op on storage
    }
    return undefined;
  }

  /** Delete a secret by name. */
  async deleteSecretByName(name: string): Promise<void> {
    const updated = this.getNames().filter(n => n !== name);
    await this.saveNames(updated);
    await this.context.secrets.delete(this.secretKey(name));
  }

  async manageSecrets(): Promise<void> {
    const action = await vscode.window.showQuickPick(
      ['Add Secret', 'Edit Secret', 'Delete Secret', 'List Secrets'],
      { placeHolder: 'Manage Secrets' }
    );
    if (!action) { return; }

    switch (action) {
      case 'Add Secret':    await this.addSecret();    break;
      case 'Edit Secret':   await this.editSecret();   break;
      case 'Delete Secret': await this.deleteSecret(); break;
      case 'List Secrets':  await this.listSecrets();  break;
    }
  }

  private async addSecret(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Secret name (used as {{name}} in requests)',
      placeHolder: 'e.g., API_KEY, DB_PASSWORD',
      validateInput: (v) => {
        if (!v.trim()) { return 'Name cannot be empty'; }
        if (this.getNames().includes(v.trim())) { return 'A secret with that name already exists'; }
        if (!/^[\w.-]+$/.test(v.trim())) { return 'Name may only contain letters, numbers, underscores, hyphens, and dots'; }
        return undefined;
      },
    });
    if (!name) { return; }

    const value = await vscode.window.showInputBox({
      prompt: `Value for secret "${name.trim()}"`,
      password: true,
    });
    if (value === undefined) { return; }

    const trimmedName = name.trim();
    const names = this.getNames();
    names.push(trimmedName);
    await this.saveNames(names);
    await this.context.secrets.store(this.secretKey(trimmedName), value);
    vscode.window.showInformationMessage(`Secret "${trimmedName}" saved to OS keychain`);
  }

  private async editSecret(): Promise<void> {
    const names = this.getNames();
    if (names.length === 0) {
      vscode.window.showInformationMessage('No secrets defined');
      return;
    }

    const selected = await vscode.window.showQuickPick(names, {
      placeHolder: 'Select secret to edit',
    });
    if (!selected) { return; }

    const value = await vscode.window.showInputBox({
      prompt: `New value for secret "${selected}"`,
      password: true,
    });
    if (value === undefined) { return; }

    await this.context.secrets.store(this.secretKey(selected), value);
    vscode.window.showInformationMessage(`Secret "${selected}" updated`);
  }

  private async deleteSecret(): Promise<void> {
    const names = this.getNames();
    if (names.length === 0) {
      vscode.window.showInformationMessage('No secrets defined');
      return;
    }

    const selected = await vscode.window.showQuickPick(names, {
      placeHolder: 'Select secret to delete',
    });
    if (!selected) { return; }

    const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
      placeHolder: `Delete secret "${selected}"?`,
    });
    if (confirm !== 'Yes') { return; }

    const updated = names.filter(n => n !== selected);
    await this.saveNames(updated);
    await this.context.secrets.delete(this.secretKey(selected));
    vscode.window.showInformationMessage(`Secret "${selected}" deleted`);
  }

  private async listSecrets(): Promise<void> {
    const names = this.getNames();
    if (names.length === 0) {
      vscode.window.showInformationMessage('No secrets defined. Use "Add Secret" to create one.');
      return;
    }
    vscode.window.showInformationMessage(
      `Secrets (${names.length}): ${names.map(n => `{{${n}}}`).join(', ')}`
    );
  }
}
