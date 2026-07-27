import React from 'react';
import { ShieldAlert, FlaskConical } from 'lucide-react';
import { experimentalNotice, type Product } from '../../lib/productCatalog';

/* ──────────────────────────────────────────────────────────────────────
 * The EXPERIMENTAL / UNSIGNED treatment — designed once, rendered wherever a
 * download or install starts: the product page, the download page, and the
 * release feed.
 *
 * Copy is NOT authored here. It comes from experimentalNotice(product) in the
 * catalog, so a product cannot silently lose the notice and the whole thing
 * disappears the day `signing: 'signed'` is set. This file only decides how it
 * LOOKS at three densities.
 *
 * Design: monochromatic, per DESIGN_SYSTEM.md — "white at varying opacities is
 * the only accent". A warning-yellow band would fight the design system AND
 * misstate the message: unsigned is XENO's stated posture right now, not an
 * error condition. So this reads as a specification note — hairline border,
 * near-black surface, muted icon, uppercase micro-label in the same register as
 * every other section eyebrow on the page. Considered, not alarming.
 * ────────────────────────────────────────────────────────────────────── */

type Variant = 'band' | 'inline' | 'line';

const ExperimentalNotice: React.FC<{ product: Product; variant?: Variant; className?: string }> = ({
  product, variant = 'inline', className = '',
}) => {
  const notice = experimentalNotice(product);
  if (!notice) return null;

  const Icon = notice.smartScreen ? ShieldAlert : FlaskConical;

  /* Bare one-liner. Sits directly above a list of download links (release feed,
     release permalink) where a boxed band would be visual noise. */
  if (variant === 'line') {
    return (
      <p className={`flex items-start gap-2 text-[11.5px] leading-[1.55] text-[#69635b] ${className}`}>
        <Icon className="mt-[1px] h-3 w-3 shrink-0" strokeWidth={1.7} />
        <span><span className="text-[#948d83]">{notice.label}.</span> {notice.short}</span>
      </p>
    );
  }

  /* Slim strip for the hero / lean product page — one line, next to the CTA. */
  if (variant === 'inline') {
    return (
      <div className={`flex max-w-[560px] items-start gap-2.5 rounded-[8px] border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 ${className}`}>
        <Icon className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#827b71]" strokeWidth={1.7} />
        <p className="text-[12.5px] leading-[1.55] text-[#948d83]">
          <span className="font-medium text-[#cdc7be]">{notice.label}.</span>{' '}
          {notice.short}
        </p>
      </div>
    );
  }

  /* Full band — the download page, above the buttons. A caveat a visitor reads
     after downloading is not a caveat. */
  return (
    <div className={`rounded-[12px] border border-white/[0.09] bg-[#0b0b0b] p-[clamp(16px,1.6vw,22px)] ${className}`}>
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0 text-[#948d83]" strokeWidth={1.7} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#948d83]">{notice.label}</span>
      </div>
      <p className="mt-3 text-[13.5px] leading-[1.7] text-[#b3aca2]">{notice.detail}</p>
      {notice.steps && notice.steps.length > 0 && (
        <ol className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
          {notice.steps.map((s, i) => (
            <li key={s} className="flex items-start gap-3 text-[12.5px] leading-[1.6] text-[#827b71]">
              <span className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border border-white/[0.10] font-mono text-[10.5px] text-[#948d83]">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default ExperimentalNotice;
