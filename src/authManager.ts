/**
 * Authentication Profile Manager
 * Non-sensitive metadata stored in globalState.
 * Sensitive fields (token, password, apiKey) stored in VS Code SecretStorage
 * (backed by the OS keychain — encrypted at rest).
 */

import * as vscode from 'vscode';

export interface AuthProfile {
  name: string;
  type: 'bearer' | 'basic' | 'apikey' | 'oauth2';
  // Non-secret
  username?: string;
  headerName?: string;
  // Secret — only populated in memory after loadWithSecrets()
  token?: string;
  password?: string;
  apiKey?: string;
}

/** Fields persisted to globalState (no secrets). */
interface AuthProfileMeta {
  name: string;
  type: AuthProfile['type'];
  username?: string;
  headerName?: string;
}

/** Fields stored in SecretStorage, serialised as JSON. */
interface AuthSecrets {
  token?: string;
  password?: string;
  apiKey?: string;
}

export class AuthProfileManager {
  private context: vscode.ExtensionContext;
  private metas: AuthProfileMeta[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadMetas();
    this.migrateIfNeeded();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private loadMetas() {
    this.metas = this.context.globalState.get<AuthProfileMeta[]>('authProfiles.meta', []);
  }

  private async saveMetas() {
    await this.context.globalState.update('authProfiles.meta', this.metas);
  }

  private secretKey(name: string) {
    return `httpVortex.auth.${name}`;
  }

  private async saveSecrets(name: string, secrets: AuthSecrets) {
    await this.context.secrets.store(this.secretKey(name), JSON.stringify(secrets));
  }

  private async loadSecrets(name: string): Promise<AuthSecrets> {
    const raw = await this.context.secrets.get(this.secretKey(name));
    if (!raw) { return {}; }
    try { return JSON.parse(raw) as AuthSecrets; } catch { return {}; }
  }

  private async deleteSecrets(name: string) {
    await this.context.secrets.delete(this.secretKey(name));
  }

  /** One-time migration: move plaintext secrets out of the old globalState key. */
  private async migrateIfNeeded() {
    const legacy = this.context.globalState.get<AuthProfile[]>('authProfiles');
    if (!legacy || legacy.length === 0) { return; }

    for (const p of legacy) {
      // Only migrate if not already present in the new store
      if (!this.metas.find(m => m.name === p.name)) {
        const meta: AuthProfileMeta = { name: p.name, type: p.type, username: p.username, headerName: p.headerName };
        this.metas.push(meta);
        const secrets: AuthSecrets = {};
        if (p.token)    { secrets.token    = p.token; }
        if (p.password) { secrets.password = p.password; }
        if (p.apiKey)   { secrets.apiKey   = p.apiKey; }
        await this.saveSecrets(p.name, secrets);
      }
    }

    await this.saveMetas();
    // Wipe the old plaintext store
    await this.context.globalState.update('authProfiles', undefined);
  }

  /** Returns a full profile with secrets loaded from the OS keychain. */
  private async loadWithSecrets(meta: AuthProfileMeta): Promise<AuthProfile> {
    const secrets = await this.loadSecrets(meta.name);
    return { ...meta, ...secrets };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async manageProfiles() {
    const action = await vscode.window.showQuickPick(
      ['Create New Profile', 'Edit Profile', 'Delete Profile', 'List Profiles'],
      { placeHolder: 'Select an action' }
    );
    if (!action) { return; }

    switch (action) {
      case 'Create New Profile': await this.createProfile(); break;
      case 'Edit Profile':       await this.editProfile();   break;
      case 'Delete Profile':     await this.deleteProfile(); break;
      case 'List Profiles':      await this.listProfiles();  break;
    }
  }

  private async createProfile() {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter profile name',
      placeHolder: 'e.g., Production API, Dev Environment',
    });
    if (!name) { return; }

    const type = await vscode.window.showQuickPick(
      [
        { label: 'Bearer Token', value: 'bearer'  as const },
        { label: 'Basic Auth',   value: 'basic'   as const },
        { label: 'API Key',      value: 'apikey'  as const },
        { label: 'OAuth 2.0',    value: 'oauth2'  as const },
      ],
      { placeHolder: 'Select authentication type' }
    );
    if (!type) { return; }

    const meta: AuthProfileMeta = { name, type: type.value };
    const secrets: AuthSecrets  = {};

    switch (type.value) {
      case 'bearer':
      case 'oauth2':
        secrets.token = await vscode.window.showInputBox({
          prompt: type.value === 'oauth2' ? 'Enter OAuth2 access token' : 'Enter bearer token',
          password: true,
        }) ?? undefined;
        break;

      case 'basic':
        meta.username  = await vscode.window.showInputBox({ prompt: 'Enter username' }) ?? undefined;
        secrets.password = await vscode.window.showInputBox({ prompt: 'Enter password', password: true }) ?? undefined;
        break;

      case 'apikey':
        meta.headerName = await vscode.window.showInputBox({ prompt: 'Enter header name', value: 'X-API-Key' }) ?? undefined;
        secrets.apiKey  = await vscode.window.showInputBox({ prompt: 'Enter API key', password: true }) ?? undefined;
        break;
    }

    this.metas.push(meta);
    await this.saveMetas();
    await this.saveSecrets(name, secrets);
    vscode.window.showInformationMessage(`Auth profile "${name}" created (secrets stored in OS keychain)`);
  }

