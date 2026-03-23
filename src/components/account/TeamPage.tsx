import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Building2, UserPlus, Mail, Clock, Loader2, RefreshCw, ChevronDown, X, AlertTriangle,
  Search, Shield, Copy, Check, Link2, Settings, Activity, Crown, Users, UserCheck,
  MoreHorizontal, ChevronRight, Trash2, Key, Globe, Lock, Download, Monitor, Smartphone,
  ArrowUpDown, Fingerprint, LogOut, RotateCcw, Server, Layers, Tags,
  Bell, Zap, CheckSquare, Square, MinusSquare,
} from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  getWorkspaceMembers, inviteToWorkspace, getWorkspaceInvites, revokeInvite,
  updateWorkspaceMember, removeWorkspaceMember, transferOwnership,
  type WorkspaceMember, type WorkspaceInvite,
} from '../../services/accountService';

// ─── Extended types ───

interface MemberExtra { last_active: string; has_2fa: boolean; login_method: 'password' | 'sso' | 'github' | 'google'; credits_used: number; }
interface SessionEntry { id: string; user_id: string; user_name: string; device: string; ip: string; location: string; last_active: string; current?: boolean; }
interface TeamGroup { id: string; name: string; member_ids: string[]; }
interface CustomRole { id: string; name: string; permissions: string[]; builtin: boolean; }
interface ApiKeyEntry { id: string; name: string; prefix: string; created_at: string; last_used: string | null; scopes: string[]; }
interface AuditEntry { id: string; action: string; actor: string; target?: string; ts: string; }

// ─── Dev fallback data ───

const now = Date.now();
const day = 86_400_000;

const DEV_MEMBER_EXTRA: Record<string, MemberExtra> = {
  m1: { last_active: new Date(now - 300_000).toISOString(), has_2fa: true, login_method: 'password', credits_used: 4200 },
  m2: { last_active: new Date(now - 3_600_000).toISOString(), has_2fa: true, login_method: 'sso', credits_used: 2300 },
  m3: { last_active: new Date(now - day * 2).toISOString(), has_2fa: false, login_method: 'google', credits_used: 890 },
  m4: { last_active: new Date(now - day * 5).toISOString(), has_2fa: true, login_method: 'github', credits_used: 450 },
  m5: { last_active: new Date(now - 7200_000).toISOString(), has_2fa: true, login_method: 'sso', credits_used: 1800 },
  m6: { last_active: new Date(now - day).toISOString(), has_2fa: false, login_method: 'password', credits_used: 120 },
};

const DEV_MEMBERS: WorkspaceMember[] = [
  { id: 'm1', user_id: 'u1', member_role: 'owner', member_status: 'active', created_at: new Date(now - day * 90).toISOString(), user: { username: 'emilian', email: 'emilian@bnkrsys.com', display_name: 'Emilian', avatar_url: null } },
  { id: 'm2', user_id: 'u2', member_role: 'admin', member_status: 'active', created_at: new Date(now - day * 60).toISOString(), user: { username: 'alex', email: 'alex@xeno.dev', display_name: 'Alex Mercer', avatar_url: null } },
  { id: 'm3', user_id: 'u3', member_role: 'member', member_status: 'active', created_at: new Date(now - day * 30).toISOString(), user: { username: 'maria', email: 'maria@xeno.dev', display_name: 'Maria Silva', avatar_url: null } },
  { id: 'm4', user_id: 'u4', member_role: 'member', member_status: 'active', created_at: new Date(now - day * 20).toISOString(), user: { username: 'james', email: 'james@xeno.dev', display_name: 'James Chen', avatar_url: null } },
  { id: 'm5', user_id: 'u5', member_role: 'admin', member_status: 'active', created_at: new Date(now - day * 15).toISOString(), user: { username: 'sofia', email: 'sofia@xeno.dev', display_name: 'Sofia Petrov', avatar_url: null } },
  { id: 'm6', user_id: 'u6', member_role: 'member', member_status: 'active', created_at: new Date(now - day * 7).toISOString(), user: { username: 'daniel', email: 'daniel@xeno.dev', display_name: 'Daniel Kim', avatar_url: null } },
];

const DEV_INVITES: WorkspaceInvite[] = [
  { id: 'inv-1', workspace_id: 'ws-team', invited_by_user_id: 'u1', invited_user_id: null, invited_email: 'stefan@xeno.dev', role: 'member', status: 'pending', created_at: new Date(now - day * 2).toISOString(), expires_at: new Date(now + day * 5).toISOString() },
  { id: 'inv-2', workspace_id: 'ws-team', invited_by_user_id: 'u2', invited_user_id: null, invited_email: 'olga@xeno.dev', role: 'admin', status: 'pending', created_at: new Date(now - day).toISOString(), expires_at: new Date(now + day * 6).toISOString() },
];

const DEV_SESSIONS: SessionEntry[] = [
  { id: 's1', user_id: 'u1', user_name: 'Emilian', device: 'Chrome · macOS', ip: '82.14.210.33', location: 'London, UK', last_active: new Date(now - 300_000).toISOString(), current: true },
  { id: 's2', user_id: 'u1', user_name: 'Emilian', device: 'Safari · iPhone', ip: '82.14.210.34', location: 'London, UK', last_active: new Date(now - day).toISOString() },
  { id: 's3', user_id: 'u2', user_name: 'Alex Mercer', device: 'Firefox · Windows', ip: '91.23.44.12', location: 'Berlin, DE', last_active: new Date(now - 3_600_000).toISOString() },
  { id: 's4', user_id: 'u5', user_name: 'Sofia Petrov', device: 'Chrome · Linux', ip: '185.12.7.88', location: 'Sofia, BG', last_active: new Date(now - 7200_000).toISOString() },
];

const DEV_TEAMS: TeamGroup[] = [
  { id: 't1', name: 'Engineering', member_ids: ['u1', 'u2', 'u4'] },
  { id: 't2', name: 'Design', member_ids: ['u3', 'u5'] },
  { id: 't3', name: 'Operations', member_ids: ['u6'] },
];

