import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, Building2, Loader2, Mail, Shield } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../../services/authService';

type NotificationItem = {
  id: string;
  category: string;
  createdAt: string;
  title: string;
  body: string;
  workspaceId?: string | null;
  workspaceName?: string | null;
  inviteId?: string | null;
  actionRequired: boolean;
  status?: string | null;
  metadata?: any;
};

type NotificationFilter = 'all' | 'action-required' | 'workspace-invites' | 'workspace-audit';

const FILTER_OPTIONS: Array<{ id: NotificationFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'action-required', label: 'Action Required' },
  { id: 'workspace-invites', label: 'Invites' },
  { id: 'workspace-audit', label: 'Audit' },
];

const normalizeFilter = (value: string | null): NotificationFilter => {
  if (value === 'action-required' || value === 'workspace-invites' || value === 'workspace-audit') {
    return value;
  }

  return 'all';
};

const formatEventType = (value?: string | null) => {
  if (!value) {
    return 'Workspace activity';
  }

  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const getNotificationLabel = (item: NotificationItem) => {
  if (item.category === 'workspace_invite') {
    return 'Workspace Invite';
  }

  if (item.category === 'workspace_audit') {
    return 'Workspace Audit';
  }

  return 'Notification';
};

const getNotificationDetail = (item: NotificationItem) => {
  if (item.category === 'workspace_invite') {
    const expiresAt = item.metadata?.expiresAt
      ? `Expires ${new Date(item.metadata.expiresAt).toLocaleString()}`
      : null;
    return [item.body, expiresAt].filter(Boolean).join(' • ');
  }

  if (item.category === 'workspace_audit') {
    const actor = item.metadata?.actorUsername || item.metadata?.actorEmail || 'system';
    const target = item.metadata?.targetUsername || item.metadata?.targetEmail;
    const summary = [formatEventType(item.metadata?.eventType), `Actor: ${actor}`];

    if (target) {
      summary.push(`Target: ${target}`);
    }

    if (item.metadata?.inviteEmail) {
      summary.push(`Invite: ${item.metadata.inviteEmail}`);
    }

    return summary.join(' • ');
  }

  return item.body;
};

const getWorkspaceSection = (item: NotificationItem) => {
  if (item.category === 'workspace_invite') {
    return 'invites';
  }

  if (item.metadata?.eventType === 'workspace_budget_updated') {
    return 'budget';
  }

  return 'audit';
};

const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeFilter = normalizeFilter(searchParams.get('filter'));

  useEffect(() => {
    let cancelled = false;

    const loadNotifications = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/account/notifications?limit=40', {
          headers: authService.getAuthHeaders(),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load notifications');
        }

        if (!cancelled) {
          setItems(data.items || []);
          setUnreadCount(Number(data.unreadCount || 0));
          setWorkspaceName(data.currentWorkspace?.name || null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load notifications');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadNotifications();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => ({
    invites: items.filter((item) => item.category === 'workspace_invite').length,
    audit: items.filter((item) => item.category === 'workspace_audit').length,
    actionable: items.filter((item) => item.actionRequired).length,
  }), [items]);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'action-required') {
      return items.filter((item) => item.actionRequired);
    }

    if (activeFilter === 'workspace-invites') {
      return items.filter((item) => item.category === 'workspace_invite');
    }

    if (activeFilter === 'workspace-audit') {
      return items.filter((item) => item.category === 'workspace_audit');
    }

    return items;
  }, [activeFilter, items]);

  const setFilter = (filter: NotificationFilter) => {
    if (filter === 'all') {
      setSearchParams({});
      return;
    }

    setSearchParams({ filter });
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
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
              <Bell size={20} className="text-white/70" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Notifications</h1>
              <p className="text-white/40 text-sm">
                Canonical workspace inbox for invite actions and current workspace audit events.
              </p>
            </div>
          </div>
          <div className="text-sm text-white/50">{unreadCount} action-required</div>
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="text-white/40 text-xs uppercase tracking-wide mb-2">Action Required</div>
            <div className="text-white text-base font-medium">{counts.actionable}</div>
            <div className="text-white/30 text-xs mt-1">Pending invite decisions</div>
          </div>
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="text-white/40 text-xs uppercase tracking-wide mb-2">Invite Records</div>
            <div className="text-white text-base font-medium">{counts.invites}</div>
            <div className="text-white/30 text-xs mt-1">Workspace delivery and access changes</div>
          </div>
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="text-white/40 text-xs uppercase tracking-wide mb-2">Audit Events</div>
            <div className="text-white text-base font-medium">{counts.audit}</div>
            <div className="text-white/30 text-xs mt-1">Current active workspace activity</div>
          </div>
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="text-white/40 text-xs uppercase tracking-wide mb-2">Current Workspace</div>
            <div className="text-white text-base font-medium">{workspaceName || 'No active workspace'}</div>
            <div className="text-white/30 text-xs mt-1">Audit scope for this feed</div>
          </div>
        </div>

        <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-3 flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((option) => {
            const isActive = activeFilter === option.id;
            return (
              <button
                key={option.id}
                onClick={() => setFilter(option.id)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-white text-[#121212]'
                    : 'bg-[#121212] border border-[#2a2a2d] text-white/70 hover:text-white hover:border-white/15'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-4">
          {filteredItems.map((item) => (
            <div key={item.id} className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5">
                    {item.category === 'workspace_invite' ? (
                      <Mail size={16} className="text-emerald-300" />
                    ) : item.category === 'workspace_audit' ? (
                      <Shield size={16} className="text-amber-300" />
                    ) : (
                      <Bell size={16} className="text-white/40" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-[10px] uppercase tracking-wide text-white/60">
                        {getNotificationLabel(item)}
                      </span>
                      {item.status && (
                        <span className="px-2 py-0.5 rounded-full bg-[#121212] border border-[#2a2a2d] text-[10px] uppercase tracking-wide text-white/45">
                          {item.status}
                        </span>
                      )}
                      {item.actionRequired && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] uppercase tracking-wide text-emerald-400">
                          Action Required
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-white">
                      {item.category === 'workspace_audit' ? formatEventType(item.metadata?.eventType) : item.title}
                    </div>
                    <div className="text-xs text-white/40 mt-1">{getNotificationDetail(item)}</div>
                    <div className="flex items-center gap-3 text-[11px] text-white/30 mt-3 flex-wrap">
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                      {item.workspaceName && (
                        <span className="inline-flex items-center gap-1">
                          <Building2 size={11} />
                          {item.workspaceName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {item.workspaceId && (
                  <button
                    onClick={() => navigate(`/overview/workspaces?workspace=${item.workspaceId}&section=${getWorkspaceSection(item)}`)}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-[#121212] border border-[#2a2a2d] text-white/75 rounded-lg text-xs font-medium hover:text-white hover:border-white/20 transition-colors"
                  >
                    Open Workspace
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {filteredItems.length === 0 && (
            <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-10 text-center">
              <Bell size={32} className="text-white/20 mx-auto mb-4" />
              <div className="text-white text-base font-medium mb-2">No notifications in this view</div>
              <div className="text-white/40 text-sm">
                Pending invites and current workspace activity will appear here when the canonical backend records them.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationsPage;