  private async editProfile() {
    if (this.metas.length === 0) {
      vscode.window.showInformationMessage('No auth profiles available');
      return;
    }
    const selected = await vscode.window.showQuickPick(
      this.metas.map(m => ({ label: m.name, meta: m })),
      { placeHolder: 'Select profile to edit' }
    );
    if (!selected) { return; }

    const index = this.metas.indexOf(selected.meta);
    this.metas.splice(index, 1);
    await this.saveMetas();
    await this.deleteSecrets(selected.meta.name);
    await this.createProfile();
  }

  private async deleteProfile() {
    if (this.metas.length === 0) {
      vscode.window.showInformationMessage('No auth profiles available');
      return;
    }
    const selected = await vscode.window.showQuickPick(
      this.metas.map(m => ({ label: m.name, meta: m })),
      { placeHolder: 'Select profile to delete' }
    );
    if (!selected) { return; }

    const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
      placeHolder: `Delete profile "${selected.label}"?`,
    });
    if (confirm !== 'Yes') { return; }

    const index = this.metas.indexOf(selected.meta);
    this.metas.splice(index, 1);
    await this.saveMetas();
    await this.deleteSecrets(selected.meta.name);
    vscode.window.showInformationMessage(`Profile "${selected.label}" deleted`);
  }

  private async listProfiles() {
    if (this.metas.length === 0) {
      vscode.window.showInformationMessage('No auth profiles available');
      return;
    }
    await vscode.window.showQuickPick(
      this.metas.map(m => `${m.name} (${m.type})`),
      { placeHolder: 'Saved Auth Profiles' }
    );
  }

  async selectProfile(): Promise<AuthProfile | undefined> {
    if (this.metas.length === 0) {
      vscode.window.showInformationMessage('No auth profiles available. Create one first.');
      return undefined;
    }
    const selected = await vscode.window.showQuickPick(
      this.metas.map(m => ({ label: m.name, description: m.type, meta: m })),
      { placeHolder: 'Select auth profile to use' }
    );
    if (!selected) { return undefined; }
    return this.loadWithSecrets(selected.meta);
  }

  getAuthHeaders(profile: AuthProfile): Record<string, string> {
    const headers: Record<string, string> = {};
    switch (profile.type) {
      case 'bearer':
      case 'oauth2':
        if (profile.token) { headers['Authorization'] = `Bearer ${profile.token}`; }
        break;
      case 'basic':
        if (profile.username && profile.password) {
          const encoded = Buffer.from(`${profile.username}:${profile.password}`).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
        }
        break;
      case 'apikey':
        if (profile.headerName && profile.apiKey) { headers[profile.headerName] = profile.apiKey; }
        break;
    }
    return headers;
  }
}
