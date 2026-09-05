// Account Service — calls /api/account/*, /api/billing/*, /api/workspaces/*, /api/projects/*
// All endpoints require authentication (JWT in cookie/header)

// ─── Types ───

export interface AccountOverview {
  user: {
    id: string;
    username: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
    plan: string;
    role: string;
    email_verified: boolean;
    created_at: string;
    last_login: string | null;
  };
  credits: {
    balance: number;
    lifetime_earned: number;
    lifetime_spent: number;
    monthly_allowance: number;
  };
  workspace_count: number;
}

export interface BillingOverview {
  credits: {
    balance: number;
    lifetime_earned: number;
    lifetime_spent: number;
    monthly_allowance: number;
    allowance_reset_date: string | null;
    is_frozen: boolean;
  };
  subscription: {
    id: string;
    plan_name: string;
    status: string;
    monthly_price: number;
    next_billing_date: string | null;
  } | null;
}

export interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PricingTier {
  id: string;
  name: string;
  monthly_price: number;
  credits_included: number;
  features: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  owner_user_id: string;
  workspace_type: 'personal' | 'team';
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  member_role?: string;
  member_count?: number;
}

export interface WorkspaceMember {
  id: string;
  user_id: string;
  member_role: string;
  member_status: string;
  created_at: string;
  user?: {
    username: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export interface OperationalTeam {
  id: string; workspace_id: string; name: string; description: string; version: number;
  projects: Array<{ id: string; name: string; is_archived: boolean }>;
  agents: Array<{ id: string; name: string; status: string }>;
}
export interface WorkspaceTeamsResult {
  teams: OperationalTeam[];
  projects: Array<{ id: string; name: string }>;
  available_agents: Array<{ id: string; name: string }>;
  can_manage: boolean;
}
export interface TeamDraft {
  name: string; description: string; project_ids: string[]; agent_ids: string[]; version?: number;
}
export const getWorkspaceTeams = (workspaceId: string) =>
  apiFetch<WorkspaceTeamsResult>(`/workspaces/${workspaceId}/teams`, { headers: { 'x-xeno-workspace': workspaceId } });
export const saveOperationalTeam = (workspaceId: string, draft: TeamDraft, teamId?: string) =>
  apiFetch<{ id: string }>(`/workspaces/${workspaceId}/teams${teamId ? `/${teamId}` : ''}`, {
    method: teamId ? 'PUT' : 'POST', headers: { 'x-xeno-workspace': workspaceId }, body: JSON.stringify(draft),
  });
export const archiveOperationalTeam = (workspaceId: string, team: OperationalTeam) =>
  apiFetch<{ id: string }>(`/workspaces/${workspaceId}/teams/${team.id}`, {
    method: 'DELETE', headers: { 'x-xeno-workspace': workspaceId }, body: JSON.stringify({ version: team.version }),
  });

export interface WorkspaceInvite {
  id: string;
  workspace_id: string;
  invited_by_user_id: string;
  invited_user_id: string | null;
  invited_email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  workspace_name?: string;
  invited_by_name?: string;
}

export interface Project {
  id: string;
  workspace_id: string | null;
  name: string;
  description: string | null;
  custom_instructions?: string | null;
  settings?: Record<string, unknown>;
  is_archived?: boolean;
  file_count?: number | string;
  chat_count?: number | string;
  capabilities?: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface AccountSession {
  id: string;
  created_at: string;
  last_active_at: string | null;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  current: boolean;
}

// ─── API helpers ───

export const ACCOUNT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AccountApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly remedy?: string;

  constructor(message: string, opts: { status: number; code?: string; remedy?: string }) {
    super(message);
    this.name = 'AccountApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.remedy = opts.remedy;
  }
}

const apiFetch = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  // The backend's authMiddleware authenticates via `Authorization: Bearer <jwt>`
  // (header-only — it does NOT read the session cookie), so attach the same
  // localStorage token the rest of the app uses. Without this, every
  // accountService call (account/billing/workspaces/projects) 401s.
  const token = typeof localStorage !== 'undefined' ? getAccessToken() : null;
  const workspace = typeof localStorage !== 'undefined' ? localStorage.getItem('xeno_active_workspace_id') : null;
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspace && ACCOUNT_UUID_RE.test(workspace) ? { 'x-xeno-workspace': workspace } : {}),
      ...options.headers,
    },
    credentials: 'include',
  });

  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new AccountApiError(`API error ${res.status}. Non-JSON response.`, {
      status: res.status,
    });
  }

  if (!res.ok || !data.success) {
    throw new AccountApiError(
      (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        `API error ${res.status}`,
      {
        status: res.status,
        code: typeof data.code === 'string' ? data.code : undefined,
        remedy: typeof data.remedy === 'string' ? data.remedy : undefined,
      },
    );
  }

  return data as T;
};

// ─── Account ───

export const getAccountOverview = () =>
  apiFetch<{ success: true; overview: AccountOverview }>('/account/overview');

export const getNotifications = () =>
  apiFetch<{ success: true; notifications: Notification[] }>('/account/notifications');

export const getAccountSessions = () =>
  apiFetch<{ success: true; sessions: AccountSession[] }>('/account/sessions');

export const revokeAccountSession = (sessionId: string) =>
  apiFetch<{ success: true; revoked_session_id: string }>(`/account/sessions/${sessionId}`, { method: 'DELETE' });

// ─── Billing ───

export const getBillingOverview = () =>
  apiFetch<{ success: true; overview: BillingOverview }>('/billing/overview');

