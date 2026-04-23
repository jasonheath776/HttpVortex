/**
 * Credentials Panel
 * A single webview panel for managing Auth Profiles and Secrets with a
 * two-tab, sidebar + form-pane layout.
 *
 * Security notes:
 *  - Secret / token values are NEVER sent from the extension to the webview.
 *  - The webview only receives names + non-sensitive metadata.
 *  - The form sends a new value back only when the user explicitly types one.
 *  - Content-Security-Policy blocks all external resources and inline scripts
 *    (the single script tag is allowed via nonce).
 */

import * as vscode from 'vscode';
import { AuthProfileManager, ProfileListItem, ProfileSaveInput } from './authManager';
import { SecretsManager } from './secretsManager';

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export class CredentialsPanel {
  private static currentPanel: CredentialsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly authManager: AuthProfileManager;
  private readonly secretsManager: SecretsManager;
  private disposables: vscode.Disposable[] = [];

  // ── Factory ────────────────────────────────────────────────────────────────

  public static createOrShow(
    authManager: AuthProfileManager,
    secretsManager: SecretsManager,
    activeTab: 'auth' | 'secrets' = 'auth'
  ): void {
    if (CredentialsPanel.currentPanel) {
      CredentialsPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      CredentialsPanel.currentPanel.post({ type: 'switchTab', tab: activeTab });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'httpVortexCredentials',
      'HTTP Vortex — Credentials',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    CredentialsPanel.currentPanel = new CredentialsPanel(panel, authManager, secretsManager, activeTab);
  }

  // ── Constructor ────────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    authManager: AuthProfileManager,
    secretsManager: SecretsManager,
    activeTab: 'auth' | 'secrets'
  ) {
    this.panel = panel;
    this.authManager = authManager;
    this.secretsManager = secretsManager;

    this.panel.webview.html = buildHtml(getNonce());

    this.panel.onDidDispose(() => {
      CredentialsPanel.currentPanel = undefined;
      while (this.disposables.length) { this.disposables.pop()?.dispose(); }
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      switch (msg.type) {
        case 'ready':
          await this.sendInit(activeTab);
          break;

        case 'saveProfile': {
          const err = await this.authManager.saveProfile(msg.profile as ProfileSaveInput, msg.isNew as boolean);
          if (err) {
            this.post({ type: 'error', message: err });
          } else {
            this.post({ type: 'toast', message: 'Profile saved.' });
            this.post({ type: 'profilesUpdated', profiles: await this.authManager.getProfileListWithStatus() });
          }
          break;
        }

        case 'deleteProfile': {
          await this.authManager.deleteProfileByName(msg.name as string);
          this.post({ type: 'profilesUpdated', profiles: await this.authManager.getProfileListWithStatus() });
          break;
        }

        case 'saveSecret': {
          const err = await this.secretsManager.setSecret(msg.name as string, msg.value as string | undefined, msg.isNew as boolean);
          if (err) {
            this.post({ type: 'error', message: err });
          } else {
            this.post({ type: 'toast', message: 'Secret saved.' });
            this.post({ type: 'secretsUpdated', secretNames: this.secretsManager.getSecretNames() });
          }
          break;
        }

        case 'deleteSecret': {
          await this.secretsManager.deleteSecretByName(msg.name as string);
          this.post({ type: 'secretsUpdated', secretNames: this.secretsManager.getSecretNames() });
          break;
        }

        case 'startAuthCodeFlow': {
          const profileName = msg.name as string;
          const err = await this.authManager.startAuthCodeFlow(profileName);
          if (err) {
            this.post({ type: 'authCodeFlowResult', success: false, error: err });
          } else {
            try { await this.authManager.setActiveProfile(profileName); } catch { /* best-effort */ }
            this.post({ type: 'authCodeFlowResult', success: true, profiles: await this.authManager.getProfileListWithStatus() });
          }
          break;
        }

        case 'refreshAccessToken': {
          const profileName = msg.name as string;
          const err = await this.authManager.refreshAccessToken(profileName);
          if (err) {
            this.post({ type: 'authCodeFlowResult', success: false, error: err });
          } else {
            try { await this.authManager.setActiveProfile(profileName); } catch { /* best-effort */ }
            this.post({ type: 'authCodeFlowResult', success: true, profiles: await this.authManager.getProfileListWithStatus() });
          }
          break;
        }

        case 'signOutProfile': {
          await this.authManager.signOutProfile(msg.name as string);
          this.post({ type: 'profilesUpdated', profiles: await this.authManager.getProfileListWithStatus() });
          break;
        }

        case 'cancelAuthCodeFlow': {
          this.authManager.cancelAuthCodeFlow();
          break;
        }

        case 'setActiveProfile': {
          const activeName = msg.name as string | undefined;
          await this.authManager.setActiveProfile(activeName);
          // For authcode profiles, auto-trigger login if no token yet
          if (activeName) {
            const profileStatus = (await this.authManager.getProfileListWithStatus())
              .find(p => p.name === activeName);
            if (profileStatus?.type === 'authcode' && !profileStatus.hasToken) {
              const err = await this.authManager.startAuthCodeFlow(activeName);
              if (err) {
                this.post({ type: 'authCodeFlowResult', success: false, error: err });
              } else {
                this.post({ type: 'authCodeFlowResult', success: true, profiles: await this.authManager.getProfileListWithStatus() });
              }
              break;
            }
          }
          this.post({ type: 'profilesUpdated', profiles: await this.authManager.getProfileListWithStatus() });
          break;
        }
      }
    }, null, this.disposables);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async sendInit(activeTab: 'auth' | 'secrets'): Promise<void> {
    this.post({
      type: 'init',
      profiles: await this.authManager.getProfileListWithStatus(),
      activeProfileName: this.authManager.getActiveProfileName(),
      secretNames: this.secretsManager.getSecretNames(),
      activeTab,
    });
  }

  private post(message: Record<string, unknown>): void {
    this.panel.webview.postMessage(message);
  }
}

// ── Message type (loose, for the onDidReceiveMessage handler) ─────────────────
interface WebviewMessage {
  type: string;
  [key: string]: unknown;
}

// ── HTML builder (kept outside the class to avoid "this" confusion) ───────────

function buildHtml(nonce: string): string {
  /* ── Embedded JavaScript ──────────────────────────────────────────────── */
  const script = `
const vscode = acquireVsCodeApi();

let state = {
  tab: 'auth',
  profiles: [],
  secretNames: [],
  activeProfileName: null,  // string | null
  selected: null,      // { index: number | null, isNew: boolean } | null
  confirmDelete: null, // string | null
  error: null,         // string | null
  signingIn: false,    // authcode flow in progress
  cancelled: false,    // user cancelled the flow — ignore next authCodeFlowResult error
};

window.addEventListener('message', function(event) {
  var msg = event.data;
  if (msg.type === 'init') {
    state.tab = msg.activeTab;
    state.profiles = msg.profiles;
    state.activeProfileName = msg.activeProfileName || null;
    state.secretNames = msg.secretNames;
    state.selected = null;
    state.confirmDelete = null;
    state.error = null;
    render();
  } else if (msg.type === 'switchTab') {
    state.tab = msg.tab;
    state.selected = null;
    state.confirmDelete = null;
    state.error = null;
    render();
  } else if (msg.type === 'profilesUpdated') {
    state.profiles = msg.profiles;
    if (msg.profiles) {
      var active = msg.profiles.find(function(p) { return p.isActive; });
      state.activeProfileName = active ? active.name : null;
    }
    state.selected = null;
    state.confirmDelete = null;
    state.error = null;
    render();
  } else if (msg.type === 'secretsUpdated') {
    state.secretNames = msg.secretNames;
    state.selected = null;
    state.confirmDelete = null;
    state.error = null;
    render();
  } else if (msg.type === 'error') {
    state.error = msg.message;
    renderDetail();
  } else if (msg.type === 'toast') {
    showToast(msg.message);
  } else if (msg.type === 'authCodeFlowResult') {
    state.signingIn = false;
    if (state.cancelled) {
      state.cancelled = false;
      renderList();
      renderDetail();
      return;
    }
    if (msg.success) {
      state.profiles = msg.profiles;
      var activeAfterFlow = msg.profiles.find(function(p) { return p.isActive; });
      state.activeProfileName = activeAfterFlow ? activeAfterFlow.name : null;
    } else {
      state.error = msg.error;
    }
    renderList();
    renderDetail();
  }
});

vscode.postMessage({ type: 'ready' });

var _toastTimer = null;
function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.classList.remove('show'); }, 2500);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render() {
  renderTabs();
  renderList();
  renderDetail();
}

function renderTabs() {
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.tab === state.tab);
  });
}

function renderList() {
  var listEl = document.getElementById('list');
  var countEl = document.getElementById('item-count');
  var items = state.tab === 'auth' ? state.profiles : state.secretNames;

  if (items.length === 0) {
    countEl.textContent = '0 items';
    listEl.innerHTML = '<div class="list-empty">Nothing here yet.<br>Click + to add one.</div>';
    return;
  }

  if (state.tab === 'auth') {
    countEl.textContent = items.length + ' profile' + (items.length !== 1 ? 's' : '');
    listEl.innerHTML = state.profiles.map(function(p, i) {
      var isSelected = state.selected && !state.selected.isNew && state.selected.index === i;
      var isConfirming = state.confirmDelete === p.name;
      var isActive = state.activeProfileName === p.name;
      var confirmHtml = isConfirming
        ? '<div class="confirm-row">Delete <strong>' + esc(p.name) + '</strong>?' +
            '<button class="btn-micro btn-danger" data-action="confirmDeleteProfile" data-name="' + esc(p.name) + '">Delete</button>' +
            '<button class="btn-micro" data-action="cancelDelete">Cancel</button>' +
          '</div>'
        : '';
      var deleteBtnHtml = isConfirming
        ? ''
        : '<button class="icon-btn" data-action="deleteItem" data-name="' + esc(p.name) + '" title="Delete">\u2715</button>';
      var authCodeBtn = '';
      if (p.type === 'authcode' && p.hasToken && p.hasRefreshToken) {
        var acDisabled = state.signingIn ? ' disabled' : '';
        authCodeBtn = '<button class="btn-micro" data-action="listRefresh" data-name="' + esc(p.name) + '"' + acDisabled + ' title="Refresh token">&#8635;</button>';
      }
      return '<div class="list-item' + (isSelected ? ' active' : '') + (isActive ? ' profile-active' : '') + '" data-index="' + i + '">' +
        '<div class="item-row">' +
          '<span class="item-name">' + esc(p.name) + '</span>' +
          '<span class="type-badge type-' + esc(p.type) + '">' + esc(p.type) + '</span>' +
          authCodeBtn +
          deleteBtnHtml +
        '</div>' + confirmHtml + '</div>';
    }).join('');
  } else {
    countEl.textContent = items.length + ' secret' + (items.length !== 1 ? 's' : '');
    listEl.innerHTML = state.secretNames.map(function(name, i) {
      var isSelected = state.selected && !state.selected.isNew && state.selected.index === i;
      var isConfirming = state.confirmDelete === name;
      var confirmHtml = isConfirming
        ? '<div class="confirm-row">Delete <strong>' + esc(name) + '</strong>?' +
            '<button class="btn-micro btn-danger" data-action="confirmDeleteSecret" data-name="' + esc(name) + '">Delete</button>' +
            '<button class="btn-micro" data-action="cancelDelete">Cancel</button>' +
          '</div>'
        : '';
      var deleteBtnHtml = isConfirming
        ? ''
        : '<button class="icon-btn" data-action="deleteItem" data-name="' + esc(name) + '" title="Delete">\u2715</button>';
      return '<div class="list-item' + (isSelected ? ' active' : '') + '" data-index="' + i + '">' +
        '<div class="item-row">' +
          '<span class="lock-icon">\uD83D\uDD12</span>' +
          '<span class="item-name">' + esc(name) + '</span>' +
          '<span class="item-ref">{{' + esc(name) + '}}</span>' +
          deleteBtnHtml +
        '</div>' + confirmHtml + '</div>';
    }).join('');
  }
}

function renderDetail() {
  var detailEl = document.getElementById('detail');
  if (state.selected === null) {
    detailEl.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon">' + (state.tab === 'auth' ? '\uD83D\uDEE1' : '\uD83D\uDD11') + '</div>' +
        '<div class="empty-title">' + (state.tab === 'auth' ? 'Auth Profiles' : 'Secrets') + '</div>' +
        '<div class="empty-sub">Select an item to edit, or click <strong>+</strong> to add a new one.</div>' +
      '</div>';
    return;
  }
  if (state.tab === 'auth') {
    renderAuthForm();
  } else {
    renderSecretForm();
  }
}

function getSecretLabel(type) {
  if (type === 'bearer')   { return 'Bearer Token'; }
  if (type === 'oauth2')   { return 'Access Token'; }
  if (type === 'basic')    { return 'Password'; }
  if (type === 'apikey')   { return 'API Key Value'; }
  if (type === 'authcode') { return 'Client Secret <span style="opacity:.5;font-weight:normal;text-transform:none">(optional)</span>'; }
  return 'Secret Value';
}

function renderAuthForm() {
  var detailEl = document.getElementById('detail');
  var isNew = state.selected.isNew;
  var p = isNew
    ? { name: '', type: 'bearer', username: '', headerName: 'X-API-Key', authorizeUrl: '', tokenUrl: '', clientId: '', scope: '', redirectPort: 49152, usePkce: false }
    : state.profiles[state.selected.index];

  var typeOptions = [
    { value: 'bearer',   label: 'Bearer Token' },
    { value: 'basic',    label: 'Basic Auth' },
    { value: 'apikey',   label: 'API Key' },
    { value: 'oauth2',   label: 'OAuth 2.0 (manual token)' },
    { value: 'authcode', label: 'OAuth2 Auth Code (browser sign-in)' },
  ].map(function(o) {
    return '<option value="' + o.value + '"' + (p.type === o.value ? ' selected' : '') + '>' + o.label + '</option>';
  }).join('');

  var errorHtml = state.error ? '<div class="form-error">' + esc(state.error) + '</div>' : '';
  state.error = null;

  var showUser     = (p.type === 'basic')    ? '' : 'display:none';
  var showHdr      = (p.type === 'apikey')   ? '' : 'display:none';
  var showAuthCode = (p.type === 'authcode') ? '' : 'display:none';
  var secretPlaceholder = isNew ? 'Enter value' : '(leave blank to keep existing)';

  var signInSection = '';
  if (!isNew && p.type === 'authcode') {
    var isConfigured = !!(p.authorizeUrl && p.tokenUrl && p.clientId);
    var tokenStatusHtml = p.hasToken
      ? '<span class="token-status signed-in">&#10003; Signed in</span>'
      : '<span class="token-status signed-out">&#10007; Not signed in</span>';
    var expiryHtml = '';
    if (p.hasToken && p.tokenExpiry) {
      var diffMs = p.tokenExpiry - Date.now();
      var diffMin = Math.floor(Math.abs(diffMs) / 60000);
      if (diffMs > 0) {
        var expiryText = diffMin >= 60
          ? 'expires in ' + Math.floor(diffMin / 60) + 'h ' + (diffMin % 60) + 'm'
          : 'expires in ' + diffMin + ' min';
        expiryHtml = '&nbsp;<span style="font-size:10px;opacity:.55">' + expiryText + '</span>';
      } else {
        expiryHtml = '&nbsp;<span style="font-size:10px;color:var(--vscode-inputValidation-warningForeground,#e2a620)">expired ' + diffMin + ' min ago</span>';
      }
    }
    var disabledAttr = (state.signingIn || !isConfigured) ? ' disabled' : '';
    var signInLabel  = state.signingIn ? 'Opening browser\u2026' : (p.hasToken ? 'Sign In Again' : 'Sign In');
    var cancelBtn    = state.signingIn
      ? '<button class="btn-secondary" data-action="cancelAuthFlow">Release Port</button>'
      : '';
    var refreshBtn   = (!state.signingIn && p.hasToken && p.hasRefreshToken)
      ? '<button class="btn-secondary" data-action="refreshToken">Refresh Token</button>'
      : '';
    var signOutBtn   = (!state.signingIn && p.hasToken)
      ? '<button class="btn-secondary" data-action="signOut">Sign Out</button>'
      : '';
    var configWarning = isConfigured ? ''
      : '<p class="field-hint" style="color:var(--vscode-inputValidation-warningForeground,#e2a620)">' +
          'Save Authorize URL, Token URL, and Client ID first.' +
        '</p>';
    signInSection =
      '<hr class="form-divider">' +
      '<h3 class="section-sub">Sign In</h3>' +
      '<div class="token-status-row">' + tokenStatusHtml + expiryHtml + '</div>' +
      configWarning +
      '<div class="form-actions">' +
        '<button class="btn-signin" data-action="signIn"' + disabledAttr + '>' + signInLabel + '</button>' +
        cancelBtn +
        refreshBtn +
        signOutBtn +
      '</div>';
  }

  detailEl.innerHTML =
    '<div class="detail-form">' +
      '<h2 class="form-title">' + (isNew ? 'New Auth Profile' : 'Edit Profile') + '</h2>' +
      errorHtml +
      '<div class="form-group">' +
        '<label for="f-name">Profile Name</label>' +
        '<input type="text" id="f-name" value="' + esc(p.name) + '"' + (isNew ? '' : ' readonly') + ' placeholder="e.g. Production API" autocomplete="off">' +
        (!isNew ? '<p class="field-hint">To rename, delete and recreate the profile.</p>' : '') +
      '</div>' +
      '<div class="form-group">' +
        '<label for="f-type">Auth Type</label>' +
        '<select id="f-type">' + typeOptions + '</select>' +
      '</div>' +
      '<div class="form-group" id="g-username" style="' + showUser + '">' +
        '<label for="f-username">Username</label>' +
        '<input type="text" id="f-username" value="' + esc(p.username || '') + '" placeholder="username" autocomplete="off">' +
      '</div>' +
      '<div class="form-group" id="g-headername" style="' + showHdr + '">' +
        '<label for="f-headername">Header Name</label>' +
        '<input type="text" id="f-headername" value="' + esc(p.headerName || 'X-API-Key') + '" placeholder="X-API-Key" autocomplete="off">' +
      '</div>' +
      '<div id="g-authcode" style="' + showAuthCode + '">' +
        '<div class="form-group">' +
          '<label for="f-authorize-url">Authorize URL</label>' +
          '<input type="text" id="f-authorize-url" value="' + esc(p.authorizeUrl || '') + '" placeholder="https://login.example.com/oauth2/authorize" autocomplete="off">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="f-token-url">Token URL</label>' +
          '<input type="text" id="f-token-url" value="' + esc(p.tokenUrl || '') + '" placeholder="https://login.example.com/oauth2/token" autocomplete="off">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="f-client-id">Client ID</label>' +
          '<input type="text" id="f-client-id" value="' + esc(p.clientId || '') + '" placeholder="my-client-id" autocomplete="off">' +
        '</div>' +
        '<div class="form-group">' +
          '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
            '<input type="checkbox" id="f-use-pkce"' + (p.usePkce ? ' checked' : '') + '>' +
            'Use PKCE <span style="opacity:.5;font-weight:normal;text-transform:none">(Proof Key for Code Exchange — public clients, no client secret needed)</span>' +
          '</label>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="f-scope">Scope <span style="opacity:.5;font-weight:normal;text-transform:none">(optional)</span></label>' +
          '<input type="text" id="f-scope" value="' + esc(p.scope || '') + '" placeholder="openid profile email" autocomplete="off">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="f-redirect-port">Redirect Port</label>' +
          '<input type="number" id="f-redirect-port" value="' + esc(String(p.redirectPort || 49152)) + '" min="1024" max="65535">' +
          '<p class="field-hint">Local port for the OAuth2 callback (<code>http://localhost:PORT/callback</code>). Must be free when signing in.</p>' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="f-secret" id="l-secret">' + getSecretLabel(p.type) + '</label>' +
        '<input type="password" id="f-secret" placeholder="' + secretPlaceholder + '" autocomplete="new-password">' +
        '<p class="field-hint">\uD83D\uDD12 Stored in the OS keychain \u2014 never written to disk.</p>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button class="btn-primary" data-action="saveProfile">Save</button>' +
        '<button class="btn-secondary" data-action="cancelForm">Cancel</button>' +
      '</div>' +
      signInSection +
    '</div>';
}

function renderSecretForm() {
  var detailEl = document.getElementById('detail');
  var isNew = state.selected.isNew;
  var name = isNew ? '' : state.secretNames[state.selected.index];

  var errorHtml = state.error ? '<div class="form-error">' + esc(state.error) + '</div>' : '';
  state.error = null;

  detailEl.innerHTML =
    '<div class="detail-form">' +
      '<h2 class="form-title">' + (isNew ? 'New Secret' : 'Edit Secret') + '</h2>' +
      errorHtml +
      '<div class="form-group">' +
        '<label for="f-name">Secret Name</label>' +
        '<input type="text" id="f-name" value="' + esc(name) + '"' + (isNew ? '' : ' readonly') + ' placeholder="e.g. API_KEY, MY_TOKEN" autocomplete="off">' +
        '<p class="field-hint">Used as <code>{{' + (name ? esc(name) : 'name') + '}}</code> in requests. Only letters, numbers, underscores, hyphens, dots.</p>' +
        (!isNew ? '<p class="field-hint">To rename, delete and recreate the secret.</p>' : '') +
      '</div>' +
      '<div class="form-group">' +
        '<label for="f-value">Value</label>' +
        '<input type="password" id="f-value" placeholder="' + (isNew ? 'Enter secret value' : '(leave blank to keep existing)') + '" autocomplete="new-password">' +
        '<p class="field-hint">\uD83D\uDD12 Stored in the OS keychain \u2014 never written to disk.</p>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button class="btn-primary" data-action="saveSecret">Save</button>' +
        '<button class="btn-secondary" data-action="cancelForm">Cancel</button>' +
      '</div>' +
    '</div>';
}

function updateConditionalFields(type) {
  var gUser     = document.getElementById('g-username');
  var gHdr      = document.getElementById('g-headername');
  var gAuthCode = document.getElementById('g-authcode');
  var lSec      = document.getElementById('l-secret');
  if (gUser)     { gUser.style.display     = type === 'basic'    ? '' : 'none'; }
  if (gHdr)      { gHdr.style.display      = type === 'apikey'   ? '' : 'none'; }
  if (gAuthCode) { gAuthCode.style.display = type === 'authcode' ? '' : 'none'; }
  if (lSec)      { lSec.innerHTML = getSecretLabel(type); }
}

// ── Event delegation ──────────────────────────────────────────────────────────

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action]');
  if (btn) {
    handleAction(btn.dataset.action, btn.dataset);
    return;
  }
  var item = e.target.closest('.list-item');
  if (item && !e.target.closest('.icon-btn') && !e.target.closest('.confirm-row')) {
    var idx = parseInt(item.dataset.index, 10);
    if (!isNaN(idx)) {
      state.selected = { index: idx, isNew: false };
      state.confirmDelete = null;
      state.error = null;
      renderList();
      renderDetail();
    }
  }
});

document.addEventListener('change', function(e) {
  if (e.target.id === 'f-type') {
    updateConditionalFields(e.target.value);
  }
});

function handleAction(action, data) {
  if (action === 'switchTab') {
    if (data.tab !== state.tab) {
      state.tab = data.tab;
      state.selected = null;
      state.confirmDelete = null;
      state.error = null;
      render();
    }
  } else if (action === 'addNew') {
    state.selected = { index: null, isNew: true };
    state.confirmDelete = null;
    state.error = null;
    renderList();
    renderDetail();
  } else if (action === 'deleteItem') {
    state.confirmDelete = data.name;
    renderList();
  } else if (action === 'cancelDelete') {
    state.confirmDelete = null;
    renderList();
  } else if (action === 'confirmDeleteProfile') {
    vscode.postMessage({ type: 'deleteProfile', name: data.name });
  } else if (action === 'confirmDeleteSecret') {
    vscode.postMessage({ type: 'deleteSecret', name: data.name });
  } else if (action === 'saveProfile') {
    submitProfileForm();
  } else if (action === 'saveSecret') {
    submitSecretForm();
  } else if (action === 'cancelForm') {
    state.selected = null;
    state.error = null;
    renderList();
    renderDetail();
  } else if (action === 'signIn') {
    if (!state.selected || state.selected.isNew) { return; }
    state.signingIn = true;
    state.error = null;
    renderDetail();
    vscode.postMessage({ type: 'startAuthCodeFlow', name: state.profiles[state.selected.index].name });
  } else if (action === 'refreshToken') {
    if (!state.selected || state.selected.isNew) { return; }
    state.signingIn = true;
    state.error = null;
    renderDetail();
    vscode.postMessage({ type: 'refreshAccessToken', name: state.profiles[state.selected.index].name });
  } else if (action === 'cancelAuthFlow') {
    state.signingIn = false;
    state.cancelled = true;
    renderDetail();
    vscode.postMessage({ type: 'cancelAuthCodeFlow' });
  } else if (action === 'signOut') {
    if (!state.selected || state.selected.isNew) { return; }
    vscode.postMessage({ type: 'signOutProfile', name: state.profiles[state.selected.index].name });
  } else if (action === 'setActiveProfile') {
    vscode.postMessage({ type: 'setActiveProfile', name: data.name });
  } else if (action === 'deactivateProfile') {
    vscode.postMessage({ type: 'setActiveProfile', name: undefined });
  } else if (action === 'listSignIn') {
    state.signingIn = true;
    state.error = null;
    renderList();
    vscode.postMessage({ type: 'startAuthCodeFlow', name: data.name });
  } else if (action === 'listRefresh') {
    var refreshIdx = state.profiles.findIndex(function(p) { return p.name === data.name; });
    state.signingIn = true;
    state.error = null;
    if (refreshIdx !== -1) { state.selected = { index: refreshIdx, isNew: false }; }
    render();
    vscode.postMessage({ type: 'refreshAccessToken', name: data.name });
  }
}

function submitProfileForm() {
  var name         = (document.getElementById('f-name')?.value || '').trim();
  var type         = document.getElementById('f-type')?.value || 'bearer';
  var username     = (document.getElementById('f-username')?.value || '').trim();
  var headerName   = (document.getElementById('f-headername')?.value || '').trim();
  var authorizeUrl = (document.getElementById('f-authorize-url')?.value || '').trim();
  var tokenUrl     = (document.getElementById('f-token-url')?.value || '').trim();
  var clientId     = (document.getElementById('f-client-id')?.value || '').trim();
  var scope        = (document.getElementById('f-scope')?.value || '').trim();
  var portStr      = document.getElementById('f-redirect-port')?.value || '';
  var redirectPort = portStr ? parseInt(portStr, 10) : undefined;
  var usePkce      = !!(document.getElementById('f-use-pkce')?.checked);
  var secret       = document.getElementById('f-secret')?.value || '';
  var isNew = state.selected.isNew;

  if (!name) {
    state.error = 'Profile name is required.';
    renderDetail();
    return;
  }

  vscode.postMessage({
    type: 'saveProfile',
    profile: {
      name: name,
      type: type,
      username: username || undefined,
      headerName: headerName || undefined,
      authorizeUrl: authorizeUrl || undefined,
      tokenUrl: tokenUrl || undefined,
      clientId: clientId || undefined,
      scope: scope || undefined,
      redirectPort: (redirectPort && !isNaN(redirectPort)) ? redirectPort : undefined,
      usePkce: type === 'authcode' ? usePkce : undefined,
      secret: secret || undefined,
    },
    isNew: isNew,
  });
}

function submitSecretForm() {
  var name  = (document.getElementById('f-name')?.value || '').trim();
  var value = document.getElementById('f-value')?.value || '';
  var isNew = state.selected.isNew;

  if (!name) {
    state.error = 'Secret name is required.';
    renderDetail();
    return;
  }
  if (isNew && !value) {
    state.error = 'Secret value is required for a new secret.';
    renderDetail();
    return;
  }

  vscode.postMessage({
    type: 'saveSecret',
    name: name,
    value: value || undefined,
    isNew: isNew,
  });
}
`;

  /* ── CSS ──────────────────────────────────────────────────────────────── */
  const css = `
*, *::before, *::after { box-sizing: border-box; }

html, body {
  height: 100%;
  overflow: hidden;
  margin: 0;
  padding: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}

/* ── Shell ─────────────────────────────────────────── */
.app     { display: flex; flex-direction: column; height: 100%; }
.content { display: flex; flex: 1; overflow: hidden; }

/* ── Header ────────────────────────────────────────── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
  background: var(--vscode-titleBar-activeBackground, var(--vscode-editor-background));
  gap: 12px;
}
.header-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vscode-textLink-activeForeground, #c586c0);
  white-space: nowrap;
}
.tabs         { display: flex; gap: 2px; }
.tab {
  padding: 4px 14px;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  background: transparent;
  color: var(--vscode-foreground);
  opacity: 0.6;
  transition: opacity 0.12s, background 0.12s;
}
.tab:hover  { opacity: 0.9; background: var(--vscode-list-hoverBackground); }
.tab.active {
  opacity: 1;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

/* ── Sidebar ───────────────────────────────────────── */
.sidebar {
  width: 230px;
  flex-shrink: 0;
  border-right: 1px solid var(--vscode-panel-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sidebar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}
#item-count {
  font-size: 11px;
  opacity: 0.45;
}
.add-btn {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
  font-size: 17px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
}
.add-btn:hover { background: var(--vscode-button-hoverBackground); }

.list      { flex: 1; overflow-y: auto; padding: 4px 0; }
.list-empty {
  padding: 20px 14px;
  font-size: 12px;
  opacity: 0.5;
  text-align: center;
  line-height: 1.7;
}

/* ── List items ────────────────────────────────────── */
.list-item {
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background 0.1s;
}
.list-item:hover   { background: var(--vscode-list-hoverBackground); }
.list-item.active  {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
  border-left-color: var(--vscode-activityBarBadge-background, #4db6f5);
}
.item-row {
  display: flex;
  align-items: center;
  padding: 7px 8px 7px 10px;
  gap: 6px;
  min-height: 34px;
}
.item-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-ref {
  font-size: 10px;
  opacity: 0.4;
  font-family: var(--vscode-editor-font-family);
  flex-shrink: 0;
  white-space: nowrap;
}
.lock-icon { font-size: 11px; flex-shrink: 0; }

.icon-btn {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 10px;
  color: inherit;
  opacity: 0;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: opacity 0.1s, background 0.1s;
}
.list-item:hover .icon-btn   { opacity: 0.55; }
.icon-btn:hover              {
  opacity: 1 !important;
  background: rgba(244, 135, 113, 0.2);
  color: #f48771;
}

.confirm-row {
  padding: 0 10px 8px 10px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.btn-micro {
  padding: 2px 8px;
  font-size: 11px;
  font-family: inherit;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 3px;
  cursor: pointer;
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
}
.btn-micro:hover { background: var(--vscode-list-hoverBackground); }
.btn-micro.btn-danger {
  background: #4c1414;
  color: #f48771;
  border-color: rgba(244,135,113,0.5);
}
.btn-micro.btn-danger:hover { background: #6b1e1e; }
.btn-micro.btn-active {
  background: rgba(35,134,54,0.15);
  color: #3fb950;
  border-color: rgba(63,185,80,0.5);
}
.btn-micro.btn-active:hover { background: rgba(35,134,54,0.28); }
.list-item.profile-active { border-left: 2px solid #3fb950; }

/* ── Type badges ───────────────────────────────────── */
.type-badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.type-bearer   { background: #0b3d6b; color: #4db6f5; }
.type-basic    { background: #0e4429; color: #4ec97b; }
.type-apikey   { background: #4d3800; color: #e2a620; }
.type-oauth2   { background: #3b1f6b; color: #c586c0; }
.type-authcode { background: #3b2400; color: #ffb057; }

/* ── Detail pane ───────────────────────────────────── */
.detail {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}

/* ── Empty state ───────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 10px;
  opacity: 0.5;
  text-align: center;
}
.empty-icon  { font-size: 42px; }
.empty-title { font-size: 14px; font-weight: 600; }
.empty-sub   { font-size: 12px; max-width: 260px; line-height: 1.7; }

/* ── Form ──────────────────────────────────────────── */
.detail-form  { max-width: 460px; }
.form-title   { font-size: 14px; font-weight: 600; margin: 0 0 20px; }
.form-error {
  background: rgba(244, 135, 113, 0.12);
  border: 1px solid rgba(244, 135, 113, 0.6);
  color: #f48771;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 16px;
}
.form-group { margin-bottom: 16px; }

label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.7;
  margin-bottom: 5px;
}

input[type="text"],
input[type="password"],
select {
  width: 100%;
  padding: 6px 10px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 4px;
  font-family: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color 0.1s;
}
input[type="text"]:focus,
input[type="password"]:focus,
select:focus { border-color: var(--vscode-focusBorder, #4db6f5); }
input[readonly] { opacity: 0.55; cursor: not-allowed; }

select option {
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
}

.field-hint {
  margin: 5px 0 0;
  font-size: 11px;
  opacity: 0.55;
  line-height: 1.5;
}
code {
  font-family: var(--vscode-editor-font-family);
  background: var(--vscode-textCodeBlock-background);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.form-actions { display: flex; gap: 8px; margin-top: 24px; }
.btn-primary {
  padding: 6px 18px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
}
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn-secondary {
  padding: 6px 18px;
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}
.btn-secondary:hover { background: var(--vscode-list-hoverBackground); }

/* ── Auth Code extras ──────────────────────────────── */
input[type="number"] {
  width: 100%;
  padding: 6px 10px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 4px;
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
input[type="number"]:focus { border-color: var(--vscode-focusBorder, #4db6f5); }

.form-divider {
  border: none;
  border-top: 1px solid var(--vscode-panel-border);
  margin: 20px 0 18px;
}
.section-sub {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.65;
  margin: 0 0 12px;
}
.token-status-row { margin-bottom: 12px; }
.token-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}
.token-status.signed-in  { background: #1a472a; color: #4ec97b; }
.token-status.signed-out { background: #2a1414; color: #f48771; opacity: .85; }
.btn-signin {
  padding: 6px 20px;
  background: #ffb057;
  color: #1a0e00;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.btn-signin:hover:not(:disabled) { background: #ffc07a; }
.btn-signin:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Toast ───────────────────────────────────────────────── */
#toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(8px);
  background: var(--vscode-notifications-background, var(--vscode-editor-background));
  color: var(--vscode-notifications-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  padding: 7px 16px;
  font-size: 13px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.18s, transform 0.18s;
  z-index: 9999;
  white-space: nowrap;
}
#toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
`;

  /* ── HTML ─────────────────────────────────────────────────────────────── */
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>HTTP Vortex — Credentials</title>
  <style>${css}</style>
</head>
<body>
  <div class="app">
    <div class="header">
      <span class="header-title">Credentials</span>
      <div class="tabs" id="tabs">
        <button class="tab" data-action="switchTab" data-tab="auth">Auth Profiles</button>
        <button class="tab" data-action="switchTab" data-tab="secrets">Secrets</button>
      </div>
    </div>
    <div class="content">
      <div class="sidebar">
        <div class="sidebar-top">
          <span id="item-count">0 items</span>
          <button class="add-btn" data-action="addNew" title="Add new">+</button>
        </div>
        <div class="list" id="list"></div>
      </div>
      <div class="detail" id="detail"></div>
    </div>
  </div>
  <div id="toast"></div>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
