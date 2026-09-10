import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CalendarDays, FolderKanban, LayoutGrid, List, MessageSquare, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { archiveProject, createProject, listProjects, updateProject, type Project } from '../../services/accountService';
import ResourceState from '../platform/ResourceState';
import ProjectTeamAssignments from './ProjectTeamAssignments';
import DrawerLayoutControl, { type DrawerLayout } from '../platform/DrawerLayoutControl';
import ActionDialog from '../platform/ActionDialog';

type View = 'list' | 'board' | 'calendar';
type ProjectAction = { kind: 'rename' | 'archive'; project: Project; workspaceId: string };

const projectState = (project: Project) => project.is_archived ? 'Archived' : String(project.settings?.status || 'Active');
const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { activeWorkspace, isLoading: workspaceLoading } = useWorkspace();
  const activeWorkspaceId = useRef(activeWorkspace?.id);
  activeWorkspaceId.current = activeWorkspace?.id;
  const actionContext = useRef({ workspaceId: activeWorkspace?.id, projectId, generation: 0 });
  if (actionContext.current.workspaceId !== activeWorkspace?.id || actionContext.current.projectId !== projectId) {
    actionContext.current = { workspaceId: activeWorkspace?.id, projectId, generation: actionContext.current.generation + 1 };
  }
  const loadGeneration = useRef(0);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(() => (localStorage.getItem('xeno_projects_view') as View) || 'list');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState('');
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);
  const confirmedArchive = useRef<string>();
  const [drawerLayout, setDrawerLayout] = useState<DrawerLayout>(() => localStorage.getItem('xeno_detail_layout') === 'full' ? 'full' : 'side');
  const changeDrawerLayout = (layout: DrawerLayout) => { setDrawerLayout(layout); localStorage.setItem('xeno_detail_layout', layout); };

  const load = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    const workspaceId = activeWorkspace.id;
    const generation = ++loadGeneration.current;
    setState('loading'); setError('');
    setProjectAction(null);
    setProjects([]);
    try {
      const result = await listProjects(workspaceId);
      if (activeWorkspaceId.current !== workspaceId || generation !== loadGeneration.current) return;
      setProjects(result.projects || []);
      setLoadedWorkspaceId(workspaceId);
      setState('ready');
    } catch (cause) {
      if (activeWorkspaceId.current !== workspaceId || generation !== loadGeneration.current) return;
      setProjects([]);
      setError(cause instanceof Error ? cause.message : 'Projects are unavailable.');
      setState('error');
    }
  }, [activeWorkspace?.id]);
  useEffect(() => { setProjectAction(null); }, [activeWorkspace?.id, projectId]);

  useEffect(() => { if (activeWorkspace?.id) void load(); }, [load, activeWorkspace?.id]);
  useEffect(() => {
    setCreating(false); setName(''); setDescription(''); setBusy(''); setQuery('');
    return () => { ++loadGeneration.current; };
  }, [activeWorkspace?.id]);
  const selectView = (next: View) => { setView(next); localStorage.setItem('xeno_projects_view', next); };
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return loadedWorkspaceId === activeWorkspace?.id
      ? projects.filter((project) => !needle || `${project.name} ${project.description || ''}`.toLowerCase().includes(needle)) : [];
  }, [projects, query, loadedWorkspaceId, activeWorkspace?.id]);
  const selected = loadedWorkspaceId === activeWorkspace?.id ? projects.find((project) => project.id === projectId) || null : null;

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !name.trim()) return;
    const workspaceId = activeWorkspace.id;
    setBusy('create'); setError('');
    try {
      const result = await createProject(name.trim(), workspaceId, description.trim() || undefined);
      if (activeWorkspaceId.current !== workspaceId) return;
      setProjects((current) => [result.project, ...current]);
      setName(''); setDescription(''); setCreating(false);
      navigate(`/overview/projects/${result.project.id}`);
    } catch (cause) { if (activeWorkspaceId.current === workspaceId) setError(cause instanceof Error ? cause.message : 'Project creation failed.'); }
    finally { if (activeWorkspaceId.current === workspaceId) setBusy(''); }
  };

  const renameSelected = () => {
    if (selected && activeWorkspace?.id) setProjectAction({ kind: 'rename', project: selected, workspaceId: activeWorkspace.id });
  };

  const archiveSelected = () => {
    confirmedArchive.current = undefined;
    if (selected && activeWorkspace?.id) setProjectAction({ kind: 'archive', project: selected, workspaceId: activeWorkspace.id });
  };

  const confirmProjectAction = async (action: ProjectAction, next: string) => {
    if (activeWorkspaceId.current !== action.workspaceId || projectId !== action.project.id) throw new Error('The active project changed. Reopen the action in its workspace.');
    const generation = loadGeneration.current;
    const contextGeneration = actionContext.current.generation;
    const stillCurrent = () => activeWorkspaceId.current === action.workspaceId && loadGeneration.current === generation && actionContext.current.generation === contextGeneration;
    if (action.kind === 'rename' && next === action.project.name) return;
    setBusy(action.project.id); setError('');
    try {
      if (action.kind === 'rename') {
        if (!next || next.length > 255) throw new Error('Enter a project name of 1–255 characters.');
        const result = await updateProject(action.project.id, { name: next });
        if (!stillCurrent()) return;
        if (result.project.id !== action.project.id || result.project.name !== next) throw new Error('The server did not confirm the requested project name.');
        setProjects(current => current.map(item => item.id === action.project.id ? result.project : item));
      } else {
        if (confirmedArchive.current !== action.project.id) {
          await archiveProject(action.project.id);
          if (!stillCurrent()) return;
          confirmedArchive.current = action.project.id;
        }
        if (!stillCurrent()) return;
        const result = await listProjects(action.workspaceId);
        if (!stillCurrent()) return;
        if (result.projects.some(item => item.id === action.project.id && !item.is_archived)) throw new Error('The project is still active after the archive request.');
        setProjects(result.projects.filter(item => !item.is_archived));
        navigate('/overview/projects');
      }
    } finally { if (stillCurrent()) setBusy(''); }
  };

  if (workspaceLoading && !activeWorkspace) return <main className="xeno-platform-page"><ResourceState kind="loading" title="Loading workspace projects" /></main>;
  if (!activeWorkspace) return <main className="xeno-platform-page"><ResourceState kind="unavailable" layout="page" title="Choose a workspace first" detail="Projects are durable workspace resources. Select or create a workspace to manage them." /></main>;

  return <main className="xeno-platform-page xeno-projects-page">
    <header className="xeno-platform-page-header"><div><span className="xeno-page-eyebrow">{activeWorkspace.name}</span><h1>Projects</h1><p>Workspace projects for conversations, files, instructions, schedules, and agent work.</p></div><div className="xeno-header-actions"><button type="button" className="xeno-page-button" onClick={() => void load()}><RefreshCw size={15} />Refresh</button><button type="button" className="xeno-page-button is-primary" onClick={() => setCreating(true)}><Plus size={15} />New project</button></div></header>
    {error ? <div className="xeno-inline-error" role="alert">{error}</div> : null}
    <div className="xeno-project-toolbar"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /></label><div role="group" aria-label="Project view"><button type="button" className={view === 'list' ? 'is-active' : ''} onClick={() => selectView('list')}><List size={15} />List</button><button type="button" className={view === 'board' ? 'is-active' : ''} onClick={() => selectView('board')}><LayoutGrid size={15} />Board</button><button type="button" className={view === 'calendar' ? 'is-active' : ''} onClick={() => selectView('calendar')}><CalendarDays size={15} />Calendar</button></div></div>
    {state === 'loading' ? <ResourceState kind="loading" title="Loading persisted projects" /> : state === 'error' ? <ResourceState kind="error" title="We couldn't load projects" detail={error} actionLabel="Try again" onRetry={() => void load()} /> : filtered.length === 0 ? <ResourceState kind="empty" layout="page" previewLabel="Workspace / Projects" title={query ? 'No matching projects' : 'No projects yet'} detail={query ? 'Change the search or clear it to see all projects.' : 'Create a persisted project to keep conversations, files, instructions, schedules, and agent work together.'} actionLabel={query ? 'Clear search' : 'Create project'} onRetry={() => query ? setQuery('') : setCreating(true)} /> : view === 'list' ? <section className="xeno-data-card xeno-project-list"><header><span>Name</span><span>Contents</span><span>Status</span><span>Updated</span></header>{filtered.map((project) => <button type="button" key={project.id} onClick={() => navigate(`/overview/projects/${project.id}`)}><span><i><FolderKanban size={16} /></i><b>{project.name}</b><small>{project.description || 'No description'}</small></span><span>{Number(project.chat_count || 0)} chats · {Number(project.file_count || 0)} files</span><span>{projectState(project)}</span><time>{dateLabel(project.updated_at)}</time></button>)}</section> : view === 'board' ? <section className="xeno-project-board"><div><header><span>Active</span><b>{filtered.filter((item) => !item.is_archived).length}</b></header>{filtered.filter((item) => !item.is_archived).map((project) => <button type="button" key={project.id} onClick={() => navigate(`/overview/projects/${project.id}`)}><FolderKanban size={16} /><strong>{project.name}</strong><p>{project.description || 'No description'}</p><small>{Number(project.chat_count || 0)} chats · updated {dateLabel(project.updated_at)}</small></button>)}</div></section> : <section className="xeno-data-card xeno-project-calendar">{filtered.map((project) => <button type="button" key={project.id} onClick={() => navigate(`/overview/projects/${project.id}`)}><time>{new Date(project.updated_at).toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}</time><span><strong>{project.name}</strong><small>Last persisted update · {Number(project.chat_count || 0)} chats</small></span></button>)}</section>}
    {creating ? <div className="xeno-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}><aside className="xeno-detail-drawer" role="dialog" aria-modal="true" aria-label="Create project"><header><span className="xeno-integration-logo"><FolderKanban size={20} /></span><span><small>{activeWorkspace.name}</small><h2>New project</h2></span><button type="button" onClick={() => setCreating(false)} aria-label="Close"><X size={18} /></button></header><form className="xeno-project-form" onSubmit={submitCreate}><label>Project name<input autoFocus required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Description<textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label><p>This creates a server-backed project in the active workspace. It is immediately available to people and agents with access.</p><button type="submit" className="xeno-page-button is-primary" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create project'}</button></form></aside></div> : null}
    {selected ? <div className="xeno-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) navigate('/overview/projects'); }}><aside className={`xeno-detail-drawer${drawerLayout === 'full' ? ' is-fullpage' : ''}`} role="dialog" aria-modal="true" aria-label={`${selected.name} details`}><header><span className="xeno-integration-logo"><FolderKanban size={20} /></span><span><small>{projectState(selected)}</small><h2>{selected.name}</h2></span><DrawerLayoutControl value={drawerLayout} onChange={changeDrawerLayout} /><button type="button" onClick={() => navigate('/overview/projects')} aria-label="Close"><X size={18} /></button></header><nav className="xeno-drawer-tabs" aria-label="Project detail sections"><button type="button" className="is-active">Overview</button><button type="button" disabled>Activity</button><span>Persisted project</span></nav><section><p>{selected.description || 'No description has been added.'}</p><dl className="xeno-project-facts"><div><dt>Conversations</dt><dd>{Number(selected.chat_count || 0)}</dd></div><div><dt>Files</dt><dd>{Number(selected.file_count || 0)}</dd></div><div><dt>Updated</dt><dd>{dateLabel(selected.updated_at)}</dd></div></dl><ProjectTeamAssignments key={`${activeWorkspace.id}:${selected.id}`} workspaceId={activeWorkspace.id} projectId={selected.id} /><div className="xeno-project-actions"><button type="button" className="xeno-page-button is-primary" onClick={() => navigate(`/overview/chat/projects/${selected.id}`)}><MessageSquare size={15} />Open project chat</button><button type="button" className="xeno-page-button" disabled={busy === selected.id} onClick={() => void renameSelected()}>Rename</button><button type="button" className="xeno-page-button" disabled={busy === selected.id} onClick={() => void archiveSelected()}><Archive size={15} />Archive</button></div></section></aside></div> : null}
    {projectAction && projectAction.workspaceId === activeWorkspace.id && projectAction.project.id === selected?.id ?
      <ActionDialog key={`${projectAction.workspaceId}:${projectAction.project.id}:${projectAction.kind}`}
        title={projectAction.kind === 'rename' ? 'Rename project' : 'Archive project'}
        detail={projectAction.kind === 'rename' ? `Rename “${projectAction.project.name}”.` : `Archive “${projectAction.project.name}”? Its active schedules will be paused.`}
        confirmLabel={projectAction.kind === 'rename' ? 'Save name' : 'Archive project'} destructive={projectAction.kind === 'archive'}
        fieldLabel={projectAction.kind === 'rename' ? 'Project name' : undefined} initialValue={projectAction.project.name}
        onConfirm={next => confirmProjectAction(projectAction, next)} onClose={() => setProjectAction(null)} /> : null}
  </main>;
};

export default ProjectsPage;