export const getBillingLedger = (limit = 50, offset = 0) =>
  apiFetch<{ success: true; ledger: LedgerEntry[]; total: number }>(
    `/billing/ledger?limit=${limit}&offset=${offset}`
  );

export const getBillingSubscription = () =>
  apiFetch<{ success: true; subscription: BillingOverview['subscription'] }>('/billing/subscription');

export const getPricingTiers = () =>
  apiFetch<{ success: true; tiers: PricingTier[] }>('/billing/pricing-tiers');

// ─── Workspaces ───

export const listWorkspaces = () =>
  apiFetch<{ success: true; workspaces: Workspace[] }>('/workspaces');

export const createWorkspace = (name: string, type: 'personal' | 'team' = 'team') =>
  apiFetch<{ success: true; workspace: Workspace }>('/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name, workspace_type: type }),
  });

export const selectWorkspace = (workspaceId: string) => {
  if (!ACCOUNT_UUID_RE.test(workspaceId)) {
    return Promise.reject(new AccountApiError('Invalid workspace id', {
      status: 400,
      code: 'invalid_workspace_id',
    }));
  }
  return apiFetch<{ success: true }>(`/workspaces/${workspaceId}/select`, {
    method: 'POST',
  });
};

// ─── Workspace Members ───

export const getWorkspaceMembers = (workspaceId: string) => {
  if (!ACCOUNT_UUID_RE.test(workspaceId)) {
    return Promise.reject(new AccountApiError('Invalid workspace id', {
      status: 400,
      code: 'invalid_workspace_id',
    }));
  }
  return apiFetch<{ success: true; workspace: Workspace; members: WorkspaceMember[] }>(
    `/workspaces/${workspaceId}/members`
  );
};

export const updateWorkspaceMember = (workspaceId: string, memberId: string, role: string) =>
  apiFetch<{ success: true }>(`/workspaces/${workspaceId}/members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ member_role: role }),
  });

export const removeWorkspaceMember = (workspaceId: string, memberId: string) =>
  apiFetch<{ success: true }>(`/workspaces/${workspaceId}/members/${memberId}`, {
    method: 'DELETE',
  });

export const transferOwnership = (workspaceId: string, newOwnerUserId: string) =>
  apiFetch<{ success: true }>(`/workspaces/${workspaceId}/owner-transfer`, {
    method: 'POST',
    body: JSON.stringify({ new_owner_user_id: newOwnerUserId }),
  });

// ─── Workspace Invites ───

export const getWorkspaceInvites = (workspaceId: string) =>
  apiFetch<{ success: true; invites: WorkspaceInvite[] }>(
    `/workspaces/${workspaceId}/invites`
  );

export const inviteToWorkspace = (workspaceId: string, email: string, role = 'member') =>
  apiFetch<{ success: true; invite: WorkspaceInvite }>(`/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });

export const revokeInvite = (workspaceId: string, inviteId: string) =>
  apiFetch<{ success: true }>(`/workspaces/${workspaceId}/invites/${inviteId}`, {
    method: 'DELETE',
  });

export const resendInvite = (workspaceId: string, inviteId: string) =>
  apiFetch<{ success: true }>(`/workspaces/${workspaceId}/invites/${inviteId}/resend`, {
    method: 'POST',
  });

export const listPendingInvites = () =>
  apiFetch<{ success: true; invites: WorkspaceInvite[] }>('/workspace-invites');

export const acceptInvite = (inviteId: string) =>
  apiFetch<{ success: true }>(`/workspace-invites/${inviteId}/accept`, {
    method: 'POST',
  });

export const declineInvite = (inviteId: string) =>
  apiFetch<{ success: true }>(`/workspace-invites/${inviteId}/decline`, {
    method: 'POST',
  });

// ─── Workspace Billing ───

export const getWorkspaceBilling = (workspaceId: string) =>
  apiFetch<{ success: true; billing: Record<string, unknown> }>(
    `/workspaces/${workspaceId}/billing`
  );

export const updateWorkspaceBudget = (workspaceId: string, budget: Record<string, unknown>) =>
  apiFetch<{ success: true }>(`/workspaces/${workspaceId}/budget`, {
    method: 'PATCH',
    body: JSON.stringify(budget),
  });

export const getWorkspaceAudit = (workspaceId: string, limit = 100) =>
  apiFetch<{ success: true; events: Array<Record<string, unknown>> }>(
    `/workspaces/${workspaceId}/audit?limit=${limit}`
  );

// ─── Projects ───

export const listProjects = (workspaceId?: string) =>
  apiFetch<{ success: true; projects: Project[] }>(
    `/chat/projects${workspaceId ? `?workspace_id=${workspaceId}` : ''}`
  );

export const createProject = (name: string, workspaceId: string, description?: string) =>
  apiFetch<{ success: true; project: Project }>('/chat/projects', {
    method: 'POST',
    body: JSON.stringify({ name, workspace_id: workspaceId, description }),
  });

export const updateProject = (projectId: string, updates: { name?: string; description?: string; custom_instructions?: string; settings?: Record<string, unknown>; is_archived?: boolean }) =>
  apiFetch<{ success: true; project: Project }>(`/chat/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });

export const updateWorkspace = (workspaceId: string, updates: { name?: string; slug?: string }) =>
  apiFetch<{ success: true; workspace: Workspace }>(`/workspaces/${workspaceId}`, {
    method: 'PATCH', body: JSON.stringify(updates),
  });

export const archiveProject = (projectId: string) =>
  apiFetch<{ success: true }>(`/chat/projects/${projectId}`, { method: 'DELETE' });
import { getAccessToken } from '../lib/authSession';
