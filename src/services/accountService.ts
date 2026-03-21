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
  workspace_id: string;
  name: string;
  description: string | null;
  status: string;
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

// ─── API helpers ───

const apiFetch = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.error || data.message || `API error ${res.status}`);
  }

  return data;
};

// ─── Account ───

export const getAccountOverview = () =>
  apiFetch<{ success: true; overview: AccountOverview }>('/account/overview');

export const getNotifications = () =>
  apiFetch<{ success: true; notifications: Notification[] }>('/account/notifications');

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

export const selectWorkspace = (workspaceId: string) =>
  apiFetch<{ success: true }>(`/workspaces/${workspaceId}/select`, {
    method: 'POST',
  });

// ─── Workspace Members ───

export const getWorkspaceMembers = (workspaceId: string) =>
  apiFetch<{ success: true; workspace: Workspace; members: WorkspaceMember[] }>(
    `/workspaces/${workspaceId}/members`
  );

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
    `/projects${workspaceId ? `?workspace_id=${workspaceId}` : ''}`
  );

export const createProject = (name: string, workspaceId: string, description?: string) =>
  apiFetch<{ success: true; project: Project }>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, workspace_id: workspaceId, description }),
  });

export const updateProject = (projectId: string, updates: { name?: string; description?: string; status?: string }) =>
  apiFetch<{ success: true; project: Project }>(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
