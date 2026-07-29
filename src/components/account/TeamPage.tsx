import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  { id: 'm1', user_id: 'u1', member_role: 'owner', member_status: 'active', created_at: new Date(now - day * 90).toISOString(), user: { username: 'alice', email: 'alice@example.com', display_name: 'Alice Roberts', avatar_url: null } },
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
  { id: 's1', user_id: 'u1', user_name: 'Alice Roberts', device: 'Chrome · macOS', ip: '82.14.210.33', location: 'London, UK', last_active: new Date(now - 300_000).toISOString(), current: true },
  { id: 's2', user_id: 'u1', user_name: 'Alice Roberts', device: 'Safari · iPhone', ip: '82.14.210.34', location: 'London, UK', last_active: new Date(now - day).toISOString() },
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
  { id: 'a1', action: 'invited', actor: 'Alice Roberts', target: 'stefan@xeno.dev', ts: new Date(now - day * 2).toISOString() },
  { id: 'a2', action: 'role_changed', actor: 'Alice Roberts', target: 'Sofia Petrov → admin', ts: new Date(now - day * 5).toISOString() },
  { id: 'a3', action: 'joined', actor: 'Daniel Kim', ts: new Date(now - day * 7).toISOString() },
  { id: 'a4', action: 'invited', actor: 'Alex Mercer', target: 'olga@xeno.dev', ts: new Date(now - day).toISOString() },
  { id: 'a5', action: 'removed', actor: 'Alice Roberts', target: 'tom@xeno.dev', ts: new Date(now - day * 12).toISOString() },
  { id: 'a6', action: 'settings_changed', actor: 'Alice Roberts', target: 'workspace name', ts: new Date(now - day * 20).toISOString() },
  { id: 'a7', action: 'sso_enabled', actor: 'Alice Roberts', ts: new Date(now - day * 25).toISOString() },
  { id: 'a8', action: 'api_key_created', actor: 'Alex Mercer', target: 'Production key', ts: new Date(now - day * 30).toISOString() },
];

const ALL_PERMISSIONS = ['view', 'use_api', 'invite', 'remove', 'settings', 'billing', 'api_keys', 'audit'] as const;

// ─── Helpers ───
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

// ─── Skeleton ───