const DEV_ROLES: CustomRole[] = [
  { id: 'r1', name: 'Owner', permissions: ['*'], builtin: true },
  { id: 'r2', name: 'Admin', permissions: ['invite', 'remove', 'settings', 'billing', 'api_keys'], builtin: true },
  { id: 'r3', name: 'Member', permissions: ['view', 'use_api'], builtin: true },
  { id: 'r4', name: 'Developer', permissions: ['view', 'use_api', 'api_keys', 'invite'], builtin: false },
  { id: 'r5', name: 'Billing Admin', permissions: ['view', 'billing', 'settings'], builtin: false },
];

const DEV_API_KEYS: ApiKeyEntry[] = [
  { id: 'k1', name: 'Production', prefix: 'xk-...a3f7', created_at: new Date(now - day * 30).toISOString(), last_used: new Date(now - 600_000).toISOString(), scopes: ['read', 'write'] },
  { id: 'k2', name: 'Staging', prefix: 'xk-...b2c1', created_at: new Date(now - day * 15).toISOString(), last_used: new Date(now - day * 2).toISOString(), scopes: ['read', 'write'] },
  { id: 'k3', name: 'CI/CD', prefix: 'xk-...f1a2', created_at: new Date(now - day * 7).toISOString(), last_used: null, scopes: ['read'] },
];

const DEV_AUDIT: AuditEntry[] = [
  { id: 'a1', action: 'invited', actor: 'Emilian', target: 'stefan@xeno.dev', ts: new Date(now - day * 2).toISOString() },
  { id: 'a2', action: 'role_changed', actor: 'Emilian', target: 'Sofia Petrov → admin', ts: new Date(now - day * 5).toISOString() },
  { id: 'a3', action: 'joined', actor: 'Daniel Kim', ts: new Date(now - day * 7).toISOString() },
  { id: 'a4', action: 'invited', actor: 'Alex Mercer', target: 'olga@xeno.dev', ts: new Date(now - day).toISOString() },
  { id: 'a5', action: 'removed', actor: 'Emilian', target: 'tom@xeno.dev', ts: new Date(now - day * 12).toISOString() },
  { id: 'a6', action: 'settings_changed', actor: 'Emilian', target: 'workspace name', ts: new Date(now - day * 20).toISOString() },
  { id: 'a7', action: 'sso_enabled', actor: 'Emilian', ts: new Date(now - day * 25).toISOString() },
  { id: 'a8', action: 'api_key_created', actor: 'Alex Mercer', target: 'Production key', ts: new Date(now - day * 30).toISOString() },
];

const ALL_PERMISSIONS = ['view', 'use_api', 'invite', 'remove', 'settings', 'billing', 'api_keys', 'audit'] as const;

// ─── Color tokens — aligned with BillingPage ───

const C = {
  bg:           'transparent',                   // page inherits app background
  surface1:     'rgba(0,0,0,0.90)',              // container bg — matches sidebar bg-black/90
  surface2:     'rgba(0,0,0,0.85)',              // panel body — slightly lighter than containers
  surface3:     'rgba(255,255,255,0.06)',         // panel heading — subtle lift inside panels
  border:       'rgba(255,255,255,0.08)',         // standard border
  borderStrong: 'rgba(255,255,255,0.15)',         // strong dividers
  rowHover:     'rgba(255,255,255,0.05)',         // row hover
  textPrimary:  'rgba(255,255,255,0.90)',         // headings
  textBody:     'rgba(255,255,255,0.70)',         // body text
  textSecondary:'rgba(255,255,255,0.40)',         // secondary text
  textTertiary: 'rgba(255,255,255,0.22)',         // tertiary/label text
  textDim:      'rgba(255,255,255,0.12)',         // timestamps
  iconDim:      'rgba(255,255,255,0.25)',         // dim icons
  positive:     'rgba(255,255,255,0.60)',         // positive values
  negative:     'rgba(255,255,255,0.30)',         // negative values
  ghost:        'rgba(255,255,255,0.08)',         // ghost button bg
  ghostHover:   'rgba(255,255,255,0.15)',         // ghost button hover
  error:        { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.12)', text: 'rgba(239,68,68,0.65)' },
  destructive:  { border: 'rgba(239,68,68,0.15)', text: 'rgba(239,68,68,0.4)', textHover: 'rgba(239,68,68,0.7)', bgHover: 'rgba(239,68,68,0.08)' },
};

const S = {
  panelHeading: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 10px', height: 34, flexShrink: 0,
    background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6,
  } as React.CSSProperties,
  headingLabel: {
    fontSize: 10, fontWeight: 600, color: C.textSecondary,
    textTransform: 'uppercase', letterSpacing: '0.04em',
  } as React.CSSProperties,
  headingMeta: {
    fontSize: 10, color: C.textDim, fontVariantNumeric: 'tabular-nums',
  } as React.CSSProperties,
  panel: {
    display: 'flex', flexDirection: 'column', gap: 4,
  } as React.CSSProperties,
  panelBody: {
    background: C.surface1, border: `1px solid ${C.border}`,
    borderRadius: 6, overflow: 'hidden', flex: 1,
  } as React.CSSProperties,
  badge: {
    fontSize: 9, padding: '1px 5px', borderRadius: 2,
    background: C.ghost, color: C.textSecondary,
    fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em',
  } as React.CSSProperties,
};

const ghostBtn = (disabled = false): React.CSSProperties => ({
  height: 28, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6,
  background: C.ghost, border: 'none', borderRadius: 4,
  color: C.textSecondary, fontSize: 11, fontWeight: 500, cursor: 'pointer',
  opacity: disabled ? 0.3 : 1, transition: 'background-color 80ms ease',
});

const primaryBtn = (disabled = false): React.CSSProperties => ({
  height: 28, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
  background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: 4,
  color: '#09090b', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  opacity: disabled ? 0.3 : 1, transition: 'background-color 80ms ease',
});

const hover = {
  ghost: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = C.ghostHover; },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = C.ghost; },
  },
  row: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = C.rowHover; },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent'; },
  },
  primary: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'rgba(255,255,255,0.8)'; },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'rgba(255,255,255,0.9)'; },
  },
  destructive: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = C.destructive.bgHover; e.currentTarget.style.color = C.destructive.textHover; },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.destructive.text; },
  },
};

// ─── Helpers ───

const roleBadge = (role: string) => {
  const opacity: Record<string, string> = {
    owner: C.textBody,       // brightest — stands out
    admin: C.textSecondary,  // medium
    member: C.textTertiary,  // dimmest
  };
  return <span style={{ ...S.badge, color: opacity[role] || C.textTertiary }}>{role}</span>;
};

