import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { getBillingSummary, type BillingSummary } from '../../services/billingService';

const ACCENT = '#a760ff';

interface UpgradePromptProps {
  /** Where it's shown, for the copy. */
  context?: 'watermark' | 'resolution' | 'credits' | 'commercial' | 'general';
  /** Compact inline variant (e.g. under a generated image) vs. full banner. */
  variant?: 'banner' | 'inline';
  className?: string;
  dismissible?: boolean;
}

const COPY: Record<string, { title: string; sub: string }> = {
  watermark: { title: 'Remove the watermark', sub: 'Pro unlocks watermark-free exports, 4K, and a commercial license.' },
  resolution: { title: 'Unlock 4K resolution', sub: "You're on standard resolution. Pro generates up to 4K." },
  credits: { title: 'Running low on credits', sub: 'Upgrade to Pro or top up — Pro includes unlimited in-house generation.' },
  commercial: { title: 'Use your work commercially', sub: 'Free outputs are personal-use only. Pro adds a commercial license.' },
  general: { title: 'Upgrade to Pro', sub: 'Watermark-free · 4K · commercial license · priority — €24/mo.' },
};

/**
 * Free→Pro upgrade nudge. Renders ONLY for Free-plan users (self-resolves the plan),
 * so it can be dropped anywhere without gating logic at the call site. Links to the
 * central billing page.
 */
const UpgradePrompt: React.FC<UpgradePromptProps> = ({ context = 'general', variant = 'banner', className = '', dismissible = true }) => {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { getBillingSummary().then(setSummary).catch(() => {}); }, []);

  // Only Free users see the nudge (Pro/Team already have everything).
  if (dismissed || !summary || (summary.plan && summary.plan !== 'free')) return null;

  const c = COPY[context] || COPY.general;
  const goToBilling = () => { window.location.href = '/overview/billing'; };

  if (variant === 'inline') {
    return (
      <button
        onClick={goToBilling}
        className={`inline-flex items-center gap-1.5 text-[12px] font-medium rounded-full px-2.5 py-1 transition-colors ${className}`}
        style={{ color: ACCENT, background: 'rgba(167,96,255,0.12)' }}
      >
        <Sparkles className="w-3 h-3" /> {c.title} — go Pro
      </button>
    );
  }

  return (
    <div className={`relative flex items-center gap-3 rounded-xl border px-4 py-3 ${className}`}
      style={{ borderColor: 'rgba(167,96,255,0.3)', background: 'rgba(167,96,255,0.08)' }}>
      <div className="grid place-items-center w-9 h-9 rounded-lg shrink-0" style={{ background: 'rgba(167,96,255,0.15)' }}>
        <Sparkles className="w-4.5 h-4.5" style={{ color: ACCENT }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white">{c.title}</div>
        <div className="text-[13px] text-white/55 truncate">{c.sub}</div>
      </div>
      <button onClick={goToBilling}
        className="shrink-0 rounded-lg text-black font-semibold text-[13px] px-3.5 py-2 transition-transform hover:scale-[1.03]"
        style={{ background: ACCENT }}>
        Upgrade
      </button>
      {dismissible && (
        <button onClick={() => setDismissed(true)} className="shrink-0 text-white/30 hover:text-white/60 transition-colors" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

export default UpgradePrompt;
