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
 *   if (await account.can('cloudSync')) enableCloudSync();       // Pro+ (Platform)
 *   if (!(await account.can('commercial'))) blockCommercialExport();
 *   // Send users to manage/upgrade:
 *   window.open(account.billingUrl, '_blank');
 */

export interface Entitlements {
  plan: string;                 // 'free' | 'pro' | 'team'
  commercial: boolean;          // commercial-use LICENSE (a legal term, not a tech gate) — Pro+
  maxResolution: string;        // 'standard' | '4k' — gates SERVER-SIDE managed generation only (NOT local export)
  priority: boolean;            // priority on the managed-inference queue — Pro+
  inHouseDailyLimit: number | null; // null = unlimited (in-house xeno-rt fair-use daily cap)
  privateProjects: boolean;     // cloud-stored private projects — Pro+
  teamSeats: number;
  cloudSync: boolean;           // cloud sync + multi-device — Pro+
  crossApp: boolean;            // cross-app workflows — Pro+
  agents: boolean;              // agents / automation — Pro+
  collaboration: boolean;       // real-time collaboration — Team only
  /** @deprecated (v2): watermarking retired; always false on every tier — never gate on this. */
  watermark: boolean;
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
  plan: 'free', commercial: false, maxResolution: 'standard', priority: false,
  inHouseDailyLimit: 50, privateProjects: false, teamSeats: 0,
  cloudSync: false, crossApp: false, agents: false, collaboration: false,
  watermark: false, // deprecated (v2): watermarking retired; always false — never gate on this
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

    /** Convenience gate: `await account.can('commercial')`, `can('priority')`, `can('cloudSync')`, `can('4k')`. */
    async can(feature: 'commercial' | 'priority' | 'watermarkFree' | '4k' | 'privateProjects' | 'cloudSync' | 'crossApp' | 'agents' | 'collaboration'): Promise<boolean> {
      const e = (await this.getEntitlements()).entitlements;
      switch (feature) {
        case 'commercial': return e.commercial;
        case 'priority': return e.priority;
        case 'watermarkFree': return !e.watermark; // deprecated (v2): always true — watermarking retired
        case '4k': return e.maxResolution === '4k';
        case 'privateProjects': return e.privateProjects;
        case 'cloudSync': return e.cloudSync;
        case 'crossApp': return e.crossApp;
        case 'agents': return e.agents;
        case 'collaboration': return e.collaboration;
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
