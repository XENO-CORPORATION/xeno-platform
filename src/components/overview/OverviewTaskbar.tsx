import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, BookOpen, Boxes, BriefcaseBusiness, Check, ChevronDown, ChevronRight,
  CircleHelp, CreditCard, FileArchive, FolderKanban, Home, LogOut,
  Menu, MessageSquareText, MoreHorizontal, PanelLeftClose, Plus, Search,
  Settings, Sparkles, User, UserPlus, Users, Workflow, Plug,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import './overview-shell.css';

interface OverviewTaskbarProps {
  labs: { id: string; name: string; lastModified: Date }[];
  onCreateLab: () => void;
  onCollapseChange?: (collapsed: boolean) => void;
  onToggleInterface?: () => void;
  isCleanMode?: boolean;
  onOpenCommandPalette?: () => void;
}

interface NavigationItem {
  label: string;
  path: string;
  icon: LucideIcon;
  badge?: string;
}

const primaryNavigation: NavigationItem[] = [
  { label: 'Home', path: '/overview', icon: Home },
  { label: 'Ask XENO', path: '/overview/chat/llm', icon: MessageSquareText },
  { label: 'Search', path: '/overview/chat/search', icon: Search },
  { label: 'Artifacts', path: '/overview/artifacts', icon: FileArchive },
];

const workspaceNavigation: NavigationItem[] = [
  { label: 'Projects', path: '/overview/projects', icon: FolderKanban },
  { label: 'Automations', path: '/overview/scheduled', icon: Workflow },
  { label: 'Teams', path: '/overview/teams', icon: Users },
];

const platformNavigation: NavigationItem[] = [
  { label: 'Notifications', path: '/overview/notifications', icon: Bell },
  { label: 'Integrations', path: '/overview/integrations', icon: Plug },
  { label: 'Products', path: '/products', icon: Boxes },
  { label: 'Usage', path: '/overview/usage-analytics', icon: BriefcaseBusiness },
  { label: 'Billing', path: '/overview/billing', icon: CreditCard },
];

const getInitials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2)
  .map((part) => part[0]?.toUpperCase()).join('') || 'X';

const XenoRailMark = () => (
  <img className="xeno-rail-mark" src="/xeno-logo.svg" alt="" aria-hidden="true" />
);

