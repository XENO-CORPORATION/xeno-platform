import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronDown,
  Zap,
  CreditCard,
  Calendar,
  TrendingUp,
  MessageSquare,
  Image,
  Film,
  Gift,
  Sparkles,
  Filter,
  Search,
  Download,
  AlertTriangle,
  Bell,
  FileText,
  Shield,
  MapPin,
  Tag,
  X,
  Activity,
  FolderOpen,
  Hash,
} from 'lucide-react';
import {
  getBillingOverview,
  getBillingLedger,
  getPricingTiers,
  type BillingOverview,
  type LedgerEntry,
  type PricingTier,
} from '../../services/accountService';

// ─── Color tokens — matched to OverviewTaskbar palette ───
// Sidebar uses bg-black/90 for its background. We apply that same value
// to our containers/panels, not the page itself. Page stays transparent
// so gaps between cards show the underlying app bg, creating depth.

const C = {
  bg:           'transparent',                   // page inherits app background
  surface1:     'rgba(0,0,0,0.90)',              // container bg — dark recessed panels
  surface2:     'rgba(0,0,0,0.85)',              // panel body
  surface3:     'rgba(255,255,255,0.06)',         // panel heading — subtle lift
  border:       'rgba(255,255,255,0.08)',         // standard border
  borderStrong: 'rgba(255,255,255,0.15)',         // strong dividers
  rowHover:     'rgba(255,255,255,0.07)',         // row hover
  textPrimary:  'rgba(255,255,255,0.90)',         // headings
  textBody:     'rgba(255,255,255,0.70)',         // body text
  textSecondary:'rgba(255,255,255,0.40)',         // secondary text
  textTertiary: 'rgba(255,255,255,0.22)',         // tertiary/label text
  textDim:      'rgba(255,255,255,0.12)',         // timestamps
  iconDim:      'rgba(255,255,255,0.30)',         // dim icons
  positive:     'rgba(255,255,255,0.60)',         // credit amounts
  negative:     'rgba(255,255,255,0.30)',         // debit amounts
  ghost:        'rgba(255,255,255,0.10)',         // ghost button bg — matches taskbar
  ghostHover:   'rgba(255,255,255,0.20)',         // ghost button hover — matches taskbar
  chartLine:    'rgba(255,255,255,0.35)',         // chart line stroke
  chartFill:    'rgba(255,255,255,0.06)',         // chart area fill
  chartDot:     'rgba(255,255,255,0.75)',         // chart hover dot
  error:        { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.12)', text: 'rgba(239,68,68,0.65)' },
};

// ─── Dev fallback data ───

const DEV_BILLING: BillingOverview = {
  credits: {
    balance: 4_820,
    lifetime_earned: 12_500,
    lifetime_spent: 7_680,
    monthly_allowance: 5_000,
    allowance_reset_date: new Date(Date.now() + 18 * 86_400_000).toISOString(),
    is_frozen: false,
  },
  subscription: {
    id: 'sub-dev-001',
    plan_name: 'Pro',
    status: 'active',
    monthly_price: 29,
    next_billing_date: new Date(Date.now() + 18 * 86_400_000).toISOString(),
  },
};

// Generate realistic 30-day usage data for the chart
const generateDevLedger = (): LedgerEntry[] => {
  const entries: LedgerEntry[] = [];
  const types = [
    { type: 'usage', desc: 'GPT-4o chat completion', ref: 'chat', range: [5, 25] },
    { type: 'usage', desc: 'Claude 3.5 Sonnet chat', ref: 'chat', range: [6, 20] },
    { type: 'usage', desc: 'Gemini 2.0 Flash chat', ref: 'chat', range: [3, 8] },
    { type: 'usage', desc: 'FLUX image generation (1024×1024)', ref: 'generation', range: [30, 60] },
    { type: 'usage', desc: 'Recraft V3 image generation', ref: 'generation', range: [20, 40] },
    { type: 'usage', desc: 'Ideogram 2.0 generation', ref: 'generation', range: [40, 80] },
    { type: 'usage', desc: 'Kling video generation (5s)', ref: 'video', range: [80, 150] },
    { type: 'usage', desc: 'Luma Dream Machine video (10s)', ref: 'video', range: [150, 250] },
  ];
  let bal = 4820;
  let id = 0;
  // Generate 2-5 transactions per day for last 30 days
  for (let d = 29; d >= 0; d--) {
    const txCount = 2 + Math.floor(Math.random() * 4);
    for (let t = 0; t < txCount; t++) {
      // Occasional credit
      if (d === 15) {
        entries.push({
          id: `tx-${id++}`, type: 'allowance', amount: 5_000, balance_after: bal + 5000,
          description: 'Monthly credit allowance', reference_type: 'subscription',
          reference_id: 'sub-001', metadata: {},
          created_at: new Date(Date.now() - d * 86_400_000 - t * 3_600_000).toISOString(),
        });
        bal += 5000;
        continue;
      }
      if (d === 28 && t === 0) {
        entries.push({
          id: `tx-${id++}`, type: 'bonus', amount: 1_000, balance_after: bal + 1000,
          description: 'Welcome bonus credits', reference_type: 'bonus',
          reference_id: 'b-001', metadata: {},
          created_at: new Date(Date.now() - d * 86_400_000).toISOString(),
        });
        bal += 1000;
        continue;
      }
      const template = types[Math.floor(Math.random() * types.length)];
      const amount = -(template.range[0] + Math.floor(Math.random() * (template.range[1] - template.range[0])));
      bal += amount;
      entries.push({
        id: `tx-${id++}`, type: template.type, amount, balance_after: bal,
        description: template.desc, reference_type: template.ref,
        reference_id: `ref-${id}`, metadata: {},
        created_at: new Date(Date.now() - d * 86_400_000 - t * 3_600_000).toISOString(),
      });
    }
  }
  return entries.reverse(); // newest first
};

const DEV_LEDGER = generateDevLedger();

const DEV_TIERS: PricingTier[] = [
  { id: 'free', name: 'Free', monthly_price: 0, credits_included: 500, features: { models: 'Basic', support: 'Community' } },
  { id: 'pro', name: 'Pro', monthly_price: 29, credits_included: 5_000, features: { models: 'All', support: 'Priority', api: true } },
  { id: 'team', name: 'Team', monthly_price: 79, credits_included: 20_000, features: { models: 'All', support: 'Dedicated', api: true, seats: 5 } },
];

// ─── Dev fallback: Payment Methods ───

interface PaymentMethod {
  id: string;
  type: 'visa' | 'mastercard' | 'amex';
  last4: string;
  expiry: string;
  isDefault: boolean;
}

const DEV_PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'pm-1', type: 'visa', last4: '4242', expiry: '12/27', isDefault: true },
];

// ─── Dev fallback: Invoices ───

interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: 'paid' | 'pending' | 'failed';
  description: string;
}

const DEV_INVOICES: Invoice[] = [
  { id: 'inv-006', date: new Date(Date.now() - 2 * 86_400_000).toISOString(), amount: 29, status: 'paid', description: 'Pro Plan — Mar 2026' },
  { id: 'inv-005', date: new Date(Date.now() - 32 * 86_400_000).toISOString(), amount: 29, status: 'paid', description: 'Pro Plan — Feb 2026' },
  { id: 'inv-004', date: new Date(Date.now() - 60 * 86_400_000).toISOString(), amount: 29, status: 'paid', description: 'Pro Plan — Jan 2026' },
  { id: 'inv-003', date: new Date(Date.now() - 91 * 86_400_000).toISOString(), amount: 29, status: 'paid', description: 'Pro Plan — Dec 2025' },
];

// ─── Dev fallback: Projects / API keys ───

interface ProjectUsage { id: string; name: string; spent: number; apiKey: string; }

const DEV_PROJECTS: ProjectUsage[] = [
  { id: 'proj-1', name: 'Production App', spent: 4200, apiKey: 'xk-...a3f7' },
  { id: 'proj-2', name: 'Staging', spent: 1800, apiKey: 'xk-...b2c1' },
  { id: 'proj-3', name: 'Research Bot', spent: 980, apiKey: 'xk-...d4e9' },
  { id: 'proj-4', name: 'Internal Tools', spent: 500, apiKey: 'xk-...f1a2' },
];

