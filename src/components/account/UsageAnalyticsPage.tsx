import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Clock, Coins, Gift, Calendar, Loader2, RefreshCw, Zap } from 'lucide-react';
import { authService } from '../../services/authService';

interface UsageData {
  current_credits: number;
  total_credits_earned: number;
  credits_used: number;
  bonus_claimed: boolean;
  member_since: string;
  history: Array<{ feature: string; credits_used: number; created_at: string }>;
}

const UsageAnalyticsPage: React.FC = () => {
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadUsageData = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const result = await authService.getUsageStats();

      if (result.success && result.usage) {
        setUsageData(result.usage);
      } else {
        setError(result.error || 'Failed to load usage data');
      }
    } catch (err) {
      setError('An error occurred while loading data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadUsageData();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFeatureLabel = (feature: string) => {
    return feature
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#121212]">
        <Loader2 size={24} className="text-white/40 animate-spin" />
      </div>
    );
  }

  const creditsPercentUsed = usageData
    ? (usageData.credits_used / (usageData.total_credits_earned || 1)) * 100
    : 0;

  return (
    <div className="h-full bg-[#121212] overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#19191a] border border-[#3a3a3d] rounded-xl">
              <BarChart3 size={20} className="text-white/70" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Usage Analytics</h1>
              <p className="text-white/40 text-sm">Track your credit consumption</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {error && (
              <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}
            <button
              onClick={() => loadUsageData(true)}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white/60 hover:text-white bg-[#19191a] hover:bg-[#2a2a2d] border border-[#3a3a3d] rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {/* Available Credits */}
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Coins size={16} className="text-emerald-400/70" />
              <span className="text-white/40 text-xs uppercase tracking-wide">Available</span>
            </div>
            <div className="text-2xl font-semibold text-white">
              {usageData?.current_credits?.toLocaleString() || 0}
            </div>
            <div className="text-white/30 text-xs mt-1">credits</div>
          </div>

          {/* Used */}
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={16} className="text-amber-400/70" />
              <span className="text-white/40 text-xs uppercase tracking-wide">Used</span>
            </div>
            <div className="text-2xl font-semibold text-white">
              {usageData?.credits_used?.toLocaleString() || 0}
            </div>
            <div className="text-white/30 text-xs mt-1">credits</div>
          </div>

          {/* Total Earned */}
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Gift size={16} className="text-purple-400/70" />
              <span className="text-white/40 text-xs uppercase tracking-wide">Total Earned</span>
            </div>
            <div className="text-2xl font-semibold text-white">
              {usageData?.total_credits_earned?.toLocaleString() || 0}
            </div>
            <div className="text-white/30 text-xs mt-1">credits</div>
          </div>

          {/* Usage Percentage */}
          <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-blue-400/70" />
              <span className="text-white/40 text-xs uppercase tracking-wide">Used</span>
            </div>
            <div className="text-2xl font-semibold text-white">
              {creditsPercentUsed.toFixed(0)}%
            </div>
            <div className="w-full h-1.5 bg-[#2a2a2d] rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-white/40 rounded-full transition-all"
                style={{ width: `${Math.min(creditsPercentUsed, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-3 gap-6">
          {/* Member Info */}
          <div className="space-y-4">
            <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <Calendar size={16} className="text-white/40" />
                <span className="text-sm font-medium text-white">Account Info</span>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-white/30 text-xs uppercase tracking-wide mb-1">Member Since</div>
                  <div className="text-white/70 text-sm">
                    {usageData?.member_since ? formatDate(usageData.member_since) : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-white/30 text-xs uppercase tracking-wide mb-1">Bonus Status</div>
                  <div className="text-sm">
                    {usageData?.bonus_claimed ? (
                      <span className="text-emerald-400">Claimed</span>
                    ) : (
                      <span className="text-amber-400">Available</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Bonus CTA */}
            {!usageData?.bonus_claimed && (
              <div className="bg-[#19191a] border border-amber-500/20 rounded-xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <Zap size={16} className="text-amber-400" />
                  <span className="text-sm font-medium text-white">Welcome Bonus</span>
                </div>
                <p className="text-white/40 text-xs mb-4">
                  Claim 1,000 free credits to get started
                </p>
                <button className="w-full px-4 py-2 text-sm font-medium text-[#121212] bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors">
                  Claim Now
                </button>
              </div>
            )}
          </div>

          {/* Activity History */}
          <div className="col-span-2">
            <div className="bg-[#19191a] border border-[#2a2a2d] rounded-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2d]">
                <h2 className="text-base font-medium text-white">Activity Feed</h2>
                <span className="text-white/40 text-xs">
                  {usageData?.history?.length || 0} items
                </span>
              </div>

              <div className="p-4 max-h-[400px] overflow-y-auto">
                {usageData?.history && usageData.history.length > 0 ? (
                  <div className="space-y-2">
                    {usageData.history.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-[#121212] border border-[#2a2a2d] rounded-lg hover:border-[#3a3a3d] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 flex items-center justify-center bg-[#2a2a2d] rounded-lg">
                            <Zap size={14} className="text-white/40" />
                          </div>
                          <div>
                            <div className="text-sm text-white">
                              {getFeatureLabel(item.feature)}
                            </div>
                            <div className="text-xs text-white/30 flex items-center gap-1">
                              <Clock size={10} />
                              {formatDate(item.created_at)} at {formatTime(item.created_at)}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm text-white/50">
                          -{item.credits_used}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <Clock size={32} className="mx-auto text-white/10 mb-3" />
                    <p className="text-white/40 text-sm">No activity yet</p>
                    <p className="text-white/25 text-xs mt-1">Your usage history will appear here</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UsageAnalyticsPage;
