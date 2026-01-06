/**
 * AllChannelsPage Component
 * Grid view of all connected YouTube channels with group management
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Youtube, Plus, ArrowLeft, Loader2, Users, Eye, Video,
  MoreVertical, Trash2, RefreshCw, ExternalLink, Folder, FolderPlus,
  Edit2, Check, X, GripVertical, ChevronRight, Palette, FolderInput, RefreshCcw,
  Languages, Globe, Tag, Link2, CheckCheck, Circle, CircleDot, CircleOff
} from 'lucide-react';
import { youtubeService, YouTubeChannel, ChannelGroup } from '../../services/youtubeService';

// Predefined language list
const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fi', name: 'Finnish', flag: '🇫🇮' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'no', name: 'Norwegian', flag: '🇳🇴' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'ro', name: 'Romanian', flag: '🇷🇴' },
  { code: 'da', name: 'Danish', flag: '🇩🇰' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
];

const getLanguageInfo = (code: string) => LANGUAGES.find(l => l.code === code) || { code, name: code.toUpperCase(), flag: '🌐' };

// Channel status type
type ChannelStatus = 'active' | 'inactive' | null;

// Context menu position interface
interface ContextMenuState {
  x: number;
  y: number;
  channelId: string;
  showGroupSubmenu: boolean;
  showRemoveSubmenu: boolean;
  showLanguageSubmenu: boolean;
  showRemoveLanguageSubmenu: boolean;
  showStatusSubmenu: boolean;
  openLeft: boolean; // Whether submenus should open to the left
}

// Channel languages map type
type ChannelLanguagesMap = Record<string, string[]>;

// Channel status map type
type ChannelStatusMap = Record<string, ChannelStatus>;

// Load channel statuses from localStorage
const loadChannelStatuses = (): ChannelStatusMap => {
  try {
    const saved = localStorage.getItem('youtube_channel_statuses');
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
};

// Save channel statuses to localStorage
const saveChannelStatuses = (statuses: ChannelStatusMap) => {
  localStorage.setItem('youtube_channel_statuses', JSON.stringify(statuses));
};

const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

// Convert group name to URL-friendly slug
const toSlug = (name: string): string => {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
};

const GROUP_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#ffffff'
];

const AllChannelsPage: React.FC = () => {
  const navigate = useNavigate();
  const { groupSlug } = useParams<{ groupSlug?: string }>();

  // Data
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [groups, setGroups] = useState<ChannelGroup[]>([]);
  const [channelLanguages, setChannelLanguages] = useState<ChannelLanguagesMap>({});
  const [languageCounts, setLanguageCounts] = useState<{ language_code: string; channel_count: number }[]>([]);
  const [channelStatuses, setChannelStatuses] = useState<ChannelStatusMap>(loadChannelStatuses);

  // UI State
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [syncingChannel, setSyncingChannel] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null); // null = All Channels
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null); // Language filter
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'active' | 'inactive'>('all'); // Status filter
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [initialGroupSet, setInitialGroupSet] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Group editing
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#ef4444');
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);

  // Drag state
  const [draggedChannel, setDraggedChannel] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  // Refs
  const newGroupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  // Set initial group from URL after groups are loaded
  useEffect(() => {
    if (!isLoading && groups.length > 0 && !initialGroupSet) {
      if (groupSlug) {
        if (groupSlug === 'uncategorized') {
          setSelectedGroup('uncategorized');
        } else {
          // Find group by slug (name converted to URL-friendly format)
          const group = groups.find(g =>
            g.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') === groupSlug
          );
          if (group) {
            setSelectedGroup(group.id);
          }
        }
      }
      setInitialGroupSet(true);
    }
  }, [isLoading, groups, groupSlug, initialGroupSet]);

  // Check for pending group assignment after OAuth callback
  useEffect(() => {
    const assignPendingGroup = async () => {
      const pendingGroupId = localStorage.getItem('youtube_pending_group');
      const previousCount = localStorage.getItem('youtube_channel_count');

      if (pendingGroupId && previousCount !== null && !isLoading) {
        const prevCount = parseInt(previousCount, 10);

        // Check if a new channel was added
        if (channels.length > prevCount) {
          // Find the newest channel (most recently created)
          const sortedChannels = [...channels].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          const newestChannel = sortedChannels[0];

          if (newestChannel) {
            try {
              // Assign the new channel to the pending group
              await youtubeService.addChannelToGroup(pendingGroupId, newestChannel.id);
              console.log(`Auto-assigned channel ${newestChannel.channel_title} to group`);

              // Reload data to reflect the change
              await refreshData();

              // Set the selected group to the one we just assigned to
              setSelectedGroup(pendingGroupId);
            } catch (err) {
              console.error('Failed to auto-assign channel to group:', err);
            }
          }
        }

        // Clean up localStorage
        localStorage.removeItem('youtube_pending_group');
        localStorage.removeItem('youtube_channel_count');
      }
    };

    assignPendingGroup();
  }, [channels.length, isLoading]);

  useEffect(() => {
    if (isCreatingGroup && newGroupInputRef.current) {
      newGroupInputRef.current.focus();
    }
  }, [isCreatingGroup]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Close dropdown menu
      setActiveMenu(null);
      setShowColorPicker(null);

      // Close status dropdown if clicking outside
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setIsStatusDropdownOpen(false);
      }

      // Close context menu if clicking outside of it
      if (contextMenu && contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        if (submenuRef.current && submenuRef.current.contains(e.target as Node)) {
          return; // Don't close if clicking in submenu
        }
        setContextMenu(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu]);

  const loadData = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const [channelList, groupList, langCounts] = await Promise.all([
        youtubeService.getChannels(),
        youtubeService.getGroups(),
        youtubeService.getLanguages()
      ]);
      setChannels(channelList);
      setGroups(groupList);
      setLanguageCounts(langCounts);

      // Load languages for all channels
      const langMap: ChannelLanguagesMap = {};
      await Promise.all(channelList.map(async (channel) => {
        try {
          const langs = await youtubeService.getChannelLanguages(channel.id);
          langMap[channel.id] = langs;
        } catch (err) {
          langMap[channel.id] = [];
        }
      }));
      setChannelLanguages(langMap);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  // Refresh data without showing loading spinner
  const refreshData = async () => {
    try {
      const [channelList, groupList, langCounts] = await Promise.all([
        youtubeService.getChannels(),
        youtubeService.getGroups(),
        youtubeService.getLanguages()
      ]);
      setChannels(channelList);
      setGroups(groupList);
      setLanguageCounts(langCounts);

      // Load languages for all channels
      const langMap: ChannelLanguagesMap = {};
      await Promise.all(channelList.map(async (channel) => {
        try {
          const langs = await youtubeService.getChannelLanguages(channel.id);
          langMap[channel.id] = langs;
        } catch (err) {
          langMap[channel.id] = [];
        }
      }));
      setChannelLanguages(langMap);
    } catch (err) {
      console.error('Failed to refresh data:', err);
    }
  };

  // Get filtered channels based on selected group, language, and status
  const getFilteredChannels = useCallback(() => {
    let result = channels;

    // Filter by group
    if (selectedGroup) {
      if (selectedGroup === 'uncategorized') {
        const groupedChannelIds = new Set(groups.flatMap(g => g.members.map(m => m.channel_id)));
        result = result.filter(c => !groupedChannelIds.has(c.id));
      } else {
        const group = groups.find(g => g.id === selectedGroup);
        if (group) {
          const memberIds = new Set(group.members.map(m => m.channel_id));
          result = result.filter(c => memberIds.has(c.id));
        }
      }
    }

    // Filter by language
    if (selectedLanguage) {
      result = result.filter(c => channelLanguages[c.id]?.includes(selectedLanguage));
    }

    // Handle status: Sort on All Channels page, Filter on group pages
    if (selectedStatus !== 'all') {
      if (selectedGroup === null) {
        // On All Channels page: SORT by status (active first or inactive first)
        result = [...result].sort((a, b) => {
          const statusA = channelStatuses[a.id];
          const statusB = channelStatuses[b.id];

          if (selectedStatus === 'active') {
            // Active first, then no status, then inactive
            if (statusA === 'active' && statusB !== 'active') return -1;
            if (statusA !== 'active' && statusB === 'active') return 1;
            if (statusA === 'inactive' && statusB !== 'inactive') return 1;
            if (statusA !== 'inactive' && statusB === 'inactive') return -1;
          } else {
            // Inactive first, then no status, then active
            if (statusA === 'inactive' && statusB !== 'inactive') return -1;
            if (statusA !== 'inactive' && statusB === 'inactive') return 1;
            if (statusA === 'active' && statusB !== 'active') return 1;
            if (statusA !== 'active' && statusB === 'active') return -1;
          }
          return 0;
        });
      } else {
        // On group pages: FILTER by status
        result = result.filter(c => channelStatuses[c.id] === selectedStatus);
      }
    }

    return result;
  }, [channels, groups, selectedGroup, selectedLanguage, channelLanguages, selectedStatus, channelStatuses]);

  // Handle group selection with URL update
  const handleGroupSelect = (groupId: string | null) => {
    setSelectedGroup(groupId);
    // Reset status filter when changing groups
    setSelectedStatus('all');

    // Update URL based on selection
    if (groupId === null) {
      navigate('/overview/content-creation/youtube/all-channels');
    } else if (groupId === 'uncategorized') {
      navigate('/overview/content-creation/youtube/all-channels/uncategorized');
    } else {
      const group = groups.find(g => g.id === groupId);
      if (group) {
        navigate(`/overview/content-creation/youtube/all-channels/${toSlug(group.name)}`);
      }
    }
  };

  // Sync all channels or group channels
  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      const channelsToSync = getFilteredChannels();

      // Sync channels sequentially to avoid rate limits
      for (const channel of channelsToSync) {
        try {
          await youtubeService.syncChannel(channel.id);
        } catch (err) {
          console.error(`Failed to sync channel ${channel.channel_title}:`, err);
        }
      }

      await refreshData();
    } catch (err) {
      console.error('Failed to sync channels:', err);
    } finally {
      setSyncingAll(false);
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      // Store current group selection so we can assign the new channel to it after OAuth
      if (selectedGroup && selectedGroup !== 'uncategorized') {
        localStorage.setItem('youtube_pending_group', selectedGroup);
      } else {
        localStorage.removeItem('youtube_pending_group');
      }
      // Also store current channel count to detect new channel
      localStorage.setItem('youtube_channel_count', String(channels.length));

      window.location.href = await youtubeService.getAuthUrl();
    } catch (err) {
      console.error('Failed to connect:', err);
      setIsConnecting(false);
    }
  };

  const handleSync = async (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncingChannel(channelId);
    try {
      await youtubeService.syncChannel(channelId);
      await refreshData();
    } catch (err) {
      console.error('Failed to sync:', err);
    } finally {
      setSyncingChannel(null);
      setActiveMenu(null);
    }
  };

  const handleDisconnect = async (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to disconnect this channel?')) return;
    try {
      await youtubeService.disconnectChannel(channelId);
      await refreshData();
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setActiveMenu(null);
    }
  };

  const handleChannelClick = (channelId: string) => {
    navigate(`/overview/content-creation/youtube?channel=${channelId}`);
  };

  const openYouTubeStudio = (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`https://studio.youtube.com/channel/${channelId}`, '_blank');
    setActiveMenu(null);
  };

  // Group handlers
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await youtubeService.createGroup({
        name: newGroupName.trim(),
        color: newGroupColor
      });
      setNewGroupName('');
      setNewGroupColor('#ef4444');
      setIsCreatingGroup(false);
      await refreshData();
    } catch (err) {
      console.error('Failed to create group:', err);
    }
  };

  const handleUpdateGroup = async (groupId: string) => {
    if (!editGroupName.trim()) return;
    try {
      await youtubeService.updateGroup(groupId, { name: editGroupName.trim() });
      setEditingGroup(null);
      await refreshData();
    } catch (err) {
      console.error('Failed to update group:', err);
    }
  };

  const handleDeleteGroup = async (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this group? Channels will not be deleted.')) return;
    try {
      await youtubeService.deleteGroup(groupId);
      if (selectedGroup === groupId) handleGroupSelect(null);
      await refreshData();
    } catch (err) {
      console.error('Failed to delete group:', err);
    }
  };

  const handleColorChange = async (groupId: string, color: string) => {
    try {
      await youtubeService.updateGroup(groupId, { color });
      setShowColorPicker(null);
      await refreshData();
    } catch (err) {
      console.error('Failed to update color:', err);
    }
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, channelId: string) => {
    setDraggedChannel(channelId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault();
    setDragOverGroup(groupId);
  };

  const handleDrop = async (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault();
    if (!draggedChannel) return;

    try {
      if (groupId) {
        // Add to group
        await youtubeService.addChannelToGroup(groupId, draggedChannel);
      }
      // If dropping on "All" or "Uncategorized", we could remove from current group
      // For now, just refresh
      await refreshData();
    } catch (err) {
      console.error('Failed to move channel:', err);
    } finally {
      setDraggedChannel(null);
      setDragOverGroup(null);
    }
  };

  const handleRemoveFromGroup = async (groupId: string, channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await youtubeService.removeChannelFromGroup(groupId, channelId);
      await refreshData();
    } catch (err) {
      console.error('Failed to remove from group:', err);
    }
    setActiveMenu(null);
  };

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 180;
    const submenuWidth = 170;
    const totalWidthNeeded = menuWidth + submenuWidth + 20; // 20px buffer

    // Calculate if we need to open submenus on the left
    const openLeft = e.clientX + totalWidthNeeded > window.innerWidth;

    // Calculate position, ensuring menu stays within viewport
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - 300);

    setContextMenu({
      x,
      y,
      channelId,
      showGroupSubmenu: false,
      showRemoveSubmenu: false,
      showLanguageSubmenu: false,
      showRemoveLanguageSubmenu: false,
      showStatusSubmenu: false,
      openLeft
    });
    setActiveMenu(null); // Close any open dropdown menu
  }, []);

  // Status handler
  const handleSetChannelStatus = (status: ChannelStatus) => {
    if (!contextMenu) return;
    const newStatuses = { ...channelStatuses };
    if (status === null) {
      delete newStatuses[contextMenu.channelId];
    } else {
      newStatuses[contextMenu.channelId] = status;
    }
    setChannelStatuses(newStatuses);
    saveChannelStatuses(newStatuses);
    setContextMenu(null);
  };

  const handleAddToGroupFromContext = async (groupId: string) => {
    if (!contextMenu) return;
    try {
      await youtubeService.addChannelToGroup(groupId, contextMenu.channelId);
      await refreshData();
    } catch (err) {
      console.error('Failed to add to group:', err);
    }
    setContextMenu(null);
  };

  const handleRemoveFromGroupContext = async (groupId: string) => {
    if (!contextMenu) return;
    try {
      await youtubeService.removeChannelFromGroup(groupId, contextMenu.channelId);
      await refreshData();
    } catch (err) {
      console.error('Failed to remove from group:', err);
    }
    setContextMenu(null);
  };

  const handleSyncFromContext = async () => {
    if (!contextMenu) return;
    setSyncingChannel(contextMenu.channelId);
    try {
      await youtubeService.syncChannel(contextMenu.channelId);
      await refreshData();
    } catch (err) {
      console.error('Failed to sync:', err);
    } finally {
      setSyncingChannel(null);
      setContextMenu(null);
    }
  };

  const handleDisconnectFromContext = async () => {
    if (!contextMenu) return;
    if (!confirm('Are you sure you want to disconnect this channel?')) return;
    try {
      await youtubeService.disconnectChannel(contextMenu.channelId);
      await refreshData();
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
    setContextMenu(null);
  };

  const openYouTubeStudioFromContext = () => {
    if (!contextMenu) return;
    const channel = channels.find(c => c.id === contextMenu.channelId);
    if (channel) {
      window.open(`https://studio.youtube.com/channel/${channel.channel_id}`, '_blank');
    }
    setContextMenu(null);
  };

  const [copiedChannelLink, setCopiedChannelLink] = useState(false);

  const copyChannelLinkFromContext = async () => {
    if (!contextMenu) return;
    const channel = channels.find(c => c.id === contextMenu.channelId);
    if (channel) {
      // Use custom URL if available, otherwise use channel ID
      const channelUrl = channel.channel_custom_url
        ? `https://youtube.com/${channel.channel_custom_url}`
        : `https://youtube.com/channel/${channel.channel_id}`;

      try {
        await navigator.clipboard.writeText(channelUrl);
        setCopiedChannelLink(true);
        setTimeout(() => {
          setCopiedChannelLink(false);
          setContextMenu(null);
        }, 1000);
      } catch (err) {
        console.error('Failed to copy:', err);
        setContextMenu(null);
      }
    }
  };

  // Get groups the context menu channel belongs to
  const getContextChannelGroups = () => {
    if (!contextMenu) return [];
    return groups.filter(g => g.members.some(m => m.channel_id === contextMenu.channelId));
  };

  // Get groups the context menu channel doesn't belong to
  const getAvailableGroupsForContext = () => {
    if (!contextMenu) return groups;
    const channelGroupIds = new Set(
      groups.filter(g => g.members.some(m => m.channel_id === contextMenu.channelId)).map(g => g.id)
    );
    return groups.filter(g => !channelGroupIds.has(g.id));
  };

  // Get languages the context menu channel has
  const getContextChannelLanguages = () => {
    if (!contextMenu) return [];
    return channelLanguages[contextMenu.channelId] || [];
  };

  // Get languages the context menu channel doesn't have
  const getAvailableLanguagesForContext = () => {
    if (!contextMenu) return LANGUAGES;
    const channelLangs = new Set(channelLanguages[contextMenu.channelId] || []);
    return LANGUAGES.filter(l => !channelLangs.has(l.code));
  };

  // Language handlers
  const handleAddLanguageFromContext = async (languageCode: string) => {
    if (!contextMenu) return;
    try {
      await youtubeService.addLanguageToChannel(contextMenu.channelId, languageCode);
      await refreshData();
    } catch (err) {
      console.error('Failed to add language to channel:', err);
    }
    setContextMenu(null);
  };

  const handleRemoveLanguageFromContext = async (languageCode: string) => {
    if (!contextMenu) return;
    try {
      await youtubeService.removeLanguageFromChannel(contextMenu.channelId, languageCode);
      await refreshData();
    } catch (err) {
      console.error('Failed to remove language from channel:', err);
    }
    setContextMenu(null);
  };

  const filteredChannels = getFilteredChannels();
  const uncategorizedCount = channels.filter(c => {
    const groupedChannelIds = new Set(groups.flatMap(g => g.members.map(m => m.channel_id)));
    return !groupedChannelIds.has(c.id);
  }).length;

  if (isLoading) {
    return (
      <div className="h-full w-full bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-red-500" />
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[#0a0a0a] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 h-14 flex items-center justify-between px-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/overview/content-creation/youtube')}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          >
            <ArrowLeft size={18} className="text-white/60" />
          </button>
          <div>
            <h1 className="text-sm font-semibold text-white">All Channels</h1>
            <p className="text-[10px] text-white/40">{channels.length} connected</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status Filter Dropdown - only visible on All Channels page */}
          {selectedGroup === null && (
            <div className="relative" ref={statusDropdownRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setIsStatusDropdownOpen(!isStatusDropdownOpen); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  selectedStatus !== 'all'
                    ? selectedStatus === 'active'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400'
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                }`}
              >
                {selectedStatus === 'active' ? (
                  <><CircleDot size={14} /> Active First</>
                ) : selectedStatus === 'inactive' ? (
                  <><CircleOff size={14} /> Inactive First</>
                ) : (
                  <><Circle size={14} /> All Status</>
                )}
                <ChevronRight size={12} className={`transition-transform ${isStatusDropdownOpen ? 'rotate-90' : ''}`} />
              </button>
              {isStatusDropdownOpen && (
                <div className="absolute right-0 mt-1 w-40 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-hidden z-30">
                  <button
                    onClick={() => { setSelectedStatus('all'); setIsStatusDropdownOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      selectedStatus === 'all' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'
                    }`}
                  >
                    <Circle size={12} />
                    All Channels
                  </button>
                  <button
                    onClick={() => { setSelectedStatus('active'); setIsStatusDropdownOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      selectedStatus === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'text-white/60 hover:bg-white/5'
                    }`}
                  >
                    <CircleDot size={12} className="text-emerald-400" />
                    Active First
                  </button>
                  <button
                    onClick={() => { setSelectedStatus('inactive'); setIsStatusDropdownOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      selectedStatus === 'inactive' ? 'bg-zinc-500/10 text-zinc-400' : 'text-white/60 hover:bg-white/5'
                    }`}
                  >
                    <CircleOff size={12} className="text-zinc-400" />
                    Inactive First
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Sync Button - syncs filtered channels based on group and status */}
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || filteredChannels.length === 0}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 border ${
              selectedGroup !== null && selectedStatus === 'active'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                : selectedGroup !== null && selectedStatus === 'inactive'
                  ? 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400 hover:bg-zinc-500/20'
                  : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
            }`}
            title={`Sync ${filteredChannels.length} channels`}
          >
            <RefreshCcw size={16} className={syncingAll ? 'animate-spin' : ''} />
            {syncingAll
              ? 'Syncing...'
              : selectedGroup !== null && selectedStatus === 'active'
                ? `Sync Active (${filteredChannels.length})`
                : selectedGroup !== null && selectedStatus === 'inactive'
                  ? `Sync Inactive (${filteredChannels.length})`
                  : selectedGroup && selectedGroup !== 'uncategorized'
                    ? `Sync Group (${filteredChannels.length})`
                    : `Sync All (${filteredChannels.length})`
            }
          </button>

          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isConnecting ? <Loader2 size={16} className="animate-spin" /> : <><Plus size={16} /> Add Channel</>}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Groups */}
        <aside className="w-56 flex-shrink-0 border-r border-white/[0.06] flex flex-col bg-[#0a0a0a]">
          <div className="p-3 flex-1 overflow-y-auto">
            {/* All Channels */}
            <button
              onClick={() => handleGroupSelect(null)}
              onDragOver={(e) => handleDragOver(e, null)}
              onDrop={(e) => handleDrop(e, null)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors mb-1 ${
                selectedGroup === null ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'
              }`}
            >
              <Youtube size={16} />
              <span className="flex-1 text-left">All Channels</span>
              <span className="text-xs text-white/30">{channels.length}</span>
            </button>

            {/* Uncategorized */}
            <button
              onClick={() => handleGroupSelect('uncategorized')}
              onDragOver={(e) => handleDragOver(e, 'uncategorized')}
              onDrop={(e) => handleDrop(e, 'uncategorized')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors mb-3 ${
                selectedGroup === 'uncategorized' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'
              } ${dragOverGroup === 'uncategorized' ? 'ring-2 ring-blue-500' : ''}`}
            >
              <Folder size={16} />
              <span className="flex-1 text-left">Uncategorized</span>
              <span className="text-xs text-white/30">{uncategorizedCount}</span>
            </button>

            {/* Groups Label */}
            <div className="flex items-center gap-2 px-2 py-1 mb-2">
              <span className="text-[10px] text-white/30 uppercase tracking-wider">Groups</span>
              <div className="flex-1 h-px bg-white/10" />
              <button
                onClick={() => setIsCreatingGroup(true)}
                className="p-1 rounded hover:bg-white/10 transition-colors"
              >
                <FolderPlus size={12} className="text-white/40" />
              </button>
            </div>

            {/* New Group Input */}
            {isCreatingGroup && (
              <div className="mb-2 p-2 bg-white/5 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowColorPicker('new'); }}
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: newGroupColor }}
                  />
                  <input
                    ref={newGroupInputRef}
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateGroup();
                      if (e.key === 'Escape') setIsCreatingGroup(false);
                    }}
                    placeholder="Group name"
                    className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none"
                  />
                  <button onClick={handleCreateGroup} className="p-1 hover:bg-white/10 rounded">
                    <Check size={14} className="text-emerald-400" />
                  </button>
                  <button onClick={() => setIsCreatingGroup(false)} className="p-1 hover:bg-white/10 rounded">
                    <X size={14} className="text-white/40" />
                  </button>
                </div>
                {showColorPicker === 'new' && (
                  <div className="flex flex-wrap gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                    {GROUP_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => { setNewGroupColor(color); setShowColorPicker(null); }}
                        className={`w-5 h-5 rounded-full ${newGroupColor === color ? 'ring-2 ring-white ring-offset-1 ring-offset-[#0a0a0a]' : ''}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Group List */}
            <div className="space-y-1">
              {groups.map((group) => (
                <div
                  key={group.id}
                  onDragOver={(e) => handleDragOver(e, group.id)}
                  onDrop={(e) => handleDrop(e, group.id)}
                  className={`relative ${dragOverGroup === group.id ? 'ring-2 ring-blue-500 rounded-lg' : ''}`}
                >
                  {editingGroup === group.id ? (
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: group.color }} />
                      <input
                        type="text"
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateGroup(group.id);
                          if (e.key === 'Escape') setEditingGroup(null);
                        }}
                        autoFocus
                        className="flex-1 bg-transparent text-sm text-white outline-none"
                      />
                      <button onClick={() => handleUpdateGroup(group.id)} className="p-1 hover:bg-white/10 rounded">
                        <Check size={12} className="text-emerald-400" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <button
                        onClick={() => { handleGroupSelect(group.id); if (selectedGroup === group.id) setSelectedStatus('all'); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors group ${
                          selectedGroup === group.id ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'
                        }`}
                      >
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                        <span className="flex-1 text-left truncate">{group.name}</span>
                        <span className="text-xs text-white/30">{group.members.length}</span>
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingGroup(group.id); setEditGroupName(group.name); }}
                            className="p-1 hover:bg-white/10 rounded"
                          >
                            <Edit2 size={10} className="text-white/40" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowColorPicker(group.id); }}
                            className="p-1 hover:bg-white/10 rounded"
                          >
                            <Palette size={10} className="text-white/40" />
                          </button>
                          <button onClick={(e) => handleDeleteGroup(group.id, e)} className="p-1 hover:bg-white/10 rounded">
                            <Trash2 size={10} className="text-red-400" />
                          </button>
                        </div>
                      </button>
                      {/* Status sub-filter when group is selected */}
                      {selectedGroup === group.id && (
                        <div className="ml-5 mt-1 space-y-0.5">
                          <button
                            onClick={() => setSelectedStatus('all')}
                            className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-colors ${
                              selectedStatus === 'all' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5 hover:text-white/60'
                            }`}
                          >
                            <Circle size={10} />
                            All
                          </button>
                          <button
                            onClick={() => setSelectedStatus('active')}
                            className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-colors ${
                              selectedStatus === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'text-white/40 hover:bg-white/5 hover:text-white/60'
                            }`}
                          >
                            <CircleDot size={10} className="text-emerald-400" />
                            Active
                          </button>
                          <button
                            onClick={() => setSelectedStatus('inactive')}
                            className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-colors ${
                              selectedStatus === 'inactive' ? 'bg-zinc-500/10 text-zinc-400' : 'text-white/40 hover:bg-white/5 hover:text-white/60'
                            }`}
                          >
                            <CircleOff size={10} className="text-zinc-400" />
                            Inactive
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {showColorPicker === group.id && (
                    <div className="absolute left-0 top-full mt-1 p-2 bg-[#1a1a1a] border border-white/10 rounded-lg z-10 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                      {GROUP_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => handleColorChange(group.id, color)}
                          className={`w-5 h-5 rounded-full ${group.color === color ? 'ring-2 ring-white ring-offset-1 ring-offset-[#1a1a1a]' : ''}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {groups.length === 0 && !isCreatingGroup && (
              <p className="text-xs text-white/20 text-center py-4">No groups yet</p>
            )}

            {/* Language Tags Section */}
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <div className="flex items-center gap-2 px-2 py-1 mb-2">
                <span className="text-[10px] text-white/30 uppercase tracking-wider">Languages</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <div className="space-y-0.5">
                {LANGUAGES.map((lang) => {
                  const count = languageCounts.find(lc => lc.language_code === lang.code)?.channel_count || 0;
                  return (
                    <button
                      key={lang.code}
                      onClick={() => setSelectedLanguage(selectedLanguage === lang.code ? null : lang.code)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        selectedLanguage === lang.code
                          ? 'bg-white/10 text-white'
                          : count > 0
                            ? 'text-white/60 hover:bg-white/5'
                            : 'text-white/20 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-sm">{lang.flag}</span>
                      <span className="flex-1 text-left">{lang.name}</span>
                      {count > 0 && (
                        <span className="text-[10px] text-white/30">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedLanguage && (
                <button
                  onClick={() => setSelectedLanguage(null)}
                  className="w-full mt-2 px-3 py-1.5 text-[10px] text-white/40 hover:text-white/60 transition-colors"
                >
                  Clear language filter
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {filteredChannels.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 ring-1 ring-red-500/20">
                  <Youtube size={40} className="text-red-500" />
                </div>
                <h2 className="text-lg font-semibold text-white mb-2">
                  {selectedGroup ? 'No channels in this group' : 'No channels connected'}
                </h2>
                <p className="text-sm text-white/40 mb-6">
                  {selectedGroup ? 'Drag channels here to add them to this group.' : 'Connect your YouTube channels to manage them all in one place.'}
                </p>
                {!selectedGroup && (
                  <button
                    onClick={handleConnect}
                    disabled={isConnecting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {isConnecting ? <Loader2 size={18} className="animate-spin" /> : <Youtube size={18} />}
                    Connect Channel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {filteredChannels.map((channel) => (
                <div
                  key={channel.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, channel.id)}
                  onClick={() => handleChannelClick(channel.id)}
                  onContextMenu={(e) => handleContextMenu(e, channel.id)}
                  className={`group relative bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden hover:bg-white/[0.04] hover:border-white/10 transition-all cursor-pointer ${
                    draggedChannel === channel.id ? 'opacity-50' : ''
                  } ${
                    selectedGroup === null && channelStatuses[channel.id] === 'inactive' ? 'opacity-40 hover:opacity-70' : ''
                  }`}
                >
                  {/* Drag Handle */}
                  <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10">
                    <GripVertical size={14} className="text-white/40" />
                  </div>

                  {/* Banner */}
                  <div className="h-20 bg-gradient-to-br from-red-600/20 to-red-900/20 relative">
                    {channel.channel_banner_url && (
                      <img src={channel.channel_banner_url} alt="" className="w-full h-full object-cover opacity-50" />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === channel.id ? null : channel.id); }}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <MoreVertical size={14} className="text-white" />
                    </button>

                    {activeMenu === channel.id && (
                      <div className="absolute top-10 right-2 w-44 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl z-20 overflow-hidden">
                        <button
                          onClick={(e) => handleSync(channel.id, e)}
                          disabled={syncingChannel === channel.id}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw size={14} className={syncingChannel === channel.id ? 'animate-spin' : ''} />
                          Sync Channel
                        </button>
                        <button
                          onClick={(e) => openYouTubeStudio(channel.channel_id, e)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors"
                        >
                          <ExternalLink size={14} />
                          Open YouTube Studio
                        </button>
                        {selectedGroup && selectedGroup !== 'uncategorized' && (
                          <>
                            <div className="border-t border-white/10" />
                            <button
                              onClick={(e) => handleRemoveFromGroup(selectedGroup, channel.id, e)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-orange-400 hover:bg-orange-500/10 transition-colors"
                            >
                              <X size={14} />
                              Remove from Group
                            </button>
                          </>
                        )}
                        <div className="border-t border-white/10" />
                        <button
                          onClick={(e) => handleDisconnect(channel.id, e)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={14} />
                          Disconnect
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Avatar */}
                  <div className="relative -mt-8 px-4">
                    {channel.channel_thumbnail_url ? (
                      <img src={channel.channel_thumbnail_url} alt="" className="w-16 h-16 rounded-full border-4 border-[#0a0a0a] bg-[#0a0a0a]" />
                    ) : (
                      <div className="w-16 h-16 rounded-full border-4 border-[#0a0a0a] bg-red-500/20 flex items-center justify-center">
                        <Youtube size={24} className="text-red-400" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4 pt-2">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-white truncate flex-1">{channel.channel_title}</h3>
                      {channelStatuses[channel.id] && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0 ${
                          channelStatuses[channel.id] === 'active'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-zinc-500/20 text-zinc-400'
                        }`}>
                          {channelStatuses[channel.id] === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </div>
                    {channel.channel_custom_url && (
                      <p className="text-[11px] text-white/40 truncate mb-3">{channel.channel_custom_url}</p>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <div className="text-xs font-semibold text-white">{formatNumber(channel.subscriber_count)}</div>
                        <div className="text-[9px] text-white/30">Subscribers</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-semibold text-white">{formatNumber(channel.video_count)}</div>
                        <div className="text-[9px] text-white/30">Videos</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-semibold text-white">{formatNumber(channel.view_count)}</div>
                        <div className="text-[9px] text-white/30">Views</div>
                      </div>
                    </div>
                  </div>

                  {/* Group and Language badges */}
                  {(() => {
                    const channelGroups = groups.filter(g => g.members.some(m => m.channel_id === channel.id));
                    const channelLangs = channelLanguages[channel.id] || [];
                    if (channelGroups.length === 0 && channelLangs.length === 0) return null;
                    return (
                      <div className="px-4 pb-3 flex flex-wrap gap-1">
                        {/* Language flags */}
                        {channelLangs.slice(0, 4).map(langCode => {
                          const lang = getLanguageInfo(langCode);
                          return (
                            <span key={langCode} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-white/5" title={lang.name}>
                              {lang.flag}
                            </span>
                          );
                        })}
                        {channelLangs.length > 4 && (
                          <span className="text-[9px] text-white/30">+{channelLangs.length - 4}</span>
                        )}
                        {/* Group badges */}
                        {channelGroups.slice(0, 3).map(g => (
                          <span key={g.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-white/60 bg-white/5">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.color }} />
                            {g.name}
                          </span>
                        ))}
                        {channelGroups.length > 3 && (
                          <span className="text-[9px] text-white/30">+{channelGroups.length - 3}</span>
                        )}
                      </div>
                    );
                  })()}

                  <div className="absolute top-3 left-8">
                    <div className={`w-2 h-2 rounded-full ${channel.is_active ? 'bg-emerald-500' : 'bg-white/20'}`} />
                  </div>
                </div>
              ))}

              {/* Add Channel Card */}
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="h-full min-h-[200px] flex flex-col items-center justify-center gap-3 bg-white/[0.01] border border-dashed border-white/10 rounded-xl hover:bg-white/[0.03] hover:border-white/20 transition-all disabled:opacity-50"
              >
                {isConnecting ? (
                  <Loader2 size={24} className="animate-spin text-white/40" />
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                      <Plus size={20} className="text-white/40" />
                    </div>
                    <span className="text-sm text-white/40">Add Channel</span>
                  </>
                )}
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[180px] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-visible"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Add to Group - with submenu */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu({
                  ...contextMenu,
                  showGroupSubmenu: !contextMenu.showGroupSubmenu,
                  showRemoveSubmenu: false
                });
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors ${contextMenu.showGroupSubmenu ? 'bg-white/5' : ''}`}
            >
              <div className="flex items-center gap-2">
                <FolderInput size={14} />
                <span>Add to Group</span>
              </div>
              <ChevronRight size={12} className={`text-white/40 transition-transform ${contextMenu.openLeft ? 'rotate-180' : ''}`} />
            </button>

            {/* Groups Submenu */}
            {contextMenu.showGroupSubmenu && (
              <div
                ref={submenuRef}
                className={`absolute top-0 min-w-[160px] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-hidden ${
                  contextMenu.openLeft ? 'right-full mr-1' : 'left-full ml-1'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {getAvailableGroupsForContext().length > 0 ? (
                  <>
                    {getAvailableGroupsForContext().map((group) => (
                      <button
                        key={group.id}
                        onClick={() => handleAddToGroupFromContext(group.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors"
                      >
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                        <span className="truncate">{group.name}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="px-3 py-2 text-xs text-white/30 italic">
                    {groups.length === 0 ? 'No groups created' : 'Already in all groups'}
                  </div>
                )}

                {/* Create new group option */}
                <div className="border-t border-white/10">
                  <button
                    onClick={() => {
                      setContextMenu(null);
                      setIsCreatingGroup(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/50 hover:bg-white/5 hover:text-white/70 transition-colors"
                  >
                    <FolderPlus size={12} />
                    <span>Create New Group</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Remove from Group - only show if channel is in groups */}
          {getContextChannelGroups().length > 0 && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu({
                    ...contextMenu,
                    showRemoveSubmenu: !contextMenu.showRemoveSubmenu,
                    showGroupSubmenu: false
                  });
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-orange-400/70 hover:bg-orange-500/10 transition-colors ${contextMenu.showRemoveSubmenu ? 'bg-orange-500/10' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <X size={14} />
                  <span>Remove from Group</span>
                </div>
                <ChevronRight size={12} className={`text-white/40 transition-transform ${contextMenu.openLeft ? 'rotate-180' : ''}`} />
              </button>

              {/* Remove submenu */}
              {contextMenu.showRemoveSubmenu && (
                <div
                  className={`absolute top-0 min-w-[160px] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-hidden ${
                    contextMenu.openLeft ? 'right-full mr-1' : 'left-full ml-1'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {getContextChannelGroups().map((group) => (
                    <button
                      key={group.id}
                      onClick={() => handleRemoveFromGroupContext(group.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-orange-400/70 hover:bg-orange-500/10 transition-colors"
                    >
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                      <span className="truncate">{group.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-white/10" />

          {/* Add Language Tag - with submenu */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu({
                  ...contextMenu,
                  showLanguageSubmenu: !contextMenu.showLanguageSubmenu,
                  showRemoveLanguageSubmenu: false,
                  showGroupSubmenu: false,
                  showRemoveSubmenu: false
                });
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors ${contextMenu.showLanguageSubmenu ? 'bg-white/5' : ''}`}
            >
              <div className="flex items-center gap-2">
                <Globe size={14} />
                <span>Add Language</span>
              </div>
              <ChevronRight size={12} className={`text-white/40 transition-transform ${contextMenu.openLeft ? 'rotate-180' : ''}`} />
            </button>

            {/* Language Submenu */}
            {contextMenu.showLanguageSubmenu && (
              <div
                className={`absolute top-0 min-w-[140px] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-hidden max-h-[300px] overflow-y-auto ${
                  contextMenu.openLeft ? 'right-full mr-1' : 'left-full ml-1'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {getAvailableLanguagesForContext().length > 0 ? (
                  getAvailableLanguagesForContext().map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => handleAddLanguageFromContext(lang.code)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors"
                    >
                      <span>{lang.flag}</span>
                      <span className="truncate">{lang.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-white/30 italic">
                    All languages added
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Remove Language Tag - only show if channel has languages */}
          {getContextChannelLanguages().length > 0 && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu({
                    ...contextMenu,
                    showRemoveLanguageSubmenu: !contextMenu.showRemoveLanguageSubmenu,
                    showLanguageSubmenu: false,
                    showGroupSubmenu: false,
                    showRemoveSubmenu: false
                  });
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-orange-400/70 hover:bg-orange-500/10 transition-colors ${contextMenu.showRemoveLanguageSubmenu ? 'bg-orange-500/10' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <X size={14} />
                  <span>Remove Language</span>
                </div>
                <ChevronRight size={12} className={`text-white/40 transition-transform ${contextMenu.openLeft ? 'rotate-180' : ''}`} />
              </button>

              {/* Remove Language submenu */}
              {contextMenu.showRemoveLanguageSubmenu && (
                <div
                  className={`absolute top-0 min-w-[140px] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-hidden ${
                    contextMenu.openLeft ? 'right-full mr-1' : 'left-full ml-1'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {getContextChannelLanguages().map((langCode) => {
                    const lang = getLanguageInfo(langCode);
                    return (
                      <button
                        key={langCode}
                        onClick={() => handleRemoveLanguageFromContext(langCode)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-orange-400/70 hover:bg-orange-500/10 transition-colors"
                      >
                        <span>{lang.flag}</span>
                        <span className="truncate">{lang.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-white/10" />

          {/* Set Status - with submenu */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu({
                  ...contextMenu,
                  showStatusSubmenu: !contextMenu.showStatusSubmenu,
                  showLanguageSubmenu: false,
                  showRemoveLanguageSubmenu: false,
                  showGroupSubmenu: false,
                  showRemoveSubmenu: false
                });
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors ${contextMenu.showStatusSubmenu ? 'bg-white/5' : ''}`}
            >
              <div className="flex items-center gap-2">
                <Tag size={14} />
                <span>Set Status</span>
                {channelStatuses[contextMenu.channelId] && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                    channelStatuses[contextMenu.channelId] === 'active'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-zinc-500/20 text-zinc-400'
                  }`}>
                    {channelStatuses[contextMenu.channelId]}
                  </span>
                )}
              </div>
              <ChevronRight size={12} className={`text-white/40 transition-transform ${contextMenu.openLeft ? 'rotate-180' : ''}`} />
            </button>

            {/* Status Submenu */}
            {contextMenu.showStatusSubmenu && (
              <div
                className={`absolute top-0 min-w-[130px] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-hidden ${
                  contextMenu.openLeft ? 'right-full mr-1' : 'left-full ml-1'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => handleSetChannelStatus('active')}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                    channelStatuses[contextMenu.channelId] === 'active'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'text-white/70 hover:bg-white/5'
                  }`}
                >
                  <CircleDot size={12} className="text-emerald-400" />
                  <span>Active</span>
                  {channelStatuses[contextMenu.channelId] === 'active' && <Check size={12} className="ml-auto" />}
                </button>
                <button
                  onClick={() => handleSetChannelStatus('inactive')}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                    channelStatuses[contextMenu.channelId] === 'inactive'
                      ? 'bg-zinc-500/10 text-zinc-400'
                      : 'text-white/70 hover:bg-white/5'
                  }`}
                >
                  <CircleOff size={12} className="text-zinc-400" />
                  <span>Inactive</span>
                  {channelStatuses[contextMenu.channelId] === 'inactive' && <Check size={12} className="ml-auto" />}
                </button>
                {channelStatuses[contextMenu.channelId] && (
                  <>
                    <div className="border-t border-white/10" />
                    <button
                      onClick={() => handleSetChannelStatus(null)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/50 hover:bg-white/5 transition-colors"
                    >
                      <X size={12} />
                      <span>Clear Status</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-white/10" />

          {/* Sync Channel */}
          <button
            onClick={handleSyncFromContext}
            disabled={syncingChannel === contextMenu.channelId}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncingChannel === contextMenu.channelId ? 'animate-spin' : ''} />
            Sync Channel
          </button>

          {/* Open YouTube Studio */}
          <button
            onClick={openYouTubeStudioFromContext}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors"
          >
            <ExternalLink size={14} />
            Open YouTube Studio
          </button>

          {/* Copy Channel Link */}
          <button
            onClick={copyChannelLinkFromContext}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors"
          >
            {copiedChannelLink ? (
              <>
                <CheckCheck size={14} className="text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Link2 size={14} />
                Copy Channel Link
              </>
            )}
          </button>

          <div className="border-t border-white/10" />

          {/* Disconnect */}
          <button
            onClick={handleDisconnectFromContext}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} />
            Disconnect Channel
          </button>
        </div>
      )}
    </div>
  );
};

export default AllChannelsPage;
