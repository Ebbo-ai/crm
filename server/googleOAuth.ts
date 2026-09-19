import { storage } from "./storage";

/**
 * The CRM's own Google OAuth client, replacing the Replit Gmail connector for
 * anything involving Kim's, clientservice@'s, and Steve's mailboxes. The
 * Replit connector holds one Google account at a time; these three mailboxes
 * must be authorized concurrently, each with its own scopes (Steve's is
 * read+send but the read side is allow-list filtered in application code —
 * see mailAllowlist.ts — since Gmail scopes can't be restricted to a label).
 *
 * The consent screen is configured as INTERNAL in Google Cloud (see
 * docs/gmail-oauth-setup.md) — restricted to the simple.us Workspace, so no
 * Google security assessment is required for the gmail.readonly/gmail.send
 * scopes below.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** Every mailbox the CRM's OAuth app knows about, and the scopes each one needs. Steve's carries read scope only to run the application-level allow-list filter against his mailbox; it is never used to expose a general search over his mail. */
export const CONFIGURED_MAILBOXES: { mailbox: string; displayName: string; scopes: string[] }[] = [
  { mailbox: "kim.anderson@simple.us", displayName: "Kim Anderson", scopes: [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE] },
  { mailbox: "clientservice@simple.us", displayName: "Simple Client Service", scopes: [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE] },
  { mailbox: "steve.schultz@simple.us", displayName: "Steve Schultz", scopes: [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE] },
];

function clientId(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured — see docs/gmail-oauth-setup.md");
  return v;
}

function clientSecret(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not configured — see docs/gmail-oauth-setup.md");
  return v;
}

/** Built from the request's own host so the same code works against the dev domain and the deployed domain — both must be registered as authorized redirect URIs in Google Cloud, see docs/gmail-oauth-setup.md. */
export function redirectUriFor(req: { protocol: string; get(name: string): string | undefined }): string {
  return `${req.protocol}://${req.get("host")}/api/oauth/gmail/callback`;
}

/** state carries which mailbox is being authorized through Google's redirect round trip. */
export function buildAuthUrl(mailbox: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    // Forces Google to hand back a refresh token even if this mailbox
    // previously authorized the app — without this, re-authorizing after a
    // revoke silently returns no refresh_token and the mailbox stays broken.
    prompt: "consent",
    scope: (CONFIGURED_MAILBOXES.find(m => m.mailbox === mailbox)?.scopes || [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE]).join(" "),
    login_hint: mailbox,
    state: mailbox,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

/** Exchanges the authorization code for tokens and stores the mailbox's refresh token. Called once per mailbox from the OAuth callback route. */
export async function completeAuthorization(mailbox: string, code: string, redirectUri: string, connectedBy: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed: ${res.status} ${body.slice(0, 500)}`);
  }
  const tokens = (await res.json()) as TokenResponse;
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. This happens when the mailbox already authorized this app and consent wasn't re-prompted — revoke the app's access at myaccount.google.com/permissions for this mailbox and try connecting again.",
    );
  }
  const config = CONFIGURED_MAILBOXES.find(m => m.mailbox === mailbox);
  await storage.upsertGmailAccount({
    mailbox,
    displayName: config?.displayName || mailbox,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope.split(" "),
    status: "CONNECTED",
    connectedBy,
  });
}

/** Refreshes and persists a new access token using the stored refresh token. Marks the account NEEDS_REAUTH (surfaced in the Mail Accounts admin page) rather than throwing a generic error when Google reports the refresh token itself is dead. */
async function refreshAccessToken(mailbox: string, refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 400 || res.status === 401) {
      await storage.markGmailAccountNeedsReauth(mailbox);
    }
    throw new Error(`Google token refresh failed for ${mailbox}: ${res.status} ${body.slice(0, 300)}`);
  }
  const tokens = (await res.json()) as TokenResponse;
  await storage.updateGmailAccountToken(mailbox, {
    accessToken: tokens.access_token,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    status: "CONNECTED",
  });
  return tokens.access_token;
}

/** Never caches beyond what's in the DB — always checks expiry and refreshes with a safety margin so a call mid-request never hits a token that expires a second later. */
export async function getValidAccessToken(mailbox: string): Promise<string> {
  const account = await storage.getGmailAccountByMailbox(mailbox);
  if (!account) throw new Error(`${mailbox} is not connected. Connect it from Settings \u2192 Mail Accounts first.`);
  if (account.status === "NEEDS_REAUTH") {
    throw new Error(`${mailbox}'s Gmail authorization has expired or been revoked. Reconnect it from Settings \u2192 Mail Accounts.`);
  }
  const SAFETY_MARGIN_MS = 60_000;
  if (account.accessToken && account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() - SAFETY_MARGIN_MS > Date.now()) {
    return account.accessToken;
  }
  return refreshAccessToken(mailbox, account.refreshToken);
}