const OverviewTaskbar: React.FC<OverviewTaskbarProps> = ({ onCollapseChange, onOpenCommandPalette }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { workspaces, activeWorkspace, switchWorkspace, members, isLoading: isWorkspaceLoading } = useWorkspace();
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem('xeno_overview_sidebar_collapsed') === 'true',
  );
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const accountName = user?.display_name || user?.username || 'XENO user';
  const workspaceName = activeWorkspace?.name || (isWorkspaceLoading ? 'Loading…' : 'Personal');
  const unreadCount = 0;
  const railItems = useMemo(() => [
    { label: 'Home', path: '/overview', icon: Home },
    { label: 'Search', path: '/overview/chat/search', icon: Search },
    { label: 'Notifications', path: '/overview/notifications', icon: Bell, badge: unreadCount ? String(unreadCount) : undefined },
    { label: 'Projects', path: '/overview/projects', icon: FolderKanban },
    { label: 'Ask XENO', path: '/overview/chat/llm', icon: MessageSquareText },
    { label: 'Automations', path: '/overview/scheduled', icon: Workflow },
    { label: 'Teams', path: '/overview/teams', icon: Users },
    { label: 'Products', path: '/products', icon: Boxes },
  ], [unreadCount]);

  const isActive = (path: string) => path === '/overview'
    ? location.pathname === '/overview' || location.pathname === '/overview/'
    : location.pathname === path || location.pathname.startsWith(`${path}/`);

  const go = (path: string) => {
    navigate(path);
    setIsMobileOpen(false);
    setWorkspaceMenuOpen(false);
    setAccountMenuOpen(false);
  };

  const toggleCollapsed = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem('xeno_overview_sidebar_collapsed', String(next));
    onCollapseChange?.(next);
  };

  const openAccountFromRail = () => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setIsMobileOpen(true);
    } else if (isCollapsed) {
      toggleCollapsed();
    }
    setAccountMenuOpen(true);
  };

  useEffect(() => { onCollapseChange?.(isCollapsed); }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!workspaceMenuRef.current?.contains(target)) setWorkspaceMenuOpen(false);
      if (!accountMenuRef.current?.contains(target)) setAccountMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWorkspaceMenuOpen(false);
        setAccountMenuOpen(false);
        setIsMobileOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const navigationRow = (item: NavigationItem) => {
    const Icon = item.icon;
    return (
      <button key={item.label} type="button" className={`xeno-side-nav-row${isActive(item.path) ? ' is-active' : ''}`}
        onClick={() => go(item.path)} aria-current={isActive(item.path) ? 'page' : undefined}>
        <Icon size={17} strokeWidth={1.8} />
        <span>{item.label}</span>
        {item.badge ? <span className="xeno-nav-badge">{item.badge}</span> : null}
      </button>
    );
  };

  return (
    <aside className={`xeno-overview-sidebar${isCollapsed ? ' is-collapsed' : ''}${isMobileOpen ? ' is-mobile-open' : ''}`}
      aria-label="XENO workspace navigation">
      <nav className="xeno-sidebar-rail" aria-label="Primary navigation">
        <button type="button" className="xeno-rail-brand" onClick={() => (isCollapsed ? toggleCollapsed() : go('/overview'))}
          aria-label={isCollapsed ? 'Expand XENO navigation' : 'XENO home'} title={isCollapsed ? 'Expand navigation' : 'XENO home'}>
          <XenoRailMark />
        </button>
        <div className="xeno-rail-items">
          {railItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.label} type="button" className={`xeno-rail-button${item.label !== 'Notifications' && isActive(item.path) ? ' is-active' : ''}`}
                onClick={() => go(item.path)} aria-label={item.label} title={item.label}
                aria-current={item.label !== 'Notifications' && isActive(item.path) ? 'page' : undefined}>
                <Icon size={19} strokeWidth={1.75} />
                {item.badge ? <span className="xeno-rail-badge">{item.badge}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="xeno-rail-footer">
          <button type="button" className="xeno-rail-button xeno-mobile-menu-button" onClick={() => setIsMobileOpen((open) => !open)} aria-label="Open navigation"><Menu size={19} /></button>
          <button type="button" className={`xeno-rail-button${isActive('/overview/settings') ? ' is-active' : ''}`} onClick={() => go('/overview/settings')} aria-label="Settings" title="Settings"><Settings size={19} strokeWidth={1.75} /></button>
          <button type="button" className="xeno-rail-avatar" onClick={openAccountFromRail} aria-label="Open account menu" aria-expanded={accountMenuOpen}>
            {user?.avatar_url ? <img src={user.avatar_url} alt="" /> : <span>{getInitials(accountName)}</span>}
          </button>
        </div>
      </nav>

      <div className="xeno-sidebar-panel">
        <div className="xeno-sidebar-header" ref={workspaceMenuRef}>
          <button type="button" className="xeno-workspace-trigger" onClick={() => setWorkspaceMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={workspaceMenuOpen}>
            <span className="xeno-workspace-mark" aria-hidden="true" />
            <span className="xeno-workspace-name">{workspaceName}</span>
            <ChevronDown size={15} strokeWidth={1.8} />
          </button>
          <button type="button" className="xeno-collapse-button" onClick={toggleCollapsed} aria-label="Collapse sidebar" title="Collapse sidebar"><PanelLeftClose size={18} strokeWidth={1.7} /></button>
          {workspaceMenuOpen ? (
            <div className="xeno-workspace-menu" role="menu" aria-label="Choose workspace">
              <div className="xeno-workspace-menu-list">
                {workspaces.length ? workspaces.map((workspace) => (
                  <button key={workspace.id} type="button" role="menuitemradio" aria-checked={workspace.id === activeWorkspace?.id}
                    className={`xeno-workspace-menu-row${workspace.id === activeWorkspace?.id ? ' is-selected' : ''}`}
                    onClick={async () => { try { await switchWorkspace(workspace.id); setWorkspaceMenuOpen(false); } catch { /* context exposes the confirmed failure */ } }}>
                    <span className="xeno-workspace-mark" aria-hidden="true" />
                    <span><strong>{workspace.name}</strong><small>{workspace.workspace_type === 'team' ? `${workspace.member_count ?? 0} members` : 'Personal workspace'}</small></span>
                    {workspace.id === activeWorkspace?.id ? <Check size={15} /> : null}
                  </button>
                )) : <p className="xeno-menu-empty">No workspaces available</p>}
              </div>
              <div className="xeno-workspace-menu-group">
                <button type="button" role="menuitem" onClick={() => go('/overview/billing')}><Sparkles size={16} />Manage plan</button>
                <button type="button" role="menuitem" onClick={() => go('/overview/team/settings')}><Settings size={16} />Workspace settings</button>
              </div>
              <div className="xeno-workspace-menu-group">
                <button type="button" role="menuitem" onClick={() => go('/overview/team')}><UserPlus size={16} />Invite people{members.length ? <small>{members.length}</small> : null}</button>
                <button type="button" role="menuitem" onClick={() => go('/overview/team?create=1')}><Plus size={16} />New workspace</button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="xeno-sidebar-scroll">
          <button type="button" className="xeno-command-button" onClick={onOpenCommandPalette}>
            <Search size={16} /><span>Search or command</span><kbd>⌘ K</kbd>
          </button>
          <div className="xeno-side-nav-group">{primaryNavigation.map(navigationRow)}</div>
          <section className="xeno-side-section" aria-labelledby="workspace-nav-heading">
            <div className="xeno-side-section-heading" id="workspace-nav-heading">
              <span><ChevronDown size={12} />Workspace</span>
              <span className="xeno-section-heading-actions"><button type="button" aria-label="Workspace options"><MoreHorizontal size={14} /></button><button type="button" onClick={() => go('/overview/projects')} aria-label="Open projects"><Plus size={14} /></button></span>
            </div>
            {workspaceNavigation.map(navigationRow)}
          </section>
          <section className="xeno-side-section" aria-labelledby="platform-nav-heading">
            <div className="xeno-side-section-heading" id="platform-nav-heading"><span><ChevronDown size={12} />Platform</span></div>
            {platformNavigation.map(navigationRow)}
          </section>
        </div>

        <div className="xeno-sidebar-bottom">
          <button type="button" className="xeno-community-card" onClick={() => go('/products')}>
            <BookOpen size={17} /><span><strong>Explore XENO</strong><small>All products and capabilities</small></span><ChevronRight size={15} />
          </button>
          <div className="xeno-account-anchor" ref={accountMenuRef}>
            <button type="button" className="xeno-account-trigger" onClick={() => setAccountMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={accountMenuOpen}>
              <span className="xeno-account-avatar">{user?.avatar_url ? <img src={user.avatar_url} alt="" /> : getInitials(accountName)}</span>
              <span><strong>{accountName}</strong><small>{user?.plan || 'Free plan'}</small></span><Menu size={16} />
            </button>
            {accountMenuOpen ? (
              <div className="xeno-account-menu" role="menu" aria-label="Account menu">
                <div className="xeno-account-menu-header"><span className="xeno-account-avatar">{getInitials(accountName)}</span><span><strong>{accountName}</strong><small>{user?.email || 'Signed in to XENO'}</small></span></div>
                <button type="button" role="menuitem" onClick={() => go('/overview/profile')}><User size={16} />Profile</button>
                <button type="button" role="menuitem" onClick={() => go('/overview/settings')}><Settings size={16} />Settings</button>
                <button type="button" role="menuitem" onClick={() => go('/overview/help')}><CircleHelp size={16} />Help</button>
                <button type="button" role="menuitem" className="is-danger" onClick={logout}><LogOut size={16} />Log out</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {isMobileOpen ? <button type="button" className="xeno-mobile-scrim" onClick={() => setIsMobileOpen(false)} aria-label="Close navigation" /> : null}
    </aside>
  );
};

export default OverviewTaskbar;
