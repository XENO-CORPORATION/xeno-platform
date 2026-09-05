import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Building2, Mail, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { getWorkspaceAudit, getWorkspaceInvites, inviteToWorkspace, removeWorkspaceMember, resendInvite, revokeInvite, transferOwnership, updateWorkspace, updateWorkspaceMember, type WorkspaceInvite } from '../../services/accountService';
import ResourceState from '../platform/ResourceState';
import AccountSettingsNav from './AccountSettingsNav';

type Tab = 'members' | 'settings' | 'security' | 'activity';
const tabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: 'members', label: 'Members', icon: Users }, { id: 'settings', label: 'Workspace', icon: Building2 },
  { id: 'security', label: 'Security', icon: ShieldCheck }, { id: 'activity', label: 'Activity', icon: Activity },
];
const unsupported = [
  ['Two-factor authentication policy', 'Account-level 2FA management is not backed by a platform API.'],
  ['Single sign-on and SCIM', 'Workspace identity-provider and provisioning contracts are not implemented.'],
  ['Domain and IP restrictions', 'Enforcement and audit contracts are required before controls can be enabled.'],
  ['Workspace API keys', 'No workspace-scoped key issuance or revocation contract exists.'],
];

const TeamPage: React.FC = () => {
  const navigate = useNavigate(); const { tab } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: Tab = tab === 'settings' || tab === 'security' || tab === 'activity' ? tab : 'members';
  const { activeWorkspace, members, refreshMembers, refreshWorkspaces, createWorkspace, isOwner, userRole, error: workspaceError } = useWorkspace();
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]); const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const [email, setEmail] = useState(''); const [role, setRole] = useState('member');
  const [createOpen, setCreateOpen] = useState(false); const [workspaceName, setWorkspaceName] = useState('');
  const [editName, setEditName] = useState(activeWorkspace?.name || ''); const [editSlug, setEditSlug] = useState(activeWorkspace?.slug || '');
  useEffect(() => { setEditName(activeWorkspace?.name || ''); setEditSlug(activeWorkspace?.slug || ''); }, [activeWorkspace?.id, activeWorkspace?.name, activeWorkspace?.slug]);
  useEffect(() => { if (searchParams.get('create') === '1') { setCreateOpen(true); setSearchParams({}, { replace: true }); } }, [searchParams, setSearchParams]);
  const load = useCallback(async () => {
    if (!activeWorkspace) { setLoading(false); return; }
    setLoading(true); setError(''); setInvites([]); setEvents([]);
    try {
      await refreshMembers();
      if (activeTab === 'members') setInvites((await getWorkspaceInvites(activeWorkspace.id)).invites);
      if (activeTab === 'activity') setEvents((await getWorkspaceAudit(activeWorkspace.id, 100)).events);
    } catch (err) { setError(err instanceof Error ? err.message : 'Workspace data is unavailable'); }
    finally { setLoading(false); }
  }, [activeWorkspace?.id, activeTab, refreshMembers]);
  useEffect(() => { load(); }, [load]);
  const mutate = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key); setError('');
    try { await operation(); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'The server did not confirm this change'); }
    finally { setBusy(''); }
  };
  const createDialog = createOpen ? <div className="xeno-command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}><form className="xeno-create-workspace-dialog" role="dialog" aria-modal="true" aria-label="Create workspace" onSubmit={(event) => { event.preventDefault(); if (!workspaceName.trim()) return; mutate('create-workspace', () => createWorkspace(workspaceName.trim()).then(() => { setWorkspaceName(''); setCreateOpen(false); })); }}><header><span><small>Workspace</small><h2>Create a team workspace</h2></span><button type="button" onClick={() => setCreateOpen(false)} aria-label="Close"><X size={18} /></button></header><p>Creates a real workspace and selects it only after the server confirms membership.</p><input autoFocus value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace name" required /><footer><button type="button" className="xeno-page-button" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" className="xeno-page-button is-primary" disabled={busy === 'create-workspace'}>Create workspace</button></footer></form></div> : null;
  if (!activeWorkspace) return <main className="xeno-platform-page"><ResourceState kind={workspaceError ? 'error' : 'empty'} layout="page" previewLabel="Workspace / Members" title={workspaceError ? 'We couldn\'t load your workspace' : 'Create your first workspace'} detail={workspaceError || 'Bring people, projects, automations, and shared account controls into one confirmed workspace.'} actionLabel={workspaceError ? 'Try again' : 'Create workspace'} onRetry={workspaceError ? load : () => setCreateOpen(true)} secondaryActionLabel="Back to dashboard" onSecondaryAction={() => navigate('/overview')} />{createDialog}</main>;
  return <main className="xeno-platform-page xeno-account-page"><header className="xeno-platform-page-header"><div><span className="xeno-page-eyebrow">Workspace</span><h1>{activeWorkspace.name}</h1><p>{activeWorkspace.workspace_type === 'team' ? 'Members, governance, and confirmed activity.' : 'Your personal XENO workspace.'}</p></div><div className="xeno-header-actions"><button type="button" className="xeno-page-button" onClick={() => setCreateOpen(true)}><Plus size={15} />New workspace</button><button type="button" className="xeno-page-button" onClick={load}><RefreshCw size={15} />Refresh</button></div></header>
    <AccountSettingsNav />
    <nav className="xeno-settings-tabs" aria-label="Workspace settings">{tabs.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={activeTab === item.id ? 'is-active' : ''} onClick={() => navigate(item.id === 'members' ? '/overview/team' : `/overview/team/${item.id}`)}><Icon size={16} />{item.label}</button>; })}</nav>
    {error ? <div className="xeno-inline-error" role="alert">{error}</div> : null}
    {loading ? <ResourceState kind="loading" /> : activeTab === 'members' ? <>
      {isOwner || userRole === 'admin' ? <form className="xeno-invite-bar" onSubmit={(event) => { event.preventDefault(); if (!email.trim()) return; mutate('invite', () => inviteToWorkspace(activeWorkspace.id, email.trim(), role).then(() => setEmail(''))); }}><UserPlus size={17} /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="person@company.com" aria-label="Email to invite" /><select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Invite role"><option value="member">Member</option><option value="admin">Admin</option></select><button type="submit" disabled={busy === 'invite'}>Send invite</button></form> : null}
      <section className="xeno-data-card"><header><h2>Members</h2><span>{members.length}</span></header>{members.length ? members.map((member) => <div className="xeno-member-row" key={member.id}><span className="xeno-member-avatar">{(member.user?.display_name || member.user?.email || '?').slice(0, 1).toUpperCase()}</span><span><strong>{member.user?.display_name || member.user?.username || member.user?.email || 'Workspace member'}</strong><small>{member.user?.email || member.member_status}</small></span>{isOwner && member.member_role !== 'owner' ? <select value={member.member_role} disabled={Boolean(busy)} onChange={(event) => mutate(`role-${member.id}`, () => updateWorkspaceMember(activeWorkspace.id, member.id, event.target.value))}><option value="member">Member</option><option value="admin">Admin</option></select> : <span className="xeno-role-badge">{member.member_role}</span>}{isOwner && member.member_role !== 'owner' ? <><button type="button" className="xeno-row-action" onClick={() => mutate(`owner-${member.id}`, () => transferOwnership(activeWorkspace.id, member.user_id))}>Make owner</button><button type="button" className="xeno-row-action is-danger" aria-label="Remove member" onClick={() => mutate(`remove-${member.id}`, () => removeWorkspaceMember(activeWorkspace.id, member.id))}><Trash2 size={15} /></button></> : null}</div>) : <ResourceState kind="empty" title="No members returned" />}</section>
      <section className="xeno-data-card"><header><h2>Pending invitations</h2><span>{invites.length}</span></header>{invites.length ? invites.map((invite) => <div className="xeno-member-row" key={invite.id}><span className="xeno-data-icon"><Mail size={16} /></span><span><strong>{invite.invited_email}</strong><small>{invite.role} · {invite.status}</small></span><button type="button" className="xeno-row-action" onClick={() => mutate(`resend-${invite.id}`, () => resendInvite(activeWorkspace.id, invite.id))}>Resend</button><button type="button" className="xeno-row-action is-danger" onClick={() => mutate(`revoke-${invite.id}`, () => revokeInvite(activeWorkspace.id, invite.id))}>Revoke</button></div>) : <ResourceState kind="empty" title="No pending invitations" />}</section>
    </> : activeTab === 'settings' ? <section className="xeno-data-card"><header><h2>Workspace record</h2><span className="xeno-role-badge">{activeWorkspace.status}</span></header><dl className="xeno-record-grid"><div><dt>Type</dt><dd>{activeWorkspace.workspace_type}</dd></div><div><dt>Your role</dt><dd>{userRole || 'unknown'}</dd></div><div><dt>Created</dt><dd>{new Date(activeWorkspace.created_at).toLocaleString()}</dd></div><div><dt>Workspace ID</dt><dd><code>{activeWorkspace.id}</code></dd></div></dl>{isOwner || userRole === 'admin' ? <form className="xeno-workspace-edit" onSubmit={(event) => { event.preventDefault(); mutate('workspace-update', async () => { await updateWorkspace(activeWorkspace.id, { name: editName.trim(), slug: editSlug.trim() }); await refreshWorkspaces(); }); }}><label>Name<input required maxLength={200} value={editName} onChange={(event) => setEditName(event.target.value)} /></label><label>Slug<input required minLength={3} maxLength={100} value={editSlug} onChange={(event) => setEditSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></label><button type="submit" className="xeno-page-button is-primary" disabled={busy === 'workspace-update'}>{busy === 'workspace-update' ? 'Saving…' : 'Save workspace'}</button></form> : <ResourceState kind="unavailable" title="Workspace editing requires an admin" detail="Your current role can read this record but cannot change workspace identity." />}</section> : activeTab === 'security' ? <section className="xeno-capability-list"><div className="xeno-truth-banner"><ShieldCheck size={18} /><span><strong>Server authorization is authoritative</strong><small>Membership, role, billing, and workspace access are enforced by authenticated server routes.</small></span></div><article><span><strong>Account sessions</strong><small>Review and revoke active browser and device sessions from account settings.</small></span><button type="button" className="xeno-row-action" onClick={() => navigate('/overview/settings')}>Manage</button></article>{unsupported.map(([name, detail]) => <article key={name}><span><strong>{name}</strong><small>{detail}</small></span><span className="xeno-availability is-planned">Unavailable</span></article>)}</section> : <section className="xeno-data-card"><header><h2>Workspace audit</h2><span>{events.length}</span></header>{events.length ? events.map((event, index) => <div className="xeno-audit-row" key={String(event.id || index)}><span className="xeno-data-icon"><Activity size={16} /></span><span><strong>{String(event.action || event.event_type || 'Workspace event')}</strong><small>{String(event.actor_display_name || event.actor_email || event.actor_user_id || 'System')}</small></span><time>{event.created_at ? new Date(String(event.created_at)).toLocaleString() : 'Time unavailable'}</time></div>) : <ResourceState kind="empty" title="No audit events returned" detail="The workspace audit endpoint returned an empty event list." />}</section>}
    {createDialog}
  </main>;
};
export default TeamPage;
