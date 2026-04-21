/**
 * Authentication Profile Manager
 * Non-sensitive metadata stored in globalState.
 * Sensitive fields (token, password, apiKey) stored in VS Code SecretStorage
 * (backed by the OS keychain — encrypted at rest).
 */

import * as vscode from 'vscode';
import { runAuthCodeFlow, runRefreshTokenFlow } from './oauth2CodeFlow';

export interface AuthProfile {
  name: string;
  type: 'bearer' | 'basic' | 'apikey' | 'oauth2' | 'authcode';
  // Non-secret
  username?: string;
  headerName?: string;
  // authcode non-secret
  authorizeUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scope?: string;
  redirectPort?: number;
  /** authcode only — use PKCE (RFC 7636) instead of a client secret. */
  usePkce?: boolean;
  // Secret — only populated in memory after loadWithSecrets()
  token?: string;
  password?: string;
  apiKey?: string;
  clientSecret?: string;
  refreshToken?: string;
  tokenExpiry?: number;
}

/** Public projection used by the credentials panel (no secrets). */
export interface ProfileListItem {
  name: string;
  type: AuthProfile['type'];
  username?: string;
  headerName?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scope?: string;
  redirectPort?: number;
  /** authcode only — whether PKCE is used (no client secret required). */
  usePkce?: boolean;
  /** authcode only — whether a valid access token is currently stored. */
  hasToken?: boolean;
  /** authcode only — whether a refresh token is stored. */
  hasRefreshToken?: boolean;
  /** authcode only — epoch ms when the access token expires (if reported by server). */
  tokenExpiry?: number;
  /** Whether this is the currently active profile. */
  isActive?: boolean;
}

/** Input shape for creating / updating a profile via the credentials panel. */
export interface ProfileSaveInput {
  name: string;
  type: AuthProfile['type'];
  username?: string;
  headerName?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scope?: string;
  redirectPort?: number;
  /** authcode only — use PKCE (RFC 7636) instead of a client secret. */
  usePkce?: boolean;
  /** Generic secret value — stored as token / password / apiKey / clientSecret based on type.
   *  Omit (or pass undefined) when editing to keep the existing secret. */
  secret?: string;
}

/** Fields persisted to globalState (no secrets). */
interface AuthProfileMeta {
  name: string;
  type: AuthProfile['type'];
  username?: string;
  headerName?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scope?: string;
  redirectPort?: number;
  usePkce?: boolean;
}

/** Fields stored in SecretStorage, serialised as JSON. */
interface AuthSecrets {
  token?: string;
  password?: string;
  apiKey?: string;
  clientSecret?: string;
  refreshToken?: string;
  tokenExpiry?: number;
}

export class AuthProfileManager {
  private context: vscode.ExtensionContext;
  private metas: AuthProfileMeta[] = [];
  private activeProfileName: string | undefined;
  private _flowAbort?: AbortController;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadMetas();
    this.activeProfileName = this.context.globalState.get<string>('authProfiles.active');
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

  /** Returns profile metadata list (no secrets) for use by the credentials panel. */
  getProfileList(): ProfileListItem[] {
    return this.metas.map(m => ({
      name: m.name, type: m.type, username: m.username, headerName: m.headerName,
      authorizeUrl: m.authorizeUrl, tokenUrl: m.tokenUrl, clientId: m.clientId,
      scope: m.scope, redirectPort: m.redirectPort, usePkce: m.usePkce,
    }));
  }

  /** Like getProfileList but also checks SecretStorage for hasToken on authcode profiles. */
  async getProfileListWithStatus(): Promise<ProfileListItem[]> {
    const results: ProfileListItem[] = [];
    for (const m of this.metas) {
      const item: ProfileListItem = {
        name: m.name, type: m.type, username: m.username, headerName: m.headerName,
        authorizeUrl: m.authorizeUrl, tokenUrl: m.tokenUrl, clientId: m.clientId,
        scope: m.scope, redirectPort: m.redirectPort, usePkce: m.usePkce,
        isActive: m.name === this.activeProfileName,
      };
      if (m.type === 'authcode') {
        const s = await this.loadSecrets(m.name);
        item.hasToken = !!s.token;
        item.hasRefreshToken = !!s.refreshToken;
        item.tokenExpiry = s.tokenExpiry;
      }
      results.push(item);
    }
    return results;
  }

  /** Create or update a profile. Returns an error string on failure, or undefined on success. */
  async saveProfile(input: ProfileSaveInput, isNew: boolean): Promise<string | undefined> {
    if (!input.name.trim()) { return 'Profile name is required.'; }

    if (isNew) {
      if (this.metas.find(m => m.name === input.name)) {
        return `A profile named "${input.name}" already exists.`;
      }
      this.metas.push({
        name: input.name, type: input.type,
        username: input.username, headerName: input.headerName,
        authorizeUrl: input.authorizeUrl, tokenUrl: input.tokenUrl,
        clientId: input.clientId, scope: input.scope, redirectPort: input.redirectPort,
        usePkce: input.usePkce,
      });
      await this.saveMetas();
    } else {
      const meta = this.metas.find(m => m.name === input.name);
      if (!meta) { return `Profile "${input.name}" not found.`; }
      meta.type = input.type;
      meta.username = input.username;
      meta.headerName = input.headerName;
      meta.authorizeUrl = input.authorizeUrl;
      meta.tokenUrl = input.tokenUrl;
      meta.clientId = input.clientId;
      meta.scope = input.scope;
      meta.redirectPort = input.redirectPort;
      meta.usePkce = input.usePkce;
      await this.saveMetas();
    }

    if (input.secret) {
      // Always merge with existing secrets so stored tokens are preserved on config edits
      const existing = await this.loadSecrets(input.name);
      const secrets: AuthSecrets = { ...existing };
      switch (input.type) {
        case 'bearer':
        case 'oauth2':   secrets.token        = input.secret; break;
        case 'basic':    secrets.password     = input.secret; break;
        case 'apikey':   secrets.apiKey       = input.secret; break;
        case 'authcode': secrets.clientSecret = input.secret; break;
      }
      await this.saveSecrets(input.name, secrets);
    }
    return undefined;
  }

