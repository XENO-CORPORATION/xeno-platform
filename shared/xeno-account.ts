/**
 * @xeno/account — the SHARED account / entitlements / billing client.
 *
 * CANONICAL. Every XENO product uses THIS to talk to the central account system
 * in xeno-platform — products do NOT build their own billing, subscriptions, or
 * credit ledger (see XENO-MONETIZATION-AND-ACCOUNT.md). Framework-agnostic: works
 * in web, Electron (main or renderer), and Node/CLI. The product supplies its own
 * auth-token getter; everything else is handled here.
 *
 * Usage:
 *   import { createXenoAccount } from './xeno-account';
 *   const account = createXenoAccount({ getToken: () => localStorage.getItem('xenoos_auth_token') });
 *   const ent = await account.getEntitlements();
 *   if (ent?.entitlements.watermark) applyWatermark();          // Free tier
 *   if (!(await account.can('commercial'))) blockCommercialExport();
 *   // Send users to manage/upgrade:
 *   window.open(account.billingUrl, '_blank');
 */

export interface Entitlements {
  plan: string;                 // 'free' | 'pro' | 'team'
  watermark: boolean;           // true → outputs must be watermarked
  commercial: boolean;          // commercial-use license
  maxResolution: string;        // 'standard' | '4k'
  priority: boolean;            // priority generation queue
  inHouseDailyLimit: number | null; // null = unlimited (in-house xeno-rt models)
  privateProjects: boolean;
  teamSeats: number;
}

export interface AccountSummary {
  enabled: boolean;
  plan: string;
  status: string;               // 'active' | 'canceled' | 'past_due' | 'none' | ...
  credits: number;
  currentPeriodEnd: string | null;
  entitlements: Entitlements;
}

export interface XenoAccountConfig {
  /** Central account API host. Default: https://xenostudio.ai */
  apiBase?: string;
  /** Where to send users for plan/credit management. Default: <apiBase>/overview/billing */
  billingUrl?: string;
  /** Return the current user's auth token (Bearer). Sync or async. */
  getToken: () => string | null | undefined | Promise<string | null | undefined>;
  /** Optional fetch impl (Node < 18 / custom). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const FREE: Entitlements = {
  plan: 'free', watermark: true, commercial: false, maxResolution: 'standard',
  priority: false, inHouseDailyLimit: 50, privateProjects: false, teamSeats: 0,
};

export function createXenoAccount(cfg: XenoAccountConfig) {
  const base = (cfg.apiBase || 'https://xenostudio.ai').replace(/\/$/, '');
  const billingUrl = cfg.billingUrl || `${base}/overview/billing`;
  const f = cfg.fetchImpl || (globalThis.fetch as typeof fetch);

  async function headers(): Promise<Record<string, string>> {
    const t = await cfg.getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function get<T>(path: string): Promise<T | null> {
    try {
      const res = await f(`${base}/api/billing${path}`, { headers: await headers() });
      if (!res.ok) return null;
      const d = await res.json();
      return d?.success === false ? null : (d as T);
    } catch { return null; }
  }

  async function post(path: string, body?: unknown): Promise<{ ok: boolean; url?: string; error?: string }> {
    try {
      const res = await f(`${base}/api/billing${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await headers()) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.url) return { ok: true, url: d.url };
      return { ok: false, error: d?.error || `Request failed (${res.status})` };
    } catch (e) { return { ok: false, error: (e as Error).message || 'Network error' }; }
  }

  return {
    billingUrl,

    /** Full account summary — plan, credit balance, entitlements. Null if signed out/unreachable. */
    getSummary: () => get<AccountSummary>('/summary'),

    /** The user's plan + feature entitlements (defaults to FREE if unreachable). */
    async getEntitlements(): Promise<AccountSummary> {
      const r = await get<AccountSummary>('/entitlements');
      return r ?? { enabled: false, plan: 'free', status: 'none', credits: 0, currentPeriodEnd: null, entitlements: FREE };
    },

    /** Convenience gate: `await account.can('commercial')`, `can('priority')`, `can('watermarkFree')`, `can('4k')`. */
    async can(feature: 'commercial' | 'priority' | 'watermarkFree' | '4k' | 'privateProjects'): Promise<boolean> {
      const e = (await this.getEntitlements()).entitlements;
      switch (feature) {
        case 'commercial': return e.commercial;
        case 'priority': return e.priority;
        case 'watermarkFree': return !e.watermark;
        case '4k': return e.maxResolution === '4k';
        case 'privateProjects': return e.privateProjects;
        default: return false;
      }
    },

    /** Current credit balance (for premium/marketplace metering). */
    async getCredits(): Promise<number> {
      const s = await get<AccountSummary>('/summary');
      return s?.credits ?? 0;
    },

    /** Start a Checkout for a plan or credit pack; returns the Stripe URL for the product to open/redirect. */
    startCheckout: (itemId: string) => post('/checkout', { itemId }),

    /** Open the Stripe billing portal (manage/cancel/update card); returns the URL to open. */
    openPortal: () => post('/portal'),
  };
}

export type XenoAccount = ReturnType<typeof createXenoAccount>;
