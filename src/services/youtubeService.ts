/**
 * YouTube Service
 * API integration for YouTube channel management and analytics
 */

const API_BASE = '/api/youtube';

// ============================================
// TYPES
// ============================================

export interface YouTubeChannel {
  id: string;
  channel_id: string;
  channel_title: string;
  channel_description?: string;
  channel_thumbnail_url?: string;
  channel_custom_url?: string;
  channel_banner_url?: string;
  subscriber_count: number;
  video_count: number;
  view_count: number;
  is_active: boolean;
  is_monetized: boolean;
  last_sync_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ChannelAnalytics {
  channel_id: string;
  channel_title: string;
  channel_thumbnail_url?: string;
  subscribers: number;
  subscriber_change: number;
  views: number;
  watch_time_minutes: number;
  estimated_revenue?: number | null;
  likes?: number;
  comments?: number;
  shares?: number;
  period: string;
  error?: string;
}

export interface CombinedAnalytics {
  total_subscribers: number;
  total_views: number;
  total_watch_time: number;
  total_revenue: number | null;
  channels: ChannelAnalytics[];
  period: string;
}

export interface VideoAnalytics {
  video_id: string;
  title: string;
  thumbnail_url?: string;
  published_at?: string;
  views: number;
  watch_time_minutes: number;
  likes: number;
  comments: number;
  average_view_duration: number;
}

export interface DemographicsData {
  age_groups: { group: string; percentage: number }[];
  gender: { male: number; female: number; other: number };
  countries: { country: string; percentage: number }[];
}

export interface TrafficSourceData {
  source: string;
  views: number;
  percentage: number;
}

export interface DailyAnalytics {
  date: string;
  views: number;
  watch_time_minutes: number;
  subscribers_gained: number;
  subscribers_lost: number;
  subscribers_net: number;
  likes: number;
  comments: number;
}

export interface ChannelVideo {
  video_id: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  published_at?: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  duration?: string;
}

export interface VideoDetail {
  id: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  published_at?: string;
  tags: string[];
  category_id?: string;
  duration_seconds: number;
  duration?: string;
  privacy_status?: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  favorite_count: number;
}

export interface VideoAnalyticsDetail {
  views: number;
  watch_time_minutes: number;
  avg_view_duration: number;
  avg_view_percentage: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  subscribers_gained: number;
  subscribers_lost: number;
}

export interface VideoDailyAnalytics {
  date: string;
  views: number;
  watch_time_minutes: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface VideoDetailResponse {
  video: VideoDetail;
  analytics: VideoAnalyticsDetail | null;
  daily: VideoDailyAnalytics[];
  traffic_sources: TrafficSourceData[];
  demographics: DemographicsData | null;
}

// Daily snapshot for subscriber history tracking
export interface DailySnapshot {
  date: string;
  subscriber_count: number;
  subscribers_gained: number;
  subscribers_lost: number;
  net_change: number;
  views: number;
  watch_time_minutes: number;
}

export interface ChannelHistoryResponse {
  channel_id: string;
  current_subscribers: number;
  snapshots: DailySnapshot[];
  message?: string;
}

// Dashboard types for comprehensive channel analytics
export interface DashboardChannel {
  id: string;
  channel_id: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  custom_url?: string;
  banner_url?: string;
  subscriber_count: number;
  video_count: number;
  view_count: number;
  is_monetized: boolean;
  last_sync_at?: string;
  created_at: string;
}

export interface DashboardOverview {
  views: number;
  watch_time_minutes: number;
  avg_view_duration: number;
  avg_view_percentage: number;
  subscribers_gained: number;
  subscribers_lost: number;
  subscriber_change: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  videos_added_to_playlists: number;
  card_clicks: number;
  card_click_rate: number;
  card_impressions: number;
  engagement_rate: number;
  total_subscribers: number;
  total_videos: number;
  total_views: number;
}

export interface DashboardDaily {
  date: string;
  views: number;
  watch_time_minutes: number;
  subscribers_gained: number;
  subscribers_lost: number;
  subscribers_net: number;
  likes: number;
  comments: number;
  shares: number;
  avg_view_duration: number;
}

export interface DashboardVideo {
  video_id: string;
  title: string;
  thumbnail_url?: string;
  published_at?: string;
  views: number;
  watch_time_minutes: number;
  likes: number;
  comments: number;
  avg_view_duration: number;
  avg_view_percentage: number;
}

export interface DashboardTrafficSource {
  source: string;
  source_type: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface DashboardDevice {
  device: string;
  device_type: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface DashboardPlaybackLocation {
  location: string;
  location_type: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface DashboardRealtime {
  today: {
    date: string;
    views: number;
    watch_time_minutes: number;
    subscribers_gained: number;
    subscribers_lost: number;
    subscribers_net: number;
  } | null;
  yesterday: {
    date: string;
    views: number;
    watch_time_minutes: number;
    subscribers_gained: number;
    subscribers_lost: number;
    subscribers_net: number;
  } | null;
}

export interface DashboardDemographics {
  age_groups: { group: string; percentage: number }[];
  gender: { male: number; female: number };
  countries: { country: string; percentage: number }[];
}

// New detailed analytics types
export interface SearchTermData {
  term: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface ExternalTrafficData {
  website: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface SuggestedVideoData {
  video_id: string;
  title?: string;
  thumbnail?: string;
  channel_title?: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface PlaylistTrafficData {
  playlist_id: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface EndScreenTrafficData {
  video_id: string;
  title?: string;
  thumbnail?: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface CountryData {
  country_code: string;
  country_name: string;
  views: number;
  watch_time_minutes: number;
  subscribers_gained: number;
  subscribers_lost: number;
  percentage: number;
}

export interface USStateData {
  province_code: string;
  province_name: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface SubscriberStatusMetrics {
  views: number;
  watch_time_minutes: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface SubscriberStatusData {
  subscribed: SubscriberStatusMetrics | null;
  unsubscribed: SubscriberStatusMetrics | null;
}

export interface OperatingSystemData {
  os: string;
  os_type: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface YouTubeProductData {
  product: string;
  product_type: string;
  views: number;
  watch_time_minutes: number;
  percentage: number;
}

export interface CardPerformanceData {
  video_id: string;
  title?: string;
  thumbnail?: string;
  card_clicks: number;
  card_impressions: number;
  card_click_rate: number;
  card_teaser_clicks: number;
  card_teaser_impressions: number;
  card_teaser_click_rate: number;
}

export interface TrafficDetails {
  search_terms: SearchTermData[];
  external_websites: ExternalTrafficData[];
  suggested_videos: SuggestedVideoData[];
  playlists: PlaylistTrafficData[];
  end_screens: EndScreenTrafficData[];
}

export interface EngagementDetails {
  card_performance: CardPerformanceData[];
}

export interface GeographyData {
  countries: CountryData[];
  us_states: USStateData[];
}

export interface AudienceInsights {
  subscriber_status: SubscriberStatusData;
  operating_systems: OperatingSystemData[];
  youtube_products: YouTubeProductData[];
}

// Cache metadata returned with dashboard responses
export interface CacheMetadata {
  fromCache: boolean;
  cachedAt: string;
  expiresAt: string;
  ttl: number; // seconds remaining
  etag: string;
}

// Period comparison metric
export interface MetricComparison {
  current: number;
  previous: number;
  change: number;
  direction: 'up' | 'down' | 'neutral';
}

// All comparison metrics
export interface DashboardComparison {
  views: MetricComparison;
  watch_time: MetricComparison;
  subscribers: MetricComparison;
  likes: MetricComparison;
  comments: MetricComparison;
  shares: MetricComparison;
  engagement_rate: MetricComparison;
  avg_view_duration: MetricComparison;
  avg_view_percentage: MetricComparison;
  card_clicks?: MetricComparison;
  card_impressions?: MetricComparison;
}

// Period info with labels
export interface PeriodInfo {
  current: { startDate: string; endDate: string; label: string };
  previous: { startDate: string; endDate: string; label: string };
  days: number;
}

export interface DashboardResponse {
  channel: DashboardChannel;
  overview: DashboardOverview;
  daily: DashboardDaily[];
  top_videos: DashboardVideo[];
  traffic_sources: DashboardTrafficSource[];
  demographics: DashboardDemographics;
  devices: DashboardDevice[];
  playback_locations: DashboardPlaybackLocation[];
  realtime: DashboardRealtime;
  // New additions
  traffic_details: TrafficDetails;
  engagement_details: EngagementDetails;
  geography: GeographyData;
  audience_insights: AudienceInsights;
  period: string;
  period_info?: PeriodInfo;
  comparison?: DashboardComparison;
  fetched_at: string;
  // Cache metadata (optional - only present when caching is enabled)
  _cache?: CacheMetadata;
}

// Real-time metrics response (for polling)
export interface RealtimeMetrics {
  last_48_hours: {
    views: number;
    watch_time: number;
    subscribers_gained: number;
    subscribers_lost: number;
  };
  today: {
    views: number;
    watch_time: number;
  };
}

export interface RealtimeResponse {
  success: boolean;
  realtime: RealtimeMetrics;
  fetched_at: string;
}

export type DateRange = 'last_7_days' | 'last_28_days' | 'last_90_days' | 'last_365_days' | 'lifetime';

export interface ChannelGroup {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  members: { channel_id: string; sort_order: number }[];
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
}

// Comment types
export interface CommentAuthor {
  name: string;
  profile_image: string;
  channel_url?: string;
}

export interface CommentReply {
  id: string;
  author: CommentAuthor;
  text: string;
  like_count: number;
  published_at: string;
}

export interface Comment {
  id: string;
  video_id: string;
  video_title?: string;
  video_thumbnail?: string;
  author: CommentAuthor;
  text: string;
  text_original: string;
  like_count: number;
  published_at: string;
  updated_at: string;
  reply_count: number;
  replies: CommentReply[];
}

export interface CommentsResponse {
  comments: Comment[];
  next_page_token?: string;
  total_results?: number;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('xenoos_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

interface ApiResponse<T> {
  success: boolean;
  error?: string;
  [key: string]: any;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data: ApiResponse<T> = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed');
  }
  return data as T;
}

// ============================================
// YOUTUBE SERVICE
// ============================================

class YouTubeService {
  // ==========================================
  // Database Initialization
  // ==========================================

  /**
   * Initialize YouTube database tables
   */
  async initDatabase(): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_BASE}/init`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  }

  // ==========================================
  // OAuth Methods
  // ==========================================

  /**
   * Get OAuth URL to connect a YouTube channel
   */
  async getAuthUrl(): Promise<string> {
    const response = await fetch(`${API_BASE}/auth`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ authUrl: string }>(response);
    return data.authUrl;
  }

  // ==========================================
  // Channel Methods
  // ==========================================

  /**
   * Get all connected YouTube channels
   */
  async getChannels(): Promise<YouTubeChannel[]> {
    const response = await fetch(`${API_BASE}/channels`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ channels: YouTubeChannel[] }>(response);
    return data.channels || [];
  }

  /**
   * Get a single channel by ID
   */
  async getChannel(id: string): Promise<YouTubeChannel | null> {
    const response = await fetch(`${API_BASE}/channels/${id}`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ channel: YouTubeChannel }>(response);
    return data.channel || null;
  }

  /**
   * Disconnect (soft delete) a channel
   */
  async disconnectChannel(id: string): Promise<boolean> {
    const response = await fetch(`${API_BASE}/channels/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await handleResponse(response);
    return true;
  }

  /**
   * Get the OAuth URL to connect a new channel
   */
  async getConnectUrl(): Promise<string> {
    const response = await fetch(`${API_BASE}/auth`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ authUrl: string }>(response);
    return data.authUrl;
  }

  /**
   * Force sync channel data from YouTube API
   */
  async syncChannel(id: string): Promise<YouTubeChannel> {
    const response = await fetch(`${API_BASE}/channels/${id}/sync`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ channel: YouTubeChannel }>(response);
    return data.channel;
  }

  /**
   * Reauthorize a channel to get updated OAuth permissions
   * Returns a URL that the user should be redirected to
   */
  async reauthorizeChannel(id: string): Promise<string> {
    const response = await fetch(`${API_BASE}/channels/${id}/reauthorize`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ authUrl: string }>(response);
    return data.authUrl;
  }

  // ==========================================
  // Analytics Methods
  // ==========================================

  /**
   * Get combined analytics for all channels
   */
  async getCombinedAnalytics(dateRange: DateRange = 'last_28_days'): Promise<CombinedAnalytics> {
    const response = await fetch(`${API_BASE}/analytics/overview?dateRange=${dateRange}`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ analytics: CombinedAnalytics }>(response);
    return data.analytics;
  }

  /**
   * Get analytics for a single channel
   */
  async getChannelAnalytics(channelId: string, dateRange: DateRange = 'last_28_days'): Promise<ChannelAnalytics> {
    const response = await fetch(`${API_BASE}/analytics/overview/${channelId}?dateRange=${dateRange}`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ analytics: ChannelAnalytics }>(response);
    return data.analytics;
  }

  /**
   * Get top videos for a channel
   */
  async getTopVideos(channelId: string, limit: number = 10, dateRange: DateRange = 'last_28_days'): Promise<VideoAnalytics[]> {
    const response = await fetch(
      `${API_BASE}/analytics/videos/${channelId}?limit=${limit}&dateRange=${dateRange}`,
      { headers: getAuthHeaders() }
    );
    const data = await handleResponse<{ videos: VideoAnalytics[] }>(response);
    return data.videos || [];
  }

  /**
   * Get audience demographics for a channel
   */
  async getDemographics(channelId: string, dateRange: DateRange = 'last_28_days'): Promise<DemographicsData> {
    const response = await fetch(
      `${API_BASE}/analytics/demographics/${channelId}?dateRange=${dateRange}`,
      { headers: getAuthHeaders() }
    );
    const data = await handleResponse<{ demographics: DemographicsData }>(response);
    return data.demographics;
  }

  /**
   * Get traffic sources for a channel
   */
  async getTrafficSources(channelId: string, dateRange: DateRange = 'last_28_days'): Promise<TrafficSourceData[]> {
    const response = await fetch(
      `${API_BASE}/analytics/traffic/${channelId}?dateRange=${dateRange}`,
      { headers: getAuthHeaders() }
    );
    const data = await handleResponse<{ sources: TrafficSourceData[] }>(response);
    return data.sources || [];
  }

  /**
   * Get daily analytics for charts
   */
  async getDailyAnalytics(channelId: string, dateRange: DateRange = 'last_28_days'): Promise<DailyAnalytics[]> {
    const response = await fetch(
      `${API_BASE}/analytics/daily/${channelId}?dateRange=${dateRange}`,
      { headers: getAuthHeaders() }
    );
    const data = await handleResponse<{ daily: DailyAnalytics[] }>(response);
    return data.daily || [];
  }

  /**
   * Get all videos for a channel (paginated)
   */
  async getChannelVideos(channelId: string, limit: number = 50, pageToken?: string): Promise<{
    videos: ChannelVideo[];
    nextPageToken?: string;
    totalResults?: number;
  }> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetch(
      `${API_BASE}/videos/${channelId}?${params}`,
      { headers: getAuthHeaders() }
    );
    const data = await handleResponse<{
      videos: ChannelVideo[];
      nextPageToken?: string;
      totalResults?: number;
    }>(response);
    return {
      videos: data.videos || [],
      nextPageToken: data.nextPageToken,
      totalResults: data.totalResults
    };
  }

  /**
   * Get detailed analytics for a specific video
   */
  async getVideoDetails(channelId: string, videoId: string, dateRange: DateRange = 'last_28_days'): Promise<VideoDetailResponse> {
    const response = await fetch(
      `${API_BASE}/video/${channelId}/${videoId}?dateRange=${dateRange}`,
      { headers: getAuthHeaders() }
    );
    const data = await handleResponse<VideoDetailResponse>(response);
    return data;
  }

  /**
   * Get comprehensive dashboard data for a channel
   * Returns all analytics in one call for the dashboard
   *
   * @param channelId - The channel UUID
   * @param dateRange - Time period for analytics
   * @param forceRefresh - Set to true to bypass cache and fetch fresh data
   * @returns Dashboard data with optional cache metadata
   */
  async getDashboard(
    channelId: string,
    dateRange: DateRange = 'last_28_days',
    forceRefresh: boolean = false
  ): Promise<DashboardResponse> {
    const params = new URLSearchParams({ dateRange });
    if (forceRefresh) {
      params.append('forceRefresh', 'true');
    }

    const response = await fetch(
      `${API_BASE}/dashboard/${channelId}?${params.toString()}`,
      { headers: getAuthHeaders() }
    );
    const data = await handleResponse<DashboardResponse>(response);
    return data;
  }

  /**
   * Get real-time metrics for a channel (for polling)
   * Lightweight endpoint that returns only live/recent activity data
   *
   * @param channelId - The channel UUID
   * @returns Real-time metrics (last 48 hours and today)
   */
  async getRealtimeMetrics(channelId: string): Promise<RealtimeResponse> {
    const response = await fetch(
      `${API_BASE}/realtime/${channelId}`,
      { headers: getAuthHeaders() }
    );
    const data = await handleResponse<RealtimeResponse>(response);
    return data;
  }

  /**
   * Get recent comments for a channel
   */
  async getComments(channelId: string, maxResults: number = 50, pageToken?: string): Promise<CommentsResponse> {
    const params = new URLSearchParams({ maxResults: maxResults.toString() });
    if (pageToken) params.append('pageToken', pageToken);

    const response = await fetch(
      `${API_BASE}/comments/${channelId}?${params.toString()}`,
      { headers: getAuthHeaders() }
    );
    const data = await handleResponse<CommentsResponse>(response);
    return data;
  }

  // ==========================================
  // Sync & Cache Management Methods
  // ==========================================

  /**
   * Trigger background sync for all channels
   */
  async syncAllChannels(): Promise<{
    success: boolean;
    summary: { total: number; success: number; errors: number };
    results: { id: string; status: string; error?: string }[];
  }> {
    const response = await fetch(`${API_BASE}/sync/all`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  }

  /**
   * Get sync status for all channels
   */
  async getSyncStatus(): Promise<{
    success: boolean;
    channels: {
      id: string;
      channel_id: string;
      channel_title: string;
      last_sync_at: string | null;
      sync_error: string | null;
      sync_status: 'never' | 'fresh' | 'recent' | 'stale' | 'outdated';
      cache: {
        cachedItems: number;
        earliestExpiry: string | null;
        latestCache: string | null;
      };
    }[];
  }> {
    const response = await fetch(`${API_BASE}/sync/status`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  }

  /**
   * Clear cached data for a channel or all channels
   */
  async clearCache(channelId?: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_BASE}/cache/clear`, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(channelId ? { channelId } : {}),
    });
    return handleResponse(response);
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  /**
   * Format large numbers for display (e.g., 1500000 -> "1.5M")
   */
  formatNumber(num: number): string {
    if (num >= 1000000000) return `${(num / 1000000000).toFixed(1)}B`;
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  }

  /**
   * Format watch time minutes for display
   */
  formatWatchTime(minutes: number): string {
    if (minutes >= 525600) { // 1 year in minutes
      const years = minutes / 525600;
      return `${years.toFixed(1)}y`;
    }
    if (minutes >= 43200) { // 30 days in minutes
      const months = minutes / 43200;
      return `${months.toFixed(1)}mo`;
    }
    if (minutes >= 1440) { // 1 day in minutes
      const days = minutes / 1440;
      return `${days.toFixed(1)}d`;
    }
    if (minutes >= 60) {
      const hours = minutes / 60;
      return `${hours.toFixed(1)}h`;
    }
    return `${minutes}m`;
  }

  /**
   * Format duration seconds to readable format
   */
  formatDuration(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get display name for date range
   */
  getDateRangeLabel(dateRange: DateRange): string {
    const labels: Record<DateRange, string> = {
      'last_7_days': 'Last 7 Days',
      'last_28_days': 'Last 28 Days',
      'last_90_days': 'Last 90 Days',
      'last_365_days': 'Last 365 Days',
      'lifetime': 'Lifetime'
    };
    return labels[dateRange] || dateRange;
  }

  /**
   * Calculate percentage change
   */
  calculateChange(current: number, previous: number): { value: number; isPositive: boolean } {
    if (previous === 0) {
      return { value: current > 0 ? 100 : 0, isPositive: current >= 0 };
    }
    const change = ((current - previous) / previous) * 100;
    return { value: Math.abs(change), isPositive: change >= 0 };
  }

  // ==========================================
  // Channel Groups Methods
  // ==========================================

  /**
   * Get all channel groups
   */
  async getGroups(): Promise<ChannelGroup[]> {
    const response = await fetch(`${API_BASE}/groups`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ groups: ChannelGroup[] }>(response);
    return data.groups || [];
  }

  /**
   * Create a new channel group
   */
  async createGroup(input: CreateGroupInput): Promise<ChannelGroup> {
    const response = await fetch(`${API_BASE}/groups`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ group: ChannelGroup }>(response);
    return data.group;
  }

  /**
   * Update a channel group
   */
  async updateGroup(groupId: string, input: UpdateGroupInput): Promise<ChannelGroup> {
    const response = await fetch(`${API_BASE}/groups/${groupId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ group: ChannelGroup }>(response);
    return data.group;
  }

  /**
   * Delete a channel group
   */
  async deleteGroup(groupId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/groups/${groupId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await handleResponse(response);
  }

  /**
   * Reorder groups
   */
  async reorderGroups(groupIds: string[]): Promise<void> {
    const response = await fetch(`${API_BASE}/groups/reorder`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ groupIds }),
    });
    await handleResponse(response);
  }

  /**
   * Add a channel to a group
   */
  async addChannelToGroup(groupId: string, channelId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/groups/${groupId}/channels`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ channelId }),
    });
    await handleResponse(response);
  }

  /**
   * Remove a channel from a group
   */
  async removeChannelFromGroup(groupId: string, channelId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/groups/${groupId}/channels/${channelId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await handleResponse(response);
  }

  /**
   * Reorder channels within a group
   */
  async reorderChannelsInGroup(groupId: string, channelIds: string[]): Promise<void> {
    const response = await fetch(`${API_BASE}/groups/${groupId}/channels/reorder`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ channelIds }),
    });
    await handleResponse(response);
  }

  /**
   * Get all groups a channel belongs to
   */
  async getChannelGroups(channelId: string): Promise<ChannelGroup[]> {
    const response = await fetch(`${API_BASE}/channels/${channelId}/groups`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ groups: ChannelGroup[] }>(response);
    return data.groups || [];
  }

  // ==========================================
  // Language Tag Methods
  // ==========================================

  /**
   * Get all language tags with channel counts
   */
  async getLanguages(): Promise<{ language_code: string; channel_count: number }[]> {
    const response = await fetch(`${API_BASE}/languages`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ languages: { language_code: string; channel_count: number }[] }>(response);
    return data.languages || [];
  }

  /**
   * Get languages for a specific channel
   */
  async getChannelLanguages(channelId: string): Promise<string[]> {
    const response = await fetch(`${API_BASE}/channels/${channelId}/languages`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ languages: string[] }>(response);
    return data.languages || [];
  }

  /**
   * Add a language tag to a channel
   */
  async addLanguageToChannel(channelId: string, languageCode: string): Promise<void> {
    const response = await fetch(`${API_BASE}/channels/${channelId}/languages`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ languageCode }),
    });
    await handleResponse(response);
  }

  /**
   * Remove a language tag from a channel
   */
  async removeLanguageFromChannel(channelId: string, languageCode: string): Promise<void> {
    const response = await fetch(`${API_BASE}/channels/${channelId}/languages/${languageCode}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    await handleResponse(response);
  }

  // ==========================================
  // Daily History / Snapshots Methods
  // ==========================================

  /**
   * Get daily subscriber history for a channel
   */
  async getChannelHistory(channelId: string, months: number = 3): Promise<ChannelHistoryResponse> {
    const response = await fetch(`${API_BASE}/history/${channelId}?months=${months}`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<ChannelHistoryResponse>(response);
    return data;
  }

  /**
   * Record today's snapshot for a channel
   */
  async recordSnapshot(channelId: string): Promise<{ date: string; subscriber_count: number; net_change: number }> {
    const response = await fetch(`${API_BASE}/history/${channelId}/snapshot`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ snapshot: { date: string; subscriber_count: number; net_change: number } }>(response);
    return data.snapshot;
  }

  /**
   * Record today's snapshot for all channels
   */
  async recordAllSnapshots(): Promise<{ date: string; results: { channel_id: string; status: string }[] }> {
    const response = await fetch(`${API_BASE}/history/sync-all`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse(response);
  }
}

// Create and export singleton instance
export const youtubeService = new YouTubeService();
export default youtubeService;
