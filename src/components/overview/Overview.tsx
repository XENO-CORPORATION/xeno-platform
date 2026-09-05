import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  BarChart3,
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Clock3,
  Coins,
  Command,
  FolderKanban,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { listProjects, type Project } from '../../services/accountService';
import { chatService } from '../../services/chatService';

interface OverviewProps {
  onAddCredits?: () => void;
  onOpenCommandPalette?: () => void;
}

interface DashboardStats {
  credits: number | null;
  lifetimeSpent: number | null;
  requests30d: number | null;
  usageBySurface: Array<{ surface: string; events: number; credits: number }>;
}

interface ScheduledTask {
  id: string;
  title?: string;
  name?: string;
  status?: string;
  updated_at?: string;
  created_at?: string;
  next_run_at?: string;
  cadence_label?: string;
}

interface RecentWorkItem {
  id: string;
  name: string;
  kind: 'project' | 'automation';
  status: string;
  updatedAt: string | null;
  detail: string;
  path: string;
}

const emptyStats: DashboardStats = {
  credits: null,
  lifetimeSpent: null,
  requests30d: null,
  usageBySurface: [],
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatNumber = (value: number | null) => value === null ? '—' : new Intl.NumberFormat().format(value);
const formatCredits = (value: number | null) => value === null ? '—' : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} cr`;
const formatDate = (value: string | null) => {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

const Overview: React.FC<OverviewProps> = ({ onAddCredits, onOpenCommandPalette }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [projects, setProjects] = useState<Project[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const loadDashboard = async () => {
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    setLoadError(null);
    const accessToken = getAccessToken();

    const authHeaders = (): Record<string, string> => {
      const workspace = localStorage.getItem('xeno_active_workspace_id');
      return {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(workspace ? { 'x-xeno-workspace': workspace } : {}),
      };
    };

    const statsRequest = fetch('/api/dashboard/stats', { headers: authHeaders(), credentials: 'include' }).then(async (response) => {
      if (!response.ok) throw new Error(`Dashboard metrics are unavailable (${response.status})`);
      const body = await response.json();
      const raw = body?.stats ?? {};
      const usageBySurface = Array.isArray(raw.usage_by_surface)
        ? raw.usage_by_surface.map((row: Record<string, unknown>) => ({
            surface: typeof row.surface === 'string' ? row.surface : 'other',
            events: number(row.events) ?? 0,
            credits: number(row.credits) ?? 0,
          }))
        : [];
      return {
        credits: number(raw.credits),
        lifetimeSpent: number(raw.lifetime_spent),
        requests30d: number(raw.requests_30d),
        usageBySurface,
      } satisfies DashboardStats;
    });

    const projectWorkspaceId = activeWorkspace?.id && UUID_PATTERN.test(activeWorkspace.id)
      ? activeWorkspace.id
      : undefined;
    const projectRequest = listProjects(projectWorkspaceId).then((result) => result.projects || []);
    const automationRequest = accessToken
      ? chatService.getScheduledTasks({ sort: 'updated' }) as Promise<ScheduledTask[]>
      : Promise.reject(new Error('Authentication required'));
    const [statsResult, projectResult, automationResult] = await Promise.allSettled([
      statsRequest,
      projectRequest,
      automationRequest,
    ]);
    if (generation !== loadGeneration.current) return;

    const failures: string[] = [];
    if (statsResult.status === 'fulfilled') setStats(statsResult.value);
    else {
      setStats(emptyStats);
      failures.push('usage');
    }
    if (projectResult.status === 'fulfilled') setProjects(projectResult.value);
    else {
      setProjects([]);
      failures.push('projects');
    }
    if (automationResult.status === 'fulfilled') setScheduledTasks(automationResult.value);
    else {
      setScheduledTasks([]);
      failures.push('automations');
    }
    setLoadError(failures.length ? `Could not load ${failures.join(', ')}. The dashboard is showing only confirmed data.` : null);
    setIsLoading(false);
  };

  useEffect(() => { void loadDashboard(); }, [activeWorkspace?.id]);

  const projectCounts = useMemo(() => ({
    total: projects.length,
    active: projects.filter((project) => !project.is_archived).length,
    completed: projects.filter((project) => ['completed', 'closed', 'done'].includes(String(project.settings?.status || '').toLowerCase())).length,
  }), [projects]);

  const automationCounts = useMemo(() => ({
    total: scheduledTasks.length,
    active: scheduledTasks.filter((task) => ['active', 'scheduled', 'running'].includes((task.status || '').toLowerCase())).length,
    failed: scheduledTasks.filter((task) => ['failed', 'error'].includes((task.status || '').toLowerCase())).length,
  }), [scheduledTasks]);

  const recentWork = useMemo<RecentWorkItem[]>(() => {
    const projectItems = projects.map((project) => ({
      id: project.id,
      name: project.name,
      kind: 'project' as const,
      status: project.is_archived ? 'archived' : String(project.settings?.status || 'active'),
      updatedAt: project.updated_at || project.created_at || null,
      detail: project.description || 'Workspace project',
      path: `/overview/projects/${encodeURIComponent(project.id)}`,
    }));
    const automationItems = scheduledTasks.map((task) => ({
      id: task.id,
      name: task.title || task.name || 'Untitled automation',
      kind: 'automation' as const,
      status: task.status || 'scheduled',
      updatedAt: task.updated_at || task.created_at || task.next_run_at || null,
      detail: task.cadence_label || (task.next_run_at ? `Next run ${formatDate(task.next_run_at)}` : 'Scheduled automation'),
      path: '/overview/scheduled',
    }));
    return [...projectItems, ...automationItems]
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, 7);
  }, [projects, scheduledTasks]);

  const remainingCredits = stats.credits ?? (number(user?.credits) ?? null);
  const totalUsageEvents = stats.usageBySurface.reduce((sum, surface) => sum + surface.events, 0);

  const quickStarts = [
    {
      title: 'Ask XENO Agent',
      description: 'Plan work, inspect your context, and drive XENO products from one agent surface.',
      path: '/overview/chat/llm',
      icon: Bot,
      status: 'Ready',
    },
    {
      title: projects.length ? 'Continue a project' : 'Create a project',
      description: projects.length ? `Resume ${projects[0].name} in the active workspace.` : 'Create a durable workspace for files, conversations, and agent work.',
      path: projects[0] ? `/overview/projects/${encodeURIComponent(projects[0].id)}` : '/overview/projects',
      icon: FolderKanban,
    },
    {
      title: 'Build an automation',
      description: 'Schedule repeatable agent work and review every run from the same control plane.',
      path: '/overview/scheduled',
      icon: Workflow,
    },
  ];

  const renderMetricCard = (
    title: string,
    Icon: LucideIcon,
    totalLabel: string,
    totalValue: string,
    successLabel: string,
    successValue: string,
    alertLabel: string,
    alertValue: string,
  ) => (
    <article className="xeno-metric-card">
      <header className="xeno-metric-card-header"><h3>{title}</h3><button type="button" className="xeno-icon-button" aria-label={`More options for ${title}`}><MoreHorizontal size={15} /></button></header>
      <div className="xeno-metric-card-body">
        <div className="xeno-metric-kicker"><span><Icon size={15} strokeWidth={1.8} /></span><span>Current workspace</span></div>
        <div className="xeno-metric-main"><span>{totalLabel}</span><strong>{isLoading ? '···' : totalValue}</strong></div>
        <div className="xeno-metric-line"><span className="xeno-metric-dot" /><span>{successLabel}</span><strong>{isLoading ? '···' : successValue}</strong></div>
        <div className="xeno-metric-line"><span className="xeno-metric-dot is-alert" /><span>{alertLabel}</span><strong>{isLoading ? '···' : alertValue}</strong></div>
      </div>
    </article>
  );

  return (
    <main className="xeno-overview-dashboard">
      <header className="xeno-dashboard-header">
        <div className="xeno-breadcrumb"><span>Home</span><ChevronRight size={13} /><strong>{activeWorkspace?.name || 'Overview'}</strong></div>
        <div className="xeno-dashboard-actions">
          <button type="button" className="xeno-dashboard-command" aria-label="Search or enter a command" title="Search or enter a command" onClick={onOpenCommandPalette}><Command size={14} aria-hidden="true" /><span>Search or enter a command</span><kbd>⌘ K</kbd></button>
          <div className="xeno-credit-pill"><Coins size={14} />{formatCredits(remainingCredits)}</div>
          <button type="button" className="xeno-primary-button" onClick={onAddCredits}><CirclePlus size={15} />Add credits</button>
        </div>
      </header>

      <div className="xeno-dashboard-scroll">
        <section className="xeno-dashboard-section">
          <div className="xeno-section-heading-row">
            <h1 className="xeno-section-title"><Sparkles size={19} />Start with XENO</h1>
            <div className="xeno-progress-summary" aria-label="Three available starting points"><span className="xeno-progress-summary-track"><span /></span><strong>1/3</strong></div>
          </div>
          <div className="xeno-start-grid">
            {quickStarts.map((card) => {
              const Icon = card.icon;
              return (
                <button type="button" key={card.title} className="xeno-start-card" onClick={() => navigate(card.path)}>
                  <span className="xeno-card-icon"><Icon size={18} strokeWidth={1.8} /></span>
                  <span className="xeno-start-card-title">{card.title}{card.status ? <span className="xeno-status-chip">{card.status}</span> : null}</span>
                  <p>{card.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="xeno-dashboard-section">
          <div className="xeno-section-heading-row">
            <h2 className="xeno-section-title"><BarChart3 size={18} />Workspace activity</h2>
            <div className="xeno-section-actions">
              <button type="button" className="xeno-secondary-button"><CalendarDays size={14} />Last 30 days<ChevronDown size={13} /></button>
              <button type="button" className="xeno-secondary-button" onClick={() => navigate('/overview/usage-analytics')}><BarChart3 size={14} />View usage</button>
            </div>
          </div>
          {loadError ? <div className="xeno-dashboard-error"><span>{loadError}</span><button type="button" className="xeno-icon-button" onClick={() => void loadDashboard()} aria-label="Retry loading dashboard"><RefreshCw size={14} /></button></div> : null}
          <div className="xeno-metric-grid">
            {renderMetricCard('Projects', FolderKanban, 'Total projects', formatNumber(projectCounts.total), 'Active', formatNumber(projectCounts.active), 'Completed', formatNumber(projectCounts.completed))}
            {renderMetricCard('Automations', Workflow, 'Total automations', formatNumber(automationCounts.total), 'Active or scheduled', formatNumber(automationCounts.active), 'Needs attention', formatNumber(automationCounts.failed))}
            {renderMetricCard('Usage & credits', Coins, 'Requests (30 days)', formatNumber(stats.requests30d), 'Metered events', formatNumber(totalUsageEvents), 'Credits used', formatCredits(stats.lifetimeSpent))}
          </div>
        </section>

        <section className="xeno-dashboard-section">
          <div className="xeno-section-heading-row">
            <h2 className="xeno-section-title"><Workflow size={18} />Recent work</h2>
            <div className="xeno-section-actions">
              <button type="button" className="xeno-secondary-button" onClick={() => navigate('/overview/projects')}><FolderKanban size={14} />All projects</button>
              <button type="button" className="xeno-secondary-button" onClick={() => navigate('/overview/scheduled')}><Workflow size={14} />All automations</button>
            </div>
          </div>
          <div className="xeno-work-table-wrap">
            <table className="xeno-work-table">
              <thead><tr><th style={{ width: '31%' }}>Name</th><th style={{ width: '14%' }}>Type</th><th style={{ width: '15%' }}>Updated</th><th style={{ width: '22%' }}>Details</th><th style={{ width: '18%' }}>Status</th></tr></thead>
              <tbody>
                {isLoading ? Array.from({ length: 5 }, (_, index) => (
                  <tr key={index}><td><div className="xeno-skeleton" style={{ width: '72%', height: 10, borderRadius: 4 }}>Loading</div></td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
                )) : recentWork.length ? recentWork.map((item) => {
                  const status = item.status.toLowerCase();
                  return (
                    <tr key={`${item.kind}-${item.id}`} onClick={() => navigate(item.path)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') navigate(item.path); }}>
                      <td><div className="xeno-work-name">{item.name}</div></td>
                      <td><span className="xeno-kind-pill">{item.kind === 'project' ? <FolderKanban size={11} /> : <Workflow size={11} />}{item.kind}</span></td>
                      <td>{formatDate(item.updatedAt)}</td>
                      <td title={item.detail}><div className="xeno-work-name xeno-work-detail">{item.detail}</div></td>
                      <td><span className={`xeno-table-status is-${status}`}>{item.status}</span></td>
                    </tr>
                  );
                }) : (
                  <tr><td className="xeno-empty-row" colSpan={5}><strong>No project or automation activity yet</strong><span>Create a project or schedule agent work to see it here.</span></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
};

export default Overview;
import { getAccessToken } from '../../lib/authSession';
