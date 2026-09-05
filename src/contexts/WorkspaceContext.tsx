import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  listWorkspaces,
  selectWorkspace as apiSelectWorkspace,
  createWorkspace as apiCreateWorkspace,
  getWorkspaceMembers,
  AccountApiError,
  ACCOUNT_UUID_RE,
  type Workspace,
  type WorkspaceMember,
} from '../services/accountService';

interface WorkspaceContextType {
  // State
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  members: WorkspaceMember[];
  isLoading: boolean;
  error: string | null;

  // Actions
  switchWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace>;
  refreshWorkspaces: () => Promise<void>;
  refreshMembers: () => Promise<void>;

  // Helpers
  isOwner: boolean;
  isTeam: boolean;
  userRole: string | null;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
};

const ACTIVE_WORKSPACE_KEY = 'xeno_active_workspace_id';

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkspaces = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await listWorkspaces();
      setWorkspaces(res.workspaces);

      // Restore last active workspace from localStorage, or default to personal
      const savedId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      const saved = res.workspaces.find(w => w.id === savedId);
      const personal = res.workspaces.find(w => w.workspace_type === 'personal');
      const target = saved || personal || res.workspaces[0] || null;

      if (target && target.id !== activeWorkspace?.id) {
        setActiveWorkspace(target);
        localStorage.setItem(ACTIVE_WORKSPACE_KEY, target.id);
      }
    } catch (err: unknown) {
      const message =
        err instanceof AccountApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not load workspaces';
      const savedId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      if (savedId && !ACCOUNT_UUID_RE.test(savedId)) {
        localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      }
      console.warn('[WorkspaceContext] workspaces unavailable:', message);
      setWorkspaces([]);
      setActiveWorkspace(null);
      setMembers([]);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const refreshMembers = useCallback(async () => {
    if (!activeWorkspace) return;
    if (!ACCOUNT_UUID_RE.test(activeWorkspace.id)) { setMembers([]); return; }
    try {
      const res = await getWorkspaceMembers(activeWorkspace.id);
      setMembers(res.members);
    } catch (err) {
      setMembers([]);
      setError(err instanceof Error ? err.message : 'Could not load workspace members');
    }
  }, [activeWorkspace?.id]);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    const target = workspaces.find(w => w.id === workspaceId);
    if (!target) throw new Error('Workspace is not available to this account');
    setError(null);
    try {
      await apiSelectWorkspace(workspaceId);
      setActiveWorkspace(target);
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The server did not confirm the workspace switch';
      setError(message);
      throw err;
    }
  }, [workspaces]);

  const createWorkspace = useCallback(async (name: string) => {
    setError(null);
    try {
      const result = await apiCreateWorkspace(name, 'team');
      await apiSelectWorkspace(result.workspace.id);
      setWorkspaces((current) => [...current.filter((item) => item.id !== result.workspace.id), result.workspace]);
      setActiveWorkspace(result.workspace);
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, result.workspace.id);
      return result.workspace;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The server did not confirm workspace creation';
      setError(message);
      throw err;
    }
  }, []);

  // Workspaces only exist as server-confirmed authenticated resources.
  useEffect(() => {
    if (isAuthenticated) {
      refreshWorkspaces();
    } else {
      setWorkspaces([]);
      setActiveWorkspace(null);
      setMembers([]);
    }
  }, [isAuthenticated]);

  // Load members when active workspace changes
  useEffect(() => {
    if (activeWorkspace) {
      refreshMembers();
    }
  }, [activeWorkspace?.id]);

  const userRole = activeWorkspace?.member_role || members.find(m => m.user_id === user?.id)?.member_role || null;
  const isOwner = userRole === 'owner';
  const isTeam = activeWorkspace?.workspace_type === 'team';

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        members,
        isLoading,
        error,
        switchWorkspace,
        createWorkspace,
        refreshWorkspaces,
        refreshMembers,
        isOwner,
        isTeam,
        userRole,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};
