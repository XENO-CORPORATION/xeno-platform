/**
 * VideoDetailPage Component
 * Detailed analytics view for a single YouTube video
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Eye, ThumbsUp, MessageSquare, Share2,
  Clock, Calendar, Users, TrendingUp, Play, Globe, BarChart3,
  ChevronDown, ExternalLink, Percent, Timer, Tag
} from 'lucide-react';
import {
  youtubeService,
  VideoDetailResponse,
  DateRange
} from '../../services/youtubeService';

// ============================================================================
// HELPERS
// ============================================================================

const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

const formatWatchTime = (minutes: number): string => {
  if (minutes >= 1440) return `${(minutes / 1440).toFixed(1)}d`;
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${Math.round(minutes)}m`;
};

const formatDuration = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Chart component
const MiniChart: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 60 - ((value - min) / range) * 50;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox="0 0 100 60" className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,60 ${points} 100,60`} fill={`url(#grad-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const VideoDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const channelId = searchParams.get('channel');
  const videoId = searchParams.get('video');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<VideoDetailResponse | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('last_28_days');
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  const dateRangeOptions: { value: DateRange; label: string }[] = [
    { value: 'last_7_days', label: '7 days' },
    { value: 'last_28_days', label: '28 days' },
    { value: 'last_90_days', label: '90 days' },
    { value: 'last_365_days', label: '365 days' },
    { value: 'lifetime', label: 'Lifetime' }
  ];

  useEffect(() => {
    const loadVideoDetails = async () => {
      if (!channelId || !videoId) {
        setError('Missing channel or video ID');
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const result = await youtubeService.getVideoDetails(channelId, videoId, dateRange);
        setData(result);
        setError(null);
      } catch (err) {
        setError('Failed to load video details');
      } finally {
        setIsLoading(false);
      }
    };
    loadVideoDetails();
  }, [channelId, videoId, dateRange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setIsDateDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-white/40" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/40 text-sm mb-3">{error || 'Video not found'}</p>
          <button onClick={() => navigate(-1)} className="px-3 py-1.5 bg-white/10 rounded-lg text-white/70 text-xs">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const { video, analytics, daily, traffic_sources, demographics } = data;
  const viewsData = daily?.map(d => d.views) || [];
  const engagementRate = video.view_count > 0 ? ((video.like_count + video.comment_count) / video.view_count * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0a0a0a] border-b border-white/[0.06]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-white/5">
              <ArrowLeft size={16} className="text-white/60" />
            </button>
            <div className="w-14 h-8 rounded-md overflow-hidden bg-white/5">
              {video.thumbnail_url && <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />}
            </div>
            <div>
              <h1 className="text-xs font-medium text-white line-clamp-1 max-w-sm">{video.title}</h1>
              <p className="text-[10px] text-white/40">{formatDate(video.published_at || '')} • {formatDuration(video.duration_seconds)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={dateDropdownRef}>
              <button
                onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-white/60"
              >
                <Calendar size={12} />
                {dateRangeOptions.find(o => o.value === dateRange)?.label}
                <ChevronDown size={10} className={isDateDropdownOpen ? 'rotate-180' : ''} />
              </button>
              {isDateDropdownOpen && (
                <div className="absolute right-0 mt-1 w-28 bg-[#141416] border border-white/[0.08] rounded-lg overflow-hidden z-30">
                  {dateRangeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setDateRange(opt.value); setIsDateDropdownOpen(false); }}
                      className={`w-full px-3 py-1.5 text-left text-[10px] ${dateRange === opt.value ? 'bg-white/[0.08] text-white' : 'text-white/50 hover:bg-white/[0.04]'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <a
              href={`https://youtube.com/watch?v=${video.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-[10px] text-white font-medium"
            >
              <ExternalLink size={10} />
              YouTube
            </a>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-4 space-y-3">
        {/* Row 1: Primary Stats */}
        <div className="grid grid-cols-6 gap-3">
          {[
            { icon: Eye, label: 'Views', value: formatNumber(video.view_count), color: 'text-blue-400' },
            { icon: Clock, label: 'Watch Time', value: analytics ? formatWatchTime(analytics.watch_time_minutes) : '—', color: 'text-purple-400' },
            { icon: ThumbsUp, label: 'Likes', value: formatNumber(video.like_count), color: 'text-emerald-400' },
            { icon: MessageSquare, label: 'Comments', value: formatNumber(video.comment_count), color: 'text-amber-400' },
            { icon: Share2, label: 'Shares', value: analytics ? formatNumber(analytics.shares) : '—', color: 'text-pink-400' },
            { icon: Users, label: 'Subs', value: analytics ? `${(analytics.subscribers_gained - analytics.subscribers_lost) >= 0 ? '+' : ''}${formatNumber(analytics.subscribers_gained - analytics.subscribers_lost)}` : '—', color: (analytics?.subscribers_gained || 0) >= (analytics?.subscribers_lost || 0) ? 'text-emerald-400' : 'text-red-400' },
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

        {/* Row 2: Chart + Engagement Metrics */}
        <div className="grid grid-cols-4 gap-3">
          {/* Chart */}
          <div className="col-span-3 bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
              <div className="flex items-center gap-1.5">
                <BarChart3 size={10} className="text-red-400" />
                <span className="text-[9px] font-medium text-white/50 uppercase">Views Over Time</span>
              </div>
              {daily.length > 0 && (
                <span className="text-[9px] text-white/30">{formatDate(daily[0].date)} – {formatDate(daily[daily.length - 1].date)}</span>
              )}
            </div>
            <div className="p-3 h-32">
              {viewsData.length > 0 ? (
                <MiniChart data={viewsData} color="#ef4444" />
              ) : (
                <div className="h-full flex items-center justify-center text-white/20 text-[10px]">No data</div>
              )}
            </div>
          </div>

          {/* Engagement */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
              <Percent size={10} className="text-emerald-400" />
              <span className="text-[9px] font-medium text-white/50 uppercase">Engagement</span>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-[10px] text-white/40">Avg View %</span>
                <span className="text-[11px] font-medium text-white">{analytics ? `${analytics.avg_view_percentage.toFixed(1)}%` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-white/40">Avg Duration</span>
                <span className="text-[11px] font-medium text-white">{analytics ? formatDuration(Math.round(analytics.avg_view_duration)) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-white/40">Engage Rate</span>
                <span className="text-[11px] font-medium text-white">{engagementRate.toFixed(2)}%</span>
              </div>
              {analytics && (
                <div className="pt-2 border-t border-white/[0.04]">
                  <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(analytics.avg_view_percentage, 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 3: Traffic Sources + Demographics + Video Info */}
        <div className="grid grid-cols-3 gap-3">
          {/* Traffic Sources */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
              <TrendingUp size={10} className="text-amber-400" />
              <span className="text-[9px] font-medium text-white/50 uppercase">Traffic Sources</span>
            </div>
            <div className="p-3">
              {traffic_sources && traffic_sources.length > 0 ? (
                <div className="space-y-2">
                  {traffic_sources.slice(0, 5).map((source) => (
                    <div key={source.source} className="flex justify-between">
                      <span className="text-[10px] text-white/50 truncate max-w-[120px]">{source.source}</span>
                      <span className="text-[10px] font-medium text-white">{source.percentage.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-white/20 text-center py-4">No data</p>
              )}
            </div>
          </div>

          {/* Demographics */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
              <Users size={10} className="text-blue-400" />
              <span className="text-[9px] font-medium text-white/50 uppercase">Audience</span>
            </div>
            <div className="p-3">
              {demographics ? (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[10px] text-white/40">Male</span>
                    <span className="text-[10px] font-medium text-blue-400">{demographics.gender.male.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-white/40">Female</span>
                    <span className="text-[10px] font-medium text-pink-400">{demographics.gender.female.toFixed(1)}%</span>
                  </div>
                  {demographics.age_groups.length > 0 && (
                    <div className="flex justify-between pt-2 border-t border-white/[0.04]">
                      <span className="text-[10px] text-white/40">Top Age</span>
                      <span className="text-[10px] font-medium text-white">{demographics.age_groups[0].group}</span>
                    </div>
                  )}
                  {demographics.countries.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[10px] text-white/40">Top Country</span>
                      <span className="text-[10px] font-medium text-white">{demographics.countries[0].country}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-white/20 text-center py-4">No data</p>
              )}
            </div>
          </div>

          {/* Video Info */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
              <Tag size={10} className="text-purple-400" />
              <span className="text-[9px] font-medium text-white/50 uppercase">Details</span>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-[10px] text-white/40">Privacy</span>
                <span className="text-[10px] font-medium text-white capitalize">{video.privacy_status || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-white/40">Duration</span>
                <span className="text-[10px] font-medium text-white">{formatDuration(video.duration_seconds)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-white/40">Published</span>
                <span className="text-[10px] font-medium text-white">{formatDate(video.published_at || '')}</span>
              </div>
              {video.tags && video.tags.length > 0 && (
                <div className="pt-2 border-t border-white/[0.04]">
                  <div className="flex flex-wrap gap-1">
                    {video.tags.slice(0, 4).map((tag, i) => (
                      <span key={i} className="px-1.5 py-0.5 text-[8px] bg-white/[0.04] rounded text-white/40">{tag}</span>
                    ))}
                    {video.tags.length > 4 && <span className="text-[8px] text-white/20">+{video.tags.length - 4}</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {video.description && (
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
              <span className="text-[9px] font-medium text-white/50 uppercase">Description</span>
            </div>
            <div className="p-3">
              <p className="text-[11px] text-white/50 whitespace-pre-wrap line-clamp-4 leading-relaxed">{video.description}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default VideoDetailPage;