// ─── Dev fallback: Audit Log ───

interface AuditEntry { id: string; action: string; actor: string; timestamp: string; }

const DEV_AUDIT: AuditEntry[] = [
  { id: 'aud-1', action: 'Plan upgraded to Pro', actor: 'you', timestamp: new Date(Date.now() - 5 * 86_400_000).toISOString() },
  { id: 'aud-2', action: 'Payment method added', actor: 'you', timestamp: new Date(Date.now() - 10 * 86_400_000).toISOString() },
  { id: 'aud-3', action: 'Budget limit set to 8,000', actor: 'you', timestamp: new Date(Date.now() - 15 * 86_400_000).toISOString() },
  { id: 'aud-4', action: 'API key xk-...b2c1 created', actor: 'you', timestamp: new Date(Date.now() - 20 * 86_400_000).toISOString() },
  { id: 'aud-5', action: 'Subscription started', actor: 'system', timestamp: new Date(Date.now() - 30 * 86_400_000).toISOString() },
];

// ─── Helpers ───

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

const daysUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

const getDateKey = (iso: string) => new Date(iso).toDateString();

const getDateLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const getCategoryIcon = (refType: string, amount: number) => {
  if (amount > 0) {
    if (refType === 'bonus') return <Gift size={13} style={{ color: C.textSecondary }} />;
    return <ArrowDownLeft size={13} style={{ color: C.textSecondary }} />;
  }
  switch (refType) {
    case 'chat': return <MessageSquare size={13} style={{ color: C.textTertiary }} />;
    case 'generation': return <Image size={13} style={{ color: C.textTertiary }} />;
    case 'video': return <Film size={13} style={{ color: C.textTertiary }} />;
    default: return <ArrowUpRight size={13} style={{ color: C.textTertiary }} />;
  }
};

// ─── Animated counter hook ───

const useAnimatedNumber = (target: number, duration = 800) => {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    const from = prevTarget.current;
    prevTarget.current = target;
    if (from === target) { setValue(target); return; }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(Math.round(from + (target - from) * ease));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);

  return value;
};

// ─── Spending chart (pure SVG) ───

type ChartRange = 7 | 30 | 90;

