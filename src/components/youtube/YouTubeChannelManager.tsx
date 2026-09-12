/**
 * YouTubeChannelManager Component
 * Full 16:9 landscape layout with header + left sidebar
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Youtube, Plus, RefreshCw, Loader2, ChevronDown, CheckCircle, XCircle,
  Users, Eye, Clock, DollarSign, TrendingUp, TrendingDown, Video, Play,
  ThumbsUp, MessageSquare, Share2, Globe, ExternalLink, Settings,
  BarChart3, Activity, ArrowUpRight, ArrowDownRight, LayoutDashboard,
  Film, UserCircle, Wallet, Home, ChevronRight, Folder, Search, X,
  Monitor, Smartphone, Tablet, Tv, Gamepad2, MapPin, Zap, Heart,
  ListPlus, MousePointer, PercentIcon, Link2, Check, ArrowLeft, Calendar,
  ChevronLeft
} from 'lucide-react';
import { youtubeService, YouTubeChannel, CombinedAnalytics, VideoAnalytics, DemographicsData, TrafficSourceData, DateRange, DailyAnalytics, ChannelVideo, ChannelGroup, DashboardResponse, DashboardVideo, DashboardTrafficSource, DashboardDevice, Comment, CommentsResponse, RealtimeMetrics, CacheMetadata, DailySnapshot } from '../../services/youtubeService';

// ============================================================================
// HELPERS
// ============================================================================

type NavItem = 'dashboard' | 'content' | 'audience' | 'revenue' | 'video' | 'history';

const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

const formatWatchTime = (minutes: number): string => {
  const hours = minutes / 60;
  if (hours >= 1000) return `${(hours / 1000).toFixed(1)}K hrs`;
  return `${hours.toFixed(1)} hrs`;
};

const formatCurrency = (amount: number | null): string => {
  if (amount === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};


// ============================================================================
// CHART COMPONENT
// ============================================================================

const PerformanceChart: React.FC<{ data: number[]; color?: string }> = ({ data, color = '#ef4444' }) => {
  const maxValue = Math.max(...data);
  const minValue = Math.min(...data);
  const range = maxValue - minValue || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 100 - ((value - minValue) / range) * 80 - 10;
    return `${x},${y}`;
  }).join(' ');

  const areaPoints = `0,100 ${points} 100,100`;

  return (
    <div className="relative w-full h-full">
      <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {[20, 40, 60, 80].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="white" strokeOpacity="0.04" strokeWidth="0.2" />
        ))}
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill="url(#chartGradient)" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute left-3 top-2 text-[10px] text-white/30">{formatNumber(maxValue)}</div>
      <div className="absolute left-3 bottom-2 text-[10px] text-white/30">{formatNumber(minValue)}</div>
    </div>
  );
};

// Mini Sparkline for metric cards
const MiniSparkline: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  if (!data || data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((v - min) / range) * 80 - 10;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const YouTubeChannelManager: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // State
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [analytics, setAnalytics] = useState<CombinedAnalytics | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavItem>('dashboard');
  const [dateRange, setDateRange] = useState<DateRange>('last_28_days');
  const [activeMetric, setActiveMetric] = useState<'views' | 'watchTime' | 'subscribers' | 'revenue'>('views');

  // Loading
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // UI
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState(false);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [channelSearchQuery, setChannelSearchQuery] = useState('');

  // Groups
  const [groups, setGroups] = useState<ChannelGroup[]>([]);

  // Data
  const [topVideos, setTopVideos] = useState<VideoAnalytics[]>([]);
  const [demographics, setDemographics] = useState<DemographicsData | null>(null);
  const [trafficSources, setTrafficSources] = useState<TrafficSourceData[]>([]);
  const [dailyAnalytics, setDailyAnalytics] = useState<DailyAnalytics[]>([]);
  const [allVideos, setAllVideos] = useState<ChannelVideo[]>([]);
  const [videosNextPage, setVideosNextPage] = useState<string | undefined>();
  const [totalVideos, setTotalVideos] = useState<number>(0);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);

  // Video context menu
  const [videoContextMenu, setVideoContextMenu] = useState<{
    x: number;
    y: number;
    videoId: string;
    videoTitle: string;
  } | null>(null);
  const [copiedVideoLink, setCopiedVideoLink] = useState(false);
  const videoContextMenuRef = useRef<HTMLDivElement>(null);

  // Dashboard data (comprehensive)
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isFromCache, setIsFromCache] = useState<boolean>(false);
  const [cacheTTL, setCacheTTL] = useState<number>(0);

  // Video Analytics (inline view)
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedVideoData, setSelectedVideoData] = useState<any>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);

  // History / Calendar tracking
  const [historyData, setHistoryData] = useState<DailySnapshot[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyCurrentMonth, setHistoryCurrentMonth] = useState(new Date());

  // Real-time metrics (polled separately for live data)
  const [realtimeMetrics, setRealtimeMetrics] = useState<RealtimeMetrics | null>(null);
  const [isPollingRealtime, setIsPollingRealtime] = useState<boolean>(false);

  // Comments modal
  const [isCommentsModalOpen, setIsCommentsModalOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [commentsNextPage, setCommentsNextPage] = useState<string | undefined>();

  // Messages
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Refs
  const dateDropdownRef = useRef<HTMLDivElement>(null);
  const channelDropdownRef = useRef<HTMLDivElement>(null);

  // Chart data - only use real data from API
  const chartData = useMemo(() => {
    if (dailyAnalytics.length === 0) return [];

    // Use real data based on active metric
    switch (activeMetric) {
      case 'views':
        return dailyAnalytics.map(d => d.views);
      case 'watchTime':
        return dailyAnalytics.map(d => d.watch_time_minutes);
      case 'subscribers':
        return dailyAnalytics.map(d => d.subscribers_net);
      default:
        return dailyAnalytics.map(d => d.views);
    }
  }, [dailyAnalytics, activeMetric]);

  // Chart labels (dates)
  const chartLabels = useMemo(() => {
    return dailyAnalytics.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
  }, [dailyAnalytics]);

  // Get channels for a specific group
  const getChannelsForGroup = useMemo(() => {
    return (groupId: string): YouTubeChannel[] => {
      const group = groups.find(g => g.id === groupId);
      if (!group) return [];
      const memberIds = new Set(group.members.map(m => m.channel_id));
      return channels.filter(c => memberIds.has(c.id));
    };
  }, [channels, groups]);

  // Get ungrouped channels
  const ungroupedChannels = useMemo(() => {
    const groupedChannelIds = new Set(groups.flatMap(g => g.members.map(m => m.channel_id)));
    return channels.filter(c => !groupedChannelIds.has(c.id));
  }, [channels, groups]);

  // Filter channels by search query
  const filterChannelsBySearch = (channelList: YouTubeChannel[]) => {
    if (!channelSearchQuery.trim()) return channelList;
    const query = channelSearchQuery.toLowerCase();
    return channelList.filter(c =>
      c.channel_title.toLowerCase().includes(query) ||
      c.channel_custom_url?.toLowerCase().includes(query)
    );
  };

  const dateRangeOptions: { value: DateRange; label: string }[] = [
    { value: 'last_7_days', label: 'Last 7 days' },
    { value: 'last_28_days', label: 'Last 28 days' },
    { value: 'last_90_days', label: 'Last 90 days' },
    { value: 'last_365_days', label: 'Last 365 days' },
    { value: 'lifetime', label: 'Lifetime' },
  ];

  // Helper to select a channel and update URL
  const selectChannel = (channelId: string) => {
    setSelectedChannelId(channelId);
    navigate(`/overview/content-creation/youtube?channel=${channelId}`, { replace: true });
  };

  const navItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'content', label: 'Content', icon: <Film size={18} /> },
    { id: 'audience', label: 'Audience', icon: <UserCircle size={18} /> },
    { id: 'revenue', label: 'Revenue', icon: <Wallet size={18} /> },
    { id: 'history', label: 'History', icon: <Calendar size={18} /> },
  ];

  // Effects
  useEffect(() => {
    const success = searchParams.get('success');
    const errorParam = searchParams.get('error');
    if (success === 'connected') {
      setSuccessMessage('Channel connected successfully!');
      setTimeout(() => setSuccessMessage(null), 5000);
    } else if (errorParam) {
      setError(`Connection failed: ${errorParam}`);
      setTimeout(() => setError(null), 5000);
    }
    if (success || errorParam) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [searchParams]);

  useEffect(() => { loadChannels(); }, []);

  // Handle channel query parameter changes (e.g., navigating from AllChannelsPage)
  useEffect(() => {
    const channelParam = searchParams.get('channel');
    if (channelParam && channels.length > 0 && channels.some(c => c.id === channelParam)) {
      if (selectedChannelId !== channelParam) {
        setSelectedChannelId(channelParam);
      }
    }
  }, [searchParams, channels]);

  useEffect(() => {
    if (channels.length > 0) {
      loadDashboard();
    }
  }, [channels.length, dateRange, selectedChannelId]);

  // Auto-refresh dashboard data every 5 minutes when on dashboard tab
  useEffect(() => {
    if (activeNav !== 'dashboard' || !selectedChannelId) return;

    const interval = setInterval(() => {
      loadDashboard();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [activeNav, selectedChannelId, dateRange]);

  // Real-time metrics polling (every 60 seconds) - lightweight endpoint for live data
  useEffect(() => {
    if (activeNav !== 'dashboard' || !selectedChannelId) {
      setIsPollingRealtime(false);
      return;
    }

    const pollRealtime = async () => {
      try {
        setIsPollingRealtime(true);
        const data = await youtubeService.getRealtimeMetrics(selectedChannelId);
        setRealtimeMetrics(data.realtime);
      } catch (err) {
        console.error('Realtime poll error:', err);
      } finally {
        setIsPollingRealtime(false);
      }
    };

    // Initial fetch
    pollRealtime();

    // Poll every 60 seconds
    const interval = setInterval(pollRealtime, 60 * 1000);

    return () => clearInterval(interval);
  }, [activeNav, selectedChannelId]);

  // Reset videos when channel changes (so they reload for the new channel)
  useEffect(() => {
    setAllVideos([]);
    setVideosNextPage(undefined);
    setTotalVideos(0);
  }, [selectedChannelId]);

  // Load videos when switching to Content tab or when channel changes
  useEffect(() => {
    if (activeNav === 'content' && channels.length > 0 && selectedChannelId && allVideos.length === 0) {
      loadAllVideos();
    }
  }, [activeNav, channels.length, selectedChannelId, allVideos.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setIsDateDropdownOpen(false);
      }
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(e.target as Node)) {
        setIsChannelDropdownOpen(false);
        setHoveredGroupId(null);
        setChannelSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Data loading
  const loadChannels = async () => {
    setIsLoading(true);
    try {
      const [list, groupList] = await Promise.all([
        youtubeService.getChannels(),
        youtubeService.getGroups()
      ]);
      setChannels(list);
      setGroups(groupList);

      // Check for channel query parameter first
      const channelParam = searchParams.get('channel');
      if (channelParam && list.some(c => c.id === channelParam)) {
        setSelectedChannelId(channelParam);
      } else if (list.length > 0 && !selectedChannelId) {
        // Select first channel and update URL
        setSelectedChannelId(list[0].id);
        navigate(`/overview/content-creation/youtube?channel=${list[0].id}`, { replace: true });
      }
    } catch (err) {
      setChannels([]);
      setGroups([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDashboard = async (forceRefresh: boolean = false) => {
    const id = selectedChannelId || channels[0]?.id;
    if (!id) return;

    setIsLoadingAnalytics(true);
    try {
      const data = await youtubeService.getDashboard(id, dateRange, forceRefresh);
      setDashboard(data);

      // Set cache metadata
      if (data._cache) {
        setLastRefresh(new Date(data._cache.cachedAt));
        setIsFromCache(data._cache.fromCache);
        setCacheTTL(data._cache.ttl);
      } else {
        setLastRefresh(new Date());
        setIsFromCache(false);
        setCacheTTL(0);
      }

      // Also set legacy state for backwards compatibility
      setDailyAnalytics(data.daily.map(d => ({
        date: d.date,
        views: d.views,
        watch_time_minutes: d.watch_time_minutes,
        subscribers_gained: d.subscribers_gained,
        subscribers_lost: d.subscribers_lost,
        subscribers_net: d.subscribers_net,
        likes: d.likes,
        comments: d.comments
      })));
      setTopVideos(data.top_videos.map(v => ({
        video_id: v.video_id,
        title: v.title,
        thumbnail_url: v.thumbnail_url,
        published_at: v.published_at,
        views: v.views,
        watch_time_minutes: v.watch_time_minutes,
        likes: v.likes,
        comments: v.comments,
        average_view_duration: v.avg_view_duration
      })));
      setTrafficSources(data.traffic_sources.map(t => ({
        source: t.source,
        views: t.views,
        percentage: t.percentage
      })));
      if (data.demographics) {
        setDemographics({
          age_groups: data.demographics.age_groups,
          gender: { ...data.demographics.gender, other: 0 },
          countries: data.demographics.countries || []
        });
      }

      // Set combined analytics for backwards compatibility
      const channel = channels.find(c => c.id === id);
      setAnalytics({
        total_subscribers: data.overview.total_subscribers,
        total_views: data.overview.views,
        total_watch_time: data.overview.watch_time_minutes,
        total_revenue: null,
        channels: [{
          channel_id: id,
          channel_title: channel?.channel_title || data.channel.title,
          channel_thumbnail_url: channel?.channel_thumbnail_url || data.channel.thumbnail_url,
          subscribers: data.overview.total_subscribers,
          subscriber_change: data.overview.subscriber_change,
          views: data.overview.views,
          watch_time_minutes: data.overview.watch_time_minutes,
          period: dateRange
        }],
        period: dateRange
      });
    } catch (err) {
      console.error('Dashboard error:', err);
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  const [commentsError, setCommentsError] = useState<string | null>(null);

  const loadComments = async (pageToken?: string) => {
    const id = selectedChannelId || channels[0]?.id;
    if (!id) return;

    setIsLoadingComments(true);
    setCommentsError(null);
    try {
      const result = await youtubeService.getComments(id, 50, pageToken);
      if (pageToken) {
        setComments(prev => [...prev, ...result.comments]);
      } else {
        setComments(result.comments);
      }
      setCommentsNextPage(result.next_page_token);
    } catch (err: any) {
      console.error('Comments error:', err);
      if (err.message?.includes('Insufficient') || err.message?.includes('403')) {
        setCommentsError('Comments require additional permissions. Please reconnect your YouTube account.');
      } else {
        setCommentsError('Failed to load comments. Please try again.');
      }
    } finally {
      setIsLoadingComments(false);
    }
  };

  const openCommentsModal = () => {
    setIsCommentsModalOpen(true);
    setComments([]);
    setCommentsNextPage(undefined);
    setCommentsError(null);
    loadComments();
  };

  const closeCommentsModal = () => {
    setIsCommentsModalOpen(false);
    setComments([]);
    setCommentsNextPage(undefined);
  };

  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const loadAllVideos = async (pageToken?: string) => {
    const id = selectedChannelId || channels[0]?.id;
    if (!id) return;
    setIsLoadingVideos(true);
    try {
      const result = await youtubeService.getChannelVideos(id, 20, pageToken);
      if (pageToken) {
        setAllVideos(prev => [...prev, ...result.videos]);
      } else {
        setAllVideos(result.videos);
      }
      setVideosNextPage(result.nextPageToken);
      setTotalVideos(result.totalResults || 0);
    } catch (err) {
      console.error('Failed to load videos:', err);
    } finally {
      setIsLoadingVideos(false);
    }
  };

  // Video context menu handlers
  const handleVideoContextMenu = (e: React.MouseEvent, videoId: string, videoTitle: string) => {
    e.preventDefault();
    e.stopPropagation();
    setVideoContextMenu({
      x: e.clientX,
      y: e.clientY,
      videoId,
      videoTitle
    });
  };

  const openVideoOnYouTube = () => {
    if (!videoContextMenu) return;
    window.open(`https://youtube.com/watch?v=${videoContextMenu.videoId}`, '_blank');
    setVideoContextMenu(null);
  };

  const openVideoInStudio = () => {
    if (!videoContextMenu) return;
    const channel = channels.find(c => c.id === selectedChannelId);
    if (channel) {
      window.open(`https://studio.youtube.com/video/${videoContextMenu.videoId}/edit`, '_blank');
    }
    setVideoContextMenu(null);
  };

  const copyVideoLink = async () => {
    if (!videoContextMenu) return;
    const videoUrl = `https://youtube.com/watch?v=${videoContextMenu.videoId}`;
    try {
      await navigator.clipboard.writeText(videoUrl);
      setCopiedVideoLink(true);
      setTimeout(() => {
        setCopiedVideoLink(false);
        setVideoContextMenu(null);
      }, 1000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setVideoContextMenu(null);
    }
  };

  const viewVideoAnalytics = () => {
    if (!videoContextMenu) return;
    openVideoAnalytics(videoContextMenu.videoId);
    setVideoContextMenu(null);
  };

  const openVideoAnalytics = async (videoId: string) => {
    setSelectedVideoId(videoId);
    setActiveNav('video');
    setIsLoadingVideo(true);
    try {
      const channelId = selectedChannelId || channels[0]?.id || '';
      console.log('[Video Analytics] Fetching details for:', { channelId, videoId, dateRange });
      const result = await youtubeService.getVideoDetails(channelId, videoId, dateRange);
      console.log('[Video Analytics] Result:', result);
      setSelectedVideoData(result);
    } catch (err) {
      console.error('Failed to load video details:', err);
      setSelectedVideoData(null);
    } finally {
      setIsLoadingVideo(false);
    }
  };

  const closeVideoAnalytics = () => {
    setSelectedVideoId(null);
    setSelectedVideoData(null);
    setActiveNav('content');
  };

  // Load history data for calendar view
  const loadHistory = async () => {
    const channelId = selectedChannelId || channels[0]?.id;
    if (!channelId) return;

    setIsLoadingHistory(true);
    try {
      const result = await youtubeService.getChannelHistory(channelId, 6); // 6 months
      setHistoryData(result.snapshots || []);
    } catch (err) {
      console.error('Failed to load history:', err);
      setHistoryData([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Load history when switching to history tab
  useEffect(() => {
    if (activeNav === 'history' && historyData.length === 0) {
      loadHistory();
    }
  }, [activeNav, selectedChannelId]);

  // Close video context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (videoContextMenuRef.current && !videoContextMenuRef.current.contains(e.target as Node)) {
        setVideoContextMenu(null);
      }
    };
    if (videoContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [videoContextMenu]);

  // Handlers
  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      window.location.href = await youtubeService.getAuthUrl();
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      setIsConnecting(false);
    }
  };

  const selectedChannel = channels.find(c => c.id === selectedChannelId);

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full w-full bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-red-500" />
      </div>
    );
  }

  // ============================================================================
  // MAIN LAYOUT - HEADER + SIDEBAR + CONTENT
  // ============================================================================
  return (
    <div className="h-full w-full bg-[#0a0a0a] flex flex-col overflow-hidden">

      {/* Toast Messages */}
      {(successMessage || error) && (
        <div className="absolute top-16 right-4 z-50">
          {successMessage && (
            <div className="px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2 text-emerald-400 text-sm">
              <CheckCircle size={16} />{successMessage}
            </div>
          )}
          {error && (
            <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-sm">
              <XCircle size={16} />{error}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          HEADER - Full Width
      ══════════════════════════════════════════════════════════════════════ */}
      <header className="flex-shrink-0 h-14 flex items-center justify-between px-5 border-b border-white/[0.06] bg-[#0a0a0a]">
        {/* Left: Logo + Title + Current Tab */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
            <Youtube size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">YouTube Studio</h1>
            <p className="text-[10px] text-white/40">Channel Analytics</p>
          </div>
          {/* Vertical Separator + Current Tab */}
          <div className="h-8 w-px bg-white/10 ml-2" />
          <span className="text-sm font-medium text-white capitalize">{activeNav}</span>
        </div>

        {/* Right: Date Range + Sync + Channel Selector */}
        <div className="flex items-center gap-3">
          {/* Date Range Selector */}
          <div className="relative" ref={dateDropdownRef}>
            <button
              onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.05] hover:bg-white/[0.08] text-xs text-white/70 transition-colors"
            >
              {dateRangeOptions.find(o => o.value === dateRange)?.label}
              <ChevronDown size={12} className={`transition-transform ${isDateDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDateDropdownOpen && (
              <div className="absolute top-full right-0 mt-1 w-40 bg-[#151515] border border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden">
                {dateRangeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setDateRange(opt.value); setIsDateDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      dateRange === opt.value
                        ? 'bg-white/10 text-white'
                        : 'text-white/50 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sync Button */}
          <button
            onClick={() => loadDashboard(true)}
            disabled={isLoadingAnalytics}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white/70 hover:text-white transition-all"
          >
            <RefreshCw size={12} className={isLoadingAnalytics ? 'animate-spin' : ''} />
            Sync
          </button>

          {/* Channel Selector Dropdown */}
          <div className="relative" ref={channelDropdownRef}>
          <button
            onClick={() => setIsChannelDropdownOpen(!isChannelDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.08] transition-colors"
          >
            {selectedChannel ? (
              <>
                {selectedChannel.channel_thumbnail_url ? (
                  <img src={selectedChannel.channel_thumbnail_url} alt="" className="w-6 h-6 rounded-full" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
                    <Youtube size={12} className="text-red-400" />
                  </div>
                )}
                <span className="text-sm text-white font-medium max-w-[150px] truncate">
                  {selectedChannel.channel_title}
                </span>
              </>
            ) : (
              <>
                <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                  <Plus size={12} className="text-white/60" />
                </div>
                <span className="text-sm text-white/60">Add Channel</span>
              </>
            )}
            <ChevronDown size={14} className={`text-white/40 transition-transform ${isChannelDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isChannelDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 flex flex-row-reverse bg-[#151515] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
              {/* Right Panel - Groups (appears on the right) */}
              <div className="w-56 flex flex-col border-l border-white/10">
                {/* Header */}
                <div className="p-3 border-b border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-white">Channel Groups</span>
                    <button
                      onClick={() => { navigate('/overview/content-creation/youtube/all-channels'); setIsChannelDropdownOpen(false); }}
                      className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                    >
                      Manage all
                    </button>
                  </div>
                  <p className="text-[10px] text-white/40">{channels.length} channels total</p>
                </div>

                {/* Groups List */}
                <div className="flex-1 overflow-y-auto max-h-[400px] p-2">
                  {/* All Channels */}
                  <button
                    onClick={() => setHoveredGroupId(hoveredGroupId === 'all' ? null : 'all')}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors mb-1 ${
                      hoveredGroupId === 'all' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'
                    }`}
                  >
                    <ChevronRight size={12} className={`text-white/30 transition-transform ${hoveredGroupId === 'all' ? 'rotate-180' : ''}`} />
                    <Youtube size={14} className="text-red-400" />
                    <span className="flex-1 text-left">All Channels</span>
                    <span className="text-[10px] text-white/30">{channels.length}</span>
                  </button>

                  {/* Groups */}
                  {groups.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-2 py-1.5 mt-2">
                        <span className="text-[9px] text-white/30 uppercase tracking-wider">Groups</span>
                        <div className="flex-1 h-px bg-white/10" />
                      </div>
                      {groups.map((group) => (
                        <button
                          key={group.id}
                          onClick={() => setHoveredGroupId(hoveredGroupId === group.id ? null : group.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                            hoveredGroupId === group.id ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'
                          }`}
                        >
                          <ChevronRight size={12} className={`text-white/30 transition-transform ${hoveredGroupId === group.id ? 'rotate-180' : ''}`} />
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                          <span className="flex-1 text-left truncate">{group.name}</span>
                          <span className="text-[10px] text-white/30">{group.members.length}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Uncategorized */}
                  {ungroupedChannels.length > 0 && (
                    <button
                      onClick={() => setHoveredGroupId(hoveredGroupId === 'uncategorized' ? null : 'uncategorized')}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors mt-1 ${
                        hoveredGroupId === 'uncategorized' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'
                      }`}
                    >
                      <ChevronRight size={12} className={`text-white/30 transition-transform ${hoveredGroupId === 'uncategorized' ? 'rotate-180' : ''}`} />
                      <Folder size={14} className="text-white/40" />
                      <span className="flex-1 text-left">Uncategorized</span>
                      <span className="text-[10px] text-white/30">{ungroupedChannels.length}</span>
                    </button>
                  )}
                </div>

                {/* Add Channel Button */}
                <div className="border-t border-white/10 p-2">
                  <button
                    onClick={() => { handleConnect(); setIsChannelDropdownOpen(false); }}
                    disabled={isConnecting}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {isConnecting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <>
                        <Plus size={14} />
                        Add Channel
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Left Panel - Channels in Selected Group (appears on the left) */}
              {hoveredGroupId && (
                <div className="w-72 flex flex-col bg-[#1a1a1a]">
                  {/* Search */}
                  <div className="p-3 border-b border-white/10">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                      <input
                        type="text"
                        value={channelSearchQuery}
                        onChange={(e) => setChannelSearchQuery(e.target.value)}
                        placeholder="Search channels..."
                        className="w-full pl-9 pr-8 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20"
                      />
                      {channelSearchQuery && (
                        <button
                          onClick={() => setChannelSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Channel List */}
                  <div className="flex-1 overflow-y-auto max-h-[400px] p-2">
                    {(() => {
                      let channelList: YouTubeChannel[] = [];
                      if (hoveredGroupId === 'all') {
                        channelList = channels;
                      } else if (hoveredGroupId === 'uncategorized') {
                        channelList = ungroupedChannels;
                      } else {
                        channelList = getChannelsForGroup(hoveredGroupId);
                      }

                      const filteredChannels = filterChannelsBySearch(channelList);

                      if (filteredChannels.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <Youtube size={24} className="text-white/20 mb-2" />
                            <p className="text-xs text-white/40">
                              {channelSearchQuery ? 'No channels match your search' : 'No channels in this group'}
                            </p>
                          </div>
                        );
                      }

                      return filteredChannels.map((ch) => (
                        <button
                          key={ch.id}
                          onClick={() => {
                            selectChannel(ch.id);
                            setIsChannelDropdownOpen(false);
                            setHoveredGroupId(null);
                            setChannelSearchQuery('');
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors mb-1 ${
                            selectedChannelId === ch.id ? 'bg-red-500/20 border border-red-500/30' : 'hover:bg-white/5'
                          }`}
                        >
                          {ch.channel_thumbnail_url ? (
                            <img src={ch.channel_thumbnail_url} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                              <Youtube size={14} className="text-red-400" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0 text-left">
                            <div className="text-sm text-white truncate">{ch.channel_title}</div>
                            <div className="text-[10px] text-white/40">{formatNumber(ch.subscriber_count)} subscribers</div>
                          </div>
                          {selectedChannelId === ch.id && (
                            <CheckCircle size={14} className="text-red-400 flex-shrink-0" />
                          )}
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════════
          BODY - Sidebar + Main Content
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden">

        {/* ─────────────────────────────────────────────────────────────────────
            LEFT SIDEBAR
        ───────────────────────────────────────────────────────────────────── */}
        <aside className="w-56 flex-shrink-0 border-r border-white/[0.06] flex flex-col bg-[#0a0a0a]">

          {/* Navigation */}
          <nav className="flex-1 p-3">
            {/* All Channels Button */}
            <button
              onClick={() => navigate('/overview/content-creation/youtube/all-channels')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-white/50 hover:bg-white/[0.04] hover:text-white/80 mb-3"
            >
              <Home size={18} />
              All Channels
            </button>

            <div className="space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    activeNav === item.id
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/50 hover:bg-white/[0.04] hover:text-white/80'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </nav>

          {/* Empty state prompt */}
          {channels.length === 0 && (
            <div className="p-4 border-t border-white/[0.06]">
              <p className="text-xs text-white/30 text-center">
                Connect a channel to view analytics
              </p>
            </div>
          )}
        </aside>

        {/* ─────────────────────────────────────────────────────────────────────
            MAIN CONTENT AREA
        ───────────────────────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* Tab Content */}
          {channels.length === 0 ? (
            /* Empty State */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 ring-1 ring-red-500/20">
                  <Youtube size={40} className="text-red-500" />
                </div>
                <h2 className="text-lg font-semibold text-white mb-2">No channels connected</h2>
                <p className="text-sm text-white/40 mb-6">
                  Connect your YouTube channel to view analytics, track performance, and manage your content.
                </p>
                <button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {isConnecting ? <Loader2 size={18} className="animate-spin" /> : <Youtube size={18} />}
                  Connect Channel
                </button>
              </div>
            </div>
          ) : activeNav === 'dashboard' ? (
            /* ═══════════════════════════════════════════════════════════════
               DASHBOARD - Production Grade Analytics
            ═══════════════════════════════════════════════════════════════ */
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 space-y-4">

                {/* ══════════════ CHANNEL INFO BAR ══════════════ */}
                <div className="flex items-center gap-3 px-1">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                    {dashboard?.channel?.thumbnail_url ? (
                      <img src={dashboard.channel.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    ) : <Youtube size={16} className="text-red-500 m-auto mt-1.5" />}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-white">{dashboard?.channel?.title || 'Loading...'}</span>
                    <div className="flex items-center gap-2 text-[10px] text-white/40">
                      <div className={`w-1.5 h-1.5 rounded-full ${isFromCache ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                      <span>{isFromCache ? 'Cached' : 'Live'} · {lastRefresh?.toLocaleTimeString() || '—'}</span>
                      {cacheTTL > 0 && <span>· Next sync {Math.ceil(cacheTTL / 60)}m</span>}
                    </div>
                  </div>
                </div>

                {/* ══════════════ PRIMARY METRICS WITH SPARKLINES ══════════════ */}
                <div className="grid grid-cols-5 gap-3">
                  {/* Subscribers */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Users size={12} className="text-emerald-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Subscribers</span>
                    </div>
                    <div className="p-3">
                      <div className="text-xl font-bold text-white mb-1">{formatNumber(dashboard?.overview?.total_subscribers || 0)}</div>
                      {dailyAnalytics.length > 1 && (
                        <div className="h-6 mb-1">
                          <MiniSparkline data={dailyAnalytics.map(d => d.subscribers_net)} color="#10b981" />
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        {dashboard?.comparison?.subscribers && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                            dashboard.comparison.subscribers.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                            dashboard.comparison.subscribers.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                            'bg-white/10 text-white/40'
                          }`}>
                            {dashboard.comparison.subscribers.direction === 'up' ? <TrendingUp size={10} /> :
                             dashboard.comparison.subscribers.direction === 'down' ? <TrendingDown size={10} /> : null}
                            {dashboard.comparison.subscribers.direction === 'up' ? '+' : dashboard.comparison.subscribers.direction === 'down' ? '-' : ''}
                            {dashboard.comparison.subscribers.change}%
                          </span>
                        )}
                        <span className="text-[9px] text-white/30">{dashboard?.period_info?.current?.label || ''}</span>
                      </div>
                    </div>
                  </div>

                  {/* Views */}
                  <button onClick={() => setActiveMetric('views')} className={`bg-white/[0.03] rounded-xl border text-left transition-all overflow-hidden ${activeMetric === 'views' ? 'border-red-500/40 bg-red-500/5' : 'border-white/[0.06] hover:border-white/10'}`}>
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Eye size={12} className="text-red-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Views</span>
                    </div>
                    <div className="p-3">
                      <div className="text-xl font-bold text-white mb-1">{formatNumber(dashboard?.overview?.views || 0)}</div>
                      {dailyAnalytics.length > 1 && (
                        <div className="h-6 mb-1">
                          <MiniSparkline data={dailyAnalytics.map(d => d.views)} color="#ef4444" />
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        {dashboard?.comparison?.views && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                            dashboard.comparison.views.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                            dashboard.comparison.views.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                            'bg-white/10 text-white/40'
                          }`}>
                            {dashboard.comparison.views.direction === 'up' ? <TrendingUp size={10} /> :
                             dashboard.comparison.views.direction === 'down' ? <TrendingDown size={10} /> : null}
                            {dashboard.comparison.views.direction === 'up' ? '+' : dashboard.comparison.views.direction === 'down' ? '-' : ''}
                            {dashboard.comparison.views.change}%
                          </span>
                        )}
                        <span className="text-[9px] text-white/30">{dashboard?.period_info?.current?.label || ''}</span>
                      </div>
                    </div>
                  </button>

                  {/* Watch Time */}
                  <button onClick={() => setActiveMetric('watchTime')} className={`bg-white/[0.03] rounded-xl border text-left transition-all overflow-hidden ${activeMetric === 'watchTime' ? 'border-blue-500/40 bg-blue-500/5' : 'border-white/[0.06] hover:border-white/10'}`}>
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Clock size={12} className="text-blue-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Watch Time</span>
                    </div>
                    <div className="p-3">
                      <div className="text-xl font-bold text-white mb-1">{formatWatchTime(dashboard?.overview?.watch_time_minutes || 0)}</div>
                      {dailyAnalytics.length > 1 && (
                        <div className="h-6 mb-1">
                          <MiniSparkline data={dailyAnalytics.map(d => d.watch_time_minutes)} color="#3b82f6" />
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        {dashboard?.comparison?.watch_time && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                            dashboard.comparison.watch_time.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                            dashboard.comparison.watch_time.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                            'bg-white/10 text-white/40'
                          }`}>
                            {dashboard.comparison.watch_time.direction === 'up' ? <TrendingUp size={10} /> :
                             dashboard.comparison.watch_time.direction === 'down' ? <TrendingDown size={10} /> : null}
                            {dashboard.comparison.watch_time.direction === 'up' ? '+' : dashboard.comparison.watch_time.direction === 'down' ? '-' : ''}
                            {dashboard.comparison.watch_time.change}%
                          </span>
                        )}
                        <span className="text-[9px] text-white/30">{dashboard?.period_info?.current?.label || ''}</span>
                      </div>
                    </div>
                  </button>

                  {/* Avg View % */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <PercentIcon size={12} className="text-purple-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Avg View %</span>
                    </div>
                    <div className="p-3">
                      <div className="text-xl font-bold text-white mb-1">{(dashboard?.overview?.avg_view_percentage || 0).toFixed(1)}%</div>
                      <div className="h-6 mb-1" /> {/* Spacer for alignment */}
                      <div className="flex items-center justify-between">
                        {dashboard?.comparison?.avg_view_percentage && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                            dashboard.comparison.avg_view_percentage.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                            dashboard.comparison.avg_view_percentage.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                            'bg-white/10 text-white/40'
                          }`}>
                            {dashboard.comparison.avg_view_percentage.direction === 'up' ? <TrendingUp size={10} /> :
                             dashboard.comparison.avg_view_percentage.direction === 'down' ? <TrendingDown size={10} /> : null}
                            {dashboard.comparison.avg_view_percentage.direction === 'up' ? '+' : dashboard.comparison.avg_view_percentage.direction === 'down' ? '-' : ''}
                            {dashboard.comparison.avg_view_percentage.change}%
                          </span>
                        )}
                        <span className="text-[9px] text-white/30">{dashboard?.period_info?.current?.label || ''}</span>
                      </div>
                    </div>
                  </div>

                  {/* Engagement */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Activity size={12} className="text-amber-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Engagement</span>
                    </div>
                    <div className="p-3">
                      <div className="text-xl font-bold text-white mb-1">{(dashboard?.overview?.engagement_rate || 0).toFixed(2)}%</div>
                      {dailyAnalytics.length > 1 && (
                        <div className="h-6 mb-1">
                          <MiniSparkline data={dailyAnalytics.map(d => d.likes + d.comments + (d.shares || 0))} color="#f59e0b" />
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        {dashboard?.comparison?.engagement_rate && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                            dashboard.comparison.engagement_rate.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                            dashboard.comparison.engagement_rate.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                            'bg-white/10 text-white/40'
                          }`}>
                            {dashboard.comparison.engagement_rate.direction === 'up' ? <TrendingUp size={10} /> :
                             dashboard.comparison.engagement_rate.direction === 'down' ? <TrendingDown size={10} /> : null}
                            {dashboard.comparison.engagement_rate.direction === 'up' ? '+' : dashboard.comparison.engagement_rate.direction === 'down' ? '-' : ''}
                            {dashboard.comparison.engagement_rate.change}%
                          </span>
                        )}
                        <span className="text-[9px] text-white/30">{dashboard?.period_info?.current?.label || ''}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ══════════════ CHART + REAL-TIME ══════════════ */}
                <div className="grid grid-cols-4 gap-3">
                  {/* Main Chart */}
                  <div className="col-span-3 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <BarChart3 size={14} className={activeMetric === 'views' ? 'text-red-400' : activeMetric === 'watchTime' ? 'text-blue-400' : 'text-emerald-400'} />
                        <span className="text-xs font-medium text-white">
                          {activeMetric === 'views' ? 'Views' : activeMetric === 'watchTime' ? 'Watch Time' : 'Subscribers'} · {dailyAnalytics.length} days
                        </span>
                      </div>
                      <span className="text-xs text-white/40">
                        Total: {activeMetric === 'views' ? formatNumber(dailyAnalytics.reduce((s, d) => s + d.views, 0)) : activeMetric === 'watchTime' ? formatWatchTime(dailyAnalytics.reduce((s, d) => s + d.watch_time_minutes, 0)) : formatNumber(dailyAnalytics.reduce((s, d) => s + d.subscribers_net, 0))}
                      </span>
                    </div>
                    <div className="p-4 h-48">
                      <PerformanceChart data={chartData} color={activeMetric === 'subscribers' ? '#10b981' : activeMetric === 'watchTime' ? '#3b82f6' : '#ef4444'} />
                    </div>
                  </div>

                  {/* Real-time + Quick Stats */}
                  <div className="col-span-1 space-y-3">
                    {/* Today's Stats */}
                    <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                        <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-[10px] font-medium text-white uppercase">Today</span>
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="flex justify-between">
                          <span className="text-[10px] text-white/40">Views</span>
                          <span className="text-xs font-medium text-white">{formatNumber(realtimeMetrics?.today?.views ?? dashboard?.realtime?.today?.views ?? 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-white/40">Watch Time</span>
                          <span className="text-xs font-medium text-white">{formatWatchTime(realtimeMetrics?.today?.watch_time ?? dashboard?.realtime?.today?.watch_time_minutes ?? 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-white/40">Subs +/-</span>
                          <span className="text-xs font-medium text-emerald-400">+{formatNumber(realtimeMetrics?.last_48_hours?.subscribers_gained ?? dashboard?.realtime?.today?.subscribers_gained ?? 0)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Metrics */}
                    <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                        <Zap size={12} className="text-amber-400" />
                        <span className="text-[10px] font-medium text-white uppercase">Metrics</span>
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="flex justify-between">
                          <span className="text-[10px] text-white/40">Avg View %</span>
                          <span className="text-xs font-medium text-white">{(dashboard?.overview?.avg_view_percentage || 0).toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-white/40">Avg Duration</span>
                          <span className="text-xs font-medium text-white">{Math.round(dashboard?.overview?.avg_view_duration || 0)}s</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-white/40">Videos</span>
                          <span className="text-xs font-medium text-white">{dashboard?.overview?.total_videos || 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ══════════════ ENGAGEMENT + SUBSCRIBER INSIGHTS + TOP VIDEOS ══════════════ */}
                <div className="grid grid-cols-6 gap-3">
                  {/* Engagement Metrics with Comparisons */}
                  <div className="col-span-2 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Heart size={12} className="text-pink-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Engagement</span>
                    </div>
                    <div className="p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={openCommentsModal} className="text-center p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-all">
                          <ThumbsUp size={14} className="text-blue-400 mx-auto mb-1" />
                          <div className="text-sm font-semibold text-white">{formatNumber(dashboard?.overview?.likes || 0)}</div>
                          <div className="text-[9px] text-white/30 mb-1">Likes</div>
                          {dashboard?.comparison?.likes && (
                            <span className={`text-[9px] px-1 py-0.5 rounded inline-flex items-center gap-0.5 ${
                              dashboard.comparison.likes.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                              dashboard.comparison.likes.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                              'bg-white/10 text-white/40'
                            }`}>
                              {dashboard.comparison.likes.direction === 'up' ? '+' : dashboard.comparison.likes.direction === 'down' ? '-' : ''}{dashboard.comparison.likes.change}%
                            </span>
                          )}
                        </button>
                        <button onClick={openCommentsModal} className="text-center p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-all">
                          <MessageSquare size={14} className="text-emerald-400 mx-auto mb-1" />
                          <div className="text-sm font-semibold text-white">{formatNumber(dashboard?.overview?.comments || 0)}</div>
                          <div className="text-[9px] text-white/30 mb-1">Comments</div>
                          {dashboard?.comparison?.comments && (
                            <span className={`text-[9px] px-1 py-0.5 rounded inline-flex items-center gap-0.5 ${
                              dashboard.comparison.comments.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                              dashboard.comparison.comments.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                              'bg-white/10 text-white/40'
                            }`}>
                              {dashboard.comparison.comments.direction === 'up' ? '+' : dashboard.comparison.comments.direction === 'down' ? '-' : ''}{dashboard.comparison.comments.change}%
                            </span>
                          )}
                        </button>
                        <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                          <Share2 size={14} className="text-purple-400 mx-auto mb-1" />
                          <div className="text-sm font-semibold text-white">{formatNumber(dashboard?.overview?.shares || 0)}</div>
                          <div className="text-[9px] text-white/30 mb-1">Shares</div>
                          {dashboard?.comparison?.shares && (
                            <span className={`text-[9px] px-1 py-0.5 rounded inline-flex items-center gap-0.5 ${
                              dashboard.comparison.shares.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                              dashboard.comparison.shares.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                              'bg-white/10 text-white/40'
                            }`}>
                              {dashboard.comparison.shares.direction === 'up' ? '+' : dashboard.comparison.shares.direction === 'down' ? '-' : ''}{dashboard.comparison.shares.change}%
                            </span>
                          )}
                        </div>
                        <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                          <ListPlus size={14} className="text-amber-400 mx-auto mb-1" />
                          <div className="text-sm font-semibold text-white">{formatNumber(dashboard?.overview?.videos_added_to_playlists || 0)}</div>
                          <div className="text-[9px] text-white/30">Saved</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Subscriber Insights */}
                  <div className="col-span-1 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Users size={12} className="text-emerald-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Subscribers</span>
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-white/40">Gained</span>
                        <span className="text-sm font-semibold text-emerald-400">+{formatNumber(dashboard?.overview?.subscribers_gained || 0)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-white/40">Lost</span>
                        <span className="text-sm font-semibold text-red-400">-{formatNumber(dashboard?.overview?.subscribers_lost || 0)}</span>
                      </div>
                      <div className="pt-2 border-t border-white/5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-white/40">Net</span>
                          <div className="flex items-center gap-1">
                            <span className={`text-sm font-bold ${(dashboard?.overview?.subscriber_change || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {(dashboard?.overview?.subscriber_change || 0) >= 0 ? '+' : ''}{formatNumber(dashboard?.overview?.subscriber_change || 0)}
                            </span>
                            {dashboard?.comparison?.subscribers && (
                              <span className={`text-[9px] px-1 py-0.5 rounded ${
                                dashboard.comparison.subscribers.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                                dashboard.comparison.subscribers.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                                'bg-white/10 text-white/40'
                              }`}>
                                {dashboard.comparison.subscribers.direction === 'up' ? '+' : dashboard.comparison.subscribers.direction === 'down' ? '-' : ''}{dashboard.comparison.subscribers.change}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Top Videos */}
                  <div className="col-span-3 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <Play size={12} className="text-red-400" />
                        <span className="text-[10px] font-medium text-white uppercase">Top Videos</span>
                      </div>
                      <button onClick={() => setActiveNav('content')} className="text-[9px] text-white/40 hover:text-white">View all →</button>
                    </div>
                    <div className="p-2">
                      {topVideos.length > 0 ? topVideos.slice(0, 4).map((v, i) => (
                        <div key={v.video_id} onClick={() => openVideoAnalytics(v.video_id)} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/[0.03] cursor-pointer">
                          <span className={`w-5 text-center text-[10px] font-bold ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-orange-400' : 'text-white/20'}`}>{i + 1}</span>
                          <div className="w-12 h-7 rounded bg-white/5 overflow-hidden flex-shrink-0">
                            {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" className="w-full h-full object-cover" /> : <Video size={10} className="text-white/20 m-auto mt-2" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-white truncate">{v.title}</div>
                            <div className="text-[9px] text-white/30">{formatNumber(v.views)} views · {formatWatchTime(v.watch_time_minutes)}</div>
                          </div>
                        </div>
                      )) : <div className="text-center py-4 text-white/20 text-[10px]">No videos</div>}
                    </div>
                  </div>
                </div>

                {/* ══════════════ TRAFFIC + DEVICES + DEMOGRAPHICS ══════════════ */}
                <div className="grid grid-cols-3 gap-3">
                  {/* Traffic Sources */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Globe size={12} className="text-purple-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Traffic Sources</span>
                    </div>
                    <div className="p-3 space-y-2">
                      {trafficSources.length > 0 ? trafficSources.slice(0, 5).map((s, i) => {
                        const colors = ['bg-red-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500'];
                        return (
                          <div key={s.source} className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${colors[i]}`} />
                            <span className="text-[10px] text-white/60 flex-1 truncate">{s.source}</span>
                            <span className="text-[10px] font-medium text-white">{s.percentage.toFixed(1)}%</span>
                          </div>
                        );
                      }) : <div className="text-center py-3 text-white/20 text-[10px]">No data</div>}
                    </div>
                  </div>

                  {/* Devices */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Monitor size={12} className="text-cyan-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Devices</span>
                    </div>
                    <div className="p-3 space-y-2">
                      {dashboard?.devices?.slice(0, 5).map((d) => {
                        const icons: Record<string, JSX.Element> = { 'MOBILE': <Smartphone size={12} className="text-emerald-400" />, 'DESKTOP': <Monitor size={12} className="text-blue-400" />, 'TABLET': <Tablet size={12} className="text-purple-400" />, 'TV': <Tv size={12} className="text-red-400" /> };
                        return (
                          <div key={d.device} className="flex items-center gap-2">
                            {icons[d.device_type] || <Monitor size={12} className="text-white/40" />}
                            <span className="text-[10px] text-white/60 flex-1">{d.device}</span>
                            <span className="text-[10px] font-medium text-white">{d.percentage.toFixed(1)}%</span>
                          </div>
                        );
                      }) || <div className="text-center py-3 text-white/20 text-[10px]">No data</div>}
                    </div>
                  </div>

                  {/* Demographics */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <Users size={12} className="text-pink-400" />
                        <span className="text-[10px] font-medium text-white uppercase">Audience</span>
                      </div>
                      <button onClick={() => setActiveNav('audience')} className="text-[9px] text-white/40 hover:text-white">More →</button>
                    </div>
                    <div className="p-3">
                      {demographics ? (
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <div className="flex-1 bg-blue-500/10 rounded-lg p-2 text-center">
                              <div className="text-base font-bold text-blue-400">{demographics.gender.male}%</div>
                              <div className="text-[9px] text-white/30">Male</div>
                            </div>
                            <div className="flex-1 bg-pink-500/10 rounded-lg p-2 text-center">
                              <div className="text-base font-bold text-pink-400">{demographics.gender.female}%</div>
                              <div className="text-[9px] text-white/30">Female</div>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {demographics.age_groups.slice(0, 3).map(ag => (
                              <div key={ag.group} className="flex items-center gap-2">
                                <span className="text-[9px] text-white/40 w-10">{ag.group.replace('age', '')}</span>
                                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${ag.percentage}%` }} />
                                </div>
                                <span className="text-[9px] text-white/60 w-6 text-right">{ag.percentage}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : <div className="text-center py-3 text-white/20 text-[10px]">No data</div>}
                    </div>
                  </div>
                </div>

                {/* ══════════════ GEOGRAPHY + SEARCH TERMS ══════════════ */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Top Countries */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <MapPin size={12} className="text-emerald-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Top Countries</span>
                    </div>
                    <div className="p-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {dashboard?.geography?.countries?.slice(0, 6).map((c, i) => (
                          <div key={c.country_code} className="flex items-center gap-2">
                            <span className="text-[10px] text-white/60 flex-1 truncate">{c.country_name}</span>
                            <span className="text-[10px] font-medium text-white">{c.percentage.toFixed(1)}%</span>
                          </div>
                        )) || <div className="col-span-2 text-center py-2 text-white/20 text-[10px]">No data</div>}
                      </div>
                    </div>
                  </div>

                  {/* Search Terms */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Search size={12} className="text-yellow-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Top Search Terms</span>
                    </div>
                    <div className="p-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {dashboard?.traffic_details?.search_terms?.slice(0, 6).map((s, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-[10px] text-white/60 flex-1 truncate">{s.term}</span>
                            <span className="text-[10px] text-white/40">{formatNumber(s.views)}</span>
                          </div>
                        )) || <div className="col-span-2 text-center py-2 text-white/20 text-[10px]">No data</div>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ══════════════ CARDS + END SCREENS ══════════════ */}
                <div className="grid grid-cols-3 gap-3">
                  {/* Card Performance with Comparisons */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <MousePointer size={12} className="text-orange-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Cards</span>
                    </div>
                    <div className="p-3 grid grid-cols-2 gap-2">
                      <div className="text-center">
                        <div className="text-lg font-bold text-white">{formatNumber(dashboard?.overview?.card_impressions || 0)}</div>
                        <div className="text-[9px] text-white/30 mb-1">Impressions</div>
                        {dashboard?.comparison?.card_impressions && (
                          <span className={`text-[9px] px-1 py-0.5 rounded inline-flex items-center gap-0.5 ${
                            dashboard.comparison.card_impressions.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                            dashboard.comparison.card_impressions.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                            'bg-white/10 text-white/40'
                          }`}>
                            {dashboard.comparison.card_impressions.direction === 'up' ? '+' : dashboard.comparison.card_impressions.direction === 'down' ? '-' : ''}{dashboard.comparison.card_impressions.change}%
                          </span>
                        )}
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-white">{formatNumber(dashboard?.overview?.card_clicks || 0)}</div>
                        <div className="text-[9px] text-white/30 mb-1">Clicks</div>
                        {dashboard?.comparison?.card_clicks && (
                          <span className={`text-[9px] px-1 py-0.5 rounded inline-flex items-center gap-0.5 ${
                            dashboard.comparison.card_clicks.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                            dashboard.comparison.card_clicks.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                            'bg-white/10 text-white/40'
                          }`}>
                            {dashboard.comparison.card_clicks.direction === 'up' ? '+' : dashboard.comparison.card_clicks.direction === 'down' ? '-' : ''}{dashboard.comparison.card_clicks.change}%
                          </span>
                        )}
                      </div>
                      <div className="col-span-2 text-center pt-1 border-t border-white/5">
                        <span className="text-[10px] text-white/40">CTR: </span>
                        <span className="text-sm font-medium text-orange-400">{(dashboard?.overview?.card_click_rate || 0).toFixed(2)}%</span>
                      </div>
                    </div>
                  </div>

                  {/* External Traffic */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <ExternalLink size={12} className="text-cyan-400" />
                      <span className="text-[10px] font-medium text-white uppercase">External Traffic</span>
                    </div>
                    <div className="p-2 space-y-1 max-h-24 overflow-y-auto">
                      {dashboard?.traffic_details?.external_websites?.slice(0, 4).map((e, i) => (
                        <a key={i} href={e.website.startsWith('http') ? e.website : `https://${e.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-1.5 rounded hover:bg-white/[0.03] transition-colors">
                          <span className="text-[10px] text-cyan-400/80 truncate flex-1">{e.website}</span>
                          <span className="text-[9px] text-white/30">{formatNumber(e.views)}</span>
                        </a>
                      )) || <div className="text-center py-2 text-white/20 text-[10px]">No data</div>}
                    </div>
                  </div>

                  {/* Suggested Videos */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Video size={12} className="text-red-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Suggested Traffic</span>
                    </div>
                    <div className="p-2 space-y-1 max-h-24 overflow-y-auto">
                      {dashboard?.traffic_details?.suggested_videos?.slice(0, 3).map((v, i) => (
                        <a key={i} href={`https://youtube.com/watch?v=${v.video_id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-1 rounded hover:bg-white/[0.03] transition-colors">
                          {v.thumbnail && <img src={v.thumbnail} alt="" className="w-8 h-5 rounded object-cover" />}
                          <span className="text-[10px] text-white/60 truncate flex-1">{v.title || v.video_id}</span>
                          <span className="text-[9px] text-white/30">{formatNumber(v.views)}</span>
                        </a>
                      )) || <div className="text-center py-2 text-white/20 text-[10px]">No data</div>}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          ) : activeNav === 'content' ? (
            /* ═══════════════════════════════════════════════════════════════
               CONTENT TAB - Professional Video Library
            ═══════════════════════════════════════════════════════════════ */
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 space-y-4">

                {/* ══════════════ CONTENT OVERVIEW STATS ══════════════ */}
                <div className="grid grid-cols-4 gap-3">
                  {/* Total Videos */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Video size={12} className="text-red-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Total Videos</span>
                    </div>
                    <div className="p-3">
                      <div className="text-2xl font-bold text-white">{formatNumber(totalVideos)}</div>
                      <p className="text-[10px] text-white/40 mt-1">Published videos</p>
                    </div>
                  </div>

                  {/* Total Views */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <Eye size={12} className="text-blue-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Total Views</span>
                    </div>
                    <div className="p-3">
                      <div className="text-2xl font-bold text-white">
                        {formatNumber(allVideos.reduce((sum, v) => sum + (v.view_count || 0), 0))}
                      </div>
                      <p className="text-[10px] text-white/40 mt-1">Across all videos</p>
                    </div>
                  </div>

                  {/* Total Likes */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <ThumbsUp size={12} className="text-emerald-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Total Likes</span>
                    </div>
                    <div className="p-3">
                      <div className="text-2xl font-bold text-white">
                        {formatNumber(allVideos.reduce((sum, v) => sum + (v.like_count || 0), 0))}
                      </div>
                      <p className="text-[10px] text-white/40 mt-1">Total engagement</p>
                    </div>
                  </div>

                  {/* Total Comments */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                      <MessageSquare size={12} className="text-purple-400" />
                      <span className="text-[10px] font-medium text-white uppercase">Comments</span>
                    </div>
                    <div className="p-3">
                      <div className="text-2xl font-bold text-white">
                        {formatNumber(allVideos.reduce((sum, v) => sum + (v.comment_count || 0), 0))}
                      </div>
                      <p className="text-[10px] text-white/40 mt-1">Community activity</p>
                    </div>
                  </div>
                </div>

                {/* ══════════════ TOP PERFORMING VIDEOS ══════════════ */}
                {allVideos.length > 0 && (
                  <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={14} className="text-amber-400" />
                        <span className="text-xs font-medium text-white">Top Performing Videos</span>
                      </div>
                      <span className="text-[10px] text-white/40">By views</span>
                    </div>
                    <div className="p-2">
                      <div className="space-y-1">
                        {[...allVideos]
                          .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
                          .slice(0, 5)
                          .map((video, index) => (
                            <div
                              key={video.video_id}
                              onClick={() => openVideoAnalytics(video.video_id)}
                              onContextMenu={(e) => handleVideoContextMenu(e, video.video_id, video.title)}
                              className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors group"
                            >
                              <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${
                                index === 0 ? 'bg-amber-500/20 text-amber-400' :
                                index === 1 ? 'bg-slate-400/20 text-slate-300' :
                                index === 2 ? 'bg-orange-500/20 text-orange-400' :
                                'bg-white/5 text-white/40'
                              }`}>
                                {index + 1}
                              </span>
                              <div className="w-16 h-9 rounded-md bg-white/5 overflow-hidden flex-shrink-0">
                                {video.thumbnail_url ? (
                                  <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Video size={12} className="text-white/20" />
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-xs text-white font-medium truncate group-hover:text-red-400 transition-colors">{video.title}</h4>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[10px] text-white/40">{formatNumber(video.view_count || 0)} views</span>
                                  <span className="text-[10px] text-white/30">•</span>
                                  <span className="text-[10px] text-white/40">{formatNumber(video.like_count || 0)} likes</span>
                                </div>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); openVideoAnalytics(video.video_id); }}
                                className="px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-white/60 hover:text-white transition-colors"
                              >
                                View
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ══════════════ VIDEO LIBRARY ══════════════ */}
                <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <Film size={14} className="text-red-400" />
                      <span className="text-xs font-medium text-white">Video Library</span>
                      <span className="text-[10px] text-white/40">({totalVideos})</span>
                    </div>
                    {isLoadingVideos && <Loader2 size={12} className="animate-spin text-white/40" />}
                  </div>

                  {/* Videos Content */}
                  {isLoadingVideos && allVideos.length === 0 ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={24} className="animate-spin text-red-400" />
                    </div>
                  ) : allVideos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <Video size={28} className="text-white/20 mb-2" />
                      <p className="text-white/40 text-xs">No videos found</p>
                    </div>
                  ) : (
                    <div className="p-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                        {allVideos.map((video) => (
                          <div
                            key={video.video_id}
                            onContextMenu={(e) => handleVideoContextMenu(e, video.video_id, video.title)}
                            className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden hover:border-white/[0.1] transition-all"
                          >
                            {/* Thumbnail */}
                            <div
                              className="aspect-video bg-white/[0.02] cursor-pointer"
                              onClick={() => window.open(`https://youtube.com/watch?v=${video.video_id}`, '_blank')}
                            >
                              {video.thumbnail_url ? (
                                <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Video size={20} className="text-white/10" />
                                </div>
                              )}
                            </div>

                            {/* Header - Title */}
                            <div className="px-3 py-2 border-b border-white/[0.06]">
                              <h4 className="text-[11px] text-white font-medium line-clamp-2 leading-snug">{video.title}</h4>
                              <p className="text-[9px] text-white/30 mt-1">
                                {video.published_at ? new Date(video.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                              </p>
                            </div>

                            {/* Stats */}
                            <div className="px-3 py-2 space-y-1.5">
                              <div className="flex justify-between">
                                <span className="text-[10px] text-white/40">Views</span>
                                <span className="text-[11px] font-medium text-white">{formatNumber(video.view_count || 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[10px] text-white/40">Likes</span>
                                <span className="text-[11px] font-medium text-white">{formatNumber(video.like_count || 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[10px] text-white/40">Comments</span>
                                <span className="text-[11px] font-medium text-white">{formatNumber(video.comment_count || 0)}</span>
                              </div>
                            </div>

                            {/* Footer */}
                            <div className="px-3 py-2 border-t border-white/[0.06]">
                              <button
                                onClick={() => openVideoAnalytics(video.video_id)}
                                className="w-full py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-white/50 hover:text-white font-medium transition-colors"
                              >
                                View Analytics
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Load More */}
                      {videosNextPage && (
                        <div className="flex justify-center mt-4 pt-4 border-t border-white/[0.06]">
                          <button
                            onClick={() => loadAllVideos(videosNextPage)}
                            disabled={isLoadingVideos}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-white/60 hover:text-white font-medium transition-colors disabled:opacity-50"
                          >
                            {isLoadingVideos ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            Load More
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </div>
          ) : activeNav === 'audience' ? (
            /* ═══════════════════════════════════════════════════════════════
               AUDIENCE TAB - Full Demographics
            ═══════════════════════════════════════════════════════════════ */
            <div className="flex-1 overflow-y-auto">
              <div className="p-5 space-y-5">
                {demographics ? (
                  <>
                    {/* Gender Distribution */}
                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
                      <h3 className="text-sm font-medium text-white mb-4">Gender Distribution</h3>
                      <div className="flex gap-4">
                        <div className="flex-1 bg-blue-500/10 rounded-xl p-6 text-center">
                          <div className="text-4xl font-bold text-blue-400 mb-1">{demographics.gender.male}%</div>
                          <div className="text-sm text-white/50">Male</div>
                        </div>
                        <div className="flex-1 bg-pink-500/10 rounded-xl p-6 text-center">
                          <div className="text-4xl font-bold text-pink-400 mb-1">{demographics.gender.female}%</div>
                          <div className="text-sm text-white/50">Female</div>
                        </div>
                        {demographics.gender.other > 0 && (
                          <div className="flex-1 bg-purple-500/10 rounded-xl p-6 text-center">
                            <div className="text-4xl font-bold text-purple-400 mb-1">{demographics.gender.other}%</div>
                            <div className="text-sm text-white/50">Other</div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Age Groups */}
                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
                      <h3 className="text-sm font-medium text-white mb-4">Age Groups</h3>
                      <div className="space-y-3">
                        {demographics.age_groups.map((age) => (
                          <div key={age.group}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-white/60">{age.group}</span>
                              <span className="text-white font-medium">{age.percentage.toFixed(1)}%</span>
                            </div>
                            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-red-500 to-orange-500 rounded-full transition-all"
                                style={{ width: `${age.percentage}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Top Countries */}
                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
                      <h3 className="text-sm font-medium text-white mb-4">Top Countries</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {demographics.countries.slice(0, 10).map((country, i) => (
                          <div key={country.country} className="flex items-center gap-3 p-3 bg-white/[0.02] rounded-lg">
                            <span className="text-lg font-semibold text-white/30 w-6">{i + 1}</span>
                            <div className="flex-1">
                              <div className="text-sm text-white">{country.country}</div>
                              <div className="text-xs text-white/40">{country.percentage.toFixed(1)}%</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-20">
                    <div className="text-center">
                      <UserCircle size={48} className="text-white/20 mx-auto mb-4" />
                      <p className="text-white/40 text-sm">No audience data available</p>
                      <p className="text-white/30 text-xs mt-1">Data may take time to populate</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeNav === 'revenue' ? (
            /* ═══════════════════════════════════════════════════════════════
               REVENUE TAB
            ═══════════════════════════════════════════════════════════════ */
            <div className="flex-1 overflow-y-auto">
              <div className="p-5 space-y-5">
                {analytics?.total_revenue !== null ? (
                  <>
                    {/* Revenue Overview */}
                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
                      <h3 className="text-sm font-medium text-white mb-4">Estimated Revenue</h3>
                      <div className="text-4xl font-bold text-amber-400 mb-2">
                        {formatCurrency(analytics?.total_revenue || 0)}
                      </div>
                      <p className="text-xs text-white/40">
                        {dateRangeOptions.find(o => o.value === dateRange)?.label}
                      </p>
                    </div>

                    {/* Revenue Note */}
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                      <p className="text-sm text-amber-400/80">
                        Revenue data is estimated and may differ from your actual YouTube earnings.
                        Final earnings are available in YouTube Studio.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-20">
                    <div className="text-center">
                      <Wallet size={48} className="text-white/20 mx-auto mb-4" />
                      <p className="text-white/40 text-sm">Revenue data not available</p>
                      <p className="text-white/30 text-xs mt-1">Monetization may not be enabled for this channel</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeNav === 'video' && selectedVideoId ? (
            /* ═══════════════════════════════════════════════════════════════
               VIDEO ANALYTICS - Inline View
            ═══════════════════════════════════════════════════════════════ */
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 space-y-3">
                {isLoadingVideo ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 size={24} className="animate-spin text-red-400" />
                  </div>
                ) : selectedVideoData ? (
                  <>
                    {/* Back Button + Video Header */}
                    <div className="flex items-center gap-3 mb-2">
                      <button
                        onClick={closeVideoAnalytics}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        <ArrowLeft size={16} className="text-white/60" />
                      </button>
                      <div className="w-16 h-9 rounded-md overflow-hidden bg-white/5 flex-shrink-0">
                        {selectedVideoData.video.thumbnail_url && (
                          <img src={selectedVideoData.video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xs font-medium text-white truncate">{selectedVideoData.video.title}</h2>
                        <p className="text-[10px] text-white/40">
                          {selectedVideoData.video.published_at ? new Date(selectedVideoData.video.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                          {selectedVideoData.video.duration_seconds ? ` • ${Math.floor(selectedVideoData.video.duration_seconds / 60)}:${(selectedVideoData.video.duration_seconds % 60).toString().padStart(2, '0')}` : ''}
                        </p>
                      </div>
                      <a
                        href={`https://youtube.com/watch?v=${selectedVideoData.video.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-[10px] text-white font-medium"
                      >
                        <ExternalLink size={10} />
                        YouTube
                      </a>
                    </div>

                    {/* Primary Stats Row */}
                    <div className="grid grid-cols-6 gap-3">
                      {[
                        { icon: Eye, label: 'Views', value: formatNumber(selectedVideoData.video.view_count || 0), color: 'text-blue-400' },
                        { icon: Clock, label: 'Watch Time', value: selectedVideoData.analytics ? formatWatchTime(selectedVideoData.analytics.watch_time_minutes) : '—', color: 'text-purple-400' },
                        { icon: ThumbsUp, label: 'Likes', value: formatNumber(selectedVideoData.video.like_count || 0), color: 'text-emerald-400' },
                        { icon: MessageSquare, label: 'Comments', value: formatNumber(selectedVideoData.video.comment_count || 0), color: 'text-amber-400' },
                        { icon: Share2, label: 'Shares', value: selectedVideoData.analytics ? formatNumber(selectedVideoData.analytics.shares || 0) : '—', color: 'text-pink-400' },
                        { icon: Users, label: 'Subs', value: selectedVideoData.analytics ? `${(selectedVideoData.analytics.subscribers_gained - selectedVideoData.analytics.subscribers_lost) >= 0 ? '+' : ''}${formatNumber(selectedVideoData.analytics.subscribers_gained - selectedVideoData.analytics.subscribers_lost)}` : '—', color: 'text-emerald-400' },
                      ].map((stat, i) => (
                        <div key={i} className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
                            <stat.icon size={10} className={stat.color} />
                            <span className="text-[9px] font-medium text-white/50 uppercase">{stat.label}</span>
                          </div>
                          <div className="px-3 py-2">
                            <span className="text-lg font-semibold text-white">{stat.value}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Engagement + Traffic + Audience */}
                    <div className="grid grid-cols-3 gap-3">
                      {/* Engagement */}
                      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
                          <TrendingUp size={10} className="text-emerald-400" />
                          <span className="text-[9px] font-medium text-white/50 uppercase">Engagement</span>
                        </div>
                        <div className="p-3 space-y-2">
                          <div className="flex justify-between">
                            <span className="text-[10px] text-white/40">Avg View %</span>
                            <span className="text-[11px] font-medium text-white">{selectedVideoData.analytics ? `${selectedVideoData.analytics.avg_view_percentage.toFixed(1)}%` : '—'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[10px] text-white/40">Avg Duration</span>
                            <span className="text-[11px] font-medium text-white">{selectedVideoData.analytics ? `${Math.floor(selectedVideoData.analytics.avg_view_duration / 60)}:${(Math.round(selectedVideoData.analytics.avg_view_duration) % 60).toString().padStart(2, '0')}` : '—'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[10px] text-white/40">Engage Rate</span>
                            <span className="text-[11px] font-medium text-white">{selectedVideoData.video.view_count > 0 ? `${((selectedVideoData.video.like_count + selectedVideoData.video.comment_count) / selectedVideoData.video.view_count * 100).toFixed(2)}%` : '0%'}</span>
                          </div>
                          {selectedVideoData.analytics && (
                            <div className="pt-2 border-t border-white/[0.04]">
                              <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(selectedVideoData.analytics.avg_view_percentage, 100)}%` }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Traffic Sources */}
                      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
                          <Globe size={10} className="text-amber-400" />
                          <span className="text-[9px] font-medium text-white/50 uppercase">Traffic Sources</span>
                        </div>
                        <div className="p-3">
                          {selectedVideoData.traffic_sources && selectedVideoData.traffic_sources.length > 0 ? (
                            <div className="space-y-2">
                              {selectedVideoData.traffic_sources.slice(0, 5).map((source: any) => (
                                <div key={source.source} className="flex justify-between">
                                  <span className="text-[10px] text-white/50 truncate max-w-[100px]">{source.source}</span>
                                  <span className="text-[10px] font-medium text-white">{source.percentage.toFixed(1)}%</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-3">
                              <p className="text-[10px] text-white/30">No traffic data</p>
                              <p className="text-[9px] text-white/15 mt-1">Analytics may take 48-72h</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Audience */}
                      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
                          <Users size={10} className="text-blue-400" />
                          <span className="text-[9px] font-medium text-white/50 uppercase">Audience</span>
                        </div>
                        <div className="p-3">
                          {selectedVideoData.demographics && (selectedVideoData.demographics.gender?.male > 0 || selectedVideoData.demographics.gender?.female > 0) ? (
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-[10px] text-white/40">Male</span>
                                <span className="text-[10px] font-medium text-blue-400">{selectedVideoData.demographics.gender.male.toFixed(1)}%</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[10px] text-white/40">Female</span>
                                <span className="text-[10px] font-medium text-pink-400">{selectedVideoData.demographics.gender.female.toFixed(1)}%</span>
                              </div>
                              {selectedVideoData.demographics.age_groups?.length > 0 && (
                                <div className="flex justify-between pt-2 border-t border-white/[0.04]">
                                  <span className="text-[10px] text-white/40">Top Age</span>
                                  <span className="text-[10px] font-medium text-white">{selectedVideoData.demographics.age_groups[0].group}</span>
                                </div>
                              )}
                              {selectedVideoData.demographics.countries?.length > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-[10px] text-white/40">Top Country</span>
                                  <span className="text-[10px] font-medium text-white">{selectedVideoData.demographics.countries[0].country}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-center py-3">
                              <p className="text-[10px] text-white/30">No audience data</p>
                              <p className="text-[9px] text-white/15 mt-1">Needs sufficient views</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    {selectedVideoData.video.description && (
                      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
                          <span className="text-[9px] font-medium text-white/50 uppercase">Description</span>
                        </div>
                        <div className="p-3">
                          <p className="text-[11px] text-white/50 whitespace-pre-wrap line-clamp-4 leading-relaxed">{selectedVideoData.video.description}</p>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center py-20">
                    <p className="text-white/40 text-sm">Failed to load video data</p>
                  </div>
                )}
              </div>
            </div>
          ) : activeNav === 'history' ? (
            /* ═══════════════════════════════════════════════════════════════
               HISTORY TAB - Subscriber Calendar Tracking
            ═══════════════════════════════════════════════════════════════ */
            <div className="flex-1 overflow-y-auto">
              <div className="p-5 space-y-4">
                {/* Month Navigation */}
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Subscriber History</h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const newMonth = new Date(historyCurrentMonth);
                        newMonth.setMonth(newMonth.getMonth() - 1);
                        setHistoryCurrentMonth(newMonth);
                      }}
                      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <ChevronLeft size={16} className="text-white/60" />
                    </button>
                    <span className="text-sm font-medium text-white min-w-[120px] text-center">
                      {historyCurrentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                    <button
                      onClick={() => {
                        const newMonth = new Date(historyCurrentMonth);
                        newMonth.setMonth(newMonth.getMonth() + 1);
                        if (newMonth <= new Date()) setHistoryCurrentMonth(newMonth);
                      }}
                      disabled={historyCurrentMonth.getMonth() === new Date().getMonth() && historyCurrentMonth.getFullYear() === new Date().getFullYear()}
                      className="p-1.5 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-30"
                    >
                      <ChevronRight size={16} className="text-white/60" />
                    </button>
                    <button
                      onClick={loadHistory}
                      disabled={isLoadingHistory}
                      className="ml-2 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <RefreshCw size={16} className={`text-white/60 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {isLoadingHistory ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 size={24} className="animate-spin text-red-400" />
                  </div>
                ) : historyData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Calendar size={48} className="text-white/20 mb-4" />
                    <p className="text-white/40 text-sm mb-2">No history data yet</p>
                    <p className="text-white/20 text-xs max-w-md">
                      History will be recorded as you sync your channels. Click the refresh button to fetch historical data from YouTube Analytics.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Calendar Grid */}
                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
                      {/* Weekday Headers */}
                      <div className="grid grid-cols-7 border-b border-white/[0.06]">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                          <div key={day} className="py-2 text-center text-[10px] font-medium text-white/40 uppercase">
                            {day}
                          </div>
                        ))}
                      </div>

                      {/* Calendar Days */}
                      <div className="grid grid-cols-7">
                        {(() => {
                          const year = historyCurrentMonth.getFullYear();
                          const month = historyCurrentMonth.getMonth();
                          const firstDay = new Date(year, month, 1).getDay();
                          const daysInMonth = new Date(year, month + 1, 0).getDate();
                          const today = new Date();

                          // Build a map of date -> snapshot for quick lookup
                          const snapshotMap: Record<string, DailySnapshot> = {};
                          historyData.forEach(s => {
                            const dateStr = new Date(s.date).toISOString().split('T')[0];
                            snapshotMap[dateStr] = s;
                          });

                          const cells = [];

                          // Empty cells for days before first of month
                          for (let i = 0; i < firstDay; i++) {
                            cells.push(<div key={`empty-${i}`} className="h-20 border-r border-b border-white/[0.04]" />);
                          }

                          // Days of the month
                          for (let day = 1; day <= daysInMonth; day++) {
                            const date = new Date(year, month, day);
                            const dateStr = date.toISOString().split('T')[0];
                            const snapshot = snapshotMap[dateStr];
                            const isToday = date.toDateString() === today.toDateString();
                            const isFuture = date > today;

                            cells.push(
                              <div
                                key={day}
                                className={`h-20 p-1.5 border-r border-b border-white/[0.04] ${
                                  isToday ? 'bg-red-500/5' : ''
                                } ${isFuture ? 'opacity-30' : ''}`}
                              >
                                <div className={`text-[10px] font-medium mb-1 ${isToday ? 'text-red-400' : 'text-white/40'}`}>
                                  {day}
                                </div>
                                {snapshot && !isFuture && (
                                  <div className="space-y-0.5">
                                    <div className="text-[11px] font-semibold text-white">
                                      {formatNumber(snapshot.subscriber_count)}
                                    </div>
                                    {snapshot.net_change !== 0 && (
                                      <div className={`text-[9px] font-medium flex items-center gap-0.5 ${
                                        snapshot.net_change > 0 ? 'text-emerald-400' : 'text-red-400'
                                      }`}>
                                        {snapshot.net_change > 0 ? (
                                          <TrendingUp size={8} />
                                        ) : (
                                          <TrendingDown size={8} />
                                        )}
                                        {snapshot.net_change > 0 ? '+' : ''}{formatNumber(snapshot.net_change)}
                                      </div>
                                    )}
                                    {snapshot.views > 0 && (
                                      <div className="text-[8px] text-white/30">
                                        {formatNumber(snapshot.views)} views
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return cells;
                        })()}
                      </div>
                    </div>

                    {/* Summary Stats */}
                    <div className="grid grid-cols-4 gap-3">
                      {(() => {
                        const monthStart = new Date(historyCurrentMonth.getFullYear(), historyCurrentMonth.getMonth(), 1);
                        const monthEnd = new Date(historyCurrentMonth.getFullYear(), historyCurrentMonth.getMonth() + 1, 0);

                        const monthSnapshots = historyData.filter(s => {
                          const d = new Date(s.date);
                          return d >= monthStart && d <= monthEnd;
                        });

                        const totalGained = monthSnapshots.reduce((sum, s) => sum + s.subscribers_gained, 0);
                        const totalLost = monthSnapshots.reduce((sum, s) => sum + s.subscribers_lost, 0);
                        const netChange = totalGained - totalLost;
                        const totalViews = monthSnapshots.reduce((sum, s) => sum + s.views, 0);

                        const growthDays = monthSnapshots.filter(s => s.net_change > 0).length;
                        const declineDays = monthSnapshots.filter(s => s.net_change < 0).length;

                        return [
                          { label: 'Net Change', value: `${netChange >= 0 ? '+' : ''}${formatNumber(netChange)}`, color: netChange >= 0 ? 'text-emerald-400' : 'text-red-400' },
                          { label: 'Total Views', value: formatNumber(totalViews), color: 'text-blue-400' },
                          { label: 'Growth Days', value: growthDays.toString(), color: 'text-emerald-400' },
                          { label: 'Decline Days', value: declineDays.toString(), color: 'text-red-400' },
                        ].map((stat, i) => (
                          <div key={i} className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-3">
                            <div className="text-[10px] text-white/40 uppercase mb-1">{stat.label}</div>
                            <div className={`text-lg font-semibold ${stat.color}`}>{stat.value}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {/* Video Context Menu */}
      {videoContextMenu && (
        <div
          ref={videoContextMenuRef}
          className="fixed z-50 min-w-[180px] bg-[#1a1a1c] border border-white/10 rounded-xl shadow-2xl py-1.5 overflow-hidden"
          style={{
            left: Math.min(videoContextMenu.x, window.innerWidth - 200),
            top: Math.min(videoContextMenu.y, window.innerHeight - 250)
          }}
        >
          {/* Video Title Header */}
          <div className="px-3 py-2 border-b border-white/10">
            <p className="text-[10px] text-white/40 uppercase tracking-wide">Video</p>
            <p className="text-xs text-white truncate max-w-[200px]">{videoContextMenu.videoTitle}</p>
          </div>

          {/* View Analytics */}
          <button
            onClick={viewVideoAnalytics}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors"
          >
            <BarChart3 size={14} />
            View Analytics
          </button>

          {/* Open on YouTube */}
          <button
            onClick={openVideoOnYouTube}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors"
          >
            <ExternalLink size={14} />
            Open on YouTube
          </button>

          {/* Open in YouTube Studio */}
          <button
            onClick={openVideoInStudio}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors"
          >
            <Settings size={14} />
            Open in YouTube Studio
          </button>

          {/* Copy Video Link */}
          <button
            onClick={copyVideoLink}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors"
          >
            {copiedVideoLink ? (
              <>
                <Check size={14} className="text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Link2 size={14} />
                Copy Video Link
              </>
            )}
          </button>
        </div>
      )}

      {/* Comments Modal */}
      {isCommentsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeCommentsModal}
          />

          {/* Modal */}
          <div className="relative bg-[#151515] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <MessageSquare size={20} className="text-blue-400" />
                <div>
                  <h2 className="text-lg font-semibold text-white">Recent Comments</h2>
                  <p className="text-xs text-white/40">Comments on your channel's videos</p>
                </div>
              </div>
              <button
                onClick={closeCommentsModal}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={18} className="text-white/60" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {isLoadingComments && comments.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 size={32} className="animate-spin text-white/40" />
                </div>
              ) : commentsError ? (
                <div className="text-center py-20 max-w-lg mx-auto">
                  <MessageSquare size={40} className="text-red-400/50 mx-auto mb-4" />
                  <p className="text-white/60 mb-2">Unable to load comments</p>
                  <p className="text-white/40 text-sm">{commentsError}</p>

                  <div className="mt-6 p-4 bg-white/[0.03] border border-white/10 rounded-xl text-left">
                    <p className="text-white/60 text-sm font-medium mb-3">To enable comments, follow these steps:</p>
                    <ol className="text-white/40 text-sm space-y-2 list-decimal list-inside">
                      <li>Go to <span className="text-blue-400">Google Cloud Console</span> → OAuth consent screen</li>
                      <li>Add your Google account email as a <span className="text-white/60">Test User</span></li>
                      <li>Click "Reconnect Channel" below to re-authorize with the new scope</li>
                    </ol>
                    <p className="text-white/30 text-xs mt-3">
                      Note: The <code className="bg-white/10 px-1 rounded">youtube.force-ssl</code> scope requires Google app verification for production. Test users bypass this requirement during development.
                    </p>
                  </div>

                  <div className="flex gap-3 justify-center mt-6">
                    <button
                      onClick={() => window.open('https://console.cloud.google.com/apis/credentials/consent', '_blank')}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      <ExternalLink size={14} />
                      Open Google Console
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          const authUrl = await youtubeService.getConnectUrl();
                          window.location.href = authUrl;
                        } catch (err) {
                          console.error('Connect error:', err);
                        }
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Reconnect Channel
                    </button>
                  </div>
                </div>
              ) : comments.length === 0 ? (
                <div className="text-center py-20">
                  <MessageSquare size={40} className="text-white/20 mx-auto mb-4" />
                  <p className="text-white/40">No comments found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {comments.map((comment) => (
                    <div key={comment.id} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                      {/* Video info */}
                      {comment.video_title && (
                        <div
                          onClick={() => {
                            closeCommentsModal();
                            navigate(`/overview/content-creation/youtube/video?channel=${selectedChannelId || channels[0]?.id}&video=${comment.video_id}`);
                          }}
                          className="flex items-center gap-2 mb-3 cursor-pointer hover:bg-white/5 rounded-lg p-2 -m-2 transition-colors"
                        >
                          {comment.video_thumbnail && (
                            <img src={comment.video_thumbnail} alt="" className="w-12 h-8 rounded object-cover" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white/60 truncate">{comment.video_title}</div>
                          </div>
                        </div>
                      )}

                      {/* Comment */}
                      <div className="flex gap-3">
                        <img
                          src={comment.author.profile_image}
                          alt=""
                          className="w-10 h-10 rounded-full flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-white">{comment.author.name}</span>
                            <span className="text-xs text-white/40">{formatTimeAgo(comment.published_at)}</span>
                          </div>
                          <p
                            className="text-sm text-white/70 mb-2"
                            dangerouslySetInnerHTML={{ __html: comment.text }}
                          />
                          <div className="flex items-center gap-4 text-xs text-white/40">
                            <span className="flex items-center gap-1">
                              <ThumbsUp size={12} />
                              {comment.like_count}
                            </span>
                            {comment.reply_count > 0 && (
                              <span className="flex items-center gap-1">
                                <MessageSquare size={12} />
                                {comment.reply_count} replies
                              </span>
                            )}
                          </div>

                          {/* Replies */}
                          {comment.replies.length > 0 && (
                            <div className="mt-3 ml-4 space-y-3 border-l-2 border-white/10 pl-4">
                              {comment.replies.slice(0, 3).map((reply) => (
                                <div key={reply.id} className="flex gap-2">
                                  <img
                                    src={reply.author.profile_image}
                                    alt=""
                                    className="w-6 h-6 rounded-full flex-shrink-0"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className="text-xs font-medium text-white">{reply.author.name}</span>
                                      <span className="text-[10px] text-white/40">{formatTimeAgo(reply.published_at)}</span>
                                    </div>
                                    <p
                                      className="text-xs text-white/60"
                                      dangerouslySetInnerHTML={{ __html: reply.text }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Load More */}
                  {commentsNextPage && (
                    <div className="flex justify-center pt-4">
                      <button
                        onClick={() => loadComments(commentsNextPage)}
                        disabled={isLoadingComments}
                        className="px-4 py-2 bg-white/[0.05] hover:bg-white/10 border border-white/10 rounded-lg text-sm text-white/70 transition-colors disabled:opacity-50"
                      >
                        {isLoadingComments ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          'Load More'
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default YouTubeChannelManager;
