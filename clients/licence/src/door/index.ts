/**
 * `@xenosystem/licence/door` — the sign-in door every XENO desktop app runs, in its MAIN process.
 *
 * Owner, 2026-10-25: one unified core, never a copy per app. Extracted from XENO Canvas 0.40+ (the reference
 * implementation of `XENO APP ENFORCEMENT - PLAYBOOK.md`): the OIDC session, the door state, the licence verdict,
 * the `auth.log` trace and `X-Xeno-Client` on every platform call. An app passes in its own Electron and its own
 * account SDK (`@xeno-corporation/account`, vendored per app) and gets the whole door; the screen stays
 * `@xenosystem/blocks/auth` in the renderer.
 *
 * Two verbs cross the bridge and nothing else:
 *   main → renderer  `auth-gate:state`   { account, licence, sdk, pending?, identity?, message?, lastVerifiedAt?, capabilities }
 *   renderer → main  `auth-gate:intent`  { kind }
 *
 * 🔴 The server decides, not the app. Whether this account may open this product is `product_access_policy`;
 * whether this build may sign in at all is the version floor on the token endpoint. The app renders the answer.
 *
 * What the session does, and the locked decisions it keeps (`XENO AUTH - SPEC.md`):
 *   - OIDC public client, PKCE-S256 (L3), on the ONE origin `/api/oauth2/*` (L1).
 *   - Interactive sign-in = RFC 8252 loopback + the SYSTEM browser (L8 — never an embedded webview).
 *   - The refresh token and the DPoP key live ONLY in the OS keystore via `safeStorage` (L9); Linux
 *     `basic_text` counts as absent, so the session is then memory-only.
 *   - One serialized refresh writer (L6); a TRANSIENT refresh failure keeps the token (offline is not signed out).
 *   - Tokens are DPoP-bound (RFC 9449): the gateway refuses Bearer for model calls.
 */
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { appendFileSync, renameSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startLicence, xenoClientHeaders, type Licence } from '../index';

// ── What the app injects ─────────────────────────────────────────────────────────────────────────────

/** The slice of Electron the door uses. */
export interface DoorElectron {
  app: { isPackaged: boolean; getVersion(): string; getPath(name: 'userData' | 'home'): string };
  ipcMain: {
    handle(channel: string, listener: (...args: any[]) => unknown): void;
    on(channel: string, listener: (event: unknown, ...args: any[]) => void): void;
  };
  shell: { openExternal(url: string): Promise<void> | void };
  safeStorage: { isEncryptionAvailable(): boolean; encryptString(s: string): Uint8Array; decryptString(b: Uint8Array): string; getSelectedStorageBackend?: () => string };
  BrowserWindow: { getAllWindows(): Array<{ isDestroyed(): boolean; webContents: { send(channel: string, ...args: unknown[]): void } }> };
}

export interface DpopSigner { createProof(o: { method: string; url: string; accessToken?: string; nonce?: string }): Promise<string> }
export interface TokenSet { accessToken: string; refreshToken?: string; expiresAt?: string | number | Date }

/** The slice of `@xeno-corporation/account` (+ `/node`) the door uses — the app's own vendored SDK. */
export interface DoorAccountSdk {
  buildAuthorizeUrl(config: any, o: { state: string; codeChallenge: string; redirectUri: string; nonce: string }): string;
  exchangeCode(config: any, transport: any, o: { code: string; codeVerifier: string; redirectUri: string; expectedNonce: string }): Promise<TokenSet>;
  generatePkce(): Promise<{ verifier: string; challenge: string }>;
  generateState(): string;
  refreshTokens(config: any, transport: any, refreshToken: string): Promise<TokenSet>;
  Transport: new (o: { fetchImpl: typeof fetch }) => unknown;
  createNodeDpopSigner(jwk: string): DpopSigner;
}

