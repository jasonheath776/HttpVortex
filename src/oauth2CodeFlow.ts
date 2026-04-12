/**
 * OAuth2 Authorization Code Flow helper
 *
 * Starts a short-lived local HTTP server, opens the system browser at the
 * authorization URL, waits for the redirect callback, validates the state
 * parameter (CSRF protection), and exchanges the code for tokens.
 *
 * Security notes:
 *  - The local server binds only to 127.0.0.1 (loopback).
 *  - The `state` parameter is a cryptographically-random nonce; mismatches abort the flow.
 *  - The server is closed immediately after the first valid callback (or on timeout).
 *  - client_secret is read from SecretStorage, never from disk.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import axios from 'axios';

export interface AuthCodeFlowConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  redirectPort: number;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  /** Seconds until expiry as reported by the server. */
  expiresIn?: number;
}

/** Timeout before giving up waiting for the browser callback (5 minutes). */
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Runs the OAuth2 Authorization Code flow:
 *  1. Starts a local HTTP server on 127.0.0.1:redirectPort
 *  2. Opens the browser at the authorization URL
 *  3. Waits for the /callback redirect (with timeout)
 *  4. Validates the state parameter
 *  5. Exchanges the code for tokens via POST to tokenUrl
 *  6. Returns the token response
 *
 * Throws on any error (timeout, state mismatch, token exchange failure, etc.)
 */
export async function runAuthCodeFlow(config: AuthCodeFlowConfig): Promise<TokenResponse> {
  const redirectUri = `http://localhost:${config.redirectPort}/callback`;
  const state = crypto.randomBytes(20).toString('hex');

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri,
    state,
    ...(config.scope ? { scope: config.scope } : {}),
  });

  const authUrl = `${config.authorizeUrl}?${authParams.toString()}`;

  return new Promise<TokenResponse>((resolve, reject) => {
    let done = false;

    const finish = (err?: Error, result?: TokenResponse) => {
      if (done) { return; }
      done = true;
      clearTimeout(timer);
      server.close();
      if (err) { reject(err); } else { resolve(result!); }
    };

    // Safety timeout
    const timer = setTimeout(() => {
      finish(new Error('Sign-in timed out after 5 minutes. Please try again.'));
    }, FLOW_TIMEOUT_MS);

    const server = http.createServer(async (req, res) => {
      const url = req.url ?? '';
      if (!url.startsWith('/callback')) {
        res.writeHead(404); res.end('Not found'); return;
      }

      const parsed = new URL(url, `http://127.0.0.1:${config.redirectPort}`);
      const code           = parsed.searchParams.get('code');
      const returnedState  = parsed.searchParams.get('state');
      const error          = parsed.searchParams.get('error');
      const errorDesc      = parsed.searchParams.get('error_description');

      // Respond to the browser first so it doesn't hang
      const success = !error && !!code && returnedState === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildCallbackPage(success, error, errorDesc));

      if (error) {
        finish(new Error(`Authorization denied: ${errorDesc ?? error}`));
        return;
      }
      if (!code) {
        finish(new Error('No authorization code received in the callback.'));
        return;
      }
      if (returnedState !== state) {
        finish(new Error('State mismatch — possible CSRF attempt. Sign-in aborted.'));
        return;
      }

      // Exchange code → tokens
      try {
        const body = new URLSearchParams({
          grant_type:   'authorization_code',
          code,
          redirect_uri:  redirectUri,
          client_id:    config.clientId,
          client_secret: config.clientSecret,
        });

        const resp = await axios.post<{
          access_token:  string;
          refresh_token?: string;
          expires_in?:   number;
        }>(config.tokenUrl, body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
          timeout: 30_000,
        });

        finish(undefined, {
          accessToken:  resp.data.access_token,
          refreshToken: resp.data.refresh_token,
          expiresIn:    resp.data.expires_in,
        });
      } catch (err: unknown) {
        let msg = 'Token exchange failed';
        if (axios.isAxiosError(err)) {
          const d = err.response?.data as Record<string, string> | undefined;
          msg += `: ${d?.error_description ?? d?.error ?? err.message}`;
        } else {
          msg += `: ${String(err)}`;
        }
        finish(new Error(msg));
      }
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      const detail = err.code === 'EADDRINUSE'
        ? `Port ${config.redirectPort} is already in use. Change the Redirect Port in the profile and try again.`
        : err.message;
      finish(new Error(`Could not start local callback server: ${detail}`));
    });

    server.listen(config.redirectPort, '127.0.0.1', () => {
      vscode.env.openExternal(vscode.Uri.parse(authUrl)).then((opened) => {
        if (!opened) {
          finish(new Error('Failed to open the system browser. Check your OS default browser settings.'));
        }
      });
    });
  });
}

// ── Response page shown in the browser after the callback ────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildCallbackPage(
  success: boolean,
  error: string | null,
  errorDesc: string | null
): string {
  const baseStyle = `
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh;
         background:#1e1e2e;color:#cdd6f4;}
    .card{text-align:center;padding:40px 32px;background:#313244;border-radius:14px;
          max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.4);}
    h1{margin:0 0 10px;font-size:1.3rem;}
    p{margin:0;opacity:.7;font-size:.95rem;line-height:1.6;}
  `;
  if (success) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Signed In</title><style>${baseStyle}
      h1{color:#a6e3a1;}</style></head><body>
      <div class="card"><h1>&#10003; Signed in successfully</h1>
      <p>You can close this tab and return to VS Code.</p></div></body></html>`;
  }
  const msg = errorDesc ?? error ?? 'Unknown error';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sign In Failed</title><style>${baseStyle}
    h1{color:#f38ba8;}</style></head><body>
    <div class="card"><h1>&#10007; Sign in failed</h1>
    <p>${escHtml(msg)}</p></div></body></html>`;
}
