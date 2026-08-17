import React, { useCallback, useRef, useState } from 'react';
import { Palette, FileText, Terminal, MessageSquare, Check, Sparkles } from 'lucide-react';
import {
  SUITES, EVERYTHING_ID, productsForSuite, availableForSuite, allAvailableProducts, type Suite,
} from '../../lib/workspaceSuites';
import SuiteVisual from './SuiteVisual';
import { productIcon } from '../../lib/productIcons';
import { isUnreleased } from '../../lib/releaseStatus';

/* ═══════════════════════════════════════════════════════════════════════════
 * WORKSPACE CHOOSER — the first and most consequential step.
 *
 * This is not a survey question. The answer decides how the platform lays
 * itself out for this person, so the screen has to feel like it matters: four
 * suites side by side, each showing the real products inside it, and one way
 * to refuse the choice entirely and take the whole ecosystem.
 *
 * ── THE FRAME ──────────────────────────────────────────────────────────────
 *
 * "Everything" is not a fifth tile, and it is NOT a replacement panel — an
 * earlier version swapped the four cards for a single summary card, which made
 * choosing everything feel like losing the grid rather than gaining it.
 *
 * Instead a stroke frame grows out of the bar and closes BEHIND the cards
 * until it encloses all four. The cards never move. Then the checks fall into
 * place one by one, left to right, and the bar's own tick lands last — it is
 * the summary, so it arrives after the thing it summarises.
 *
 * `prefers-reduced-motion` goes straight to the framed state. The choice is
 * what matters; the animation is how it feels, and someone who asked the OS to
 * stop moving things still has to be able to make it.
 * ═══════════════════════════════════════════════════════════════════════════ */

const SUITE_ICON: Record<string, React.ReactNode> = {
  creative:  <Palette className="h-[18px] w-[18px]" />,
  office:    <FileText className="h-[18px] w-[18px]" />,
  developer: <Terminal className="h-[18px] w-[18px]" />,
  connect:   <MessageSquare className="h-[18px] w-[18px]" />,
};

type Phase = 'idle' | 'framing' | 'framed';

const FRAME_MS = 720;

