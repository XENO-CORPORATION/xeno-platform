import React from 'react';
import { Check } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════
 * Onboarding building blocks.
 *
 * ── THE LAYOUT LESSON, WHICH IS THE WHOLE POINT ────────────────────────────
 *
 * The first version wrapped every step in a single big Card. That is what made
 * it read as cramped and boxy — a container around the content adds two
 * borders and a padding well between the user and the thing they are doing,
 * and it shrinks the usable width so everything inside gets tighter.
 *
 * The reference flow does the opposite: content sits DIRECTLY on the page in
 * one left-aligned column, centred in the viewport, with generous air around
 * it. The only cards are the CHOICES themselves. That inversion — no shell,
 * cards only where there is something to pick — is what makes it feel calm.
 *
 * So: no page card. One column, ~600px. Big headline, muted sub, real space
 * between groups, a compact button (not a full-width slab), text links for
 * Back/Skip, and progress pinned to the bottom of the viewport.
 *
 * ── COLOUR ────────────────────────────────────────────────────────────────
 *
 * The reference is light; XENO is dark, and the auth screen this flows out of
 * is #060606. Adopting their layout does not mean adopting their theme — so
 * this is the dark reading of the same structure. Emphasis comes from surface
 * lightness and border brightness, per DESIGN_SYSTEM.md, never hue.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/* ── Heading ─────────────────────────────────────────────────────────────── */

/**
 * Step headline + sub.
 *
 * Left-aligned, not centred: centred body copy is harder to scan because every
 * line starts in a different place, and each of these screens is followed by a
 * left-aligned form or grid the eye has to return to anyway.
 */
export const StepHeading: React.FC<{ title: string; sub?: string }> = ({ title, sub }) => (
  <div className="space-y-2">
    <h1 className="text-[30px] sm:text-[33px] font-semibold leading-[1.12] tracking-[-0.025em] text-white text-balance">
      {title}
    </h1>
    {sub && <p className="text-[14.5px] leading-relaxed text-white/40">{sub}</p>}
  </div>
);

/* ── SelectTile ──────────────────────────────────────────────────────────── */

/**
 * The choice card — roles, interests.
 *
 * Sized for presence: a real card with room around its label, not a compressed
 * row. Selection is a BRIGHT BORDER plus a lifted surface, mirroring the
 * reference's black-border-on-white, which is the highest-contrast selection
 * signal available without introducing colour.
 *
 * Right padding is reserved for the check so selecting never reflows the
 * label — a tile that resizes on click makes the whole grid twitch.
 */
export const SelectTile: React.FC<{
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  meta?: string;
  style?: React.CSSProperties;
}> = ({ selected, onClick, icon, label, meta, style }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    style={{
      /* A GRADIENT surface, not a flat rgba fill. This is the single biggest
         reason the first version read as "empty dark rectangles": a uniform
         fill has no light direction, so nothing tells the eye the shape is a
         surface rather than a hole. The homepage's cards are all gradients
         (see ProductsShowcase) for exactly this reason. */
      background: selected
        ? 'linear-gradient(180deg, rgba(255,255,255,0.085), rgba(255,255,255,0.03))'
        : 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))',
      /* Top hairline = lit from above; the drop shadow seats it on the page.
         Together they are what make a div read as a raised card. */
      boxShadow: selected
        ? 'inset 0 1px 0 0 rgba(255,255,255,0.16), 0 8px 24px -8px rgba(0,0,0,0.8)'
        : 'inset 0 1px 0 0 rgba(255,255,255,0.055), 0 4px 14px -8px rgba(0,0,0,0.7)',
      ...style,
    }}
    className={cx(
      'focus-self group relative flex min-h-[86px] w-full items-center gap-3.5 rounded-[12px] border',
      'px-4 pr-11 py-4 text-left',
      // The card LIFTS on hover. A colour-only hover state is why the grid felt
      // inert — nothing moved, so nothing felt touchable. `will-change` keeps
      // the lift on its own layer so it does not repaint the text under it.
      'transition-[border-color,transform,box-shadow] duration-200 ease-out will-change-transform',
      'hover:-translate-y-[3px] active:translate-y-0 active:scale-[0.985]',
      selected ? 'border-white/45' : 'border-white/[0.10] hover:border-white/[0.26]',
    )}
  >
    {icon && (
      /* Icon in a bordered CHIP rather than bare on the surface. A loose glyph
         floating next to text reads as clip-art; boxed, it reads as a control.
         Same treatment the homepage uses for its inline marks. */
      <span
        className={cx(
          'grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border transition-all duration-200',
          selected
            ? 'border-white/25 bg-white/[0.12] text-white'
            : 'border-white/[0.09] bg-white/[0.04] text-white/50 group-hover:border-white/20 group-hover:text-white/85',
        )}
      >
        {icon}
      </span>
    )}

    <span className="min-w-0 flex-1">
      <span
        className={cx(
          'block text-[14px] font-medium leading-snug transition-colors duration-200',
          selected ? 'text-white' : 'text-white/80 group-hover:text-white',
        )}
      >
        {label}
      </span>
      {meta && <span className="mt-1 block text-[11.5px] tabular-nums text-white/30">{meta}</span>}
    </span>

    {/* Scales in rather than appearing — a check that pops reads as a response
        to the click, which is the feedback a tile otherwise lacks. */}
    <span
      aria-hidden
      className={cx(
        'absolute right-3.5 top-1/2 grid h-[19px] w-[19px] -translate-y-1/2 place-items-center rounded-[5px] bg-white',
        'transition-all duration-200 ease-out',
        selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
      )}
    >
      <Check className="h-3 w-3 text-black" strokeWidth={3} />
    </span>
  </button>
);

