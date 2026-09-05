import type { LucideIcon } from 'lucide-react';
import { Bell, CircleUserRound, CreditCard, Gauge, Plug, Search, Settings, ShieldCheck, Users } from 'lucide-react';

export type PlatformCommandGroup = 'Navigate' | 'Account' | 'Workspace';

export interface PlatformCommand {
  id: string;
  capabilityId: string;
  label: string;
  description: string;
  group: PlatformCommandGroup;
  keywords: string[];
  path: string;
  icon: LucideIcon;
}

/** One registry powers keyboard, sidebar, and the hosted agent capability catalogue. */
export const platformCommands: readonly PlatformCommand[] = [
  { id: 'dashboard.open', capabilityId: 'platform.dashboard.open', label: 'Open dashboard', description: 'Account and workspace overview', group: 'Navigate', keywords: ['home', 'overview'], path: '/overview', icon: Gauge },
  { id: 'search.open', capabilityId: 'platform.search.open', label: 'Search XENO', description: 'Search conversations and platform resources', group: 'Navigate', keywords: ['find', 'command'], path: '/overview/chat/search', icon: Search },
  { id: 'notifications.open', capabilityId: 'platform.notifications.open', label: 'Open notifications', description: 'Account and workspace signals', group: 'Navigate', keywords: ['activity', 'inbox'], path: '/overview/notifications', icon: Bell },
  { id: 'account.profile', capabilityId: 'platform.account.open_profile', label: 'Open profile', description: 'Identity and public account details', group: 'Account', keywords: ['avatar', 'name', 'email'], path: '/overview/profile', icon: CircleUserRound },
  { id: 'account.settings', capabilityId: 'platform.account.open_settings', label: 'Open account settings', description: 'Preferences and account security', group: 'Account', keywords: ['preferences', 'password'], path: '/overview/settings', icon: Settings },
  { id: 'workspace.members', capabilityId: 'platform.workspace.open_members', label: 'Manage workspace members', description: 'Members, roles, and invitations', group: 'Workspace', keywords: ['team', 'invite', 'roles'], path: '/overview/team', icon: Users },
  { id: 'workspace.teams', capabilityId: 'platform.workspace.open_teams', label: 'Manage operational teams', description: 'Teams and shared project assignments', group: 'Workspace', keywords: ['agents', 'team', 'fleet', 'projects'], path: '/overview/teams', icon: Users },
  { id: 'workspace.security', capabilityId: 'platform.workspace.open_security', label: 'Review workspace security', description: 'Backed controls and capability availability', group: 'Workspace', keywords: ['sso', 'scim', 'sessions'], path: '/overview/team/security', icon: ShieldCheck },
  { id: 'integrations.open', capabilityId: 'platform.integrations.open', label: 'Open integrations', description: 'Connection catalogue and availability', group: 'Workspace', keywords: ['apps', 'connections', 'mcp'], path: '/overview/integrations', icon: Plug },
  { id: 'billing.open', capabilityId: 'platform.billing.open', label: 'Open billing', description: 'Plan, credits, and entitlements', group: 'Account', keywords: ['plan', 'usage', 'payment'], path: '/overview/billing', icon: CreditCard },
] as const;

export const getPlatformStatus = () => ({
  lifecycle: 'hosted' as const,
  surface: 'xeno-platform-web',
  activeWorkspaceId: typeof localStorage !== 'undefined' ? localStorage.getItem('xeno_active_workspace_id') : null,
});

export const platformCapabilities = [{
  id: 'platform.app.status', label: 'Read platform status', description: 'Hosted surface and current workspace status', kind: 'read' as const,
}, ...platformCommands.map(({ capabilityId, label, description, path }) => ({
  id: capabilityId,
  label,
  description,
  kind: 'navigation' as const,
  path,
}))];