  /**
   * Runs the OAuth2 Authorization Code flow for the named profile.
   * Returns an error string on failure, or undefined on success.
   */
  async startAuthCodeFlow(name: string): Promise<string | undefined> {
    const meta = this.metas.find(m => m.name === name);
    if (!meta || meta.type !== 'authcode') {
      return `Profile "${name}" is not an Auth Code profile.`;
    }
    if (!meta.authorizeUrl || !meta.tokenUrl || !meta.clientId) {
      return 'Save the Authorize URL, Token URL, and Client ID before signing in.';
    }
    const secrets = await this.loadSecrets(name);
    const controller = new AbortController();
    this._flowAbort = controller;
    try {
      const result = await runAuthCodeFlow({
        authorizeUrl: meta.authorizeUrl,
        tokenUrl:     meta.tokenUrl,
        clientId:     meta.clientId,
        clientSecret: secrets.clientSecret,
        scope:        meta.scope,
        redirectPort: meta.redirectPort ?? 49152,
        usePkce:      meta.usePkce,
      }, controller.signal);
      const expiry = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;
      await this.saveSecrets(name, {
        ...secrets,
        token:        result.accessToken,
        refreshToken: result.refreshToken,
        tokenExpiry:  expiry,
      });
      return undefined;
    } catch (err: unknown) {
      return (err as Error).message;
    } finally {
      this._flowAbort = undefined;
    }
  }

  /** Aborts an in-progress auth code flow, releasing the local callback port. */
  cancelAuthCodeFlow(): void {
    this._flowAbort?.abort();
    this._flowAbort = undefined;
  }

  /**
   * Uses the stored refresh token to silently obtain a new access token.
   * Returns an error string on failure, or undefined on success.
   */
  async refreshAccessToken(name: string): Promise<string | undefined> {
    const meta = this.metas.find(m => m.name === name);
    if (!meta || meta.type !== 'authcode') {
      return `Profile "${name}" is not an Auth Code profile.`;
    }
    if (!meta.tokenUrl || !meta.clientId) {
      return 'Save the Token URL and Client ID before refreshing.';
    }
    const secrets = await this.loadSecrets(name);
    if (!secrets.refreshToken) {
      return 'No refresh token stored. Please sign in first.';
    }
    try {
      const result = await runRefreshTokenFlow(
        { tokenUrl: meta.tokenUrl, clientId: meta.clientId, clientSecret: secrets.clientSecret },
        secrets.refreshToken,
      );
      const expiry = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;
      await this.saveSecrets(name, {
        ...secrets,
        token:        result.accessToken,
        // Some servers rotate the refresh token; fall back to the existing one
        refreshToken: result.refreshToken ?? secrets.refreshToken,
        tokenExpiry:  expiry,
      });
      return undefined;
    } catch (err: unknown) {
      return (err as Error).message;
    }
  }

  /** Clears the stored access/refresh tokens for an authcode profile (sign out). */
  async signOutProfile(name: string): Promise<void> {
    const secrets = await this.loadSecrets(name);
    await this.saveSecrets(name, { ...secrets, token: undefined, refreshToken: undefined, tokenExpiry: undefined });
  }

  /** Delete a profile by name. */
  async deleteProfileByName(name: string): Promise<void> {
    const idx = this.metas.findIndex(m => m.name === name);
    if (idx >= 0) {
      this.metas.splice(idx, 1);
      await this.saveMetas();
      await this.deleteSecrets(name);
    }
  }

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

  // ── Active profile ─────────────────────────────────────────────────────────

  getActiveProfileName(): string | undefined {
    return this.activeProfileName;
  }

  async setActiveProfile(name: string | undefined): Promise<void> {
    this.activeProfileName = name;
    await this.context.globalState.update('authProfiles.active', name);
  }

  /**
   * Returns variables derived from the active profile for injection into requests:
   *   token      — the access token (bearer / oauth2 / authcode)
   *   password   — basic auth password
   *   apiKey     — api key value
   *
   * If the active profile has an expired authcode token within 60 s of expiry,
   * callers should trigger a refresh first via startAuthCodeFlow().
   */
  async getActiveProfileVariables(): Promise<Record<string, string>> {
    if (!this.activeProfileName) { return {}; }
    const meta = this.metas.find(m => m.name === this.activeProfileName);
    if (!meta) { return {}; }
    const secrets = await this.loadSecrets(meta.name);
    const vars: Record<string, string> = {};
    switch (meta.type) {
      case 'bearer':
      case 'oauth2':
      case 'authcode':
        if (secrets.token) { vars['token'] = secrets.token; }
        break;
      case 'basic':
        if (secrets.password) { vars['password'] = secrets.password; }
        break;
      case 'apikey':
        if (secrets.apiKey) { vars['apiKey'] = secrets.apiKey; }
        break;
    }
    return vars;
  }

  getAuthHeaders(profile: AuthProfile): Record<string, string> {
    const headers: Record<string, string> = {};
    switch (profile.type) {
      case 'bearer':
      case 'oauth2':
      case 'authcode':
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