/* ── PlanCard ────────────────────────────────────────────────────────────── */

/**
 * A pricing card with actual content.
 *
 * The first version was a label, a price and a dead button on a flat panel —
 * mostly empty space, which is why it looked unfinished. A pricing card's job
 * is to answer "what do I get", and that answer has to be ON the card.
 *
 * The features are DERIVED from the plan's real entitlement set (served by
 * /api/billing/config), not hand-written marketing bullets. A typed list is
 * how "Pro includes agents" outlives the code that made it true; deriving it
 * means the card and the gate cannot disagree.
 */
export const PlanCard: React.FC<{
  label: string;
  price: string;
  interval: string;
  features: string[];
  badge?: string;
  highlighted?: boolean;
  available: boolean;
  busy?: boolean;
  onSelect: () => void;
  style?: React.CSSProperties;
}> = ({ label, price, interval, features, badge, highlighted, available, busy, onSelect, style }) => (
  /* Shell + plates, same anatomy as the suite cards and per
     `XENO CHROME - CONSTRUCTION PLAYBOOK.md`: the shell carries page
     background and the plates float on it with a 2px gap. Header LIGHTER than
     body is deliberate — it is what makes the body read as a recessed well. */
  <div
    style={{
      background: '#08080a',
      boxShadow: highlighted
        ? '0 20px 48px -18px rgba(0,0,0,0.95)'
        : '0 10px 30px -16px rgba(0,0,0,0.85)',
      ...style,
    }}
    className={cx(
      'relative flex flex-col gap-[2px] rounded-[12px] border p-1.5 transition-colors duration-200',
      highlighted ? 'border-white/35' : 'border-white/[0.08] hover:border-white/20',
    )}
  >
    {badge && (
      /* Sits ON the shell's top edge rather than inside a plate, so it reads as
         a ribbon on the card instead of a first list item. */
      <span className="absolute -top-[9px] left-4 z-10 rounded-[5px] border border-white/25 bg-[#0e0e0e] px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white/85">
        {badge}
      </span>
    )}

    {/* ── Header plate ── */}
    <div
      className="flex shrink-0 items-baseline justify-between gap-2 rounded-t-[8px] px-4 py-3"
      style={{ background: highlighted ? '#242424' : '#1a1a1a' }}
    >
      <span className={cx('text-[14.5px] font-semibold', highlighted ? 'text-white' : 'text-white/85')}>
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-white">
          {price}
        </span>
        <span className="text-[11.5px] text-white/35">/{interval}</span>
      </span>
    </div>

    {/* ── Body plate ── */}
    <div className="flex flex-1 flex-col rounded-b-[8px] px-4 py-4" style={{ background: '#111111' }}>
      <ul className="flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <Check className="mt-[3px] h-[13px] w-[13px] shrink-0 text-white/55" strokeWidth={2.5} />
            <span className="text-[12.5px] leading-snug text-white/60">{f}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={!available || busy}
        onClick={onSelect}
        className={cx(
          'focus-self mt-5 w-full rounded-[8px] px-4 py-2.5 text-[13.5px] font-semibold',
          'transition-all duration-200 active:scale-[0.99]',
          'disabled:cursor-not-allowed disabled:opacity-25',
          highlighted
            ? 'bg-white text-black hover:bg-white/90'
            : 'border border-white/20 bg-transparent text-white hover:border-white/40 hover:bg-white/[0.06]',
        )}
      >
        {busy ? 'Opening checkout…' : available ? 'Select plan' : 'Not yet available'}
      </button>
    </div>
  </div>
);

