import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  listWorkspaces,
  selectWorkspace as apiSelectWorkspace,
  getWorkspaceMembers,
  type Workspace,
  type WorkspaceMember,
} from '../services/accountService';

// Fallback data when API is unavailable (dev mode / no backend)
const DEV_WORKSPACES: Workspace[] = [
  {
    id: 'ws-personal',
    owner_user_id: 'dev-user',
    workspace_type: 'personal',
    name: 'Personal',
    slug: 'personal',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {},
    member_role: 'owner',
  },
  {
    id: 'ws-team',
    owner_user_id: 'dev-user',
    workspace_type: 'team',
    name: 'XENO Corporation',
    slug: 'xeno-corporation',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {},
    member_role: 'owner',
    member_count: 4,
  },
];

const DEV_MEMBERS: WorkspaceMember[] = [
  { id: 'm1', user_id: 'dev-user', member_role: 'owner', member_status: 'active', created_at: new Date().toISOString(), user: { username: 'emilian', email: 'emilian@bnkrsys.com', display_name: 'Emilian', avatar_url: null } },
  { id: 'm2', user_id: 'u2', member_role: 'admin', member_status: 'active', created_at: new Date().toISOString(), user: { username: 'alex', email: 'alex@xeno.dev', display_name: 'Alex', avatar_url: null } },
  { id: 'm3', user_id: 'u3', member_role: 'member', member_status: 'active', created_at: new Date().toISOString(), user: { username: 'maria', email: 'maria@xeno.dev', display_name: 'Maria', avatar_url: null } },
];

interface WorkspaceContextType {
  // State
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  members: WorkspaceMember[];
  isLoading: boolean;
  error: string | null;

  // Actions
  switchWorkspace: (workspaceId: string) => Promise<void>;
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
    if (!isAuthenticated && !import.meta.env.DEV) return;
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
      console.warn('[WorkspaceContext] API unavailable, using fallback data');
      // Fallback to dev data so UI is always functional
      setWorkspaces(DEV_WORKSPACES);
      if (!activeWorkspace) {
        // Default to team workspace so TeamPage renders content in dev
        setActiveWorkspace(DEV_WORKSPACES[1] ?? DEV_WORKSPACES[0]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const refreshMembers = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const res = await getWorkspaceMembers(activeWorkspace.id);
      setMembers(res.members);
    } catch {
      setMembers(activeWorkspace.workspace_type === 'team' ? DEV_MEMBERS : DEV_MEMBERS.slice(0, 1));
    }
  }, [activeWorkspace?.id]);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    const target = workspaces.find(w => w.id === workspaceId);
    if (!target) return;

    try {
      await apiSelectWorkspace(workspaceId);
    } catch {
      // API unavailable — still switch locally
    }
    setActiveWorkspace(target);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
  }, [workspaces]);

  // Load workspaces on auth, or immediately in dev mode
  useEffect(() => {
    if (isAuthenticated) {
      refreshWorkspaces();
    } else if (import.meta.env.DEV) {
      // Dev mode without auth — load fallback data
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