const roleIcon = (role: string) => {
  if (role === 'owner') return <Crown size={10} style={{ color: C.textBody }} />;
  if (role === 'admin') return <Shield size={10} style={{ color: C.textSecondary }} />;
  return <Users size={10} style={{ color: C.textTertiary }} />;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const timeAgo = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

const formatRelative = timeAgo;

const actionLabel: Record<string, string> = {
  invited: 'Sent invite to', role_changed: 'Changed role', joined: 'Joined workspace',
  removed: 'Removed', settings_changed: 'Updated', left: 'Left workspace',
  sso_enabled: 'Enabled SSO', sso_disabled: 'Disabled SSO', api_key_created: 'Created API key',
  api_key_revoked: 'Revoked API key', session_revoked: 'Revoked session',
};

const loginMethodLabel: Record<string, string> = { password: 'Password', sso: 'SSO', github: 'GitHub', google: 'Google' };

type RoleFilter = 'all' | 'owner' | 'admin' | 'member';
type SortField = 'name' | 'role' | 'joined' | 'last_active' | 'usage';
type SortDir = 'asc' | 'desc';

// ─── Skeleton ───

const Skeleton: React.FC = () => (
  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
    <Loader2 size={18} className="animate-spin" style={{ color: C.textDim }} />
  </div>
);

// ─── Component ───

const TeamPage: React.FC = () => {
  const { activeWorkspace, isOwner, userRole } = useWorkspace();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // UI state
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [showTransferConfirm, setShowTransferConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const searchRef = useRef<HTMLInputElement>(null);

  // Sidebar panels
  const [invitesOpen, setInvitesOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [inviteLinkOpen, setInviteLinkOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [ssoOpen, setSsoOpen] = useState(false);
  const [scimOpen, setScimOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);

  // SSO/SAML state
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoIdpUrl, setSsoIdpUrl] = useState('');
  const [ssoCert, setSsoCert] = useState('');
  const [ssoEntityId, setSsoEntityId] = useState('');

  // SCIM state
  const [scimEnabled, setScimEnabled] = useState(false);
  const [scimToken] = useState('xk-scim-' + Math.random().toString(36).slice(2, 14));
  const [scimTokenCopied, setScimTokenCopied] = useState(false);

  // Sessions
  const [sessions] = useState<SessionEntry[]>(DEV_SESSIONS);

  // Custom roles
  const [roles, setRoles] = useState<CustomRole[]>(DEV_ROLES);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState('');

  // Bulk actions
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);

  // Settings state
  const [wsName, setWsName] = useState('');
  const [wsSlug, setWsSlug] = useState('');

  // Security toggles
  const [enforce2fa, setEnforce2fa] = useState(false);
  const [restrictDomains, setRestrictDomains] = useState(false);
  const [allowedDomain, setAllowedDomain] = useState('xeno.dev');

  // Invite link
  const [inviteLink] = useState(`https://xeno.dev/invite/xk-${Math.random().toString(36).slice(2, 10)}`);
  const [linkCopied, setLinkCopied] = useState(false);

  // Audit
  const [audit] = useState<AuditEntry[]>(DEV_AUDIT);

  // Delete confirm
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const wsId = activeWorkspace?.id;
  const canManage = isOwner || userRole === 'admin';

  const loadData = useCallback(async (refresh = false) => {
    if (!wsId) return;
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);
    try {
      const [membersRes, invitesRes] = await Promise.allSettled([
        getWorkspaceMembers(wsId), getWorkspaceInvites(wsId),
      ]);
      if (membersRes.status === 'fulfilled') setMembers(membersRes.value.members);
      else throw new Error('members');
      if (invitesRes.status === 'fulfilled') setInvites(invitesRes.value.invites);
    } catch {
      console.warn('[TeamPage] API unavailable, using fallback data');
      setMembers(DEV_MEMBERS);
      setInvites(DEV_INVITES);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [wsId]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (activeWorkspace) {
      setWsName(activeWorkspace.name);
      setWsSlug(activeWorkspace.slug ?? '');
    }
  }, [activeWorkspace]);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); loadData(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loadData]);

  const handleInvite = async () => {
    if (!wsId || !inviteEmail.trim()) return;
    setIsInviting(true); setInviteError(null);
    try {
      await inviteToWorkspace(wsId, inviteEmail.trim(), inviteRole);
      setInviteEmail(''); setShowInviteForm(false);
      await loadData(true);
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally { setIsInviting(false); }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!wsId) return;
    try { await revokeInvite(wsId, inviteId); } catch { /* fallback */ }
    setInvites(prev => prev.filter(i => i.id !== inviteId));
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    if (!wsId) return;
    try { await updateWorkspaceMember(wsId, memberId, newRole); } catch { /* fallback */ }
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, member_role: newRole } : m));
    setEditingMember(null);
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!wsId) return;
    try { await removeWorkspaceMember(wsId, memberId); } catch { /* fallback */ }
    setMembers(prev => prev.filter(m => m.id !== memberId));
  };

  const handleTransferOwnership = async (newOwnerUserId: string) => {
    if (!wsId) return;
    try { await transferOwnership(wsId, newOwnerUserId); await loadData(true); } catch { /* */ }
    setShowTransferConfirm(null);
  };

  // Filtered members
  const filteredMembers = useMemo(() => {
    let result = members;
    if (roleFilter !== 'all') result = result.filter(m => m.member_role === roleFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(m =>
        (m.user?.display_name || '').toLowerCase().includes(q) ||
        (m.user?.email || '').toLowerCase().includes(q) ||
        (m.user?.username || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [members, roleFilter, search]);

  // Stats
  const stats = useMemo(() => ({
    total: members.length,
    active: members.filter(m => m.member_status === 'active').length,
    admins: members.filter(m => m.member_role === 'admin' || m.member_role === 'owner').length,
    pending: invites.length,
  }), [members, invites]);

  const filterCounts = useMemo(() => ({
    all: members.length,
    owner: members.filter(m => m.member_role === 'owner').length,
    admin: members.filter(m => m.member_role === 'admin').length,
    member: members.filter(m => m.member_role === 'member').length,
  }), [members]);

  if (isLoading) return <Skeleton />;

  if (!activeWorkspace || activeWorkspace.workspace_type !== 'team') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <div style={{ textAlign: 'center' }}>
          <Building2 size={28} style={{ color: C.ghost, margin: '0 auto 8px' }} />
          <p style={{ fontSize: 12, color: C.textSecondary, margin: 0 }}>Switch to a team workspace to manage members</p>
        </div>
      </div>
    );
  }

  const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
    <button onClick={() => onChange(!value)} style={{
      width: 28, height: 14, borderRadius: 7, border: 'none', cursor: 'pointer',
      background: value ? 'rgba(255,255,255,0.25)' : C.border,
      position: 'relative', transition: 'background 150ms ease', padding: 0,
    }}>
      <div style={{
        width: 10, height: 10, borderRadius: '50%',
        background: value ? C.textPrimary : C.textDim,
        position: 'absolute', top: 2, left: value ? 16 : 2,
        transition: 'left 150ms ease, background 150ms ease',
      }} />
    </button>
  );

  return (
    <div style={{
      height: '100%', background: C.bg,
      display: 'grid', gridTemplateRows: 'auto auto 1fr',
      overflow: 'hidden',
    }}>

      {/* ═══ Row 1: Header + Invite form ═══ */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 10px', height: 34,
            background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6,
          }}>
            <h1 style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, margin: 0 }}>Team</h1>
            <span style={{ fontSize: 10, color: C.textTertiary }}>·</span>
            <span style={{ fontSize: 10, color: C.textTertiary }}>Members, roles &amp; permissions</span>
          </div>
          {canManage && (
            <button
              onClick={() => setShowInviteForm(!showInviteForm)}
              style={{
                height: 34, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6,
                background: C.surface1, border: `1px solid ${showInviteForm ? C.borderStrong : C.border}`, borderRadius: 6,
                color: showInviteForm ? C.textPrimary : C.textSecondary, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                transition: 'color 80ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = C.textPrimary; }}
              onMouseLeave={e => { e.currentTarget.style.color = showInviteForm ? C.textPrimary : C.textSecondary; }}
            >
              <UserPlus size={11} />
              {showInviteForm ? 'Cancel' : 'Invite'}
            </button>
          )}
          <button onClick={() => loadData(true)} disabled={isRefreshing} style={{
            height: 34, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6,
            background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.textSecondary, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            opacity: isRefreshing ? 0.3 : 1, transition: 'color 80ms ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.color = C.textPrimary; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.textSecondary; }}
          >
            <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Invite form */}
        {showInviteForm && canManage && (
          <div style={{ marginTop: 6, padding: '8px 10px', background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                placeholder="Email address" autoFocus
                style={{
                  flex: 1, height: 28, padding: '0 8px', boxSizing: 'border-box',
                  background: C.bg, border: `1px solid ${C.border}`,
                  borderRadius: 4, color: C.textBody, fontSize: 12, outline: 'none',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = C.borderStrong; }}
                onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
                onKeyDown={e => { if (e.key === 'Enter') handleInvite(); }}
              />
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{
                height: 28, padding: '0 8px', background: C.bg, border: `1px solid ${C.border}`,
                borderRadius: 4, color: C.textSecondary, fontSize: 11, outline: 'none', cursor: 'pointer',
              }}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button onClick={handleInvite} disabled={isInviting || !inviteEmail.trim()} style={primaryBtn(isInviting || !inviteEmail.trim())} {...hover.primary}>
                {isInviting ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                Send
              </button>
            </div>
            {inviteError && <div style={{ fontSize: 11, color: C.error.text, marginTop: 4 }}>{inviteError}</div>}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 6, padding: '5px 10px', borderRadius: 4, background: C.error.bg, border: `1px solid ${C.error.border}`, color: C.error.text, fontSize: 11 }}>
            {error}
          </div>
        )}
      </div>

      {/* ═══ Row 2: Stats ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 6 }}>
        {([
          { icon: <Users size={11} style={{ color: C.iconDim }} />, label: 'Total Members', value: stats.total, sub: 'in workspace' },
          { icon: <UserCheck size={11} style={{ color: C.iconDim }} />, label: 'Active', value: stats.active, sub: 'online' },
          { icon: <Shield size={11} style={{ color: C.iconDim }} />, label: 'Admins', value: stats.admins, sub: 'with elevated access' },
          { icon: <Mail size={11} style={{ color: C.iconDim }} />, label: 'Pending', value: stats.pending, sub: `invite${stats.pending !== 1 ? 's' : ''}` },
        ] as const).map((stat) => (
          <div key={stat.label} style={{ background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              {stat.icon}
              <span style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>{stat.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{stat.value}</span>
              <span style={{ fontSize: 9, color: C.textDim }}>{stat.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ═══ Row 3: Members list + sidebar ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 6, margin: '6px 0 0', minHeight: 0 }}>

        {/* ── Members List ── */}
        <div style={{ ...S.panel, minHeight: 0 }}>
          <div style={S.panelHeading}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={S.headingLabel}>Members</span>
              {/* Role filter tabs */}
              <div style={{ display: 'flex', gap: 0 }}>
                {(['all', 'owner', 'admin', 'member'] as RoleFilter[]).map(f => {
                  const active = roleFilter === f;
                  return (
                    <button key={f} onClick={() => setRoleFilter(f)} style={{
                      height: 24, padding: '0 10px', fontSize: 9, fontWeight: 500,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      borderBottom: active ? '2px solid rgba(255,255,255,0.5)' : '2px solid transparent',
                      color: active ? C.textBody : C.textTertiary,
                      textTransform: 'uppercase', letterSpacing: '0.03em',
                      transition: 'all 80ms ease', display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                      {f}
                      <span style={{
                        fontSize: 8, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                        color: active ? C.textSecondary : C.textDim,
                        background: active ? C.ghost : 'transparent',
                        borderRadius: 3, padding: '1px 4px', transition: 'all 80ms ease',
                      }}>
                        {filterCounts[f]}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Search */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.bg, borderRadius: 3, padding: '0 6px', height: 22, marginLeft: 'auto' }}>
                <Search size={10} style={{ color: C.textTertiary, flexShrink: 0 }} />
                <input
                  ref={searchRef}
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search… ( / )"
                  style={{
                    background: 'none', border: 'none', outline: 'none',
                    fontSize: 10, color: C.textBody, width: 90, padding: 0, height: '100%',
                  }}
                />
              </div>
            </div>
            <span style={S.headingMeta}>{filteredMembers.length}</span>
          </div>

          <div style={{ ...S.panelBody, flex: 1, minHeight: 0, overflowY: 'auto', padding: 4 }}>
            <div style={{ display: 'grid', gap: 1 }}>
              {filteredMembers.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center' }}>
                  <Users size={24} style={{ color: C.ghost, margin: '0 auto 8px' }} />
                  <p style={{ fontSize: 11, color: C.textTertiary, margin: 0 }}>
                    {search ? 'No members match your search' : 'No members found'}
                  </p>
                </div>
              ) : (<>
                {/* Bulk action bar */}
                {selectedMembers.size > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '4px 8px', background: C.ghost, borderRadius: 4, marginBottom: 2,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button onClick={() => setSelectedMembers(new Set())} style={{ ...ghostBtn(), height: 22, padding: '0 4px', borderRadius: 3 }}>
                        <X size={10} />
                      </button>
                      <span style={{ fontSize: 10, color: C.textSecondary }}>{selectedMembers.size} selected</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button onClick={() => setBulkAction('role')} style={{ ...ghostBtn(), height: 22, padding: '0 6px', fontSize: 9, borderRadius: 3, color: C.textTertiary }} {...hover.ghost}>Change Role</button>
                      <button onClick={() => setBulkAction('remove')} style={{ height: 22, padding: '0 6px', fontSize: 9, fontWeight: 500, background: 'transparent', border: `1px solid ${C.destructive.border}`, borderRadius: 3, color: C.destructive.text, cursor: 'pointer' }}>Remove</button>
                      <button onClick={() => {
                        const rows = filteredMembers.filter(m => selectedMembers.has(m.id)).map(m => {
                          const ex = DEV_MEMBER_EXTRA[m.id];
                          return `${m.user?.display_name},${m.user?.email},${m.member_role},${ex?.last_active || ''},${ex?.has_2fa || false},${ex?.login_method || ''},${ex?.credits_used || 0}`;
                        });
                        const csv = 'Name,Email,Role,Last Active,2FA,Login Method,Credits Used\n' + rows.join('\n');
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = 'members-export.csv'; a.click();
                        URL.revokeObjectURL(url);
                      }} style={{ ...ghostBtn(), height: 22, padding: '0 6px', fontSize: 9, borderRadius: 3, color: C.textTertiary }} {...hover.ghost}>
                        <Download size={9} /> Export
                      </button>
                    </div>
                  </div>
                )}
                {filteredMembers.map(member => {
                const extra = DEV_MEMBER_EXTRA[member.id];
                const isSelected = selectedMembers.has(member.id);
                return (
                <div
                  key={member.id}
                  style={{
                    display: 'grid', gridTemplateColumns: canManage ? '18px 32px 1fr auto' : '32px 1fr auto',
                    alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4,
                    transition: 'background-color 80ms ease',
                    background: isSelected ? C.ghost : undefined,
                  }}
                  {...hover.row}
                >
                  {/* Checkbox for bulk select */}
                  {canManage && (
                    <button
                      onClick={() => setSelectedMembers(prev => {
                        const next = new Set(prev);
                        if (next.has(member.id)) next.delete(member.id); else next.add(member.id);
                        return next;
                      })}
                      style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      {isSelected ? <CheckSquare size={13} style={{ color: C.textBody }} /> : <Square size={13} style={{ color: C.textDim }} />}
                    </button>
                  )}

                  {/* Avatar */}
                  <div style={{
                    width: 32, height: 32, borderRadius: 4,
                    background: C.surface1, border: `1px solid ${C.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative',
                  }}>
                    {member.user?.avatar_url ? (
                      <img src={member.user.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      <span style={{ fontSize: 13, fontWeight: 500, color: C.textSecondary }}>
                        {(member.user?.display_name || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Info + Last Active + meta */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: C.textBody, fontWeight: 500 }}>
                        {member.user?.display_name || member.user?.username || 'Unknown'}
                      </span>
                      {roleBadge(member.member_role)}
                      {extra?.has_2fa && <Fingerprint size={10} style={{ color: C.textTertiary }} />}
                      {extra?.login_method && extra.login_method !== 'password' && (
                        <span style={{ ...S.badge, fontSize: 8 }}>{loginMethodLabel[extra.login_method]}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim, lineHeight: '14px', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{member.user?.email}</span>
                      {extra?.last_active && (<>
                        <span style={{ color: C.textTertiary }}>·</span>
                        <span>{formatRelative(extra.last_active)}</span>
                      </>)}
                      {extra?.credits_used !== undefined && (<>
                        <span style={{ color: C.textTertiary }}>·</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{extra.credits_used.toLocaleString()} cr</span>
                      </>)}
                    </div>
                  </div>

                  {/* Actions */}
                  {canManage && member.member_role !== 'owner' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {editingMember === member.id ? (
                        <>
                          {['member', 'admin'].map(role => (
                            <button key={role} onClick={() => handleRoleChange(member.id, role)} style={{
                              height: 24, padding: '0 8px', fontSize: 10, fontWeight: 500,
                              background: member.member_role === role ? C.ghostHover : C.ghost,
                              border: 'none', borderRadius: 3,
                              color: member.member_role === role ? C.textBody : C.textTertiary,
                              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.03em',
                              transition: 'background-color 80ms ease',
                            }}>{role}</button>
                          ))}
                          <button onClick={() => setEditingMember(null)} style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.ghost, border: 'none', borderRadius: 3, color: C.textSecondary, cursor: 'pointer' }}>
                            <X size={10} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditingMember(member.id)} title="Change role" style={{ ...ghostBtn(), height: 24, padding: '0 6px', fontSize: 10, borderRadius: 3, color: C.textTertiary }} {...hover.ghost}>
                            <MoreHorizontal size={10} />
                          </button>
                          <button onClick={() => handleRemoveMember(member.id)} title="Remove member" style={{
                            width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 3,
                            color: C.textTertiary, cursor: 'pointer', transition: 'all 80ms ease',
                          }}
                            onMouseEnter={e => { e.currentTarget.style.background = C.ghost; e.currentTarget.style.color = C.textSecondary; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textTertiary; }}
                          >
                            <X size={10} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
              })}
              </>)}
            </div>
          </div>
        </div>

        {/* ── Right Sidebar ── */}
        <div style={{ display: 'grid', gap: 6, alignContent: 'start', minHeight: 0, overflowY: 'auto' }}>

          {/* Pending Invites */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setInvitesOpen(o => !o)}>
              <span style={S.headingLabel}>Pending Invites</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={S.headingMeta}>{invites.length}</span>
                <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: invitesOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </div>
            </div>
            {invitesOpen && (
              <div style={{ ...S.panelBody, padding: 6 }}>
                {invites.length === 0 ? (
                  <div style={{ padding: '16px 0', textAlign: 'center' }}>
                    <Mail size={18} style={{ color: C.ghost, margin: '0 auto 6px' }} />
                    <p style={{ fontSize: 10, color: C.textTertiary, margin: 0 }}>No pending invites</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 2 }}>
                    {invites.map(invite => (
                      <div key={invite.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 4 }} {...hover.row}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: C.textBody }}>{invite.invited_email}</div>
                          <div style={{ fontSize: 9, color: C.textDim, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={8} /> {timeAgo(invite.created_at)} · {roleBadge(invite.role)}
                          </div>
                        </div>
                        {canManage && (
                          <button onClick={() => handleRevokeInvite(invite.id)}
                            style={{ height: 22, padding: '0 8px', fontSize: 9, fontWeight: 500, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 3, color: C.textTertiary, cursor: 'pointer', transition: 'all 80ms ease' }}
                            onMouseEnter={e => { e.currentTarget.style.background = C.ghost; e.currentTarget.style.color = C.textSecondary; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textTertiary; }}
                          >Revoke</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Invite Link */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setInviteLinkOpen(o => !o)}>
              <span style={S.headingLabel}>Invite Link</span>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: inviteLinkOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {inviteLinkOpen && (
              <div style={{ ...S.panelBody, padding: 10, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 28, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' }}>
                    <Link2 size={10} style={{ color: C.textTertiary, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inviteLink}</span>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(inviteLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); }}
                    style={{ ...ghostBtn(), height: 28, padding: '0 8px', borderRadius: 4 }} {...hover.ghost}
                  >
                    {linkCopied ? <Check size={10} style={{ color: C.positive }} /> : <Copy size={10} />}
                  </button>
                </div>
                <div style={{ fontSize: 9, color: C.textDim }}>Anyone with this link can request to join the workspace.</div>
              </div>
            )}
          </div>

          {/* Workspace Settings */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setSettingsOpen(o => !o)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Settings size={10} style={{ color: C.textTertiary }} />
                <span style={S.headingLabel}>Workspace Settings</span>
              </div>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: settingsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {settingsOpen && (
              <div style={{ ...S.panelBody, padding: 10, display: 'grid', gap: 8 }}>
                {([
                  { label: 'Name', val: wsName, set: setWsName },
                  { label: 'Slug', val: wsSlug, set: setWsSlug },
                ] as const).map(field => (
                  <div key={field.label}>
                    <div style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', marginBottom: 3 }}>{field.label}</div>
                    <input value={field.val} onChange={e => field.set(e.target.value)} style={{
                      width: '100%', height: 24, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                      color: C.textBody, fontSize: 10, padding: '0 6px', outline: 'none', boxSizing: 'border-box',
                    }} />
                  </div>
                ))}
                <button style={{ ...ghostBtn(), width: '100%', justifyContent: 'center', height: 24, fontSize: 10 }} {...hover.ghost}>
                  Save Changes
                </button>
              </div>
            )}
          </div>

          {/* Permissions & Security */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setSecurityOpen(o => !o)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Lock size={10} style={{ color: C.textTertiary }} />
                <span style={S.headingLabel}>Security</span>
              </div>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: securityOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {securityOpen && (
              <div style={{ ...S.panelBody, padding: 10, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Key size={10} style={{ color: C.textTertiary }} />
                    <span style={{ fontSize: 10, color: C.textBody }}>Enforce 2FA</span>
                  </div>
                  <Toggle value={enforce2fa} onChange={setEnforce2fa} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Globe size={10} style={{ color: C.textTertiary }} />
                    <span style={{ fontSize: 10, color: C.textBody }}>Domain restriction</span>
                  </div>
                  <Toggle value={restrictDomains} onChange={setRestrictDomains} />
                </div>
                {restrictDomains && (
                  <div>
                    <div style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', marginBottom: 3 }}>Allowed Domain</div>
                    <input value={allowedDomain} onChange={e => setAllowedDomain(e.target.value)} style={{
                      width: '100%', height: 24, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                      color: C.textBody, fontSize: 10, padding: '0 6px', outline: 'none', boxSizing: 'border-box',
                    }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Activity Log */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setAuditOpen(o => !o)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Activity size={10} style={{ color: C.textTertiary }} />
                <span style={S.headingLabel}>Activity Log</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={S.headingMeta}>{audit.length}</span>
                <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: auditOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </div>
            </div>
            {auditOpen && (
              <div style={{ ...S.panelBody, padding: 6, display: 'grid', gap: 2 }}>
                {audit.map(entry => (
                  <div key={entry.id} style={{ padding: '5px 8px', borderRadius: 4 }} {...hover.row}>
                    <div style={{ fontSize: 10, color: C.textBody }}>
                      <strong style={{ color: C.textSecondary }}>{entry.actor}</strong>{' '}
                      {actionLabel[entry.action] || entry.action}
                      {entry.target && <span style={{ color: C.textSecondary }}> {entry.target}</span>}
                    </div>
                    <div style={{ fontSize: 8, color: C.textDim, marginTop: 1 }}>{timeAgo(entry.ts)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── SSO / SAML ── */}
          {canManage && (
            <div style={S.panel}>
              <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setSsoOpen(o => !o)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Globe size={11} style={{ color: C.textTertiary }} />
                  <span style={S.headingLabel}>SSO / SAML</span>
                  {ssoEnabled && <span style={{ ...S.badge, fontSize: 8 }}>Active</span>}
                </div>
                <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: ssoOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </div>
              {ssoOpen && (
                <div style={{ ...S.panelBody, padding: '8px 10px', display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: C.textSecondary }}>Enable SAML SSO</span>
                    <button onClick={() => setSsoEnabled(!ssoEnabled)} style={{
                      width: 32, height: 16, borderRadius: 3, border: 'none', cursor: 'pointer',
                      background: ssoEnabled ? C.textBody : C.ghost,
                      position: 'relative', transition: 'background-color 80ms ease',
                    }}>
                      <div style={{
                        width: 12, height: 12, borderRadius: ssoEnabled ? 3 : 2,
                        background: ssoEnabled ? '#0a0a0b' : C.textDim,
                        position: 'absolute', top: 2,
                        left: ssoEnabled ? 18 : 2,
                        transition: 'left 150ms ease, border-radius 150ms ease',
                      }} />
                    </button>
                  </div>
                  {ssoEnabled && (<>
                    <div>
                      <label style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>IdP Login URL</label>
                      <input value={ssoIdpUrl} onChange={e => setSsoIdpUrl(e.target.value)} placeholder="https://idp.example.com/sso/saml" style={{ width: '100%', height: 24, background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, borderRadius: 3, color: C.textBody, fontSize: 10, padding: '0 6px', outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>Entity ID</label>
                      <input value={ssoEntityId} onChange={e => setSsoEntityId(e.target.value)} placeholder="urn:xeno:workspace" style={{ width: '100%', height: 24, background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, borderRadius: 3, color: C.textBody, fontSize: 10, padding: '0 6px', outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>X.509 Certificate</label>
                      <textarea value={ssoCert} onChange={e => setSsoCert(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" rows={3} style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, borderRadius: 3, color: C.textBody, fontSize: 10, padding: '4px 6px', outline: 'none', resize: 'vertical', fontFamily: 'monospace' }} />
                    </div>
                    <button style={{ height: 24, padding: '0 10px', fontSize: 10, fontWeight: 500, background: C.ghost, border: 'none', borderRadius: 3, color: C.textSecondary, cursor: 'pointer', alignSelf: 'flex-start', transition: 'background-color 80ms ease' }}>Save Configuration</button>
                  </>)}
                </div>
              )}
            </div>
          )}

          {/* ── SCIM Provisioning ── */}
          {canManage && (
            <div style={S.panel}>
              <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setScimOpen(o => !o)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Server size={11} style={{ color: C.textTertiary }} />
                  <span style={S.headingLabel}>SCIM Provisioning</span>
                  {scimEnabled && <span style={{ ...S.badge, fontSize: 8 }}>Active</span>}
                </div>
                <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: scimOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </div>
              {scimOpen && (
                <div style={{ ...S.panelBody, padding: '8px 10px', display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: C.textSecondary }}>Enable SCIM</span>
                    <button onClick={() => setScimEnabled(!scimEnabled)} style={{
                      width: 32, height: 16, borderRadius: 3, border: 'none', cursor: 'pointer',
                      background: scimEnabled ? C.textBody : C.ghost,
                      position: 'relative', transition: 'background-color 80ms ease',
                    }}>
                      <div style={{
                        width: 12, height: 12, borderRadius: scimEnabled ? 3 : 2,
                        background: scimEnabled ? '#0a0a0b' : C.textDim,
                        position: 'absolute', top: 2,
                        left: scimEnabled ? 18 : 2,
                        transition: 'left 150ms ease, border-radius 150ms ease',
                      }} />
                    </button>
                  </div>
                  {scimEnabled && (<>
                    <div>
                      <label style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>SCIM Base URL</label>
                      <div style={{ height: 24, display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, borderRadius: 3, padding: '0 6px' }}>
                        <span style={{ fontSize: 10, color: C.textTertiary, fontFamily: 'monospace', flex: 1 }}>https://api.xenostudio.ai/scim/v2</span>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>Bearer Token</label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <div style={{ flex: 1, height: 24, display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, borderRadius: 3, padding: '0 6px' }}>
                          <span style={{ fontSize: 10, color: C.textTertiary, fontFamily: 'monospace' }}>{scimToken}</span>
                        </div>
                        <button onClick={() => { navigator.clipboard.writeText(scimToken); setScimTokenCopied(true); setTimeout(() => setScimTokenCopied(false), 1500); }} style={{ ...ghostBtn(), height: 24, padding: '0 6px', borderRadius: 3 }} {...hover.ghost}>
                          {scimTokenCopied ? <Check size={10} /> : <Copy size={10} />}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim }}>
                      Configure your IdP (Okta, Azure AD, OneLogin) with these credentials to auto-sync users.
                    </div>
                  </>)}
                </div>
              )}
            </div>
          )}

          {/* ── Sessions ── */}
          {canManage && (
            <div style={S.panel}>
              <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setSessionsOpen(o => !o)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Monitor size={11} style={{ color: C.textTertiary }} />
                  <span style={S.headingLabel}>Active Sessions</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={S.headingMeta}>{sessions.length}</span>
                  <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: sessionsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                </div>
              </div>
              {sessionsOpen && (
                <div style={{ ...S.panelBody, padding: 4 }}>
                  {sessions.map(s => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: 4, transition: 'background-color 80ms ease' }} {...hover.row}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {s.device.includes('iPhone') || s.device.includes('Android') ? <Smartphone size={12} style={{ color: C.textTertiary }} /> : <Monitor size={12} style={{ color: C.textTertiary }} />}
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 10, color: C.textBody }}>{s.user_name}</span>
                            <span style={{ fontSize: 10, color: C.textDim }}>· {s.device}</span>
                            {s.current && <span style={{ ...S.badge, fontSize: 8 }}>Current</span>}
                          </div>
                          <div style={{ fontSize: 9, color: C.textDim }}>{s.ip} · {s.location} · {formatRelative(s.last_active)}</div>
                        </div>
                      </div>
                      {!s.current && (
                        <button style={{ ...ghostBtn(), height: 22, padding: '0 6px', fontSize: 9, borderRadius: 3, color: C.textTertiary }} {...hover.ghost}>
                          <LogOut size={9} /> Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Custom Roles ── */}
          {canManage && (
            <div style={S.panel}>
              <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setRolesOpen(o => !o)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={11} style={{ color: C.textTertiary }} />
                  <span style={S.headingLabel}>Roles & Permissions</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={S.headingMeta}>{roles.length}</span>
                  <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: rolesOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                </div>
              </div>
              {rolesOpen && (
                <div style={{ ...S.panelBody, padding: 4 }}>
                  {roles.map(role => (
                    <div key={role.id} style={{ padding: '5px 8px', borderRadius: 4, transition: 'background-color 80ms ease' }} {...hover.row}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, color: C.textBody, fontWeight: 500 }}>{role.name}</span>
                          {role.builtin && <span style={{ ...S.badge, fontSize: 8 }}>Built-in</span>}
                        </div>
                        {!role.builtin && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => setEditingRole(editingRole === role.id ? null : role.id)} style={{ ...ghostBtn(), height: 20, padding: '0 4px', borderRadius: 3 }} {...hover.ghost}>
                              <Settings size={9} />
                            </button>
                            <button onClick={() => setRoles(prev => prev.filter(r => r.id !== role.id))} style={{ ...ghostBtn(), height: 20, padding: '0 4px', borderRadius: 3, color: C.textDim }} {...hover.ghost}>
                              <X size={9} />
                            </button>
                          </div>
                        )}
                      </div>
                      {/* Permission editor */}
                      {editingRole === role.id && (
                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {ALL_PERMISSIONS.map(perm => {
                            const has = role.permissions.includes(perm);
                            return (
                              <button key={perm} onClick={() => {
                                setRoles(prev => prev.map(r => r.id !== role.id ? r : {
                                  ...r, permissions: has ? r.permissions.filter(p => p !== perm) : [...r.permissions, perm]
                                }));
                              }} style={{
                                height: 20, padding: '0 6px', fontSize: 9, borderRadius: 2,
                                background: has ? C.ghost : 'transparent',
                                border: `1px solid ${has ? C.borderStrong : C.border}`,
                                color: has ? C.textBody : C.textDim,
                                cursor: 'pointer', transition: 'all 80ms ease',
                              }}>{perm}</button>
                            );
                          })}
                        </div>
                      )}
                      {/* Permission summary */}
                      {editingRole !== role.id && (
                        <div style={{ fontSize: 9, color: C.textDim, marginTop: 2 }}>
                          {role.permissions.includes('*') ? 'All permissions' : role.permissions.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Add new role */}
                  <div style={{ padding: '5px 8px', display: 'flex', gap: 4 }}>
                    <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="New role name..." style={{
                      flex: 1, height: 24, background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, borderRadius: 3,
                      color: C.textBody, fontSize: 10, padding: '0 6px', outline: 'none',
                    }} />
                    <button disabled={!newRoleName.trim()} onClick={() => {
                      if (!newRoleName.trim()) return;
                      setRoles(prev => [...prev, { id: `r-${Date.now()}`, name: newRoleName.trim(), permissions: ['view'], builtin: false }]);
                      setNewRoleName('');
                    }} style={{
                      height: 24, padding: '0 8px', fontSize: 10, fontWeight: 500,
                      background: newRoleName.trim() ? C.ghost : 'transparent',
                      border: 'none', borderRadius: 3,
                      color: newRoleName.trim() ? C.textSecondary : C.textDim,
                      cursor: newRoleName.trim() ? 'pointer' : 'not-allowed',
                    }}>Add</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Transfer Ownership */}
          {isOwner && members.filter(m => m.member_role !== 'owner').length > 0 && (
            <div style={S.panel}>
              <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setDangerOpen(o => !o)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={11} style={{ color: C.textTertiary }} />
                  <span style={S.headingLabel}>Danger Zone</span>
                </div>
                <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: dangerOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </div>
              {dangerOpen && (
                <div style={{ ...S.panelBody, padding: '8px 10px', display: 'grid', gap: 8 }}>
                  {/* Transfer ownership */}
                  <div>
                    <div style={{ fontSize: 10, color: C.textBody, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ChevronRight size={9} style={{ color: C.textTertiary }} /> Transfer Ownership
                    </div>
                    {members.filter(m => m.member_role !== 'owner').map(member => (
                      <div key={member.id}>
                        {showTransferConfirm === member.id ? (
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '6px 8px', borderRadius: 4,
                            background: C.ghost, border: `1px solid ${C.border}`,
                          }}>
                            <span style={{ fontSize: 10, color: C.textSecondary }}>Transfer to {member.user?.display_name}?</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => setShowTransferConfirm(null)} style={{ ...ghostBtn(), height: 22, padding: '0 6px', fontSize: 9, borderRadius: 3 }}>Cancel</button>
                              <button onClick={() => handleTransferOwnership(member.user_id)} style={{ height: 22, padding: '0 6px', fontSize: 9, fontWeight: 500, background: C.ghostHover, border: 'none', borderRadius: 3, color: C.textBody, cursor: 'pointer' }}>Confirm</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setShowTransferConfirm(member.id)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', transition: 'background-color 80ms ease', marginBottom: 2 }}
                            {...hover.row}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 10, color: C.textSecondary }}>{member.user?.display_name}</span>
                              {roleBadge(member.member_role)}
                            </div>
                            <ChevronDown size={10} style={{ color: C.textDim, transform: 'rotate(-90deg)' }} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Delete workspace */}
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <div style={{ fontSize: 10, color: C.textSecondary, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Trash2 size={9} /> Delete Workspace
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, marginBottom: 6 }}>
                      Type <strong style={{ color: C.textTertiary }}>{activeWorkspace.name}</strong> to confirm
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder={activeWorkspace.name} style={{
                        flex: 1, height: 24, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                        color: C.textBody, fontSize: 10, padding: '0 6px', outline: 'none',
                      }} />
                      <button disabled={deleteConfirmText !== activeWorkspace.name} style={{
                        height: 24, padding: '0 8px', fontSize: 9, fontWeight: 500,
                        background: deleteConfirmText === activeWorkspace.name ? C.ghostHover : 'transparent',
                        border: `1px solid ${C.border}`, borderRadius: 3,
                        color: deleteConfirmText === activeWorkspace.name ? C.textBody : C.textTertiary,
                        cursor: deleteConfirmText === activeWorkspace.name ? 'pointer' : 'not-allowed',
                        opacity: deleteConfirmText === activeWorkspace.name ? 1 : 0.4,
                      }}>Delete</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeamPage;