export interface DoorOptions {
  /** Catalog slug: `pixel`, `motion`, … — the licence product and the `X-Xeno-Client` name. */
  product: string;
  /** Shown on the browser page after sign-in: "XENO Pixel". */
  productName: string;
  /** The app's registered OIDC client, e.g. `xeno-pixel`. */
  clientId: string;
  /** Scopes the client is registered for. Asking for one it cannot hold fails sign-in outright. */
  scopes: string[];
  electron: DoorElectron;
  account: DoorAccountSdk;
  /** OIDC issuer (default `https://xenostudio.ai`, where the provider is today). */
  issuer?: string;
  /** Public site for links (default `https://xenosystem.ai`). */
  site?: string;
  /** Licence API base (default: the licence package's own). */
  apiBase?: string;
  /**
   * Called with every state pushed to the windows, for what main itself must do when the door moves (close a view,
   * tell a sidecar). A throw here is logged and never stops the push. It carries no credential.
   */
  onStateChange?: (state: XenoAuthGateState) => void;
}

// ── Pure pieces (exported for their tests) ───────────────────────────────────────────────────────────

export type XenoLicenceState = 'licensed' | 'unlicensed' | 'expired-offline' | 'update-required';
export type XenoAccountStatus = 'unknown' | 'signedOut' | 'signedIn' | 'refreshing' | 'expired' | 'offline';
export type XenoAuthGateIntentKind = 'signIn' | 'cancelSignIn' | 'signOut' | 'refresh' | 'openDownload' | 'manageBilling';

export interface XenoAuthGateState {
  account: XenoAccountStatus;
  licence: XenoLicenceState | 'checking';
  sdk: 'ready' | 'unavailable';
  pending?: boolean;
  identity?: { sub: string; email?: string; name?: string };
  message?: string;
  lastVerifiedAt?: number;
  /** Where the system browser opens for sign-in, from the issuer sign-in really uses (`@xenosystem/blocks` >= 0.22 names it). */
  signInHost?: string;
  capabilities: Partial<Record<XenoAuthGateIntentKind, boolean>>;
}

/** What the door can perform — the gate hides the affordance for anything absent. */
export const CAPABILITIES: XenoAuthGateState['capabilities'] = {
  signIn: true, cancelSignIn: true, signOut: true, refresh: true, openDownload: true, manageBilling: true,
};

/**
 * The gate's two axes from one licence result. PURE — the only place a verdict becomes a door.
 *
 *   update-required            → licence `update-required`, whatever the account says: the server refuses this
 *                                build a token, so the door says UPDATE, never sign in
 *   no token                   → `signedOut`
 *   token, unauthenticated     → `expired`
 *   token, anything else       → `signedIn`, licence as the verdict says
 *   no token, SAVED session    → `offline` (a network failure, not a refusal): licensed inside the grace,
 *                                `expired-offline` after it — never the sign-in door
 */
export function gateStateFrom(l: Licence, hasToken: boolean, savedSession = false): Pick<XenoAuthGateState, 'account' | 'licence' | 'message' | 'lastVerifiedAt'> {
  const lastVerifiedAt = l.state === 'licensed' || l.state === 'expired-offline' ? l.checkedAt : undefined;
  if (l.state === 'update-required') {
    return { account: hasToken ? 'signedIn' : 'signedOut', licence: 'update-required', message: l.message, lastVerifiedAt: undefined };
  }
  if (!hasToken && savedSession) {
    if (l.state === 'licensed') return { account: 'offline', licence: 'licensed', message: undefined, lastVerifiedAt };
    if (l.state === 'expired-offline') return { account: 'offline', licence: 'expired-offline', message: undefined, lastVerifiedAt };
    return { account: 'offline', licence: 'checking', message: undefined, lastVerifiedAt: undefined };
  }
  if (!hasToken) return { account: 'signedOut', licence: 'checking', message: undefined, lastVerifiedAt: undefined };
  if (l.state === 'unlicensed' && l.reason === 'unauthenticated') {
    return { account: 'expired', licence: 'checking', message: undefined, lastVerifiedAt: undefined };
  }
  return { account: 'signedIn', licence: l.state, message: l.state === 'unlicensed' ? l.message : undefined, lastVerifiedAt };
}

/**
 * A refresh that failed for a reason that says nothing about the token (network, rate limit, platform error), read
 * from the SDK's own `retryable` — with ONE override: 426 is the version floor refusing THIS build, never a blip.
 */
export function isTransientRefreshFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { retryable?: unknown; httpStatus?: unknown };
  if (e.httpStatus === 426) return false;
  return e.retryable === true;
}

