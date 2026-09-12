import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FolderKanban, Loader2, Plus, ShieldAlert, Zap } from 'lucide-react';
import { authService } from '../../services/authService';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

type Project = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: string;
  allowApiAccess: boolean;
  allowOverage: boolean;
  dailyCreditLimitMicro: number | null;
  monthlyCreditLimitMicro: number | null;
  maxRequestsPerMinute: number | null;
  maxRequestsPerDay: number | null;
  apiKeysCount: number;
  totalRequests30d: number;
  totalTokens30d: number;
  totalCostMicro30d: number;
  isActive: boolean;
};

type Overview = {
  currentWorkspace: {
    id: string;
    name: string;
  } | null;
  currentProject: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

const ProjectsPage: React.FC = () => {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeWorkspaceName = useMemo(() => {
    return workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.name || 'Workspace';
  }, [selectedWorkspaceId, workspaces]);

  const loadOverview = async () => {
    const response = await fetch('/api/account/overview', {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load account overview');
    }

    return data.overview as Overview & { workspaces?: Workspace[] };
  };

  const loadWorkspaces = async () => {
    const response = await fetch('/api/workspaces', {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load workspaces');
    }

    return data.workspaces as Workspace[];
  };

  const loadProjects = async (workspaceId: string) => {
    const suffix = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
    const response = await fetch(`/api/projects${suffix}`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load projects');
    }

    return data.projects as Project[];
  };

  const loadData = async (preferredWorkspaceId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const [overviewData, workspaceData] = await Promise.all([
        loadOverview(),
        loadWorkspaces(),
      ]);

      const workspaceId = preferredWorkspaceId
        || overviewData.currentWorkspace?.id
        || workspaceData[0]?.id
        || '';

      setOverview(overviewData);
      setWorkspaces(workspaceData);
      setSelectedWorkspaceId(workspaceId);

      if (workspaceId) {
        const projectData = await loadProjects(workspaceId);
        setProjects(projectData);
      } else {
        setProjects([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    loadProjects(selectedWorkspaceId)
      .then((projectData) => setProjects(projectData))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load projects');
      });
  }, [selectedWorkspaceId]);

  const handleCreateProject = async () => {
    if (!projectName.trim() || !selectedWorkspaceId) {
      setError('Project name and workspace are required');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify({
          workspaceId: selectedWorkspaceId,
          name: projectName.trim(),
          setActive: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create project');
      }

      setProjectName('');
      setShowCreate(false);
      await loadData(selectedWorkspaceId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  const handleProjectAction = async (projectId: string, action: 'activate' | 'archive') => {
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify({ action }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} project`);
      }

      await loadData(selectedWorkspaceId);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Failed to ${action} project`);
    }
  };

  if (loading) {
    return (
      <div className="h-full bg-[#121212] flex items-center justify-center">
        <Loader2 size={24} className="text-white/40 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full bg-[#121212] overflow-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
              <FolderKanban size={20} className="text-white/70" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Projects</h1>
              <p className="text-white/40 text-sm">Activate a project and bind future usage to it</p>
            </div>
          </div>

          <button
            onClick={() => setShowCreate((value) => !value)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-[#121212] rounded-lg text-sm font-medium hover:bg-white/90 transition-colors"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="text-white/40 text-xs uppercase tracking-wide mb-2">Current Project</div>
            <div className="text-white text-base font-medium">{overview?.currentProject?.name || 'No active project'}</div>
            <div className="text-white/30 text-xs font-mono mt-1">{overview?.currentProject?.slug || 'n/a'}</div>
          </div>
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="text-white/40 text-xs uppercase tracking-wide mb-2">Current Workspace</div>
            <div className="text-white text-base font-medium">{overview?.currentWorkspace?.name || 'No active workspace'}</div>
            <div className="text-white/30 text-xs mt-1">Selecting a project also selects its workspace</div>
          </div>
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="text-white/40 text-xs uppercase tracking-wide mb-2">Workspace Scope</div>
            <select
              value={selectedWorkspaceId}
              onChange={(event) => setSelectedWorkspaceId(event.target.value)}
              className="w-full px-3 py-2 bg-[#121212] border border-[#3a3a3d] rounded-lg text-white text-sm outline-none focus:border-white/30 transition-colors"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {showCreate && (
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="text-sm font-medium text-white mb-3">Create project in {activeWorkspaceName}</div>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="flex-1 px-4 py-3 bg-[#121212] border border-[#3a3a3d] rounded-lg text-white text-sm outline-none focus:border-white/30 transition-colors"
                placeholder="Project name"
              />
              <button
                onClick={handleCreateProject}
                disabled={isCreating}
                className="px-4 py-3 bg-white text-[#121212] rounded-lg text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {isCreating && <Loader2 size={14} className="animate-spin" />}
                Create
              </button>
            </div>
            <div className="text-xs text-white/30 mt-3">
              Newly created projects become the active runtime context for future API keys and billable actions.
            </div>
          </div>
        )}

        <div className="space-y-4">
          {projects.map((project) => (
            <div
              key={project.id}
              className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-base font-medium text-white">{project.name}</div>
                    {project.isActive && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] uppercase tracking-wide text-emerald-400">
                        Active
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-[10px] uppercase tracking-wide text-white/60">
                      {project.status}
                    </span>
                  </div>
                  <div className="text-white/30 text-xs font-mono mt-1">{project.slug}</div>
                  <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-white/40">
                    <span className="inline-flex items-center gap-1">
                      <ShieldAlert size={12} />
                      API access: {project.allowApiAccess ? 'enabled' : 'disabled'}
                    </span>
                    <span>Daily budget: {project.dailyCreditLimitMicro ? (project.dailyCreditLimitMicro / 1000000).toFixed(2) : 'unlimited'}</span>
                    <span>Monthly budget: {project.monthlyCreditLimitMicro ? (project.monthlyCreditLimitMicro / 1000000).toFixed(2) : 'unlimited'}</span>
                    <span>API keys: {project.apiKeysCount}</span>
                    <span>Requests 30d: {project.totalRequests30d.toLocaleString()}</span>
                    <span>Tokens 30d: {project.totalTokens30d.toLocaleString()}</span>
                    <span>Credits 30d: {(project.totalCostMicro30d / 1000000).toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!project.isActive && project.status !== 'archived' && (
                    <button
                      onClick={() => handleProjectAction(project.id, 'activate')}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-white text-[#121212] rounded-lg text-sm font-medium hover:bg-white/90 transition-colors"
                    >
                      <CheckCircle2 size={14} />
                      Set Active
                    </button>
                  )}
                  {project.status !== 'archived' && (
                    <button
                      onClick={() => handleProjectAction(project.id, 'archive')}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-[#121212] border border-[#3a3a3d] text-white/70 rounded-lg text-sm font-medium hover:bg-[#1a1a1d] hover:text-white transition-colors"
                    >
                      <Zap size={14} />
                      Archive
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {projects.length === 0 && (
            <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-10 text-center">
              <FolderKanban size={36} className="text-white/20 mx-auto mb-4" />
              <div className="text-white text-base font-medium mb-2">No projects in this workspace</div>
              <div className="text-white/40 text-sm">Create a project to attach future usage, API keys, and budgets.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectsPage;