export const WorkspaceChooser: React.FC<{
  value: string | null;
  onChange: (id: string) => void;
}> = ({ value, onChange }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLButtonElement | null>(null);
  const [phase, setPhase] = useState<Phase>(value === EVERYTHING_ID ? 'framed' : 'idle');
  const [frameVars, setFrameVars] = useState<React.CSSProperties | null>(null);

  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /**
   * The frame DRAWS ITSELF around the cards, starting at the bar.
   *
   * A hairline appears at the centre of the bar, runs out to both edges, then
   * climbs the sides and closes across the top. The shape of the motion is the
   * meaning: the enclosure completing around the four cards.
   *
   * -- WHY clip-path AND NOT A SCALE TRANSFORM ------------------------------
   *
   * The earlier version inverse-scaled a full-size frame onto the bar's box
   * and released it. That was wrong for a frame, and I had the reason
   * backwards in the code that shipped it: a transform scales the ENTIRE
   * rendered output. Borders scale. Inset box-shadows scale. So the stroke
   * started as a hairline and visibly thickened as it grew -- a frame whose
   * line changes weight mid-animation.
   *
   * Clipping reveals a frame that is already full-size and correctly stroked,
   * so the line holds ONE weight from first frame to last. It also gives
   * per-side control, which a single transform cannot: left/right and top are
   * independent insets, so they can be sequenced into two beats.
   *
   * -- WHAT IS MEASURED, AND WHY ---------------------------------------------
   *
   * Only the bar's vertical band, expressed as percentages of the frame's own
   * box. The bar's position depends on the grid's height, the column count and
   * the viewport, so a hardcoded start is correct at one breakpoint and wrong
   * everywhere else. The horizontal start is a constant 50%/50% -- dead centre
   * -- because that is where the expansion should originate regardless of
   * anything.
   */
  const expandFrame = useCallback(() => {
    if (phase !== 'idle') return;

    const wrap = wrapRef.current;
    const bar = barRef.current;
    if (reduced || !wrap || !bar) { setPhase('framed'); onChange(EVERYTHING_ID); return; }

    // Measure BEFORE mutating anything: reading a box after a style change that
    // triggers layout returns post-change geometry.
    const w = wrap.getBoundingClientRect();
    const b = bar.getBoundingClientRect();

    // The frame element is -inset-3, so its box is 12px larger on every side
    // than the wrapper. The clip percentages must be relative to THAT box, not
    // the wrapper, or the start band sits 12px off the bar.
    const INSET = 12;
    const frameH = w.height + INSET * 2;
    const barTop = (b.top - w.top) + INSET;
    const barBottom = (b.bottom - w.top) + INSET;

    setFrameVars({
      '--f-top': `${((barTop / frameH) * 100).toFixed(3)}%`,
      '--f-bottom': `${(((frameH - barBottom) / frameH) * 100).toFixed(3)}%`,
    } as React.CSSProperties);
    setPhase('framing');

    window.setTimeout(() => { setPhase('framed'); onChange(EVERYTHING_ID); }, FRAME_MS + 40);
  }, [phase, reduced, onChange]);

  /** Picking one suite retracts the frame — the two answers are exclusive. */
  const collapseFrame = useCallback(() => {
    setPhase('idle');
    setFrameVars(null);
  }, []);

  /* -- The choice -------------------------------------------------------- */
  const framed = phase === 'framed' || phase === 'framing';

  return (
    <div ref={wrapRef} className="relative">
      {/* THE FRAME. Behind everything (z-0, cards are z-10) and outside the
          content box (-inset-3), so it reads as enclosing the grid rather than
          as another card in it. Pointer-events off: it is a statement, not a
          control — the bar underneath stays clickable through it. */}
      {frameVars && (
        <div
          aria-hidden
          style={{
            ...frameVars,
            boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.42), 0 24px 60px -30px rgba(0,0,0,0.9)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.008))',
          }}
          className="xeno-frame-draw pointer-events-none absolute -inset-3 z-0 rounded-[18px]"
        />
      )}

      <div
        ref={gridRef}
        className="relative z-10 grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {SUITES.map((suite, i) => (
          <SuiteCard
            key={suite.id}
            suite={suite}
            index={i}
            // Inside the frame every suite is included, so they all read as
            // chosen — the frame is the selection, not four separate ones.
            selected={framed || value === suite.id}
            // Cascade only when the frame made the selection, and only once
            // the frame has CLOSED (86% — the top edge completes at 100%).
            // Starting earlier put the first tick on screen while the top was
            // still drawing, so it landed into an enclosure that did not exist
            // yet, which reads as two animations rather than a consequence.
            checkDelay={framed ? FRAME_MS * 0.86 + i * 95 : 0}
            onSelect={() => { collapseFrame(); onChange(suite.id); }}
          />
        ))}
      </div>

      <button
        ref={barRef}
        type="button"
        onClick={expandFrame}
        disabled={phase !== 'idle'}
        style={{ animation: 'xenoRise 0.5s cubic-bezier(0.22,1,0.36,1) forwards', animationDelay: '0.34s', opacity: 0 }}
        className={`focus-self group relative z-10 mt-3 flex w-full items-center gap-3.5 overflow-hidden
                    rounded-[12px] border px-5 py-4 text-left transition-all duration-200 ease-out
                    will-change-transform disabled:cursor-default
                    ${framed
                      ? 'border-white/40 bg-white/[0.06]'
                      : 'border-white/[0.14] hover:-translate-y-[3px] hover:border-white/35 active:translate-y-0 active:scale-[0.995]'}`}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: 'radial-gradient(ellipse 60% 140% at 50% 50%, rgba(255,255,255,0.07), transparent 70%)' }}
        />
        <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border transition-colors duration-200
                          ${framed ? 'border-white/30 bg-white/[0.14]' : 'border-white/20 bg-white/[0.07]'}`}>
          {framed ? (
            /* The bar's own tick lands LAST, after all four cards — it is the
               summary of what just happened, so it should arrive after the
               thing it summarises. */
            <Check
              style={{ animationDelay: `${FRAME_MS * 0.86 + SUITES.length * 95}ms` }}
              className="xeno-check-drop h-[18px] w-[18px] text-white"
              strokeWidth={2.5}
            />
          ) : (
            <Sparkles className="h-[18px] w-[18px] text-white/85" />
          )}
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-white">
            {framed ? 'The full XENO workspace' : 'Or take the full XENO experience'}
          </span>
          <span className="mt-0.5 block text-[12.5px] text-white/40">
            {framed
              ? 'All four suites, together. Pick a single card to narrow it.'
              : 'Every suite in one workspace \u2014 you can narrow it later.'}
          </span>
        </span>
        <span className="relative shrink-0 text-[12px] tabular-nums text-white/30">
          {allAvailableProducts().length} products
        </span>
      </button>
    </div>
  );
};

/* ── SuiteCard ───────────────────────────────────────────────────────────── */

const SuiteCard: React.FC<{
  suite: Suite;
  index: number;
  selected: boolean;
  /** ms before this card's check lands. Non-zero only when the FRAME selected
   *  everything, so the four ticks cascade instead of appearing as one block.
   *  A direct click stays at 0 — feedback for your own click must be immediate
   *  or it reads as lag. */
  checkDelay?: number;
  onSelect: () => void;
}> = ({ suite, index, selected, checkDelay = 0, onSelect }) => {
  const products = productsForSuite(suite);

  /* ── SHELL / PLATE ANATOMY ────────────────────────────────────────────────
   *
   * Straight out of `XENO CHROME - CONSTRUCTION PLAYBOOK.md`, which is the
   * callable authority for this and says it in one line: a surface is not a
   * flat card, it is a SHELL OF PAGE BACKGROUND carrying separate plates with
   * a 2px gap letting the page colour show between them.
   *
   *   shell   #08080a  (darkest — it is the page showing through)
   *   header  #1a1a1a  (lightest plate)
   *   body    #111111  (mid)
   *
   * The header being LIGHTER than the body is the part that looks wrong
   * written down and correct on screen — it is what makes the body read as a
   * recessed well rather than a panel sitting on top of a bar.
   *
   * ⚠️ A single surface with `border-bottom` dividers does NOT produce this.
   * The playbook calls that out specifically; the gap is the whole effect, and
   * a divider is a line where this needs a seam.
   * ───────────────────────────────────────────────────────────────────────── */
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        background: '#08080a',
        boxShadow: selected
          ? '0 20px 46px -18px rgba(0,0,0,0.92)'
          : '0 10px 30px -16px rgba(0,0,0,0.8)',
        animation: 'xenoRise 0.6s cubic-bezier(0.16,1.02,0.3,1) forwards',
        animationDelay: `${0.06 + index * 0.07}s`,
        opacity: 0,
      }}
      /* A portrait MINIMUM, not a fixed height. 500px (a true 9:16 at this
         width) was too much — the tallest card already reaches ~430px on its
         own, so the floor was adding empty plate rather than proportion. 420px
         evens the row up without inventing space nothing fills.
         Content still decides the real height: Developer carries 8 products
         and Office 4, and `items-stretch` matches all four to the tallest, so
         a hard height would either clip the fullest or strand the emptiest.
         Only at `lg`, where the row is genuinely four across. */
      className={`focus-self group relative flex flex-col gap-[2px] rounded-[10px] border p-1.5 text-left
                  lg:min-h-[420px]
                  transition-[border-color,transform,box-shadow] duration-200 ease-out will-change-transform
                  hover:-translate-y-[5px] active:translate-y-0
                  ${selected ? 'border-white/40' : 'border-white/[0.07] hover:border-white/[0.22]'}`}
    >
      {/* ── Header plate ── */}
      <span
        className="flex shrink-0 items-center gap-2 rounded-t-[7px] px-3 py-2.5 transition-colors duration-200"
        style={{ background: selected ? '#242424' : '#1a1a1a' }}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold leading-tight text-white">
            {suite.name}
          </span>
        </span>
        {/* Selection replaces the count rather than sitting beside it — two
            pieces of metadata in a header this small compete, and once chosen
            the count is no longer the thing you need to know. */}
        {selected ? (
          /* Rendered CONDITIONALLY on purpose. Toggling classes on a
             permanently-mounted element replays nothing — a CSS animation runs
             once, on mount. Mounting the check when it becomes selected is
             what makes it drop each time rather than only on first paint. */
          <span
            aria-hidden
            style={{ animationDelay: `${checkDelay}ms` }}
            className="xeno-check-drop grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[4px] bg-white"
          >
            <Check className="h-3 w-3 text-black" strokeWidth={3} />
          </span>
        ) : (
          /* The LIVE count, not the row count. The card lists unshipped
             products so the workspace's real scope is visible, but a header
             number is read as "things I get", and counting four unreleased
             apps into that is the kind of overstatement people notice on
             day two. */
          <span className="shrink-0 text-[10.5px] tabular-nums text-white/30">
            {availableForSuite(suite).length}
          </span>
        )}
      </span>

      {/* ── Body plate ── */}
      <span
        className="flex flex-1 flex-col rounded-b-[7px] p-3"
        style={{ background: '#111111' }}
      >
        <SuiteVisual suiteId={suite.id} />

        <span className="mt-2.5 block text-[11.5px] leading-snug text-white/35">
          {suite.tagline}
        </span>

        {/* mt-auto: with the card now taller than its content, the product
            grid sits on the FLOOR of the plate instead of floating in the
            middle with dead space under it. */}
        <span className="mt-auto pt-4 block text-[9.5px] font-semibold uppercase tracking-[0.13em] text-white/25">
          Includes
        </span>
        <span className="mt-2 grid grid-cols-2 gap-x-2 gap-y-[7px]">
          {products.map((p) => (
            <span key={p.slug} className="flex min-w-0 items-center gap-1.5">
              <span className={`shrink-0 transition-colors duration-200 ${
                isUnreleased(p.slug, p.status) ? 'text-white/15' : 'text-white/35 group-hover:text-white/60'
              }`}>
                {productIcon(p.slug)}
              </span>
              {/* The catalog prefixes every name with "XENO"; inside a XENO
                  workspace card that word is on every line and carries nothing. */}
              <span className={`truncate text-[11.5px] ${
                isUnreleased(p.slug, p.status) ? 'text-white/25' : 'text-white/65'
              }`}>
                {p.name.replace(/^XENO\s+/, '')}
              </span>
              {/* Dimming alone is not a label — it could read as disabled, or
                  as a rendering fault. The word says which. */}
              {isUnreleased(p.slug, p.status) && (
                <span className="shrink-0 text-[8.5px] font-semibold uppercase tracking-[0.1em] text-white/20">
                  Soon
                </span>
              )}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
};

export default WorkspaceChooser;