/* ── Field ───────────────────────────────────────────────────────────────── */

/**
 * Label above an input, both full width.
 *
 * The label sits OUTSIDE the field rather than inside it as a placeholder:
 * a placeholder-as-label disappears the moment you type, so anyone who pauses
 * mid-form has to clear the field to remember what it wanted.
 */
export const Field: React.FC<{
  label: string; optional?: boolean; children: React.ReactNode; style?: React.CSSProperties;
}> = ({ label, optional, children, style }) => (
  <label className="block space-y-2" style={style}>
    <span className="block text-[13.5px] font-medium text-white/75">
      {label}
      {optional && <span className="font-normal text-white/25"> (optional)</span>}
    </span>
    {children}
  </label>
);

/** Shared input recipe. `focus-self` opts out of the global :focus-visible
 *  ring, which would otherwise draw a SECOND stroke 2px outside this border. */
export const INPUT_CLS =
  'focus-self w-full rounded-[9px] border border-white/[0.10] bg-white/[0.02] px-4 py-3 ' +
  'text-[14px] text-white placeholder:text-white/20 outline-none ' +
  'transition-colors duration-150 hover:border-white/20 focus:border-white/45 focus:bg-white/[0.04]';

/* ── Checkbox ────────────────────────────────────────────────────────────── */

/** Square, 4px radius — DESIGN_SYSTEM forbids circles and pills. */
export const Checkbox: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({
  checked, onChange,
}) => (
  <>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
    <span
      aria-hidden
      className={cx(
        'mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] border',
        'transition-all duration-200 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-white/30',
        checked ? 'border-white bg-white' : 'border-white/20 bg-transparent hover:border-white/40',
      )}
    >
      <Check
        className={cx('h-3 w-3 text-black transition-transform duration-200', checked ? 'scale-100' : 'scale-0')}
        strokeWidth={3}
      />
    </span>
  </>
);

/* ── Buttons ─────────────────────────────────────────────────────────────── */

/**
 * Primary action. COMPACT and left-aligned — deliberately not a full-width
 * slab. A button stretched across the column reads as the end of a checkout;
 * at its natural width it reads as one step in a flow, which is what this is.
 */
export const PrimaryButton: React.FC<{
  onClick: () => void; disabled?: boolean; children: React.ReactNode;
}> = ({ onClick, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="focus-self rounded-[9px] bg-white px-6 py-3 text-[14px] font-semibold text-black
               transition-all duration-200 hover:bg-white/90 active:scale-[0.98]
               disabled:cursor-not-allowed disabled:opacity-20"
  >
    {children}
  </button>
);

/** Back / Skip. Plain text — a skip styled to compete with the primary action
 *  is a dark pattern in reverse. */
export const TextButton: React.FC<{
  onClick: () => void; children: React.ReactNode; className?: string;
}> = ({ onClick, children, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    className={cx(
      'focus-self text-[13.5px] text-white/35 transition-colors hover:text-white/80',
      className,
    )}
  >
    {children}
  </button>
);

/* ── Progress ────────────────────────────────────────────────────────────── */

/**
 * Pinned to the bottom of the viewport, centred — out of the content's way,
 * exactly like the reference. The active step is a wide pill and the rest are
 * dots, so position is readable at a glance without counting.
 */
export const Progress: React.FC<{ step: number; total: number }> = ({ step, total }) => (
  <div
    className="flex items-center justify-center gap-[7px]"
    role="progressbar"
    aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={total}
    aria-label={`Step ${step + 1} of ${total}`}
  >
    {Array.from({ length: total }).map((_, i) => (
      <span
        key={i}
        className={cx(
          'h-[5px] rounded-full transition-all duration-500 ease-out',
          i === step ? 'w-8 bg-white/85' : 'w-[5px] bg-white/20',
        )}
      />
    ))}
  </div>
);
