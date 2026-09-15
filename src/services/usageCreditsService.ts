import { getAccessToken } from '../lib/authSession';

export interface AccountQuota {
  metered: boolean;
  plan: string;
  usedPercent: number;
  resetsAt: string;
  exhausted: boolean;
  usageCreditsEnabled: boolean;
  usageCreditsBalance: number;
  canManageUsageCredits: boolean;
}

function parseQuota(value: unknown): AccountQuota {
  const q = value as Partial<AccountQuota> | null;
  if (!q || typeof q.metered !== 'boolean' || typeof q.plan !== 'string'
    || typeof q.usedPercent !== 'number' || !Number.isFinite(q.usedPercent)
    || q.usedPercent < 0 || q.usedPercent > 100
    || typeof q.resetsAt !== 'string' || !Number.isFinite(Date.parse(q.resetsAt))
    || typeof q.exhausted !== 'boolean' || typeof q.usageCreditsEnabled !== 'boolean'
    || typeof q.usageCreditsBalance !== 'number' || !Number.isFinite(q.usageCreditsBalance)
    || q.usageCreditsBalance < 0 || typeof q.canManageUsageCredits !== 'boolean') {
    throw new Error('Usage settings could not be confirmed. Please refresh.');
  }
  return q as AccountQuota;
}

async function requestQuota(path: string, init: RequestInit = {}): Promise<AccountQuota> {
  const token = getAccessToken();
  const response = await fetch(`/api/v2/ledger/${path}`, {
    ...init, credentials: 'same-origin', cache: 'no-store',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error?.message === 'string' ? body.error.message : 'Could not update or load usage settings. Please try again.');
  return parseQuota(body);
}

export const getAccountQuota = (): Promise<AccountQuota> => requestQuota('quota');
export const setUsageCreditsEnabled = (enabled: boolean): Promise<AccountQuota> => requestQuota('usage-credits', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
});
