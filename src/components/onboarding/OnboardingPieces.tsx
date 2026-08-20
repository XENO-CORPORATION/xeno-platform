import React from 'react';
import { Check, Lock } from 'lucide-react';

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
  /** What this tier does NOT grant. Free's whole argument lives here. */
  locked?: string[];
  /** Small line under the price — "per seat", "you are on this now". */
  note?: string;
  badge?: string;
  highlighted?: boolean;
  /** The plan the account already has. Shows its state instead of a button. */
  current?: boolean;
  available?: boolean;
  busy?: boolean;
  onSelect?: () => void;
  style?: React.CSSProperties;
}> = ({
  label, price, interval, features, locked = [], note, badge,
  highlighted, current, available, busy, onSelect, style,
}) => (
  /* Shell + THREE plates, per `XENO CHROME - CONSTRUCTION PLAYBOOK.md`: the
     shell carries page background and the plates float on it with 2px gaps.
     Header LIGHTER than body is what makes the body read as a recessed well,
     and the action gets its own plate rather than sitting loose at the bottom
     of the body — a footer plate is what stops the card reading as a flat box
     with a button drawn on it. */
  <div
    style={{
      background: '#08080a',
      boxShadow: highlighted
        ? '0 24px 56px -18px rgba(0,0,0,0.95)'
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

    {/* ── Header plate — the name and the number being decided on ── */}
    <div
      className="flex shrink-0 flex-col gap-1.5 rounded-t-[8px] px-4 py-3.5"
      style={{ background: highlighted ? '#242424' : '#1a1a1a' }}
    >
      <span className={cx('text-[13px] font-semibold uppercase tracking-[0.10em]',
                          highlighted ? 'text-white/90' : 'text-white/45')}>
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={cx('text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums',
                            highlighted ? 'text-white' : 'text-white/80')}>
          {price}
        </span>
        {interval && <span className="text-[12px] text-white/35">/{interval}</span>}
      </span>
      {/* Reserved whether or not it is filled, so three cards in a row keep
          their plate heights aligned — a header that grows on one card alone
          drags its body out of line with the others. */}
      <span className="min-h-[15px] text-[11.5px] leading-tight text-white/35">{note}</span>
    </div>

    {/* ── Body plate — what you get, then what you do not ── */}
    <div className="flex flex-1 flex-col rounded-b-[8px] px-4 py-4" style={{ background: '#111111' }}>
      {features.length > 0 && (
        <ul className="space-y-2.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2.5">
              <Check className="mt-[3px] h-[13px] w-[13px] shrink-0 text-white/55" strokeWidth={2.5} />
              <span className="text-[12.5px] leading-snug text-white/60">{f}</span>
            </li>
          ))}
        </ul>
      )}

      {locked.length > 0 && (
        /* THE reason this step exists.
         *
         * A pricing card normally lists only what a tier grants, and for a
         * paid tier that is right. For the tier somebody is already on, it
         * says nothing at all — free's granted list is genuinely empty, so a
         * grants-only card would be a blank box next to two full ones, which
         * reads as "free is fine" rather than "free cannot run anything".
         *
         * Shown dimmed with a lock rather than struck through: struck text
         * reads as something taken away, and nothing has been taken away —
         * it was never included. */
        <>
          {features.length > 0 && <div className="my-3.5 h-px bg-white/[0.06]" />}
          <p className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/25">
            Locked on this plan
          </p>
          <ul className="space-y-2.5">
            {locked.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <Lock className="mt-[2px] h-[12px] w-[12px] shrink-0 text-white/20" strokeWidth={2.2} />
                <span className="text-[12.5px] leading-snug text-white/28">{f}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>

    {/* ── Footer plate — the action, or the state ── */}
    <div className="shrink-0 rounded-b-[8px] p-1.5" style={{ background: '#141414' }}>
      {current ? (
        /* No button. "Stay on Free" would be a second control doing exactly
           what Continue already does, two tab stops apart — and a button is a
           promise that something happens. Nothing happens: this is the plan
           the account is already on. */
        <p className="py-2 text-center text-[12px] font-medium text-white/40">
          Your plan right now
        </p>
      ) : (
        <button
          type="button"
          data-roving="action"
          disabled={!available || busy}
          onClick={onSelect}
          className={cx(
            'w-full rounded-[7px] px-4 py-2.5 text-[13.5px] font-semibold',
            'transition-all duration-200 active:scale-[0.99]',
            'disabled:cursor-not-allowed disabled:opacity-25',
            highlighted
              ? 'bg-white text-black hover:bg-white/90'
              : 'border border-white/20 bg-transparent text-white hover:border-white/40 hover:bg-white/[0.06]',
          )}
        >
          {busy ? 'Opening checkout…' : available ? `Choose ${label}` : 'Not yet available'}
        </button>
      )}
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
    /* Joins the step's arrow navigation. Continue is a place people want to
       ARRIVE at, not only a thing to press: someone who has just chosen their
       cards with the keyboard should be able to keep going with the keyboard,
       rather than being told the one remaining control needs a Tab. */
    data-roving="action"
    onClick={onClick}
    disabled={disabled}
    /* 🔴 `focus-self` was here and had to go. That class opts OUT of the global
       focus ring, and its own rule says to use it ONLY on something that paints
       its own focus state — this paints hover and nothing else. So keyboard
       focus on the primary action of the entire flow was INVISIBLE. It went
       unnoticed while Continue was reachable only by Tab; it is unmissable now
       that arrows land here. */
    className="rounded-[9px] bg-white px-6 py-3 text-[14px] font-semibold text-black
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
    data-roving="action"
    onClick={onClick}
    className={cx(
      // No `focus-self` — see PrimaryButton. Quiet does not mean invisible:
      // Back is the only way out of a step for a keyboard user.
      'text-[13.5px] text-white/35 transition-colors hover:text-white/80',
      className,
    )}
  >
    {children}
  </button>
);

/* ── Flow controls ───────────────────────────────────────────────────────── */

/**
 * The footer bar: where you are, and what the keys do.
 *
 * ── ONE OBJECT, NOT TWO STACKED ROWS ───────────────────────────────────────
 *
 * Progress and the key legend were two loose rows floating on the page ground.
 * Both are chrome ABOUT the flow rather than part of it, and leaving them
 * unhoused made them read as content that had lost its container — which on a
 * screen where everything else is a card is precisely how a thing looks
 * unfinished.
 *
 * Housed together they become one status bar, and the relationship is stated:
 * position on the left, controls on the right, one hairline between them.
 *
 * ── SAME ANATOMY AS EVERY OTHER SURFACE HERE ───────────────────────────────
 *
 * Shell of page background carrying a plate, per
 * `XENO CHROME - CONSTRUCTION PLAYBOOK.md` — the same construction as the
 * suite, role and plan cards. A footer built to a different standard is the
 * two-standards problem this flow has already had twice.
 *
 * `inline-flex` so the bar is only as wide as its contents. Stretched across
 * the viewport it would read as a toolbar the flow is docked inside, which
 * claims far more importance than "you are on step 2 of 4".
 */
export const FlowControls: React.FC<{
  step: number;
  total: number;
  keys: Array<{ key: string; label: string }>;
}> = ({ step, total, keys }) => (
  <div className="flex justify-center">
    <div
      className="inline-flex rounded-[10px] border border-white/[0.07] p-1.5"
      style={{ background: '#08080a' }}
    >
      <div
        className="flex items-center gap-3 rounded-[7px] px-3 py-2"
        style={{ background: '#111111' }}
      >
        {/* Position. Rectangles with a 2px radius — DESIGN_SYSTEM forbids pills
            and circles, and `rounded-full` on a 5px bar is a pill. */}
        <div
          className="flex items-center gap-[5px]"
          role="progressbar"
          aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={total}
          aria-label={`Step ${step + 1} of ${total}`}
        >
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cx(
                'h-[5px] rounded-[2px] transition-all duration-500 ease-out',
                i === step ? 'w-7 bg-white/80' : i < step ? 'w-[10px] bg-white/30' : 'w-[10px] bg-white/[0.10]',
              )}
            />
          ))}
        </div>

        {keys.length > 0 && (
          <>
            {/* A hairline, not a gap. The two halves say different kinds of
                thing — where you are, and what you can press — and a divider
                is what stops the keys reading as a continuation of the bars. */}
            <span aria-hidden className="h-4 w-px shrink-0 bg-white/[0.09]" />

            <div className="flex items-center gap-3">
              {keys.map(({ key, label }) => (
                <span key={label} className="flex items-center gap-1.5">
                  <kbd
                    className="grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border
                               border-white/[0.10] px-1.5 font-sans text-[10px] leading-none text-white/60"
                    style={{ background: '#1a1a1a' }}
                  >
                    {key}
                  </kbd>
                  <span className="text-[10.5px] leading-none text-white/30">{label}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  </div>
);
