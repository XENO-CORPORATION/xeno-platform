// Frontend billing client — talks to /api/billing (Stripe Checkout → credit ledger).
// Same-origin API; JWT from localStorage ('xenoos_auth_token'), matching authService.

const API_BASE = '/api';

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('xenoos_auth_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function isAuthed(): boolean {
  return !!localStorage.getItem('xenoos_auth_token');
}

export interface BillingItem {
  id: string;
  kind: 'credits' | 'subscription';
  label: string;
  credits: number;
  price: number;        // display amount in `currency` (mirrors the Stripe Price)
  currency: string;     // ISO code, lowercase ('eur')
  interval?: string;
  perSeat?: boolean;
  badge?: string;
  available: boolean;
}

export interface BillingConfig {
  enabled: boolean;
  publishableKey: string;
  currency: string;
  catalog: BillingItem[];
}

/** Public — lets the UI know whether checkout is live and what's purchasable. */
export async function getBillingConfig(): Promise<BillingConfig> {
  try {
    const res = await fetch(`${API_BASE}/billing/config`);
    const data = await res.json();
    return { enabled: !!data.enabled, publishableKey: data.publishableKey || '', currency: (data.currency || 'eur'), catalog: data.catalog || [] };
  } catch {
    return { enabled: false, publishableKey: '', currency: 'eur', catalog: [] };
  }
}

/**
 * Is checkout actually purchasable right now?
 *
 * 🔴 THREE states, not two, and the third is the point. `getBillingConfig()`
 * collapses a network error into `enabled: false`, which is the right default
 * for "can I show a publishable key" and the WRONG one for "should I stop this
 * person buying": a transient fetch failure would tell a paying customer the
 * product is closed for business.
 *
 * So an error is `unknown`, and `unknown` keeps the buy button live. The server
 * is the authority either way — the worst case is the error the user already
 * gets today, instead of a refusal we invented from a dropped request.
 */
export type BillingAvailability = 'live' | 'disabled' | 'unknown';

export async function getBillingAvailability(): Promise<BillingAvailability> {
  try {
    const res = await fetch(`${API_BASE}/billing/config`);
    if (!res.ok) return 'unknown';
    const data = await res.json();
    if (typeof data?.enabled !== 'boolean') return 'unknown';
    return data.enabled ? 'live' : 'disabled';
  } catch {
    return 'unknown';
  }
}
/** Map catalog itemId → live price (for overlaying onto the static pricing tiers). */
export async function getLivePriceMap(): Promise<Record<string, { price: number; currency: string }>> {
  const cfg = await getBillingConfig();
  const map: Record<string, { price: number; currency: string }> = {};
  for (const i of cfg.catalog) map[i.id] = { price: i.price, currency: i.currency || cfg.currency };
  return map;
}

/** Start Stripe Checkout for a catalog item; on success redirects to Stripe. */
export async function startCheckout(itemId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ itemId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.url) {
      window.location.href = data.url;
      return { ok: true };
    }
    return { ok: false, error: data?.error || `Checkout failed (${res.status})` };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Network error' };
  }
}

/** Open the Stripe billing portal (manage/cancel subscription, update card). */
export async function openBillingPortal(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/billing/portal`, { method: 'POST', headers: { ...authHeaders() } });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.url) {
      window.location.href = data.url;
      return { ok: true };
    }
    return { ok: false, error: data?.error || `Could not open billing portal (${res.status})` };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Network error' };
  }
}

export interface Entitlements {
  plan: string;
  commercial: boolean;              // commercial-use license — Pro+
  maxResolution: string;            // 'standard' | '4k' — gates SERVER-SIDE managed generation only
  priority: boolean;                // priority on the managed-inference queue — Pro+
  inHouseDailyLimit: number | null; // null = unlimited (in-house xeno-rt fair-use)
  privateProjects: boolean;         // cloud-stored private projects — Pro+
  teamSeats: number;
  cloudSync: boolean;               // cloud sync + multi-device — Pro+
  crossApp: boolean;                // cross-app workflows — Pro+
  agents: boolean;                  // agents / automation — Pro+
  collaboration: boolean;           // real-time collaboration — Team only
  /** @deprecated (v2): watermarking retired; always false on every tier — never gate on this. */
  watermark: boolean;
}

export interface BillingSummary {
  enabled: boolean;
  plan: string;              // 'free' | 'pro' | 'team'
  status: string;            // 'active' | 'canceled' | 'past_due' | 'none' | ...
  credits: number;
  currentPeriodEnd: string | null;
  entitlements: Entitlements;
}

/** Current user's plan + credit balance + feature entitlements. */
export async function getBillingSummary(): Promise<BillingSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/billing/summary`, { headers: { ...authHeaders() } });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.success === false ? null : d;
  } catch {
    return null;
  }
}