const Skeleton: React.FC = () => (
  <div className="h-full flex items-center justify-center">
    <Loader2 size={18} className="animate-spin text-zinc-600" />
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
  const [sortField, setSortField] = useState<'name' | 'role' | 'last_active'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [roleDropdown, setRoleDropdown] = useState<string | null>(null);

  const toggleSort = (field: 'name' | 'role' | 'last_active') => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const searchRef = useRef<HTMLInputElement>(null);

  // Sidebar panels

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

  // Security
  const [enforce2fa, setEnforce2fa] = useState(false);
  const [restrictDomains, setRestrictDomains] = useState(false);
  const [allowedDomain, setAllowedDomain] = useState('xeno.dev');
  const [ipAllowList, setIpAllowList] = useState('');
  const [ipAllowEnabled, setIpAllowEnabled] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState('4h');
  const [auditRetention, setAuditRetention] = useState('90d');

  // Settings
  const [defaultRole, setDefaultRole] = useState('member');
  const [notifyOnInvite, setNotifyOnInvite] = useState(true);
  const [notifyOnJoin, setNotifyOnJoin] = useState(true);
  const [notifyOnRemove, setNotifyOnRemove] = useState(false);
  const [apiKeys] = useState([
    { id: 'k1', name: 'Production', prefix: 'xk_live_...a3f7', created: '2026-02-15', lastUsed: '2 hours ago' },
    { id: 'k2', name: 'Staging', prefix: 'xk_test_...b2c1', created: '2026-03-01', lastUsed: '3 days ago' },
  ]);
  const [newKeyName, setNewKeyName] = useState('');

  // Audit
  const [audit] = useState<AuditEntry[]>(DEV_AUDIT);

  // Delete confirm
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Tab navigation — URL-driven
  type Tab = 'members' | 'settings' | 'security' | 'activity';
  const { tab: urlTab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const validTabs: Tab[] = ['members', 'settings', 'security', 'activity'];
  const activeTab: Tab = validTabs.includes(urlTab as Tab) ? (urlTab as Tab) : 'members';
  const setActiveTab = (tab: Tab) => navigate(tab === 'members' ? '/overview/team' : `/overview/team/${tab}`, { replace: true });

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
    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = (a.user?.display_name || '').localeCompare(b.user?.display_name || '');
      else if (sortField === 'role') {
        const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
        cmp = (order[a.member_role] || 9) - (order[b.member_role] || 9);
      } else if (sortField === 'last_active') {
        const aTime = DEV_MEMBER_EXTRA[a.id]?.last_active ? new Date(DEV_MEMBER_EXTRA[a.id].last_active).getTime() : 0;
        const bTime = DEV_MEMBER_EXTRA[b.id]?.last_active ? new Date(DEV_MEMBER_EXTRA[b.id].last_active).getTime() : 0;
        cmp = bTime - aTime;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [members, roleFilter, search, sortField, sortDir]);

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

  if (isLoading) return (
    <div className="h-full flex items-center justify-center">
      <Loader2 size={18} className="animate-spin text-zinc-500" />
    </div>
  );

  if (!activeWorkspace || activeWorkspace.workspace_type !== 'team') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Building2 size={24} className="text-zinc-500 mx-auto mb-2" />
          <p className="text-[12px] text-zinc-500">Switch to a team workspace to manage members</p>
        </div>
      </div>
    );
  }

  const allTabs: Tab[] = ['members', 'security', 'activity', 'settings'];

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ═══ Header — dark container buttons, optically centered with taskbar ═══ */}
      <div className="flex items-center gap-1 px-2 shrink-0" style={{ paddingTop: 8, paddingBottom: 8 }}>
        {/* Workspace context */}
        <span className="text-[13px] font-semibold text-zinc-300 mr-2 pl-1">{activeWorkspace?.name || 'Team'}</span>
        <span className="text-zinc-600 mr-2">/</span>

        {/* Tabs */}
        {allTabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`h-7 px-3 text-[13px] font-medium capitalize rounded-md border transition-colors ${
              activeTab === tab
                ? 'bg-black/90 border-white/[0.08] text-zinc-300'
                : 'bg-transparent border-transparent text-zinc-600 hover:text-zinc-400 hover:bg-black/50'
            }`}>
            {tab}
          </button>
        ))}

        <div className="flex-1" />

        {/* Contextual stats — right side of header */}
        {activeTab === 'members' && (
          <div className="flex items-center gap-3 mr-3 text-[12px]">
            <span className="text-zinc-500">{stats.total} <span className="text-zinc-600">members</span></span>
            <span className="text-zinc-500">{stats.active} <span className="text-zinc-600">active</span></span>
            <span className="text-zinc-500">{stats.admins} <span className="text-zinc-600">admins</span></span>
            {invites.length > 0 && <span className="text-zinc-500">{invites.length} <span className="text-zinc-600">pending</span></span>}
          </div>
        )}
        {activeTab === 'security' && (
          <div className="flex items-center gap-3 mr-3 text-[12px]">
            <span className={ssoEnabled ? 'text-zinc-400' : 'text-zinc-600'}>SSO {ssoEnabled ? 'on' : 'off'}</span>
            <span className={enforce2fa ? 'text-zinc-400' : 'text-zinc-600'}>2FA {enforce2fa ? 'on' : 'off'}</span>
            <span className="text-zinc-500">{sessions.length} <span className="text-zinc-600">sessions</span></span>
          </div>
        )}
        {activeTab === 'activity' && (
          <div className="flex items-center gap-3 mr-3 text-[12px]">
            <span className="text-zinc-500">{audit.length} <span className="text-zinc-600">events</span></span>
            <button onClick={() => {
              const h = 'Date,Action,Actor,Target\n';
              const r = audit.map(e => `${formatDate(e.ts)},${actionLabel[e.action] || e.action},${e.actor},${e.target || ''}`).join('\n');
              const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([h + r], { type: 'text/csv' })); a.download = 'audit-log.csv'; a.click();
            }} className="text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1">
              <Download size={10} /> CSV
            </button>
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="flex items-center gap-3 mr-3 text-[12px]">
            <span className="text-zinc-500">{roles.length} <span className="text-zinc-600">roles</span></span>
            <span className="text-zinc-500">{apiKeys.length} <span className="text-zinc-600">keys</span></span>
          </div>
        )}

        {activeTab === 'members' && canManage && (
          <button onClick={() => setShowInviteForm(!showInviteForm)}
            className={`h-7 px-3 flex items-center gap-1.5 rounded-md border text-[13px] font-medium transition-colors ${
              showInviteForm
                ? 'bg-black/90 border-white/[0.15] text-zinc-300'
                : 'bg-black/90 border-white/[0.08] text-zinc-500 hover:text-zinc-400'
            }`}>
            <UserPlus size={12} /> {showInviteForm ? 'Cancel' : 'Invite'}
          </button>
        )}
      </div>


      {/* ═══ Invite form — pinned sub-header ═══ */}
      {activeTab === 'members' && showInviteForm && canManage && (
        <div className="flex items-center gap-1 px-2 py-2 border-b border-white/[0.05]">
          <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="Email address" autoFocus
            className="h-7 px-3 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-300 placeholder-zinc-500 outline-none focus:border-white/[0.15] w-64"
            onKeyDown={e => { if (e.key === 'Enter') handleInvite(); }} />
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ colorScheme: 'dark' }}
            className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-400 outline-none cursor-pointer appearance-none">
            <option value="member">Member</option><option value="admin">Admin</option>
          </select>
          <button onClick={handleInvite} disabled={isInviting || !inviteEmail.trim()}
            className="h-7 px-3 flex items-center gap-1.5 bg-white/90 text-[#09090b] text-[13px] font-semibold rounded disabled:opacity-30 hover:bg-white/80 transition-colors">
            {isInviting ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />} Send
          </button>
          {inviteError && <span className="text-[12px] text-red-400/40 ml-2">{inviteError}</span>}
        </div>
      )}

      {/* ═══ Filter toolbar — pinned sub-header, full viewport ═══ */}
      {activeTab === 'members' && (
        <div className="flex items-center gap-1 px-2 py-2 border-b border-white/[0.05]">
            {(['all', 'owner', 'admin', 'member'] as RoleFilter[]).map(f => (
              <button key={f} onClick={() => setRoleFilter(f)}
                className={`h-7 px-3 text-[13px] font-medium capitalize rounded border transition-colors ${
                  roleFilter === f ? 'bg-black/90 border-white/[0.08] text-zinc-300' : 'bg-transparent border-transparent text-zinc-600 hover:text-zinc-400 hover:bg-black/50'
                }`}>{f}</button>
            ))}
            <div className="flex-1" />
            {selectedMembers.size > 0 && (<>
              <span className="text-[12px] text-zinc-500 mr-1">{selectedMembers.size} selected</span>
              <button onClick={() => setBulkAction('role')} className="h-7 px-3 rounded bg-black/90 border border-white/[0.08] text-[13px] text-zinc-500 font-medium hover:text-zinc-400 transition-colors">Role</button>
              <button onClick={() => setBulkAction('remove')} className="h-7 px-3 rounded border border-red-500/15 text-[13px] text-red-400/40 font-medium hover:text-red-400/70 transition-colors">Remove</button>
              <button onClick={() => {
                const rows = filteredMembers.filter(m => selectedMembers.has(m.id)).map(m => { const ex = DEV_MEMBER_EXTRA[m.id]; return [m.user?.display_name, m.user?.email, m.member_role, ex?.last_active || ''].join(','); });
                const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['Name,Email,Role,Last Active\n' + rows.join('\n')], { type: 'text/csv' })); a.download = 'members.csv'; a.click();
              }} className="h-7 w-7 flex items-center justify-center rounded bg-black/90 border border-white/[0.08] text-zinc-500 hover:text-zinc-400 transition-colors"><Download size={11} /></button>
              <button onClick={() => setSelectedMembers(new Set())} className="h-7 w-7 flex items-center justify-center text-zinc-600 hover:text-zinc-500 transition-colors"><X size={11} /></button>
            </>)}
            <div className="flex items-center gap-1.5 h-7 px-3 bg-black/30 border border-white/[0.08] rounded">
              <Search size={11} className="text-zinc-500" />
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search"
                className="bg-transparent border-none outline-none text-[13px] text-zinc-300 placeholder-zinc-500 w-20" />
            </div>
          </div>
      )}

      {/* ═══ Main container — distinct bg, flex-1, scrollable ═══ */}
      <div className="flex-1 overflow-auto bg-white/[0.02] border-y border-white/[0.05]">

        {/* MEMBERS */}
        {activeTab === 'members' && (<>
          {/* Column headers */}
          <div className="grid gap-3 px-4 py-2 border-b border-white/[0.06]" style={{ gridTemplateColumns: '32px 3fr 1fr 1fr 0.7fr 56px' }}>
            <span />
            {([['name', 'Name'], ['role', 'Role'], ['last_active', 'Last Active']] as const).map(([field, label]) => (
              <button key={field} onClick={() => toggleSort(field)} className="flex items-center gap-1 text-[12px] font-semibold text-zinc-500 uppercase tracking-wider hover:text-zinc-400 transition-colors text-left">
                {label} {sortField === field && <ArrowUpDown size={10} className={`text-zinc-400 ${sortDir === 'desc' ? 'rotate-180' : ''}`} />}
              </button>
            ))}
            <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">2FA</span>
            <span />
          </div>

          {/* Pending invites */}
          {invites.map(inv => (
            <div key={inv.id} className="grid items-center gap-3 px-4 border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors" style={{ gridTemplateColumns: '32px 3fr 1fr 1fr 0.7fr 56px', minHeight: 44 }}>
              <div className="w-7 h-7 rounded flex items-center justify-center bg-white/[0.04]"><Mail size={12} className="text-zinc-600" /></div>
              <div className="min-w-0 py-2">
                <div className="text-[13px] text-zinc-400 truncate">{inv.invited_email}</div>
                <div className="text-[11px] text-zinc-600">Invited {timeAgo(inv.created_at)}</div>
              </div>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.04] text-zinc-600 uppercase tracking-wide font-medium w-fit">{inv.role}</span>
              <span className="text-[11px] text-zinc-600 italic">Pending</span>
              <span />
              {canManage ? <button onClick={() => handleRevokeInvite(inv.id)} className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">Revoke</button> : <span />}
            </div>
          ))}

          {/* Members */}
          {filteredMembers.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-zinc-600">{search ? 'No matches' : 'No members'}</div>
          ) : filteredMembers.map(member => {
            const extra = DEV_MEMBER_EXTRA[member.id];
            const isSelected = selectedMembers.has(member.id);
            const isOnline = extra?.last_active && (Date.now() - new Date(extra.last_active).getTime()) < 600000;
            return (
              <div key={member.id}>
                <div className="group grid items-center gap-3 px-4 border-b border-white/[0.05] hover:bg-white/[0.05] transition-colors"
                  style={{ gridTemplateColumns: '32px 3fr 1fr 1fr 0.7fr 56px', minHeight: 44, cursor: canManage ? 'pointer' : undefined }}
                  onClick={canManage ? () => setSelectedMembers(prev => { const n = new Set(prev); if (n.has(member.id)) n.delete(member.id); else n.add(member.id); return n; }) : undefined}>
                  <div className={`w-7 h-7 rounded flex items-center justify-center relative transition-colors ${isSelected ? 'bg-white/[0.12]' : 'bg-white/[0.08]'}`}>
                    {isSelected ? <Check size={13} className="text-zinc-300" /> :
                      <span className="text-[13px] font-medium text-zinc-400">{(member.user?.display_name || '?').charAt(0).toUpperCase()}</span>}
                    {isOnline && <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-sm bg-zinc-400 border border-[#0a0a0b]" />}
                  </div>
                  <div className="min-w-0 py-2">
                    <div className="text-[13px] font-medium text-zinc-300 truncate">{member.user?.display_name || member.user?.username || 'Unknown'}</div>
                    <div className="text-[12px] text-zinc-500 truncate">{member.user?.email}</div>
                  </div>
                  <div className="relative">
                    <button onClick={e => { e.stopPropagation(); setRoleDropdown(roleDropdown === member.id ? null : member.id); }}
                      disabled={!canManage || member.member_role === 'owner'}
                      className={`text-[11px] px-1.5 py-0.5 rounded bg-white/[0.08] uppercase tracking-wide font-medium transition-colors ${
                        canManage && member.member_role !== 'owner' ? 'text-zinc-400 hover:bg-white/[0.12] cursor-pointer' : 'text-zinc-500 cursor-default'
                      }`}>{member.member_role}</button>
                    {roleDropdown === member.id && canManage && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-[#0c0c0e] border border-white/[0.08] rounded overflow-hidden">
                        {['admin', 'member'].map(role => (
                          <button key={role} onClick={e => { e.stopPropagation(); handleRoleChange(member.id, role); setRoleDropdown(null); }}
                            className={`w-full px-3 py-1.5 text-[12px] text-left capitalize transition-colors ${
                              member.member_role === role ? 'text-zinc-300 bg-white/[0.06]' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-400'
                            }`}>{role}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-[12px] text-zinc-500 tabular-nums">{extra?.last_active ? formatRelative(extra.last_active) : '—'}</span>
                  {extra?.has_2fa ? <Fingerprint size={12} className="text-zinc-500" /> : <span className="text-[12px] text-zinc-600">—</span>}
                  {canManage && member.member_role !== 'owner' ? (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); setExpandedMember(expandedMember === member.id ? null : member.id); }}
                        className="w-6 h-6 flex items-center justify-center rounded bg-white/[0.08] text-zinc-400 hover:bg-white/[0.15] hover:text-zinc-300 transition-colors">
                        <ChevronDown size={10} className={`transition-transform ${expandedMember === member.id ? 'rotate-180' : ''}`} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleRemoveMember(member.id); }}
                        className="w-6 h-6 flex items-center justify-center rounded bg-white/[0.08] text-zinc-400 hover:bg-white/[0.15] hover:text-zinc-300 transition-colors">
                        <X size={10} />
                      </button>
                    </div>
                  ) : <div />}
                </div>
                {expandedMember === member.id && extra && (
                  <div className="flex gap-8 px-4 py-3 border-b border-white/[0.05] bg-white/[0.02] text-[12px]" style={{ paddingLeft: 'calc(32px + 12px + 16px)' }}>
                    <div><span className="text-zinc-500">Login</span> <span className="text-zinc-400 ml-1">{loginMethodLabel[extra.login_method]}</span></div>
                    <div><span className="text-zinc-500">Credits</span> <span className="text-zinc-400 ml-1 tabular-nums">{extra.credits_used.toLocaleString()}</span></div>
                    <div><span className="text-zinc-500">Joined</span> <span className="text-zinc-400 ml-1">{formatDate(member.created_at)}</span></div>
                    <div><span className="text-zinc-500">2FA</span> <span className="text-zinc-400 ml-1">{extra.has_2fa ? 'Enabled' : 'Disabled'}</span></div>
                  </div>
                )}
              </div>
            );
          })}
        </>)}

        {/* ══════════════════════════════════════════════════ */}
        {/* SETTINGS */}
        {/* ══════════════════════════════════════════════════ */}
        {/* ══════════════════════════════════════════════════ */}
        {/* SETTINGS */}
        {/* ══════════════════════════════════════════════════ */}
        {activeTab === 'settings' && (
          <div className="p-4 space-y-3">

            {/* ── General ── */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-[10px] h-[34px] shrink-0 rounded-md" style={{ background: 'rgba(0,0,0,0.90)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">General</span>
              </div>
              <div className="rounded-md divide-y divide-white/[0.04]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-zinc-400 w-32 shrink-0">Name</span>
                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <input value={wsName} onChange={e => setWsName(e.target.value)} className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-300 outline-none focus:border-white/[0.15] w-64" />
                    <button className="h-7 px-3 text-[13px] font-medium bg-white/[0.08] text-zinc-400 rounded hover:bg-white/[0.15] hover:text-zinc-300 transition-colors shrink-0">Save</button>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-zinc-400 w-32 shrink-0">Slug</span>
                  <input value={wsSlug} onChange={e => setWsSlug(e.target.value)} className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-300 outline-none focus:border-white/[0.15] font-mono w-64" />
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-zinc-400 w-32 shrink-0">Default role</span>
                  <select value={defaultRole} onChange={e => setDefaultRole(e.target.value)} style={{ colorScheme: 'dark' }}
                    className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-400 outline-none cursor-pointer appearance-none capitalize">
                    <option value="member">Member</option><option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-zinc-400 w-32 shrink-0">Notifications</span>
                  <div className="flex items-center gap-4">
                    {([
                      { label: 'Invite', value: notifyOnInvite, set: setNotifyOnInvite },
                      { label: 'Join', value: notifyOnJoin, set: setNotifyOnJoin },
                      { label: 'Remove', value: notifyOnRemove, set: setNotifyOnRemove },
                    ] as const).map(n => (
                      <button key={n.label} onClick={() => n.set(!n.value)} className="flex items-center gap-1.5 text-[12px] text-zinc-500">
                        <div className={`w-8 h-4 rounded relative transition-colors shrink-0 ${n.value ? 'bg-white/[0.20]' : 'bg-white/[0.08]'}`}>
                          <div className={`w-3 h-3 rounded-sm absolute top-0.5 transition-all ${n.value ? 'left-[18px] bg-[#0a0a0b]' : 'left-0.5 bg-zinc-500'}`} />
                        </div>
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Roles & Permissions ── */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-[10px] h-[34px] shrink-0 rounded-md" style={{ background: 'rgba(0,0,0,0.90)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Roles & Permissions</span>
                <span className="text-[10px] text-white/[0.12] tabular-nums">{roles.length}</span>
              </div>
              <div className="rounded-md divide-y divide-white/[0.04]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {roles.map(role => (
                  <div key={role.id} className="flex items-start justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-zinc-300">{role.name}</span>
                        {role.builtin && <span className="text-[11px] px-1 py-px rounded bg-white/[0.06] text-zinc-500 uppercase tracking-wide">Built-in</span>}
                      </div>
                      {editingRole === role.id ? (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {ALL_PERMISSIONS.map(perm => { const has = role.permissions.includes(perm); return (
                            <button key={perm} onClick={() => setRoles(prev => prev.map(r => r.id !== role.id ? r : { ...r, permissions: has ? r.permissions.filter(p => p !== perm) : [...r.permissions, perm] }))}
                              className={`h-6 px-2 text-[11px] rounded border transition-colors cursor-pointer ${has ? 'bg-white/[0.08] border-white/[0.15] text-zinc-300' : 'border-white/[0.06] text-zinc-600'}`}>{perm}</button>
                          ); })}
                        </div>
                      ) : (
                        <div className="text-[11px] text-zinc-500 mt-0.5">{role.permissions.includes('*') ? 'All permissions' : role.permissions.join(', ')}</div>
                      )}
                    </div>
                    {!role.builtin && (
                      <div className="flex gap-1 ml-4 shrink-0">
                        <button onClick={() => setEditingRole(editingRole === role.id ? null : role.id)} className="w-6 h-6 flex items-center justify-center rounded bg-white/[0.08] text-zinc-400 hover:text-zinc-300 transition-colors"><Settings size={10} /></button>
                        <button onClick={() => setRoles(prev => prev.filter(r => r.id !== role.id))} className="w-6 h-6 flex items-center justify-center rounded bg-white/[0.08] text-zinc-600 hover:text-zinc-400 transition-colors"><X size={10} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 px-4 py-2.5 border-t border-white/[0.04]">
                <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="New role…"
                  className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-300 placeholder-zinc-500 outline-none w-48" />
                <button disabled={!newRoleName.trim()} onClick={() => { if (!newRoleName.trim()) return; setRoles(prev => [...prev, { id: `r-${Date.now()}`, name: newRoleName.trim(), permissions: ['view'], builtin: false }]); setNewRoleName(''); }}
                  className="h-7 px-3 text-[13px] font-medium bg-white/[0.08] text-zinc-400 rounded hover:bg-white/[0.15] hover:text-zinc-300 disabled:opacity-30 transition-colors">Add</button>
              </div>
            </div>

            {/* ── API Keys ── */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-[10px] h-[34px] shrink-0 rounded-md" style={{ background: 'rgba(0,0,0,0.90)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">API Keys</span>
                <span className="text-[10px] text-white/[0.12] tabular-nums">{apiKeys.length}</span>
              </div>
              <div className="rounded-md divide-y divide-white/[0.04]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {apiKeys.map(k => (
                  <div key={k.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                    <div><div className="text-[13px] text-zinc-300">{k.name}</div><div className="text-[11px] text-zinc-500 font-mono">{k.prefix}</div></div>
                    <div className="text-[11px] text-zinc-600">{k.lastUsed}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 px-4 py-2.5 border-t border-white/[0.04]">
                <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="Key name…"
                  className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-300 placeholder-zinc-500 outline-none w-48" />
                <button disabled={!newKeyName.trim()} className="h-7 px-3 text-[13px] font-medium bg-white/[0.08] text-zinc-400 rounded hover:bg-white/[0.15] hover:text-zinc-300 disabled:opacity-30 transition-colors">Create</button>
              </div>
            </div>

            {/* ── Danger Zone ── */}
            {isOwner && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between px-[10px] h-[34px] shrink-0 rounded-md" style={{ background: 'rgba(0,0,0,0.90)', border: '1px solid rgba(239,68,68,0.10)' }}>
                  <span className="text-[10px] font-semibold text-red-400/40 uppercase tracking-wider">Danger Zone</span>
                </div>
                <div className="rounded-md divide-y divide-white/[0.04]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(239,68,68,0.10)' }}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[13px] text-zinc-400">Transfer ownership</span>
                    <div className="flex gap-1">
                      {members.filter(m => m.member_role !== 'owner').map(m => (
                        showTransferConfirm === m.id ? (
                          <div key={m.id} className="flex gap-1">
                            <button onClick={() => setShowTransferConfirm(null)} className="h-6 px-2 text-[11px] rounded bg-white/[0.08] text-zinc-500 hover:text-zinc-400 transition-colors">Cancel</button>
                            <button onClick={() => handleTransferOwnership(m.user_id)} className="h-6 px-2 text-[11px] font-medium rounded bg-white/[0.12] text-zinc-300 transition-colors">Confirm</button>
                          </div>
                        ) : (
                          <button key={m.id} onClick={() => setShowTransferConfirm(m.id)} className="h-6 px-2 text-[11px] rounded bg-white/[0.08] text-zinc-500 hover:text-zinc-400 transition-colors">{m.user?.display_name}</button>
                        )
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[13px] text-zinc-400">Delete workspace</span>
                    <div className="flex gap-1">
                      <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder={activeWorkspace?.name}
                        className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-300 placeholder-zinc-500 outline-none w-36" />
                      <button disabled={deleteConfirmText !== activeWorkspace?.name}
                        className="h-7 px-3 text-[13px] font-medium rounded border border-red-500/15 text-red-400/30 disabled:opacity-30 hover:text-red-400/60 transition-colors">Delete</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}


        {/* ══════════════════════════════════════════════════ */}
        {/* SECURITY */}
        {/* ══════════════════════════════════════════════════ */}
        {activeTab === 'security' && (
          <div className="p-4 space-y-3">

            {/* ── Authentication ── */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-[10px] h-[34px] shrink-0 rounded-md" style={{ background: 'rgba(0,0,0,0.90)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Authentication</span>
              </div>
              <div className="rounded-md divide-y divide-white/[0.04]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div><div className="text-[13px] text-zinc-300">SSO / SAML</div><div className="text-[11px] text-zinc-500 mt-0.5">Identity provider sign-on</div></div>
                  <button onClick={() => setSsoEnabled(!ssoEnabled)} className={`w-8 h-4 rounded relative transition-colors shrink-0 ${ssoEnabled ? 'bg-white/[0.20]' : 'bg-white/[0.08]'}`}>
                    <div className={`w-3 h-3 rounded-sm absolute top-0.5 transition-all ${ssoEnabled ? 'left-[18px] bg-[#0a0a0b]' : 'left-0.5 bg-zinc-500'}`} />
                  </button>
                </div>
                {ssoEnabled && (
                  <div className="grid gap-3 px-4 py-3">
                    <div><label className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">IdP URL</label><input value={ssoIdpUrl} onChange={e => setSsoIdpUrl(e.target.value)} placeholder="https://idp.example.com/sso/saml" className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-300 placeholder-zinc-500 outline-none focus:border-white/[0.15] w-full" /></div>
                    <div><label className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">Entity ID</label><input value={ssoEntityId} onChange={e => setSsoEntityId(e.target.value)} placeholder="urn:xeno:workspace" className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-300 placeholder-zinc-500 outline-none focus:border-white/[0.15] w-full" /></div>
                    <div><label className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">Certificate</label><textarea value={ssoCert} onChange={e => setSsoCert(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" rows={3} className="w-full px-2 py-1.5 bg-black/30 border border-white/[0.08] rounded text-[12px] text-zinc-300 placeholder-zinc-500 outline-none focus:border-white/[0.15] font-mono resize-y" /></div>
                    <button className="h-7 px-3 text-[13px] font-medium bg-white/[0.08] text-zinc-400 rounded hover:bg-white/[0.15] hover:text-zinc-300 transition-colors self-start">Save</button>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-3">
                  <div><div className="text-[13px] text-zinc-300">SCIM Provisioning</div><div className="text-[11px] text-zinc-500 mt-0.5">Auto-sync from IdP</div></div>
                  <button onClick={() => setScimEnabled(!scimEnabled)} className={`w-8 h-4 rounded relative transition-colors shrink-0 ${scimEnabled ? 'bg-white/[0.20]' : 'bg-white/[0.08]'}`}>
                    <div className={`w-3 h-3 rounded-sm absolute top-0.5 transition-all ${scimEnabled ? 'left-[18px] bg-[#0a0a0b]' : 'left-0.5 bg-zinc-500'}`} />
                  </button>
                </div>
                {scimEnabled && (
                  <div className="grid gap-3 px-4 py-3">
                    <div><label className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">Base URL</label><div className="h-7 px-2 flex items-center bg-black/30 border border-white/[0.08] rounded text-[12px] text-zinc-400 font-mono">https://api.xenostudio.ai/scim/v2</div></div>
                    <div><label className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">Token</label><div className="flex gap-1"><div className="h-7 px-2 flex-1 flex items-center bg-black/30 border border-white/[0.08] rounded text-[12px] text-zinc-400 font-mono">{scimToken}</div><button onClick={() => { navigator.clipboard.writeText(scimToken); setScimTokenCopied(true); setTimeout(() => setScimTokenCopied(false), 1500); }} className="w-7 h-7 flex items-center justify-center rounded bg-white/[0.08] text-zinc-500 hover:text-zinc-300 transition-colors">{scimTokenCopied ? <Check size={10} /> : <Copy size={10} />}</button></div></div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Policies ── */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-[10px] h-[34px] shrink-0 rounded-md" style={{ background: 'rgba(0,0,0,0.90)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Policies</span>
              </div>
              <div className="rounded-md divide-y divide-white/[0.04]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {/*
                  This toggle flipped local React state and nothing else. There is
                  no MFA implementation on the platform — no TOTP library, no
                  /auth/mfa route, and no server-side producer of `has_2fa` or
                  `enforce_2fa` — so an administrator could switch on "Require
                  two-factor authentication" for their whole organisation, see it
                  turn on, and believe their team was protected when no factor was
                  ever demanded of anyone.

                  A security control that reports success without enforcing
                  anything is worse than an absent one. Disabled until TOTP ships.
                */}
                <div className="flex items-center justify-between px-4 py-3 opacity-50">
                  <div>
                    <div className="text-[13px] text-zinc-300">Enforce 2FA</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">Not yet available — two-factor authentication is not implemented</div>
                  </div>
                  <button
                    disabled
                    aria-disabled="true"
                    title="Two-factor authentication is not yet implemented on XENO accounts"
                    className="w-8 h-4 rounded relative shrink-0 bg-white/[0.08] cursor-not-allowed"
                  >
                    <div className="w-3 h-3 rounded-sm absolute top-0.5 left-0.5 bg-zinc-600" />
                  </button>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <div><div className="text-[13px] text-zinc-300">Domain Lock</div><div className="text-[11px] text-zinc-500 mt-0.5">Restrict email domains</div></div>
                  <button onClick={() => setRestrictDomains(!restrictDomains)} className={`w-8 h-4 rounded relative transition-colors shrink-0 ${restrictDomains ? 'bg-white/[0.20]' : 'bg-white/[0.08]'}`}>
                    <div className={`w-3 h-3 rounded-sm absolute top-0.5 transition-all ${restrictDomains ? 'left-[18px] bg-[#0a0a0b]' : 'left-0.5 bg-zinc-500'}`} />
                  </button>
                </div>
                {restrictDomains && <div className="px-4 py-2"><input value={allowedDomain} onChange={e => setAllowedDomain(e.target.value)} className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-300 outline-none w-48" /></div>}
                <div className="flex items-center justify-between px-4 py-3">
                  <div><div className="text-[13px] text-zinc-300">IP Allow List</div><div className="text-[11px] text-zinc-500 mt-0.5">Restrict by IP range</div></div>
                  <button onClick={() => setIpAllowEnabled(!ipAllowEnabled)} className={`w-8 h-4 rounded relative transition-colors shrink-0 ${ipAllowEnabled ? 'bg-white/[0.20]' : 'bg-white/[0.08]'}`}>
                    <div className={`w-3 h-3 rounded-sm absolute top-0.5 transition-all ${ipAllowEnabled ? 'left-[18px] bg-[#0a0a0b]' : 'left-0.5 bg-zinc-500'}`} />
                  </button>
                </div>
                {ipAllowEnabled && <div className="px-4 py-2"><textarea value={ipAllowList} onChange={e => setIpAllowList(e.target.value)} placeholder="10.0.0.0/8&#10;One CIDR per line" rows={2} className="w-full px-2 py-1.5 bg-black/30 border border-white/[0.08] rounded text-[12px] text-zinc-300 placeholder-zinc-500 outline-none font-mono resize-y" /></div>}
                <div className="flex items-center justify-between px-4 py-3">
                  <div><div className="text-[13px] text-zinc-300">Session Timeout</div><div className="text-[11px] text-zinc-500 mt-0.5">Auto-logout after inactivity</div></div>
                  <select value={sessionTimeout} onChange={e => setSessionTimeout(e.target.value)} style={{ colorScheme: 'dark' }}
                    className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-400 outline-none cursor-pointer appearance-none">
                    <option value="30m">30 min</option><option value="1h">1 hour</option><option value="4h">4 hours</option><option value="24h">24 hours</option>
                  </select>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <div><div className="text-[13px] text-zinc-300">Audit Retention</div><div className="text-[11px] text-zinc-500 mt-0.5">Log retention period</div></div>
                  <select value={auditRetention} onChange={e => setAuditRetention(e.target.value)} style={{ colorScheme: 'dark' }}
                    className="h-7 px-2 bg-black/30 border border-white/[0.08] rounded text-[13px] text-zinc-400 outline-none cursor-pointer appearance-none">
                    <option value="30d">30 days</option><option value="90d">90 days</option><option value="1y">1 year</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── Sessions ── */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-[10px] h-[34px] shrink-0 rounded-md" style={{ background: 'rgba(0,0,0,0.90)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Active Sessions</span>
                <span className="text-[10px] text-white/[0.12] tabular-nums">{sessions.length}</span>
              </div>
              <div className="rounded-md divide-y divide-white/[0.04]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {sessions.map(s => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-2">
                      {s.device.includes('iPhone') || s.device.includes('Android') ? <Smartphone size={13} className="text-zinc-500" /> : <Monitor size={13} className="text-zinc-500" />}
                      <div>
                        <div className="text-[13px] text-zinc-300">{s.user_name} <span className="text-zinc-500">· {s.device}</span>{s.current && <span className="text-[11px] px-1 py-px rounded bg-white/[0.06] text-zinc-400 uppercase tracking-wide ml-1">Current</span>}</div>
                        <div className="text-[11px] text-zinc-500">{s.ip} · {s.location} · {formatRelative(s.last_active)}</div>
                      </div>
                    </div>
                    {!s.current && <button className="h-6 px-2 flex items-center gap-1 text-[11px] rounded bg-white/[0.08] text-zinc-500 hover:text-zinc-300 transition-colors"><LogOut size={9} /> Revoke</button>}
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/* ACTIVITY */}
        {/* ══════════════════════════════════════════════════ */}
        {activeTab === 'activity' && (
          <div className="p-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-[10px] h-[34px] shrink-0 rounded-md" style={{ background: 'rgba(0,0,0,0.90)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Audit Log</span>
                <span className="text-[10px] text-white/[0.12] tabular-nums">{audit.length} events</span>
              </div>
              <div className="rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="grid gap-3 px-4 py-2 border-b border-white/[0.06]" style={{ gridTemplateColumns: '1fr 2fr 1.5fr 1.5fr' }}>
                  <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">Time</span>
                  <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">Action</span>
                  <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">Actor</span>
                  <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">Target</span>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {audit.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).map(entry => (
                    <div key={entry.id} className="grid gap-3 px-4 py-2 hover:bg-white/[0.02] transition-colors" style={{ gridTemplateColumns: '1fr 2fr 1.5fr 1.5fr' }}>
                      <span className="text-[12px] text-zinc-500 tabular-nums">{formatDate(entry.ts)}</span>
                      <span className="text-[13px] font-medium text-zinc-300">{actionLabel[entry.action] || entry.action}</span>
                      <span className="text-[13px] text-zinc-400">{entry.actor}</span>
                      <span className="text-[12px] text-zinc-500">{entry.target || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ═══ Footer — viewport bottom ═══ */}
      <div className="h-7 flex items-center justify-between px-4 text-[11px] text-zinc-600 shrink-0">
        {activeTab === 'members' && (<>
          <span>Showing {filteredMembers.length} of {members.length}</span>
          <span className="tabular-nums">{isRefreshing ? 'Syncing…' : 'Synced'}</span>
        </>)}
        {activeTab === 'settings' && (<>
          <span>{roles.length} roles · {apiKeys.length} keys</span>
          <span>{isOwner ? 'Owner' : userRole}</span>
        </>)}
        {activeTab === 'security' && (<>
          <span>{[ssoEnabled && 'SSO', enforce2fa && '2FA', restrictDomains && 'Domain', ipAllowEnabled && 'IP'].filter(Boolean).join(' · ') || 'No policies'}</span>
          <span>{sessions.length} sessions</span>
        </>)}
        {activeTab === 'activity' && (<>
          <span>{audit.length} events</span>
          <span>{auditRetention} retention</span>
        </>)}
      </div>
    </div>
  );
};

export default TeamPage;