/** The short account reference the log uses — never the full id, never an email. */
export function subRef(sub: string | undefined | null): string | undefined {
  return sub ? String(sub).slice(0, 8) : undefined;
}

/** A caught error, reduced to what is safe: an HTTP status and/or an error code (a message loses its query string). */
export function errorFields(err: unknown): { status?: number; code?: string; error?: string } {
  const e = err as { httpStatus?: unknown; code?: unknown; message?: unknown } | null;
  const status = typeof e?.httpStatus === 'number' ? e.httpStatus : undefined;
  const code = typeof e?.code === 'string' ? e.code : undefined;
  const message = typeof e?.message === 'string' ? e.message.replace(/\?[^\s]*/g, '?…').slice(0, 160) : undefined;
  return { status, code, error: status || code ? undefined : message };
}

/**
 * `<userData>/auth.log`: one line per step, so a real sign-in can be FOLLOWED. 🔴 Never a credential — only step
 * names, HTTP statuses, error codes and the verdict; the account by the first 8 characters of its `sub`. Rotates
 * past 512 KB. Never throws.
 */
export function createAuthLog(app: Pick<DoorElectron['app'], 'getPath' | 'getVersion'>, maxBytes = 512 * 1024) {
  const file = (): string => join(app.getPath('userData'), 'auth.log');
  return {
    path: file,
    log(step: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
      try {
        const f = file();
        try { if (statSync(f).size > maxBytes) renameSync(f, `${f}.1`); } catch { /* no file yet */ }
        const detail = Object.entries(fields)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${typeof v === 'string' && /\s/.test(v) ? JSON.stringify(v) : String(v)}`)
          .join(' ');
        appendFileSync(f, `${new Date().toISOString()} v${app.getVersion()} ${step}${detail ? ` ${detail}` : ''}\n`);
      } catch { /* never throw from a trace */ }
    },
  };
}

/** XENO's own services — the only places the door will sign a request for. Never drop the older host. */
export const AUTHORIZABLE_ORIGINS = new Set([
  'https://xenosystem.ai',
  'https://xenostudio.ai',
  'https://api.xenostudio.ai',
  'https://api.xenosystem.ai',
  'https://direct-api.xenostudio.ai:8443',
]);

// ── The door ─────────────────────────────────────────────────────────────────────────────────────────

export function createDoor(o: DoorOptions) {
  const { app, ipcMain, shell, safeStorage, BrowserWindow } = o.electron;
  const sdk = o.account;
  const ISSUER = o.issuer ?? 'https://xenostudio.ai';
  const SITE = o.site ?? 'https://xenosystem.ai';
  const downloadUrl = `${SITE}/product/${o.product}/download`;
  const billingUrl = `${SITE}/pricing`;
  const trace = createAuthLog(app);
  const authLog = trace.log;

  /**
   * Every request to the platform names the build — `X-Xeno-Client: <product>/<version>`. 🔴 Load-bearing: the
   * token endpoint refuses a product's own client below its floor unless this header says the build is supported.
   */
  const identifiedFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, headers: { ...xenoClientHeaders(o.product, app.getVersion()), ...(init?.headers as Record<string, string> | undefined) } });
  const transport = new sdk.Transport({ fetchImpl: identifiedFetch });

  interface AuthState { accessToken: string | null; expiresAt: number; refreshToken: string | null; user: { sub?: string; email?: string; name?: string } | null; keystoreOk: boolean }
  const state: AuthState = { accessToken: null, expiresAt: 0, refreshToken: null, user: null, keystoreOk: false };
  let refreshInFlight: Promise<boolean> | null = null;
  const refreshFile = (): string => join(app.getPath('userData'), 'auth-refresh.bin');
  const dpopKeyFile = (): string => join(app.getPath('userData'), 'auth-dpop.bin');
  const metaDir = (): string => join(app.getPath('home'), '.xeno');

  /** L9 hard guard: Linux `basic_text` is hardcoded-salt pseudo-encryption, so it counts as ABSENT. */
  function keystoreAvailable(): boolean {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      return safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    } catch { return false; }
  }

  const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
  const unb64 = (s: string): Uint8Array => Buffer.from(s, 'base64');

  let dpopSigner: DpopSigner | null = null;
  /** The DPoP key: generated once, kept like the refresh token (keystore only); per-launch without a keystore. */
  async function signer(): Promise<DpopSigner> {
    if (dpopSigner) return dpopSigner;
    let jwk: string | null = null;
    if (state.keystoreOk) {
      try { jwk = safeStorage.decryptString(unb64(await readFile(dpopKeyFile(), 'utf-8'))); } catch { jwk = null; }
    }
    if (!jwk) {
      jwk = JSON.stringify(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' }));
      if (state.keystoreOk) {
        try { await writeFile(dpopKeyFile(), b64(safeStorage.encryptString(jwk)), 'utf-8'); } catch { /* session-only */ }
      }
    }
    dpopSigner = sdk.createNodeDpopSigner(jwk);
    return dpopSigner;
  }

  const oidc = async () => ({
    issuer: ISSUER,
    clientId: o.clientId,
    scopes: o.scopes,
    authorizeUrl: `${ISSUER}/api/oauth2/authorize`,
    tokenUrl: `${ISSUER}/api/oauth2/token`,
    deviceAuthorizationUrl: `${ISSUER}/api/oauth2/device_authorization`,
    dpopSigner: await signer(),
  });

  async function persistRefresh(token: string | null): Promise<void> {
    state.refreshToken = token;
    if (!state.keystoreOk) return;
    try {
      if (token === null) await unlink(refreshFile()).catch(() => undefined);
      else await writeFile(refreshFile(), b64(safeStorage.encryptString(token)), 'utf-8');
    } catch { /* keystore write failed: the session stays in memory */ }
  }

  async function loadRefresh(): Promise<string | null> {
    if (!state.keystoreOk) return null;
    try { return safeStorage.decryptString(unb64(await readFile(refreshFile(), 'utf-8'))); } catch { return null; }
  }

  /** §4.3 metadata sidecar — NO secrets. */
  async function writeMeta(): Promise<void> {
    try {
      await mkdir(metaDir(), { recursive: true });
      await writeFile(join(metaDir(), `account-${o.product}.json`), JSON.stringify({
        version: 2, sub: state.user?.sub ?? null, surface: o.product,
        accessExpiresAt: Math.floor(state.expiresAt / 1000), keystoreRef: `xeno:${o.product}:refresh`, updatedAt: new Date().toISOString(),
      }, null, 2), 'utf-8');
    } catch { /* best-effort */ }
  }

  function adopt(tokens: TokenSet): void {
    state.accessToken = tokens.accessToken;
    state.expiresAt = tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : Date.now() + 540_000;
    if (tokens.refreshToken) void persistRefresh(tokens.refreshToken);
  }

  /** Single-writer rotating refresh (L6). A transient failure KEEPS the refresh token. */
  async function tryRefresh(): Promise<boolean> {
    if (refreshInFlight) return refreshInFlight;
    /*
     * 🔴 The "no saved session" return is INSIDE the try, so `finally` clears the in-flight marker on every path.
     * Canvas had it outside: a launch with no session left the marker pointing at a promise already resolved to
     * false, so every later refresh returned that stale "no session" — a person who signed in after launch was
     * dropped when their first 10-minute token expired. Pinned in test/door.test.mjs.
     */
    refreshInFlight = (async () => {
      try {
        const rt = state.refreshToken ?? (await loadRefresh());
        if (!rt) return false;
        adopt(await sdk.refreshTokens(await oidc(), transport, rt));
        authLog('refresh.ok');
        return true;
      } catch (err) {
        authLog('refresh.failed', errorFields(err));
        state.accessToken = null;
        state.expiresAt = 0;
        if (!isTransientRefreshFailure(err)) await persistRefresh(null);
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  /** A saved session this process could not turn into a token just now = OFFLINE, not signed out. */
  async function hasSavedSession(): Promise<boolean> {
    return Boolean(state.refreshToken ?? (await loadRefresh()));
  }

  /** Silent: memory → own refresh. Never shows UI. */
  async function getAccessToken(): Promise<string | null> {
    if (state.accessToken && Date.now() < state.expiresAt - 60_000) return state.accessToken;
    if (await tryRefresh()) return state.accessToken;
    return null;
  }

  /** Headers for ONE request to a XENO service: `Authorization: DPoP <token>` + a proof bound to this method and URL (and to a server's nonce, when it issued one: RFC 9449 §8). */
  async function authorizeRequest(target: { method: string; url: string; nonce?: string }): Promise<{ authorization: string; dpop: string } | null> {
    let url: URL;
    try { url = new URL(target.url); } catch { return null; }
    if (url.protocol !== 'https:' || !AUTHORIZABLE_ORIGINS.has(url.origin)) return null;
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(target.method)) return null;
    const token = await getAccessToken();
    if (!token) return null;
    const dpop = await (await signer()).createProof({ method: target.method, url: url.href, accessToken: token, ...(target.nonce ? { nonce: target.nonce } : {}) });
    return { authorization: `DPoP ${token}`, dpop };
  }

  /** Platform calls from main: `{ authorization, dpop }` when signed in, else null. */
  async function platformAuthHeaders(method: string, url: string): Promise<Record<string, string> | null> {
    const minted = await authorizeRequest({ method, url });
    return minted ? { authorization: minted.authorization, dpop: minted.dpop } : null;
  }

  async function fetchUser(): Promise<void> {
    try {
      const url = `${ISSUER}/api/v2/me`;
      const headers = await platformAuthHeaders('GET', url);
      if (!headers) return;
      const res = await identifiedFetch(url, { headers });
      if (res.ok) {
        const me = (await res.json()) as { sub?: string; id?: string; email?: string; name?: string };
        state.user = { sub: me.sub ?? me.id, email: me.email, name: me.name };
      }
    } catch { /* profile is cosmetic */ }
  }

  let pendingServer: Server | null = null;
  let pendingFinish: ((r: { ok: boolean; error?: string }) => void) | null = null;
  /** Abandon an in-flight sign-in: close the loopback server AND its timer. */
  function cancelInteractiveSignIn(reason = 'cancelled'): void { pendingFinish?.({ ok: false, error: reason }); }

  async function signInInteractive(): Promise<{ ok: boolean; error?: string }> {
    pendingServer?.close();
    pendingServer = null;
    const pkce = await sdk.generatePkce();
    const oauthState = sdk.generateState();
    const nonce = randomBytes(24).toString('base64url');
    const config = await oidc();
    return new Promise((resolvePromise) => {
      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');
          const page = (msg: string): void => {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(`<body style="font-family:system-ui;background:#0a0a0c;color:#e5e5ea"><p>${msg}</p></body>`);
          };
          // Two booleans first, so the trace never touches the code or the state value.
          const hasCode = Boolean(code);
          const stateMatches = returnedState === oauthState;
          authLog('signin.callback', { hasCode, stateMatches });
          if (!code || !stateMatches) {
            page(`Sign-in failed — you can close this tab and try again in ${o.productName}.`);
            finish({ ok: false, error: 'state mismatch or missing code' });
            return;
          }
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : 0;
          adopt(await sdk.exchangeCode(config, transport, { code, codeVerifier: pkce.verifier, redirectUri: `http://127.0.0.1:${port}/callback`, expectedNonce: nonce }));
          authLog('signin.token', { ok: true });
          await fetchUser();
          authLog('signin.profile', { sub: subRef(state.user?.sub) ?? 'unknown' });
          await writeMeta();
          page(`Signed in to ${o.productName} — you can close this tab.`);
          finish({ ok: true });
        } catch (err) {
          authLog('signin.token', { ok: false, ...errorFields(err) });
          finish({ ok: false, error: String(err) });
        }
      });
      const timeout = setTimeout(() => finish({ ok: false, error: 'sign-in timed out' }), 5 * 60_000);
      let settled = false;
      const finish = (result: { ok: boolean; error?: string }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        authLog('signin.end', { ok: result.ok, reason: result.ok ? undefined : errorFields(new Error(result.error ?? 'unknown')).error });
        server.close();
        if (pendingServer === server) pendingServer = null;
        if (pendingFinish === finish) pendingFinish = null;
        resolvePromise(result);
      };
      pendingFinish = finish;
      server.listen(0, '127.0.0.1', () => {
        pendingServer = server;
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const url = sdk.buildAuthorizeUrl(config, { state: oauthState, codeChallenge: pkce.challenge, redirectUri: `http://127.0.0.1:${port}/callback`, nonce });
        authLog('signin.start', { port });
        void shell.openExternal(url); // system browser (L8)
      });
    });
  }

  async function signOut(): Promise<void> {
    const rt = state.refreshToken ?? (await loadRefresh());
    if (rt) {
      try {
        await identifiedFetch(`${ISSUER}/api/oauth2/revoke`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: rt, client_id: o.clientId }),
        });
      } catch { /* offline sign-out still wipes locally */ }
    }
    state.accessToken = null; state.expiresAt = 0; state.user = null;
    await persistRefresh(null);
    await writeMeta();
  }

  async function getSessionUser(): Promise<{ sub?: string; email?: string; name?: string } | null> {
    if (!state.user && state.accessToken) await fetchUser();
    return state.user;
  }

  // ── The gate ───────────────────────────────────────────────────────────────────────────────────────
  let current: XenoAuthGateState = { account: 'unknown', licence: 'checking', sdk: 'ready', capabilities: CAPABILITIES };
  let pendingSignIn = false;
  let licence: ReturnType<typeof startLicence> | null = null;
  let lastHasToken = false;
  let applying: Promise<void> = Promise.resolve();

  function push(next: Partial<XenoAuthGateState>): void {
    current = { ...current, ...next, signInHost: new URL(ISSUER).host, capabilities: CAPABILITIES };
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('auth-gate:state', current);
    try { o.onStateChange?.(current); } catch (err) { authLog('door.onStateChange', errorFields(err)); }
  }

  /** Dev-only e2e fixture (`XENO_AUTH_GATE_E2E_OPEN=1`): a packaged build IGNORES it, by construction. */
  function e2eOpenFixture(): XenoAuthGateState | null {
    if (app.isPackaged || process.env.XENO_AUTH_GATE_E2E_OPEN !== '1') return null;
    return { account: 'signedIn', licence: 'licensed', sdk: 'ready', identity: { sub: 'e2e', email: 'e2e@xeno.test', name: 'E2E fixture' }, capabilities: CAPABILITIES };
  }

  /** The last-good verdict survives a restart, or the 14-day grace means nothing. Temp-then-rename writes. */
  const cacheFile = (): string => join(app.getPath('userData'), 'licence-cache.json');
  async function readCache(): Promise<Licence | null> {
    try {
      const parsed = JSON.parse(await readFile(cacheFile(), 'utf-8')) as Licence;
      return typeof parsed?.checkedAt === 'number' && typeof parsed?.state === 'string' ? parsed : null;
    } catch { return null; }
  }
  async function writeCache(l: Licence): Promise<void> {
    const tmp = `${cacheFile()}.tmp`;
    await writeFile(tmp, JSON.stringify(l), 'utf-8');
    await rename(tmp, cacheFile());
  }

  /** Offline is a state to leave: re-check on 15 s doubling to 5 min, stop at the first online verdict. */
  let offlineRetry: ReturnType<typeof setTimeout> | null = null;
  let offlineDelayMs = 15_000;
  function scheduleOfflineRetry(offline: boolean): void {
    if (!offline) {
      if (offlineRetry) clearTimeout(offlineRetry);
      offlineRetry = null; offlineDelayMs = 15_000;
      return;
    }
    if (offlineRetry) return;
    offlineRetry = setTimeout(() => {
      offlineRetry = null;
      offlineDelayMs = Math.min(offlineDelayMs * 2, 300_000);
      void licence?.refresh();
    }, offlineDelayMs);
    (offlineRetry as { unref?: () => void }).unref?.();
  }

  async function identityOf(): Promise<XenoAuthGateState['identity']> {
    const user = await getSessionUser();
    return user?.sub ? { sub: user.sub, email: user.email, name: user.name } : undefined;
  }

  async function onLicence(l: Licence): Promise<void> {
    const savedSession = !lastHasToken && (await hasSavedSession());
    const next = gateStateFrom(l, lastHasToken, savedSession);
    scheduleOfflineRetry(next.account === 'offline');
    const identity = next.account === 'signedIn' ? await identityOf() : undefined;
    authLog('licence.verdict', { state: l.state, reason: l.reason, plan: l.plan, source: l.source, minSupported: l.minSupported, token: lastHasToken });
    const before = `${current.account}/${current.licence}`;
    push({ ...next, sdk: keystoreAvailable() ? 'ready' : 'unavailable', identity, pending: pendingSignIn });
    const after = `${current.account}/${current.licence}`;
    if (after !== before) authLog('door.state', { from: before, to: after, sub: subRef(identity?.sub) });
  }

  async function refresh(): Promise<XenoAuthGateState> {
    const fixture = e2eOpenFixture();
    if (fixture) { push(fixture); return current; }
    if (!licence) return current;
    await licence.refresh();
    await applying;
    return current;
  }

  async function performIntent(kind: XenoAuthGateIntentKind): Promise<void> {
    switch (kind) {
      case 'signIn': {
        if (pendingSignIn) return;
        // A build below the floor cannot sign in; the gate never offers it, and main refuses it too.
        if (current.licence === 'update-required') return;
        pendingSignIn = true; push({ pending: true });
        authLog('door.intent', { kind: 'signIn' });
        if (!app.isPackaged && process.env.XENO_AUTH_GATE_NO_BROWSER === '1') return;
        try { await signInInteractive(); } finally { pendingSignIn = false; }
        await refresh(); return;
      }
      case 'cancelSignIn': cancelInteractiveSignIn(); pendingSignIn = false; push({ pending: false }); return;
      case 'signOut': authLog('door.intent', { kind: 'signOut' }); await signOut(); await refresh(); return;
      case 'refresh': await refresh(); return;
      case 'openDownload': void shell.openExternal(downloadUrl); return;
      case 'manageBilling': void shell.openExternal(billingUrl); return;
    }
  }

  /** Wire the two verbs and start the check. Call once at boot, after `app.whenReady()`. */
  function start(): void {
    state.keystoreOk = keystoreAvailable();
    ipcMain.handle('auth:get-token', async () => getAccessToken());
    ipcMain.handle('auth-gate:state', async () => (current.account === 'unknown' ? refresh() : current));
    ipcMain.on('auth-gate:intent', (_e, intent: { kind?: XenoAuthGateIntentKind }) => {
      if (intent && intent.kind && intent.kind in CAPABILITIES) void performIntent(intent.kind);
    });
    void getAccessToken().then(async (ok) => { if (ok) { await fetchUser(); await writeMeta(); } });

    const fixture = e2eOpenFixture();
    if (fixture) { push(fixture); return; }

    authLog('licence.start', { product: o.product });
    // Signed out is knowable locally: say "sign in" at once; the server's answer replaces it only to say UPDATE.
    void getAccessToken().then(async (token) => {
      if (current.account !== 'unknown') return;
      lastHasToken = Boolean(token);
      if (!token && (await hasSavedSession())) return;
      if (!token && current.account === 'unknown') push({ account: 'signedOut', licence: 'checking', sdk: keystoreAvailable() ? 'ready' : 'unavailable', pending: pendingSignIn });
    }).catch(() => { /* the licence check reports on its own */ });
    licence = startLicence({
      product: o.product,
      version: app.getVersion(),
      ...(o.apiBase ? { apiBase: o.apiBase } : {}),
      getToken: async () => { const token = await getAccessToken(); lastHasToken = Boolean(token); return token; },
      readCache,
      writeCache,
      onChange: (l) => { applying = onLicence(l).catch(() => { /* the door keeps its last state */ }); },
    });
  }

  /** Stop the scheduled re-check and any in-flight sign-in at quit. */
  function stop(): void {
    cancelInteractiveSignIn('quit');
    licence?.stop();
    licence = null;
    scheduleOfflineRetry(false);
  }

  return {
    start, stop, refresh, performIntent,
    state: (): XenoAuthGateState => current,
    getAccessToken, hasSavedSession, authorizeRequest, platformAuthHeaders, identifiedFetch,
    signInInteractive, cancelInteractiveSignIn, signOut, getSessionUser, keystoreAvailable,
    authLogPath: trace.path,
  };
}

export type Door = ReturnType<typeof createDoor>;
