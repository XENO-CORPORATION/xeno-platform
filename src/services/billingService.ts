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
  usd: number;
  interval?: string;
  badge?: string;
  available: boolean;
}

export interface BillingConfig {
  enabled: boolean;
  publishableKey: string;
  catalog: BillingItem[];
}

/** Public — lets the UI know whether checkout is live and what's purchasable. */
export async function getBillingConfig(): Promise<BillingConfig> {
  try {
    const res = await fetch(`${API_BASE}/billing/config`);
    const data = await res.json();
    return { enabled: !!data.enabled, publishableKey: data.publishableKey || '', catalog: data.catalog || [] };
  } catch {
    return { enabled: false, publishableKey: '', catalog: [] };
  }
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
  watermark: boolean;
  commercial: boolean;
  maxResolution: string;
  priority: boolean;
  inHouseDailyLimit: number | null; // null = unlimited
  privateProjects: boolean;
  teamSeats: number;
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
