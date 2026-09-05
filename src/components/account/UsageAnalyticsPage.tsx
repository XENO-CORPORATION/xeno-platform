import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Calendar, Coins, RefreshCw, TrendingDown, WalletCards, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../../services/authService';
import ResourceState from '../platform/ResourceState';

interface UsageItem { feature: string; credits_used: number; created_at: string }
interface UsageData { current_credits: number; total_credits_earned: number; credits_used: number; bonus_claimed: boolean; member_since: string; history: UsageItem[] }
type Range = '7d' | '30d' | 'all';
const labelFeature = (value: string) => value.split('_').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');

const UsageAnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<UsageData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>('30d');

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true); else setState('loading');
    setError('');
    try {
      const result = await authService.getUsageStats();
      if (!result.success || !result.usage) throw new Error(result.error || 'Usage data is unavailable.');
      setData({ ...result.usage, history: Array.isArray(result.usage.history) ? result.usage.history : [] });
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Usage data is unavailable.');
      if (!data) setState('error');
    } finally { setRefreshing(false); }
  };

  useEffect(() => { if (!authLoading && user) void load(); }, [authLoading, user?.id]);
  const filtered = useMemo(() => {
    if (!data) return [];
    if (range === 'all') return data.history;
    const cutoff = Date.now() - (range === '7d' ? 7 : 30) * 86_400_000;
    return data.history.filter((item) => new Date(item.created_at).getTime() >= cutoff);
  }, [data, range]);
  const daily = useMemo(() => {
    const totals = new Map<string, number>();
    filtered.forEach((item) => { const key = new Date(item.created_at).toISOString().slice(0, 10); totals.set(key, (totals.get(key) || 0) + Number(item.credits_used || 0)); });
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([date, amount]) => ({ date, amount }));
  }, [filtered]);
  const visibleUsed = filtered.reduce((sum, item) => sum + Number(item.credits_used || 0), 0);
  const maxDaily = Math.max(...daily.map((item) => item.amount), 1);

  if (authLoading) return <main className="xeno-platform-page"><ResourceState kind="loading" title="Loading account usage" /></main>;
  if (!user) return <main className="xeno-platform-page"><ResourceState kind="unavailable" layout="page" previewLabel="Account / Usage" title="Your usage is private" detail="Sign in to view your confirmed credit balance, consumption, and activity history." actionLabel="Sign in" onRetry={() => navigate('/login?returnUrl=%2Foverview%2Fusage-analytics')} secondaryActionLabel="Back to dashboard" onSecondaryAction={() => navigate('/overview')} /></main>;
  if (state === 'loading') return <main className="xeno-platform-page"><ResourceState kind="loading" title="Loading confirmed usage" detail="Reading your balance and credit ledger from the account service." /></main>;
  if (state === 'error' || !data) return <main className="xeno-platform-page"><ResourceState kind="error" layout="page" previewLabel="Account / Usage" title="We couldn't load your usage" detail={error || 'The account service did not return confirmed usage data.'} actionLabel="Try again" onRetry={() => load()} secondaryActionLabel="Manage billing" onSecondaryAction={() => navigate('/overview/billing')} /></main>;

  const utilization = data.total_credits_earned > 0 ? Math.min(100, Math.max(0, (data.credits_used / data.total_credits_earned) * 100)) : 0;
  return <main className="xeno-platform-page">
    <header className="xeno-platform-page-header"><div><span className="xeno-page-eyebrow">Account</span><h1>Usage</h1><p>Confirmed credit balance, consumption, and recent activity.</p></div><div className="xeno-header-actions"><button type="button" className="xeno-page-button" disabled={refreshing} onClick={() => load(true)}><RefreshCw size={15} className={refreshing ? 'xeno-spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh'}</button><button type="button" className="xeno-page-button is-primary" onClick={() => navigate('/overview/billing')}>Manage billing</button></div></header>
    {error ? <div className="xeno-inline-error" role="alert">{error}</div> : null}
    <section className="xeno-usage-metrics" aria-label="Credit summary"><article><span><WalletCards size={16} />Available balance</span><strong>{data.current_credits.toLocaleString()}</strong><small>credits ready to use</small></article><article><span><TrendingDown size={16} />Total consumed</span><strong>{data.credits_used.toLocaleString()}</strong><small>confirmed ledger usage</small></article><article><span><Coins size={16} />Total funded</span><strong>{data.total_credits_earned.toLocaleString()}</strong><small>earned and purchased credits</small></article><article><span><BarChart3 size={16} />Utilization</span><strong>{utilization.toFixed(0)}%</strong><div className="xeno-usage-progress"><i style={{ width: `${utilization}%` }} /></div></article></section>
    <section className="xeno-usage-grid"><article className="xeno-data-card xeno-usage-chart"><header><div><h2>Credit activity</h2><p>{visibleUsed.toLocaleString()} credits across {filtered.length} confirmed events</p></div><div className="xeno-range-picker" aria-label="Usage range">{(['7d','30d','all'] as Range[]).map((value) => <button type="button" key={value} className={range === value ? 'is-active' : ''} aria-pressed={range === value} onClick={() => setRange(value)}>{value === 'all' ? 'All' : value === '7d' ? '7 days' : '30 days'}</button>)}</div></header>{daily.length ? <div className="xeno-usage-bars" aria-label="Daily credit use">{daily.map((item) => <div key={item.date}><span style={{ height: `${Math.max(6, (item.amount / maxDaily) * 100)}%` }} title={`${item.amount} credits`} /><small>{new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>)}</div> : <ResourceState kind="empty" title="No usage in this period" detail="Choose another range or start using a metered XENO capability." />}</article><aside className="xeno-data-card xeno-usage-account"><header><h2>Account record</h2><span>Confirmed</span></header><dl><div><dt><Calendar size={14} />Member since</dt><dd>{new Date(data.member_since).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })}</dd></div><div><dt><Zap size={14} />Welcome bonus</dt><dd>{data.bonus_claimed ? 'Claimed' : 'Available'}</dd></div></dl></aside></section>
    <section className="xeno-data-card xeno-usage-history"><header><h2>Activity</h2><span>{filtered.length} events</span></header>{filtered.length ? filtered.map((item, index) => <div className="xeno-usage-row" key={`${item.created_at}-${item.feature}-${index}`}><span className="xeno-data-icon"><Zap size={15} /></span><span><strong>{labelFeature(item.feature) || 'Metered action'}</strong><small>{new Date(item.created_at).toLocaleString()}</small></span><b>-{Number(item.credits_used).toLocaleString()} credits</b></div>) : <ResourceState kind="empty" title="No activity in this period" />}</section>
  </main>;
};

export default UsageAnalyticsPage;