const SpendingChart: React.FC<{ ledger: LedgerEntry[]; days?: ChartRange; showMoM?: boolean; showForecast?: boolean }> = ({ ledger, days = 30, showMoM = false, showForecast = false }) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Aggregate daily spending for last 30 days
  const dailyData = useMemo(() => {
    const daysList: { date: Date; label: string; spent: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      daysList.push({ date: d, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), spent: 0 });
    }
    for (const tx of ledger) {
      if (tx.amount >= 0) continue;
      const txDate = new Date(tx.created_at);
      txDate.setHours(0, 0, 0, 0);
      const idx = daysList.findIndex(d => d.date.getTime() === txDate.getTime());
      if (idx >= 0) daysList[idx].spent += Math.abs(tx.amount);
    }
    return daysList;
  }, [ledger, days]);

  // Previous period data for month-over-month comparison
  const prevPeriodData = useMemo(() => {
    if (!showMoM) return [];
    const daysList: { date: Date; label: string; spent: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i - days);
      d.setHours(0, 0, 0, 0);
      daysList.push({ date: d, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), spent: 0 });
    }
    for (const tx of ledger) {
      if (tx.amount >= 0) continue;
      const txDate = new Date(tx.created_at);
      txDate.setHours(0, 0, 0, 0);
      const idx = daysList.findIndex(d => d.date.getTime() === txDate.getTime());
      if (idx >= 0) daysList[idx].spent += Math.abs(tx.amount);
    }
    return daysList;
  }, [ledger, days, showMoM]);

  // Simple forecast: weighted moving average of last 7 days, projected forward
  const forecastData = useMemo(() => {
    if (!showForecast || dailyData.length < 7) return [];
    const last7 = dailyData.slice(-7);
    const weights = [1, 1, 1.2, 1.3, 1.5, 1.7, 2]; // recent days weighted more
    const totalW = weights.reduce((a, b) => a + b, 0);
    const wma = last7.reduce((s, d, i) => s + d.spent * weights[i], 0) / totalW;
    const forecast: number[] = [];
    for (let i = 0; i < 7; i++) forecast.push(Math.round(wma * (0.95 + Math.random() * 0.1)));
    return forecast;
  }, [dailyData, showForecast]);

  const allValues = [...dailyData.map(d => d.spent), ...(showMoM ? prevPeriodData.map(d => d.spent) : []), ...forecastData];
  const maxSpent = Math.max(...allValues, 1);

  // SVG dimensions
  const W = 500, H = 120, PAD_X = 0, PAD_Y = 8;
  const chartW = W - PAD_X * 2;
  const chartH = H - PAD_Y * 2;

  const points = dailyData.map((d, i) => ({
    x: PAD_X + (i / (dailyData.length - 1)) * chartW,
    y: PAD_Y + chartH - (d.spent / maxSpent) * chartH,
    ...d,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${H} L${points[0].x},${H} Z`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((x - PAD_X) / chartW) * (dailyData.length - 1));
    setHoverIndex(Math.max(0, Math.min(dailyData.length - 1, idx)));
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(pct => (
          <line
            key={pct}
            x1={PAD_X} x2={W - PAD_X}
            y1={PAD_Y + chartH * (1 - pct)} y2={PAD_Y + chartH * (1 - pct)}
            stroke="rgba(255,255,255,0.03)" strokeWidth={0.5}
          />
        ))}

        {/* Area fill */}
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#areaGrad)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke={C.chartLine} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />

        {/* Previous period comparison line (MoM) */}
        {showMoM && prevPeriodData.length > 0 && (() => {
          const prevPoints = prevPeriodData.map((d, i) => ({
            x: PAD_X + (i / (prevPeriodData.length - 1)) * chartW,
            y: PAD_Y + chartH - (d.spent / maxSpent) * chartH,
          }));
          const prevLine = prevPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
          return <path d={prevLine} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={1} strokeDasharray="4 3" strokeLinecap="round" />;
        })()}

        {/* Forecast projection line */}
        {showForecast && forecastData.length > 0 && (() => {
          const lastPoint = points[points.length - 1];
          const fPoints = forecastData.map((v, i) => ({
            x: lastPoint.x + ((i + 1) / forecastData.length) * (chartW * 0.2),
            y: PAD_Y + chartH - (v / maxSpent) * chartH,
          }));
          const fLine = `M${lastPoint.x},${lastPoint.y} ` + fPoints.map(p => `L${p.x},${p.y}`).join(' ');
          return <path d={fLine} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} strokeDasharray="3 2" strokeLinecap="round" />;
        })()}

        {/* Hover dot + vertical line */}
        {hoverIndex !== null && points[hoverIndex] && (
          <>
            <line
              x1={points[hoverIndex].x} x2={points[hoverIndex].x}
              y1={PAD_Y} y2={H}
              stroke="rgba(255,255,255,0.08)" strokeWidth={0.5}
            />
            <circle cx={points[hoverIndex].x} cy={points[hoverIndex].y} r={3} fill={C.chartDot} />
          </>
        )}
      </svg>

      {/* Hover tooltip */}
      {hoverIndex !== null && points[hoverIndex] && (
        <div style={{
          position: 'absolute', top: 4,
          left: `${(points[hoverIndex].x / W) * 100}%`,
          transform: 'translateX(-50%)',
          background: C.surface3, border: `1px solid ${C.border}`, borderRadius: 4,
          padding: '3px 8px', pointerEvents: 'none', whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          <span style={{ fontSize: 10, color: C.textBody, fontVariantNumeric: 'tabular-nums' }}>
            {dailyData[hoverIndex].label}: <strong>{dailyData[hoverIndex].spent.toLocaleString()}</strong> credits
          </span>
        </div>
      )}
    </div>
  );
};

// ─── Skeleton helpers ───

const skeletonStyle = `
@keyframes skeletonPulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.7; } }
.skeleton-pulse { animation: skeletonPulse 1.5s ease-in-out infinite; }
`;

const SkeletonBar = ({ w, h = 10, mt = 0 }: { w: number | string; h?: number; mt?: number }) => (
  <div className="skeleton-pulse" style={{ width: w, height: h, borderRadius: 3, background: C.surface3, marginTop: mt }} />
);

/** Skeleton transaction rows — matches real row layout: 28px icon + text + amount */
const SkeletonRows: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} style={{
        display: 'grid', gridTemplateColumns: '28px 1fr auto',
        alignItems: 'center', gap: 8, padding: '5px 8px',
      }}>
        <div className="skeleton-pulse" style={{ width: 28, height: 28, borderRadius: 4, background: C.surface3 }} />
        <div>
          <SkeletonBar w={100 + (i % 3) * 40} h={10} />
          <SkeletonBar w={50} h={7} mt={4} />
        </div>
        <SkeletonBar w={36} h={10} />
      </div>
    ))}
  </>
);

/** Full-page skeleton — shown on initial load before data arrives */
const Skeleton: React.FC = () => (
  <div style={{ height: '100%', background: C.bg, display: 'grid', gridTemplateRows: 'auto auto auto 1fr', overflow: 'hidden', gap: 6 }}>
    {/* Header row */}
    <div style={{ display: 'flex', gap: 6 }}>
      <div className="skeleton-pulse" style={{ flex: 1, height: 34, borderRadius: 6, background: C.surface1 }} />
      <div className="skeleton-pulse" style={{ width: 90, height: 34, borderRadius: 6, background: C.surface1 }} />
    </div>
    {/* Hero row */}
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 6 }}>
      <div className="skeleton-pulse" style={{ height: 180, borderRadius: 6, background: C.surface1 }} />
      <div className="skeleton-pulse" style={{ height: 180, borderRadius: 6, background: C.surface1 }} />
    </div>
    {/* Stats row */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
      {[0, 1, 2].map(i => <div key={i} className="skeleton-pulse" style={{ height: 50, borderRadius: 6, background: C.surface1 }} />)}
    </div>
    {/* Transactions + sidebar row */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 6, minHeight: 0 }}>
      <div style={{ ...S.panel }}>
        <div className="skeleton-pulse" style={{ height: 34, borderRadius: 6, background: C.surface1 }} />
        <div style={{ ...S.panelBody, padding: 4 }}>
          <SkeletonRows count={10} />
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
        <div className="skeleton-pulse" style={{ height: 34, borderRadius: 6, background: C.surface1 }} />
        <div className="skeleton-pulse" style={{ height: 160, borderRadius: 6, background: C.surface1 }} />
        <div className="skeleton-pulse" style={{ height: 34, borderRadius: 6, background: C.surface1 }} />
        <div className="skeleton-pulse" style={{ height: 120, borderRadius: 6, background: C.surface1 }} />
      </div>
    </div>
    <style>{skeletonStyle}</style>
  </div>
);

// ─── Reusable styles ───

const S = {
  panelHeading: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 10px', height: 34, flexShrink: 0,
    background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6,
  } as React.CSSProperties,
  headingLabel: {
    fontSize: 10, fontWeight: 600, color: C.textSecondary,
    textTransform: 'uppercase', letterSpacing: '0.04em',
  } as React.CSSProperties,
  headingMeta: {
    fontSize: 10, color: C.textDim, fontVariantNumeric: 'tabular-nums',
  } as React.CSSProperties,
  panel: {
    display: 'flex', flexDirection: 'column', gap: 4,
  } as React.CSSProperties,
  panelBody: {
    background: C.surface1, border: `1px solid ${C.border}`,
    borderRadius: 6, overflow: 'hidden', flex: 1,
  } as React.CSSProperties,
  badge: {
    fontSize: 9, padding: '1px 5px', borderRadius: 2,
    background: C.ghost, color: C.textSecondary,
    fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em',
  } as React.CSSProperties,
};

const ghostBtn = (disabled = false): React.CSSProperties => ({
  height: 28, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6,
  background: C.ghost, border: 'none', borderRadius: 4,
  color: C.textSecondary, fontSize: 11, fontWeight: 500, cursor: 'pointer',
  opacity: disabled ? 0.3 : 1, transition: 'background-color 80ms ease',
});

const hover = {
  ghost: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = C.ghostHover; },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = C.ghost; },
  },
  row: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = C.rowHover; },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent'; },
  },
};

// ─── Filter types ───
type LedgerFilter = 'all' | 'debits' | 'credits';

// ─── CSV export helper ───
const exportCSV = (entries: LedgerEntry[]) => {
  const header = 'Date,Time,Description,Type,Amount,Balance After\n';
  const rows = entries.map(tx => [
    new Date(tx.created_at).toLocaleDateString(),
    new Date(tx.created_at).toLocaleTimeString(),
    `"${(tx.description || tx.type).replace(/"/g, '""')}"`,
    tx.reference_type,
    tx.amount,
    tx.balance_after,
  ].join(',')).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `xeno-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
};

// ─── Component ───

const BillingPage: React.FC = () => {
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [search, setSearch] = useState('');
  const [chartRange, setChartRange] = useState<ChartRange>(30);
  const [subOpen, setSubOpen] = useState(true);
  const [plansOpen, setPlansOpen] = useState(true);
  const [usageOpen, setUsageOpen] = useState(true);

  // New feature state
  const [paymentMethods] = useState<PaymentMethod[]>(DEV_PAYMENT_METHODS);
  const [invoices] = useState<Invoice[]>(DEV_INVOICES);
  const [payOpen, setPayOpen] = useState(true);
  const [invOpen, setInvOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [ledgerHasMore, setLedgerHasMore] = useState(true);
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState({ threshold75: true, threshold90: true, depleted: true, invoiceReady: true });
  const searchRef = useRef<HTMLInputElement>(null);
  const ledgerScrollRef = useRef<HTMLDivElement>(null);

  // Phase 2 feature state
  const [budgetSoft, setBudgetSoft] = useState(6000);
  const [budgetHard, setBudgetHard] = useState(8000);
  const [budgetOpen, setBudgetOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [billingAddr, setBillingAddr] = useState({ company: 'Xeno Corp', address: '123 AI Street, SF', taxId: 'US-12345678' });
  const [addrOpen, setAddrOpen] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [showMoM, setShowMoM] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelStep, setCancelStep] = useState<'reason' | 'offer' | 'confirm'>('reason');
  const [cancelReason, setCancelReason] = useState('');

  const loadData = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);
    try {
      const [billingRes, ledgerRes, tiersRes] = await Promise.allSettled([
        getBillingOverview(),
        getBillingLedger(200, 0),
        getPricingTiers(),
      ]);
      if (billingRes.status === 'fulfilled') setBilling(billingRes.value.overview);
      else throw new Error('billing');
      if (ledgerRes.status === 'fulfilled') {
        setLedger(ledgerRes.value.ledger);
      }
      if (tiersRes.status === 'fulfilled') setTiers(tiersRes.value.tiers);
    } catch {
      console.warn('[BillingPage] API unavailable, using fallback data');
      setBilling(DEV_BILLING);
      setLedger(DEV_LEDGER);
      setTiers(DEV_TIERS);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Auto-refresh polling (60s) ──
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => loadData(true), 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, loadData]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); loadData(true); }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loadData]);

  // ── Infinite scroll: load more on reaching bottom ──
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !ledgerHasMore) return;
    setIsLoadingMore(true);
    try {
      const nextOffset = ledgerOffset + 200;
      const res = await getBillingLedger(200, nextOffset);
      if (res.ledger.length === 0) { setLedgerHasMore(false); }
      else {
        setLedger(prev => [...prev, ...res.ledger]);
        setLedgerOffset(nextOffset);
        if (nextOffset + res.ledger.length >= res.total) setLedgerHasMore(false);
      }
    } catch {
      // Dev mode — no more data
      setLedgerHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, ledgerHasMore, ledgerOffset]);

  const handleLedgerScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) loadMore();
  }, [loadMore]);

  // Animated values
  const animBalance = useAnimatedNumber(billing?.credits?.balance ?? 0);
  const animSpent = useAnimatedNumber(billing?.credits?.lifetime_spent ?? 0);
  const animAllowance = useAnimatedNumber(billing?.credits?.monthly_allowance ?? 0);

  // Filtered ledger (filter + search)
  const filteredLedger = useMemo(() => {
    let result = ledger;
    if (filter === 'credits') result = result.filter(tx => tx.amount > 0);
    else if (filter === 'debits') result = result.filter(tx => tx.amount < 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(tx => (tx.description || tx.type).toLowerCase().includes(q));
    }
    return result;
  }, [ledger, filter, search]);

  // Per-filter counts & totals (displayed on tabs)
  const filterStats = useMemo(() => {
    const allCount = ledger.length;
    const debitEntries = ledger.filter(tx => tx.amount < 0);
    const creditEntries = ledger.filter(tx => tx.amount > 0);
    return {
      all:     { count: allCount, total: 0 },
      debits:  { count: debitEntries.length, total: debitEntries.reduce((s, tx) => s + Math.abs(tx.amount), 0) },
      credits: { count: creditEntries.length, total: creditEntries.reduce((s, tx) => s + tx.amount, 0) },
    };
  }, [ledger]);

  // Burn rate projection
  const burnProjection = useMemo(() => {
    const last7 = ledger.filter(tx => {
      if (tx.amount >= 0) return false;
      return Date.now() - new Date(tx.created_at).getTime() < 7 * 86_400_000;
    });
    const totalSpent7d = last7.reduce((s, tx) => s + Math.abs(tx.amount), 0);
    const dailyBurn = totalSpent7d / 7;
    const bal = billing?.credits?.balance;
    if (dailyBurn <= 0 || bal == null) return null;
    const daysLeft = Math.floor(bal / dailyBurn);
    const exhaustDate = new Date(Date.now() + daysLeft * 86_400_000);
    return { dailyBurn: Math.round(dailyBurn), daysLeft, exhaustDate };
  }, [ledger, billing]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const cats: Record<string, number> = {};
    for (const tx of ledger) {
      if (tx.amount >= 0) continue;
      const cat = tx.reference_type === 'chat' ? 'Chat' : tx.reference_type === 'generation' ? 'Image' : tx.reference_type === 'video' ? 'Video' : 'Other';
      cats[cat] = (cats[cat] || 0) + Math.abs(tx.amount);
    }
    const total = Object.values(cats).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({ name, amount, pct: Math.round((amount / total) * 100) }));
  }, [ledger]);

  // Anomaly detection: compare each day's spending to the rolling 7-day average
  const anomalies = useMemo(() => {
    const found: { date: string; spent: number; avg: number; ratio: number }[] = [];
    const dailyMap: Record<string, number> = {};
    for (const tx of ledger) {
      if (tx.amount >= 0) continue;
      const k = getDateKey(tx.created_at);
      dailyMap[k] = (dailyMap[k] || 0) + Math.abs(tx.amount);
    }
    const days = Object.entries(dailyMap).sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime());
    for (let i = 7; i < days.length; i++) {
      const window = days.slice(i - 7, i).map(([, v]) => v);
      const avg = window.reduce((a, b) => a + b, 0) / 7;
      const [date, spent] = days[i];
      if (avg > 0 && spent / avg >= 2.0) {
        found.push({ date, spent, avg: Math.round(avg), ratio: Math.round((spent / avg) * 10) / 10 });
      }
    }
    return found.slice(-3); // last 3 anomalies
  }, [ledger]);

  // Enhanced forecast: weighted moving average
  const enhancedForecast = useMemo(() => {
    const dailyMap: Record<string, number> = {};
    for (const tx of ledger) {
      if (tx.amount >= 0) continue;
      const k = getDateKey(tx.created_at);
      dailyMap[k] = (dailyMap[k] || 0) + Math.abs(tx.amount);
    }
    const vals = Object.values(dailyMap);
    if (vals.length < 7) return null;
    const last14 = vals.slice(-14);
    const weights = last14.map((_, i) => 1 + i * 0.15);
    const totalW = weights.reduce((a, b) => a + b, 0);
    const wma = last14.reduce((s, v, i) => s + v * weights[i], 0) / totalW;
    const bal = billing?.credits?.balance ?? 0;
    return {
      dailyForecast: Math.round(wma),
      next7: Math.round(wma * 7),
      next30: Math.round(wma * 30),
      daysUntilEmpty: wma > 0 ? Math.floor(bal / wma) : Infinity,
    };
  }, [ledger, billing]);

  if (isLoading) return <Skeleton />;

  const sub = billing?.subscription;
  const credits = billing?.credits;
  const allowanceUsed = credits ? Math.max(0, credits.monthly_allowance - credits.balance) : 0;
  const allowancePercent = credits?.monthly_allowance ? Math.min(100, (allowanceUsed / credits.monthly_allowance) * 100) : 0;

  // Group filtered ledger by date
  const groupedLedger: { dateLabel: string; entries: LedgerEntry[] }[] = [];
  let lastDateKey = '';
  for (const tx of filteredLedger) {
    const dk = getDateKey(tx.created_at);
    if (dk !== lastDateKey) {
      groupedLedger.push({ dateLabel: getDateLabel(tx.created_at), entries: [] });
      lastDateKey = dk;
    }
    groupedLedger[groupedLedger.length - 1].entries.push(tx);
  }

  return (
    <div style={{
      height: '100%', background: C.bg,
      display: 'grid', gridTemplateRows: 'auto auto auto 1fr',
      overflow: 'hidden',
      padding: '8px 8px 8px 8px',
    }}>

      {/* ═══ Row 1: Header row — label bar + standalone refresh ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 10px', height: 34,
          background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6,
        }}>
          <h1 style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, margin: 0 }}>Billing</h1>
          <span style={{ fontSize: 10, color: C.textTertiary }}>·</span>
          <span style={{ fontSize: 10, color: C.textTertiary }}>Subscription, credits &amp; usage</span>
        </div>
        <button
          onClick={() => setAutoRefresh(a => !a)}
          title={autoRefresh ? 'Auto-refresh ON (60s)' : 'Auto-refresh OFF'}
          style={{
            height: 34, width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.surface1, border: `1px solid ${autoRefresh ? C.borderStrong : C.border}`, borderRadius: 6,
            color: autoRefresh ? C.textPrimary : C.textTertiary, cursor: 'pointer',
            transition: 'color 80ms ease',
            padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = C.textPrimary; }}
          onMouseLeave={e => { e.currentTarget.style.color = autoRefresh ? C.textPrimary : C.textTertiary; }}
        >
          <Clock size={11} />
        </button>
        <button onClick={() => loadData(true)} disabled={isRefreshing} style={{
          height: 34, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6,
          background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6,
          color: C.textSecondary, fontSize: 11, fontWeight: 500, cursor: 'pointer',
          opacity: isRefreshing ? 0.3 : 1, transition: 'color 80ms ease',
        }}
          onMouseEnter={e => { e.currentTarget.style.color = C.textPrimary; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.textSecondary; }}
        >
          <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 6, padding: '5px 10px', borderRadius: 4, background: C.error.bg, border: `1px solid ${C.error.border}`, color: C.error.text, fontSize: 11 }}>
          {error}
        </div>
      )}

      {/* Anomaly alert banner */}
      {anomalies.length > 0 && (
        <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 4, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.12)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={12} style={{ color: 'rgba(245,158,11,0.7)', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: 'rgba(245,158,11,0.7)', flex: 1 }}>
            <strong>Anomaly detected:</strong> {anomalies[anomalies.length - 1].ratio}x above average on {new Date(anomalies[anomalies.length - 1].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {' '}({anomalies[anomalies.length - 1].spent.toLocaleString()} vs avg {anomalies[anomalies.length - 1].avg.toLocaleString()})
          </span>
          {anomalies.length > 1 && <span style={{ fontSize: 9, color: 'rgba(245,158,11,0.5)' }}>+{anomalies.length - 1} more</span>}
        </div>
      )}

      {/* ═══ Row 2: Hero Balance + Spending Chart ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 6, marginTop: 6 }}>
        {/* Hero balance card */}
        <div style={{
          background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6,
          padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <Coins size={12} style={{ color: C.iconDim }} />
              <span style={{ fontSize: 10, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>Credit Balance</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: C.textPrimary, fontVariantNumeric: 'tabular-nums', lineHeight: '34px' }}>
              {animBalance.toLocaleString()}
            </div>
          </div>
          {/* Category breakdown */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', height: 3, borderRadius: 1, overflow: 'hidden', gap: 1 }}>
              {categoryBreakdown.map((cat, i) => (
                <div key={cat.name} style={{
                  flex: cat.pct,
                  background: `rgba(255,255,255,${0.1 + i * 0.08})`,
                  borderRadius: 1,
                }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {categoryBreakdown.slice(0, 3).map((cat, i) => (
                <div key={cat.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 1, background: `rgba(255,255,255,${0.1 + i * 0.08})` }} />
                  <span style={{ fontSize: 9, color: C.textTertiary }}>{cat.name} {cat.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 30-day spending chart */}
        <div style={{
          background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6,
          padding: '10px 12px 6px', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>Spending</span>
              <div style={{ display: 'flex', gap: 1, background: C.bg, borderRadius: 3, padding: 1 }}>
                {([7, 30, 90] as ChartRange[]).map(r => (
                  <button key={r} onClick={() => setChartRange(r)} style={{
                    height: 18, padding: '0 6px', fontSize: 9, fontWeight: 500,
                    background: chartRange === r ? C.ghost : 'transparent',
                    border: 'none', borderRadius: 2, cursor: 'pointer',
                    color: chartRange === r ? C.textBody : C.textTertiary,
                    transition: 'all 80ms ease',
                  }}>{r}d</button>
                ))}
              </div>
              <div style={{ width: 1, height: 12, background: C.border }} />
              <button onClick={() => setShowMoM(v => !v)} style={{
                height: 18, padding: '0 6px', fontSize: 9, fontWeight: 500,
                background: showMoM ? C.ghost : 'transparent',
                border: 'none', borderRadius: 2, cursor: 'pointer',
                color: showMoM ? C.textBody : C.textTertiary,
              }}>MoM</button>
              <button onClick={() => setShowForecast(v => !v)} style={{
                height: 18, padding: '0 6px', fontSize: 9, fontWeight: 500,
                background: showForecast ? C.ghost : 'transparent',
                border: 'none', borderRadius: 2, cursor: 'pointer',
                color: showForecast ? C.textBody : C.textTertiary,
              }}>Forecast</button>
            </div>
            <span style={{ fontSize: 10, color: C.textDim, fontVariantNumeric: 'tabular-nums' }}>
              max {Math.max(...(ledger.length > 0 ? (() => {
                const daily: Record<string, number> = {};
                ledger.forEach(tx => { if (tx.amount < 0) { const k = getDateKey(tx.created_at); daily[k] = (daily[k] || 0) + Math.abs(tx.amount); }});
                return Object.values(daily);
              })() : [0])).toLocaleString()}/d
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <SpendingChart ledger={ledger} days={chartRange} showMoM={showMoM} showForecast={showForecast} />
          </div>
        </div>
      </div>

      {/* ═══ Row 3: Secondary Stats ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 6 }}>
        {/* Allowance */}
        <div style={{ background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <Calendar size={11} style={{ color: C.iconDim }} />
            <span style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>Allowance</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{animAllowance.toLocaleString()}</span>
            <span style={{ fontSize: 9, color: C.textDim }}>resets {credits?.allowance_reset_date ? `${daysUntil(credits.allowance_reset_date)}d` : '—'}</span>
          </div>
          <div style={{ width: '100%', height: 2, background: C.border, borderRadius: 1, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ width: `${allowancePercent}%`, height: '100%', background: allowancePercent > 90 ? 'rgba(239,68,68,0.5)' : allowancePercent > 75 ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.3)', borderRadius: 1, transition: 'width 300ms ease' }} />
          </div>
          {allowancePercent >= 75 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <AlertTriangle size={9} style={{ color: allowancePercent >= 90 ? C.error.text : 'rgba(245,158,11,0.65)' }} />
              <span style={{ fontSize: 8, color: allowancePercent >= 90 ? C.error.text : 'rgba(245,158,11,0.65)' }}>
                {allowancePercent >= 90 ? 'Almost depleted' : 'Nearing limit'}
              </span>
            </div>
          )}
        </div>
        {/* Spent */}
        <div style={{ background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <TrendingUp size={11} style={{ color: C.iconDim }} />
            <span style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>Total Spent</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{animSpent.toLocaleString()}</span>
            <span style={{ fontSize: 9, color: C.textDim }}>lifetime</span>
          </div>
        </div>
        {/* Burn rate */}
        <div style={{ background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <Clock size={11} style={{ color: C.iconDim }} />
            <span style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>Burn Rate</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{burnProjection ? `${burnProjection.dailyBurn}/d` : '—'}</span>
            <span style={{ fontSize: 9, color: C.textDim }}>
              {burnProjection ? `~${burnProjection.daysLeft}d left` : 'no data'}
            </span>
          </div>
        </div>
        {/* Plan */}
        <div style={{ background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <Zap size={11} style={{ color: C.iconDim }} />
            <span style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>Plan</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{sub?.plan_name ?? 'Free'}</span>
            {sub?.monthly_price !== undefined && <span style={{ fontSize: 9, color: C.textDim }}>${sub.monthly_price}/mo</span>}
          </div>
        </div>
      </div>

      {/* ═══ Row 4: Transaction list + sidebar (fills remaining) ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 6, margin: '6px 0 0', minHeight: 0 }}>

        {/* ── Transaction Ledger ── */}
        <div style={{ ...S.panel, minHeight: 0 }}>
          <div style={S.panelHeading}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={S.headingLabel}>Transactions</span>
              {/* Filter tabs */}
              <div style={{ display: 'flex', gap: 0 }}>
                {(['all', 'debits', 'credits'] as LedgerFilter[]).map(f => {
                  const active = filter === f;
                  const stats = filterStats[f];
                  return (
                    <button key={f} onClick={() => setFilter(f)} style={{
                      height: 24, padding: '0 10px', fontSize: 9, fontWeight: 500,
                      background: 'transparent',
                      border: 'none', cursor: 'pointer',
                      borderBottom: active ? '2px solid rgba(255,255,255,0.5)' : '2px solid transparent',
                      color: active ? C.textBody : C.textTertiary,
                      textTransform: 'uppercase', letterSpacing: '0.03em',
                      transition: 'all 80ms ease',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                      {f}
                      <span style={{
                        fontSize: 8, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                        color: active ? C.textSecondary : C.textDim,
                        background: active ? C.ghost : 'transparent',
                        borderRadius: 3, padding: '1px 4px',
                        transition: 'all 80ms ease',
                      }}>
                        {stats.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Search */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.bg, borderRadius: 3, padding: '0 6px', height: 22, marginLeft: 'auto' }}>
                <Search size={10} style={{ color: C.textTertiary, flexShrink: 0 }} />
                <input
                  ref={searchRef}
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search… ( / )"
                  style={{
                    background: 'none', border: 'none', outline: 'none',
                    fontSize: 10, color: C.textBody, width: 90,
                    padding: 0, height: '100%',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => exportCSV(filteredLedger)}
                title="Export CSV"
                style={{ ...ghostBtn(), height: 22, padding: '0 6px', gap: 4 }}
                {...hover.ghost}
              >
                <Download size={10} />
              </button>
              <span style={S.headingMeta}>
                {filter !== 'all' && filterStats[filter].total > 0
                  ? `${filterStats[filter].total.toLocaleString()} cr · `
                  : ''}
                {filteredLedger.length}
              </span>
            </div>
          </div>
          <div ref={ledgerScrollRef} onScroll={handleLedgerScroll} style={{ ...S.panelBody, flex: 1, minHeight: 0, overflowY: 'auto', padding: 4 }}>
            <style>{skeletonStyle}</style>
            {isRefreshing && filteredLedger.length === 0 ? (
              <SkeletonRows count={10} />
            ) : filteredLedger.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <Sparkles size={24} style={{ color: C.ghost, margin: '0 auto 8px' }} />
                <p style={{ fontSize: 11, color: C.textTertiary, margin: 0 }}>
                  {filter === 'all' ? 'No transactions yet' : `No ${filter} found`}
                </p>
              </div>
            ) : (
              groupedLedger.map(group => {
                const dayTotal = group.entries.reduce((s, tx) => s + (tx.amount < 0 ? Math.abs(tx.amount) : 0), 0);
                const dayCredits = group.entries.reduce((s, tx) => s + (tx.amount > 0 ? tx.amount : 0), 0);
                return (
                <div key={group.dateLabel}>
                  {/* Date separator */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 4px',
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 600, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                      {group.dateLabel}
                    </span>
                    <div style={{ flex: 1, height: 1, background: C.border }} />
                    <span style={{ fontSize: 9, color: C.textDim, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {dayTotal > 0 && <span>-{dayTotal.toLocaleString()}</span>}
                      {dayTotal > 0 && dayCredits > 0 && <span style={{ color: C.textTertiary }}> · </span>}
                      {dayCredits > 0 && <span style={{ color: C.textSecondary }}>+{dayCredits.toLocaleString()}</span>}
                    </span>
                  </div>
                  {/* Transactions */}
                  {group.entries.map(tx => {
                    const isCredit = tx.amount > 0;
                    const catLabel = tx.reference_type === 'chat' ? 'Chat'
                      : tx.reference_type === 'generation' ? 'Image'
                      : tx.reference_type === 'video' ? 'Video'
                      : tx.reference_type === 'bonus' ? 'Bonus'
                      : tx.reference_type === 'subscription' ? 'Sub'
                      : null;
                    return (
                      <div
                        key={tx.id}
                        style={{
                          display: 'grid', gridTemplateColumns: '28px 1fr auto',
                          alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 4,
                          borderLeft: '2px solid transparent',
                          transition: 'background-color 80ms ease',
                        }}
                        {...hover.row}
                      >
                        <div style={{
                          width: 28, height: 28, borderRadius: 4,
                          background: isCredit ? 'rgba(255,255,255,0.06)' : C.surface1,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {getCategoryIcon(tx.reference_type ?? '', tx.amount)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: C.textBody, lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tx.description || tx.type}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, lineHeight: '14px' }}>
                            <span style={{ fontSize: 10, color: C.textDim }}>
                              {formatTime(tx.created_at)}
                            </span>
                            {catLabel && (
                              <span style={{
                                fontSize: 8, fontWeight: 500, color: C.textTertiary,
                                background: C.ghost, borderRadius: 2, padding: '1px 4px',
                                letterSpacing: '0.02em',
                              }}>
                                {catLabel}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', minWidth: 60 }}>
                          <div style={{
                            fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                            color: isCredit ? C.positive : C.negative,
                            lineHeight: '16px',
                          }}>
                            {isCredit ? '+' : ''}{tx.amount.toLocaleString()}
                          </div>
                          <div style={{ fontSize: 9, color: C.textDim, fontVariantNumeric: 'tabular-nums', lineHeight: '14px' }}>
                            balance {tx.balance_after.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                );
              })
            )}
            {/* Load more / infinite scroll indicator */}
            {ledgerHasMore && filteredLedger.length > 0 && (
              <div style={{ padding: '12px 0', textAlign: 'center' }}>
                {isLoadingMore ? (
                  <Loader2 size={14} className="animate-spin" style={{ color: C.textTertiary, margin: '0 auto' }} />
                ) : (
                  <button onClick={loadMore} style={{
                    background: 'none', border: `1px solid ${C.border}`, borderRadius: 4,
                    color: C.textSecondary, fontSize: 10, padding: '4px 12px', cursor: 'pointer',
                    transition: 'color 80ms ease',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.color = C.textPrimary; }}
                    onMouseLeave={e => { e.currentTarget.style.color = C.textSecondary; }}
                  >
                    Load more
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div style={{ display: 'grid', gap: 6, alignContent: 'start', minHeight: 0, overflowY: 'auto' }}>

          {/* Subscription */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setSubOpen(o => !o)}>
              <span style={S.headingLabel}>Subscription</span>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: subOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {subOpen && (
              <div style={{ ...S.panelBody, padding: 12, display: 'grid', gap: 8 }}>
                {sub ? (
                  <>
                    <KVRow label="Plan" value={<span style={S.badge}>{sub.plan_name}</span>} />
                    <KVRow label="Price" value={<span style={{ fontSize: 12, color: C.textBody, fontVariantNumeric: 'tabular-nums' }}>${sub.monthly_price}/mo</span>} />
                    <KVRow label="Status" value={<span style={S.badge}>{sub.status}</span>} />
                    {sub.next_billing_date && <KVRow label="Renews" value={<span style={{ fontSize: 11, color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{formatDate(sub.next_billing_date)}</span>} />}
                    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 4, display: 'grid', gap: 4 }}>
                      <button style={{ ...ghostBtn(), width: '100%', justifyContent: 'center' }} {...hover.ghost}>
                        Manage Subscription <ChevronRight size={12} />
                      </button>
                      <button onClick={() => { setCancelModal(true); setCancelStep('reason'); }} style={{ ...ghostBtn(), width: '100%', justifyContent: 'center', color: C.error.text, fontSize: 10 }}
                        onMouseEnter={e => { e.currentTarget.style.background = C.error.bg; }}
                        onMouseLeave={e => { e.currentTarget.style.background = C.ghost; }}
                      >
                        Cancel Subscription
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '4px 0' }}>
                    <p style={{ fontSize: 11, color: C.textTertiary, margin: '0 0 8px' }}>No active subscription</p>
                    <button style={{
                      width: '100%', height: 28, border: 'none', borderRadius: 4,
                      background: 'rgba(255,255,255,0.9)', color: '#09090b',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>
                      Choose a Plan
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Plans */}
          {tiers.length > 0 && (
            <div style={S.panel}>
              <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setPlansOpen(o => !o)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={S.headingLabel}>Available Plans</span>
                  <div style={{ display: 'flex', gap: 1, background: C.bg, borderRadius: 3, padding: 1 }}>
                    <button onClick={e => { e.stopPropagation(); setBillingCycle('monthly'); }} style={{ height: 16, padding: '0 5px', fontSize: 8, fontWeight: 500, background: billingCycle === 'monthly' ? C.ghost : 'transparent', border: 'none', borderRadius: 2, cursor: 'pointer', color: billingCycle === 'monthly' ? C.textBody : C.textTertiary }}>Monthly</button>
                    <button onClick={e => { e.stopPropagation(); setBillingCycle('annual'); }} style={{ height: 16, padding: '0 5px', fontSize: 8, fontWeight: 500, background: billingCycle === 'annual' ? C.ghost : 'transparent', border: 'none', borderRadius: 2, cursor: 'pointer', color: billingCycle === 'annual' ? C.textBody : C.textTertiary }}>Annual</button>
                  </div>
                </div>
                <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: plansOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </div>
              {plansOpen && <div style={{ ...S.panelBody, padding: 6, display: 'grid', gap: 2 }}>
                {tiers.map(tier => {
                  const isCurrent = sub?.plan_name?.toLowerCase() === tier.name.toLowerCase();
                  return (
                    <div key={tier.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 8px', borderRadius: 4,
                      background: isCurrent ? C.surface3 : 'transparent',
                      border: isCurrent ? `1px solid ${C.border}` : '1px solid transparent',
                      transition: 'background-color 80ms ease',
                    }}
                      onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = C.rowHover; }}
                      onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: C.textBody }}>{tier.name}</span>
                          {isCurrent && <span style={{ ...S.badge, fontSize: 8 }}>current</span>}
                        </div>
                        <span style={{ fontSize: 10, color: C.textTertiary }}>{tier.credits_included.toLocaleString()} credits/mo</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                        {tier.monthly_price === 0 ? 'Free' : billingCycle === 'annual' ? `$${Math.round(tier.monthly_price * 10)}/yr` : `$${tier.monthly_price}`}
                      </span>
                    </div>
                  );
                })}
              </div>}
            </div>
          )}

          {/* Usage Breakdown */}
          {categoryBreakdown.length > 0 && (
            <div style={S.panel}>
              <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setUsageOpen(o => !o)}>
                <span style={S.headingLabel}>Usage Breakdown</span>
                <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: usageOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </div>
              {usageOpen && (
                <div style={{ ...S.panelBody, padding: 10, display: 'grid', gap: 6 }}>
                  {categoryBreakdown.map((cat, i) => (
                    <div key={cat.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: C.textBody }}>{cat.name}</span>
                        <span style={{ fontSize: 10, color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{cat.amount.toLocaleString()} ({cat.pct}%)</span>
                      </div>
                      <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          width: `${cat.pct}%`, height: '100%', borderRadius: 2,
                          background: `rgba(255,255,255,${0.12 + i * 0.08})`,
                          transition: 'width 300ms ease',
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Payment Methods */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setPayOpen(o => !o)}>
              <span style={S.headingLabel}>Payment Methods</span>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: payOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {payOpen && (
              <div style={{ ...S.panelBody, padding: 10, display: 'grid', gap: 6 }}>
                {paymentMethods.map(pm => (
                  <div key={pm.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    borderRadius: 4, border: `1px solid ${C.border}`, background: pm.isDefault ? C.surface3 : 'transparent',
                  }}>
                    <CreditCard size={14} style={{ color: C.textSecondary, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.textBody }}>
                        {pm.type.charAt(0).toUpperCase() + pm.type.slice(1)} ····{pm.last4}
                        {pm.isDefault && <span style={{ ...S.badge, fontSize: 7, marginLeft: 6 }}>DEFAULT</span>}
                      </div>
                      <div style={{ fontSize: 9, color: C.textDim }}>Expires {pm.expiry}</div>
                    </div>
                  </div>
                ))}
                <button style={{ ...ghostBtn(), width: '100%', justifyContent: 'center', height: 24, fontSize: 10 }} {...hover.ghost}>
                  + Add Payment Method
                </button>
              </div>
            )}
          </div>

          {/* Invoice History */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setInvOpen(o => !o)}>
              <span style={S.headingLabel}>Invoice History</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, color: C.textDim }}>{invoices.length}</span>
                <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: invOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </div>
            </div>
            {invOpen && (
              <div style={{ ...S.panelBody, padding: 6, display: 'grid', gap: 2 }}>
                {invoices.map(inv => (
                  <div key={inv.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    borderRadius: 4, transition: 'background-color 80ms ease',
                  }} {...hover.row}>
                    <FileText size={12} style={{ color: C.textTertiary, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.textBody, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inv.description}
                      </div>
                      <div style={{ fontSize: 9, color: C.textDim }}>{formatDate(inv.date)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>${inv.amount}</div>
                      <div style={{ fontSize: 8, color: inv.status === 'paid' ? C.positive : C.error.text, textTransform: 'uppercase' }}>{inv.status}</div>
                    </div>
                    <button
                      title="Download PDF"
                      onClick={(e) => {
                        e.stopPropagation();
                        const w = window.open('', '_blank', 'width=600,height=400');
                        if (!w) return;
                        w.document.write(`<html><head><title>${inv.id}</title><style>body{font-family:system-ui;padding:40px;color:#333}h1{font-size:18px}table{width:100%;border-collapse:collapse;margin-top:20px}td{padding:8px;border-bottom:1px solid #eee}td:last-child{text-align:right;font-weight:600}.label{color:#888;font-size:13px}</style></head><body><h1>Invoice ${inv.id.toUpperCase()}</h1><table><tr><td class="label">Description</td><td>${inv.description}</td></tr><tr><td class="label">Date</td><td>${formatDate(inv.date)}</td></tr><tr><td class="label">Amount</td><td>$${inv.amount}.00</td></tr><tr><td class="label">Status</td><td>${inv.status.toUpperCase()}</td></tr></table><p style="margin-top:30px;font-size:12px;color:#aaa">Xeno Corporation &mdash; Generated ${new Date().toISOString().slice(0, 10)}</p><script>setTimeout(()=>window.print(),300)</script></body></html>`);
                        w.document.close();
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: C.textDim, flexShrink: 0, transition: 'color 80ms ease' }}
                      onMouseEnter={e => { e.currentTarget.style.color = C.textPrimary; }}
                      onMouseLeave={e => { e.currentTarget.style.color = C.textDim; }}
                    >
                      <Download size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notification Preferences */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setNotifOpen(o => !o)}>
              <span style={S.headingLabel}>Alert Preferences</span>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: notifOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {notifOpen && (
              <div style={{ ...S.panelBody, padding: 10, display: 'grid', gap: 8 }}>
                {([
                  { key: 'threshold75' as const, label: '75% allowance used' },
                  { key: 'threshold90' as const, label: '90% allowance used' },
                  { key: 'depleted' as const, label: 'Credits depleted' },
                  { key: 'invoiceReady' as const, label: 'New invoice ready' },
                ]).map(pref => (
                  <div key={pref.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Bell size={10} style={{ color: C.textTertiary }} />
                      <span style={{ fontSize: 10, color: C.textBody }}>{pref.label}</span>
                    </div>
                    <button
                      onClick={() => setNotifPrefs(p => ({ ...p, [pref.key]: !p[pref.key] }))}
                      style={{
                        width: 28, height: 14, borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: notifPrefs[pref.key] ? 'rgba(255,255,255,0.25)' : C.border,
                        position: 'relative', transition: 'background 150ms ease',
                        padding: 0,
                      }}
                    >
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: notifPrefs[pref.key] ? C.textPrimary : C.textDim,
                        position: 'absolute', top: 2,
                        left: notifPrefs[pref.key] ? 16 : 2,
                        transition: 'left 150ms ease, background 150ms ease',
                      }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Budget Limits */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setBudgetOpen(o => !o)}>
              <span style={S.headingLabel}>Budget Limits</span>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: budgetOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {budgetOpen && (
              <div style={{ ...S.panelBody, padding: 10, display: 'grid', gap: 8 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: C.textBody }}>Soft Limit (warn)</span>
                    <input type="number" value={budgetSoft} onChange={e => setBudgetSoft(Number(e.target.value))} style={{ width: 60, height: 18, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, color: C.textBody, fontSize: 10, textAlign: 'right', padding: '0 4px', outline: 'none' }} />
                  </div>
                  <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, ((billing?.credits?.lifetime_spent ?? 0) / (budgetSoft || 1)) * 100)}%`, height: '100%', borderRadius: 2, background: (billing?.credits?.lifetime_spent ?? 0) >= budgetSoft ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.2)', transition: 'width 300ms ease' }} />
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: C.textBody }}>Hard Limit (block)</span>
                    <input type="number" value={budgetHard} onChange={e => setBudgetHard(Number(e.target.value))} style={{ width: 60, height: 18, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, color: C.textBody, fontSize: 10, textAlign: 'right', padding: '0 4px', outline: 'none' }} />
                  </div>
                  <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, ((billing?.credits?.lifetime_spent ?? 0) / (budgetHard || 1)) * 100)}%`, height: '100%', borderRadius: 2, background: (billing?.credits?.lifetime_spent ?? 0) >= budgetHard ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.2)', transition: 'width 300ms ease' }} />
                  </div>
                </div>
                {(billing?.credits?.lifetime_spent ?? 0) >= budgetSoft && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.1)' }}>
                    <AlertTriangle size={9} style={{ color: 'rgba(245,158,11,0.65)' }} />
                    <span style={{ fontSize: 9, color: 'rgba(245,158,11,0.65)' }}>
                      {(billing?.credits?.lifetime_spent ?? 0) >= budgetHard ? 'Hard limit reached — usage blocked' : 'Soft limit reached — warning active'}
                    </span>
                  </div>
                )}
                {enhancedForecast && (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 6, marginTop: 2 }}>
                    <div style={{ fontSize: 9, color: C.textTertiary, marginBottom: 4 }}>FORECAST</div>
                    <KVRow label="Est. daily" value={<span style={{ fontSize: 10, color: C.textBody, fontVariantNumeric: 'tabular-nums' }}>{enhancedForecast.dailyForecast.toLocaleString()}</span>} />
                    <KVRow label="Next 7 days" value={<span style={{ fontSize: 10, color: C.textBody, fontVariantNumeric: 'tabular-nums' }}>{enhancedForecast.next7.toLocaleString()}</span>} />
                    <KVRow label="Next 30 days" value={<span style={{ fontSize: 10, color: C.textBody, fontVariantNumeric: 'tabular-nums' }}>{enhancedForecast.next30.toLocaleString()}</span>} />
                    <KVRow label="Days until empty" value={<span style={{ fontSize: 10, fontWeight: 600, color: (enhancedForecast.daysUntilEmpty < 7) ? C.error.text : C.textBody, fontVariantNumeric: 'tabular-nums' }}>{enhancedForecast.daysUntilEmpty === Infinity ? '∞' : enhancedForecast.daysUntilEmpty}</span>} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Usage by Project */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setProjectsOpen(o => !o)}>
              <span style={S.headingLabel}>Usage by Project</span>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: projectsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {projectsOpen && (
              <div style={{ ...S.panelBody, padding: 8, display: 'grid', gap: 4 }}>
                {DEV_PROJECTS.map(p => {
                  const totalProj = DEV_PROJECTS.reduce((s, x) => s + x.spent, 0) || 1;
                  return (
                    <div key={p.id} style={{ padding: '4px 6px', borderRadius: 3 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <FolderOpen size={10} style={{ color: C.textTertiary }} />
                          <span style={{ fontSize: 10, color: C.textBody }}>{p.name}</span>
                        </div>
                        <span style={{ fontSize: 10, color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{p.spent.toLocaleString()}</span>
                      </div>
                      <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${(p.spent / totalProj) * 100}%`, height: '100%', borderRadius: 2, background: 'rgba(255,255,255,0.2)' }} />
                      </div>
                      <div style={{ fontSize: 8, color: C.textDim, marginTop: 2 }}>
                        <Hash size={7} style={{ display: 'inline', verticalAlign: 'middle' }} /> {p.apiKey}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Billing Address / Tax ID */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setAddrOpen(o => !o)}>
              <span style={S.headingLabel}>Billing Details</span>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: addrOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {addrOpen && (
              <div style={{ ...S.panelBody, padding: 10, display: 'grid', gap: 8 }}>
                {(['company', 'address', 'taxId'] as const).map(field => (
                  <div key={field}>
                    <div style={{ fontSize: 9, color: C.textTertiary, textTransform: 'uppercase', marginBottom: 3 }}>
                      {field === 'taxId' ? 'Tax ID' : field}
                    </div>
                    <input
                      value={billingAddr[field]}
                      onChange={e => setBillingAddr(prev => ({ ...prev, [field]: e.target.value }))}
                      style={{ width: '100%', height: 24, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, color: C.textBody, fontSize: 10, padding: '0 6px', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                ))}
                <button style={{ ...ghostBtn(), width: '100%', justifyContent: 'center', height: 24, fontSize: 10 }} {...hover.ghost}>
                  <MapPin size={10} /> Save Billing Details
                </button>
              </div>
            )}
          </div>

          {/* Promo Code */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setPromoOpen(o => !o)}>
              <span style={S.headingLabel}>Promo Code</span>
              <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: promoOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>
            {promoOpen && (
              <div style={{ ...S.panelBody, padding: 10, display: 'grid', gap: 6 }}>
                {promoApplied ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.12)' }}>
                    <Tag size={10} style={{ color: 'rgba(34,197,94,0.7)' }} />
                    <span style={{ fontSize: 10, color: 'rgba(34,197,94,0.7)', flex: 1 }}>Code applied — 500 bonus credits!</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      value={promoCode} onChange={e => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="Enter code"
                      style={{ flex: 1, height: 24, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, color: C.textBody, fontSize: 10, padding: '0 6px', outline: 'none' }}
                    />
                    <button onClick={() => { if (promoCode.trim()) setPromoApplied(true); }} style={{ ...ghostBtn(), height: 24, fontSize: 10, borderRadius: 3 }} {...hover.ghost}>
                      Apply
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Audit Log */}
          <div style={S.panel}>
            <div style={{ ...S.panelHeading, cursor: 'pointer' }} onClick={() => setAuditOpen(o => !o)}>
              <span style={S.headingLabel}>Audit Log</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, color: C.textDim }}>{DEV_AUDIT.length}</span>
                <ChevronDown size={12} style={{ color: C.textTertiary, transition: 'transform 150ms ease', transform: auditOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </div>
            </div>
            {auditOpen && (
              <div style={{ ...S.panelBody, padding: 6, display: 'grid', gap: 2 }}>
                {DEV_AUDIT.map(entry => (
                  <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 4 }} {...hover.row}>
                    <Shield size={10} style={{ color: C.textTertiary, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: C.textBody, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.action}</div>
                      <div style={{ fontSize: 8, color: C.textDim }}>{entry.actor} · {formatDate(entry.timestamp)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Cancellation Flow Modal ═══ */}
      {cancelModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setCancelModal(false)}>
          <div style={{ background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 8, width: 360, padding: 20, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Cancel Subscription</span>
              <button onClick={() => setCancelModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textTertiary, padding: 0 }}><X size={14} /></button>
            </div>

            {cancelStep === 'reason' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <p style={{ fontSize: 11, color: C.textSecondary, margin: 0 }}>We're sorry to see you go. Help us improve by sharing why:</p>
                {['Too expensive', 'Not using it enough', 'Missing features', 'Switching to competitor', 'Other'].map(r => (
                  <button key={r} onClick={() => { setCancelReason(r); setCancelStep('offer'); }} style={{
                    ...ghostBtn(), width: '100%', justifyContent: 'flex-start', height: 32,
                    background: cancelReason === r ? C.surface3 : C.ghost,
                    border: cancelReason === r ? `1px solid ${C.borderStrong}` : '1px solid transparent',
                  }} {...hover.ghost}>{r}</button>
                ))}
              </div>
            )}

            {cancelStep === 'offer' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <p style={{ fontSize: 11, color: C.textSecondary, margin: 0 }}>Before you go, consider these options:</p>
                <div style={{ padding: '10px 12px', borderRadius: 6, background: C.surface3, border: `1px solid ${C.border}`, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Gift size={12} style={{ color: 'rgba(34,197,94,0.7)' }} />
                    <span style={{ fontSize: 11, color: C.textBody, fontWeight: 500 }}>Stay and get 50% off next month</span>
                  </div>
                  <button onClick={() => setCancelModal(false)} style={{ width: '100%', height: 28, border: 'none', borderRadius: 4, background: 'rgba(255,255,255,0.9)', color: '#09090b', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    Apply Discount & Stay
                  </button>
                </div>
                <div style={{ padding: '10px 12px', borderRadius: 6, background: C.surface3, border: `1px solid ${C.border}`, display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: C.textBody }}>Downgrade to Free instead?</span>
                  <button onClick={() => setCancelModal(false)} style={{ ...ghostBtn(), width: '100%', justifyContent: 'center' }} {...hover.ghost}>
                    Switch to Free Plan
                  </button>
                </div>
                <button onClick={() => setCancelStep('confirm')} style={{ fontSize: 10, color: C.error.text, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'center', padding: 4 }}>
                  No thanks, proceed with cancellation
                </button>
              </div>
            )}

            {cancelStep === 'confirm' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <p style={{ fontSize: 11, color: C.textSecondary, margin: 0 }}>Your subscription will end at the current billing period. You'll keep access until then.</p>
                <div style={{ padding: '8px 10px', borderRadius: 4, background: C.error.bg, border: `1px solid ${C.error.border}` }}>
                  <span style={{ fontSize: 10, color: C.error.text }}>⚠ This action cannot be undone automatically. You can re-subscribe anytime.</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setCancelModal(false)} style={{ ...ghostBtn(), flex: 1, justifyContent: 'center' }} {...hover.ghost}>Keep Subscription</button>
                  <button onClick={() => setCancelModal(false)} style={{ flex: 1, height: 28, border: 'none', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: C.error.text, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    Confirm Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sub-components ───

const KVRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span style={{ fontSize: 11, color: C.textSecondary }}>{label}</span>
    {value}
  </div>
);

export default BillingPage;
