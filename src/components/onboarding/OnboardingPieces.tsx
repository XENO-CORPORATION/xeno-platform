import React from 'react';
import { Check } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════
 * Onboarding building blocks.
 *
 * The vocabulary is lifted from landing-v3/primitives + ProductsShowcase — the
 * homepage's own language — so onboarding looks like the site a user just came
 * from rather than a form bolted onto it: a floating CARD on the page ground,
 * an INSET panel inside it, hairline borders at white/[0.07], 6–8px radii.
 *
 * ⚠️ Structure is borrowed; HUE is not. landing-v3 leans on a violet accent
 * (#a760ff) that `DESIGN_SYSTEM.md` retired — and that file is the locked
 * authority, so where the homepage and the design system disagree the document
 * wins and the homepage is the deviation. Emphasis here therefore comes from
 * surface lightness and text brightness, never colour, which also keeps this
 * screen consistent with the auth surface that leads directly into it.
 *
 * The one exception is semantic, not decorative: a satisfied requirement goes
 * green, because "this rule now passes" is meaning rather than styling — and
 * it is carried by the ICON as well, so it never depends on colour alone.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Page ground → card → inset. Matching landing-v3's T tokens exactly. */
export const SURFACE = {
  page: '#060606',
  card: '#111111',
  inset: '#0b0b0b',
  border: 'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.18)',
} as const;

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/* ── Card ────────────────────────────────────────────────────────────────── */

/**
 * The floating container every step lives in.
 *
 * Not a flat bordered box: it carries a top hairline highlight, which is what
 * makes a surface read as lit from above and therefore as raised. That single
 * inset shadow is the difference between "a div with a border" and a card.
 */
export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className = '',
}) => (
  <div
    className={cx('relative rounded-[10px] border overflow-hidden', className)}
    style={{
      background: SURFACE.card,
      borderColor: SURFACE.border,
      boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.045), 0 24px 60px -20px rgba(0,0,0,0.9)',
    }}
  >
    {children}
  </div>
);

/** A recessed panel inside a card — where inputs and lists sit. */
export const Inset: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className = '',
}) => (
  <div
    className={cx('rounded-[7px] border', className)}
    style={{ background: SURFACE.inset, borderColor: SURFACE.border }}
  >
    {children}
  </div>
);

/* ── Eyebrow ─────────────────────────────────────────────────────────────── */

/** Uppercase micro-label. Same treatment as the landing sections' eyebrows. */
export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
    {children}
  </span>
);

/* ── SelectTile ──────────────────────────────────────────────────────────── */

/**
 * The choice tile used for roles and interests.
 *
 * Selection is shown THREE ways — brighter surface, brighter border, and a
 * check mark — because a border shift alone is easy to miss against a dark
 * ground, and on a multi-select the user needs to scan which ones are on.
 *
 * The check is absolutely positioned and the tile reserves right padding for
 * it, so selecting never reflows the label. A tile that resizes on click makes
 * a grid twitch every time you choose.
 */
export const SelectTile: React.FC<{
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  meta?: string;
  style?: React.CSSProperties;
  className?: string;
}> = ({ selected, onClick, icon, label, meta, style, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    style={style}
    className={cx(
      'focus-self group relative flex items-center gap-3 rounded-[7px] border pl-3.5 pr-9 py-3 text-left',
      'transition-[background-color,border-color,transform] duration-200 ease-out',
      'active:scale-[0.985]',
      selected
        ? 'border-white/25 bg-white/[0.07]'
        : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]',
      className,
    )}
  >
    {icon && (
      <span
        className={cx(
          'grid h-8 w-8 shrink-0 place-items-center rounded-[5px] border transition-colors duration-200',
          selected
            ? 'border-white/20 bg-white/[0.10] text-white'
            : 'border-white/[0.07] bg-white/[0.03] text-white/45 group-hover:text-white/70',
        )}
      >
        {icon}
      </span>
    )}

    <span className="min-w-0 flex-1">
      <span
        className={cx(
          'block truncate text-[13px] transition-colors duration-200',
          selected ? 'text-white' : 'text-white/70 group-hover:text-white/90',
        )}
      >
        {label}
      </span>
      {meta && (
        <span className="mt-0.5 block text-[11px] tabular-nums text-white/30">{meta}</span>
      )}
    </span>

    {/* Scales in rather than appearing — a check that pops is legible as a
        response to the click, which is the feedback a tile otherwise lacks. */}
    <span
      aria-hidden
      className={cx(
        'absolute right-3 grid h-4 w-4 place-items-center rounded-[3px] bg-white',
        'transition-all duration-200 ease-out',
        selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
      )}
    >
      <Check className="h-3 w-3 text-black" strokeWidth={3} />
    </span>
  </button>
);

/* ── Progress ────────────────────────────────────────────────────────────── */

/**
 * Step progress. A track with a filling bar, not disconnected dots.
 *
 * Dots say "5 things exist"; a continuous bar says "you are 3/5 through and it
 * ends" — which is the question somebody halfway through a signup is actually
 * asking. Steps already completed stay marked so going back is legible.
 */
export const Progress: React.FC<{ step: number; total: number }> = ({ step, total }) => (
  <div className="flex items-center gap-1.5" role="progressbar"
       aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={total}
       aria-label={`Step ${step + 1} of ${total}`}>
    {Array.from({ length: total }).map((_, i) => (
      <span
        key={i}
        className={cx(
          'h-[3px] rounded-full transition-all duration-500 ease-out',
          i === step ? 'w-7 bg-white/75' : i < step ? 'w-3 bg-white/35' : 'w-3 bg-white/[0.10]',
        )}
      />
    ))}
  </div>
);
