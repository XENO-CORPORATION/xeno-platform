import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { archiveOperationalTeam, getWorkspaceTeams, saveOperationalTeam, type OperationalTeam, type TeamDraft, type WorkspaceTeamsResult } from '../../services/accountService';
import ResourceState from '../platform/ResourceState';
import { Checkbox } from '../ui/checkbox';

const emptyDraft = (): TeamDraft => ({ name: '', description: '', project_ids: [], agent_ids: [] });

export default function WorkspaceTeamsPage() {
  const { activeWorkspace } = useWorkspace();
  if (!activeWorkspace) return <main className="xeno-platform-page"><ResourceState kind="unavailable" title="Choose a workspace first" detail="Operational teams belong to a workspace." /></main>;
  // UUID-keyed remount isolates drafts, reads and mutation completions on switches.
  return <WorkspaceTeams key={activeWorkspace.id} workspaceId={activeWorkspace.id} workspaceName={activeWorkspace.name} />;
}

function WorkspaceTeams({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<WorkspaceTeamsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<OperationalTeam | 'new' | null>(null);
  const [draft, setDraft] = useState<TeamDraft>(emptyDraft);
  const [archiveTarget, setArchiveTarget] = useState<OperationalTeam | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError('');
    try { const result = await getWorkspaceTeams(workspaceId); if (mounted.current && request === generation.current) setData(result); }
    catch (cause) { if (mounted.current && request === generation.current) { setData(null); setError(cause instanceof Error ? cause.message : 'Teams could not be loaded'); } }
    finally { if (mounted.current && request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; generation.current++; }; }, [load]);
  const mutate = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      if (!mounted.current) return;
      setEditing(null); setArchiveTarget(null); setNotice(message); await load();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'The change was not confirmed'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const beginEdit = (team: OperationalTeam | 'new') => {
    setEditing(team); setArchiveTarget(null); setError(''); setNotice('');
    setDraft(team === 'new' ? emptyDraft() : { name: team.name, description: team.description, version: team.version,
      project_ids: team.projects.filter(project => !project.is_archived).map(project => project.id),
      agent_ids: team.agents.filter(agent => agent.status === 'active').map(agent => agent.id) });
  };
  const toggle = (field: 'project_ids' | 'agent_ids', id: string, on: boolean) => setDraft(current => ({ ...current, [field]: on ? [...current[field], id] : current[field].filter(value => value !== id) }));
  const editableAgents = [...(editing && editing !== 'new' ? editing.agents.filter(agent => agent.status === 'active') : []), ...(data?.available_agents || [])];
  return <main className="xeno-platform-page xeno-account-page">
    <header className="xeno-platform-page-header"><div><span className="xeno-page-eyebrow">{workspaceName}</span><h1>Teams</h1><p>Organize agents around shared workspace projects.</p></div><div className="xeno-header-actions">
      <button className="xeno-page-button" type="button" onClick={() => navigate('/overview/team')}>Workspace members</button>
      <button className="xeno-page-button" type="button" disabled={busy || loading} onClick={() => { setEditing(null); setArchiveTarget(null); void load(); }}>Refresh</button>
      {data?.can_manage && !editing && !archiveTarget ? <button className="xeno-page-button is-primary" type="button" disabled={busy || loading} onClick={() => beginEdit('new')}>New team</button> : null}
    </div></header>
    {error ? <div className="xeno-inline-error" role="alert">{error}</div> : null}
    {notice ? <div className="xeno-inline-success" role="status">{notice}</div> : null}
    {loading ? <ResourceState kind="loading" title="Loading workspace teams" /> : !data ? <ResourceState kind="error" title="Teams are unavailable" actionLabel="Try again" onRetry={() => void load()} /> : <>
      <div className="xeno-project-toolbar"><small>{!data.can_manage ? 'Only owners and admins can change teams. ' : ''}Assignments organize work; existing membership, execution permissions, and filesystem access remain unchanged.</small></div>
      {editing ? <section className="xeno-data-card"><header><h2>{editing === 'new' ? 'New team' : `Edit ${editing.name}`}</h2></header>
        <form className="xeno-project-form" onSubmit={event => { event.preventDefault(); if (!busy) void mutate(() => saveOperationalTeam(workspaceId, draft, editing === 'new' ? undefined : editing.id), 'Team saved.'); }}>
          <label>Team name<input autoFocus required maxLength={120} value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Description<textarea rows={3} maxLength={2000} value={draft.description} disabled={busy} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
          <fieldset disabled={busy}><legend>Assigned projects</legend>{data.projects.length ? data.projects.map(project => <label className="xeno-member-row" key={project.id}><Checkbox checked={draft.project_ids.includes(project.id)} onCheckedChange={value => toggle('project_ids', project.id, value === true)} /><span>{project.name}</span></label>) : <p>No active projects. Create one on the Projects page first.</p>}</fieldset>
          <fieldset disabled={busy}><legend>Assigned agents</legend>{editableAgents.length ? editableAgents.map(agent => <label className="xeno-member-row" key={agent.id}><Checkbox checked={draft.agent_ids.includes(agent.id)} onCheckedChange={value => toggle('agent_ids', agent.id, value === true)} /><span>{agent.name}</span></label>) : <p>No unassigned active agents owned by you are available.</p>}</fieldset>
          {editing !== 'new' && (editing.projects.some(project => project.is_archived) || editing.agents.some(agent => agent.status !== 'active')) ? <p>Archived projects and inactive agents will be unassigned when you save.</p> : null}
          <p>An agent belongs to one team per workspace. Remove its existing assignment before moving it.</p>
          <div className="xeno-header-actions"><button type="button" className="xeno-page-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="xeno-page-button is-primary" disabled={busy}>{busy ? 'Saving…' : 'Save team'}</button></div>
        </form></section> : null}
      {archiveTarget ? <section className="xeno-data-card"><header><h2>Archive {archiveTarget.name}?</h2></header><div className="xeno-project-form"><p>This removes team assignments. Projects, agents, conversations, and files are preserved.</p><div className="xeno-header-actions"><button type="button" className="xeno-page-button" disabled={busy} onClick={() => setArchiveTarget(null)}>Cancel</button><button type="button" className="xeno-page-button" disabled={busy} onClick={() => void mutate(() => archiveOperationalTeam(workspaceId, archiveTarget), 'Team archived. Projects and agents were preserved.')}>Confirm archive</button></div></div></section> : null}
      {!data.teams.length && !editing ? <ResourceState kind="empty" title="No teams yet" detail="Create an operational team, then assign workspace projects and your registered agents." /> : data.teams.map(team => <section className="xeno-data-card" key={team.id}>
        <header><h2>{team.name}</h2>{data.can_manage ? <div className="xeno-header-actions"><button type="button" className="xeno-page-button" disabled={busy} onClick={() => beginEdit(team)}>Edit</button><button type="button" className="xeno-page-button" disabled={busy} onClick={() => { setEditing(null); setArchiveTarget(team); }}>Archive</button></div> : null}</header>
        <div className="xeno-project-form">{team.description ? <p>{team.description}</p> : null}<h3>Projects · {team.projects.length}</h3>{team.projects.length ? team.projects.map(project => <div key={project.id}><button type="button" className="xeno-page-button" disabled={project.is_archived} onClick={() => navigate(`/overview/projects/${project.id}`)}>{project.name}{project.is_archived ? ' (archived)' : ''}</button></div>) : <p>No projects assigned.</p>}
          <h3>Agents · {team.agents.length}</h3>{team.agents.length ? team.agents.map(agent => <p key={agent.id}>{agent.name} · {agent.status}</p>) : <p>No agents assigned.</p>}
        </div></section>)}
    </>}
  </main>;
}
