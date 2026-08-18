import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Palette, FileText, Terminal, MessageSquare, Check } from 'lucide-react';
import {
  SUITES, EVERYTHING_ID, productsForSuite, availableForSuite, allAvailableProducts,
  parseWorkspace, serializeWorkspace, isEverything, type Suite,
} from '../../lib/workspaceSuites';
import SuiteVisual from './SuiteVisual';
import EdgeParticles from './EdgeParticles';
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

type Phase = 'idle' | 'framing' | 'framed' | 'unframing';

/* The selected state, settled after comparing three treatments live.
 *
 * `lift` (#242424 plates, bright surfaces) washed the screen out: with all
 * four suites chosen at once, four cards brightening together stops the page
 * reading as black. `edge` (surfaces untouched, border only) held the black
 * but made selection almost invisible on a single card.
 *
 * This is between them. The plate lifts just enough to register as a state
 * change on one card, and stays dark enough that four of them together do not
 * become the brightest thing on screen. Brightness is the scarcest signal on
 * a dark UI; most of the work is done by the BORDER, which costs none of it.
 */
const SELECTED = {
  headerBg: '#1f1f1f',
  barBg: 'rgba(255,255,255,0.028)',
  border: 'rgba(255,255,255,0.50)',
  shadow: '0 16px 38px -18px rgba(0,0,0,0.9)',
};

/**
 * The distance between the grid and the bar, in px.
 *
 * 🔴 This single number creates the gap AND sizes the connector that spans it.
 * It used to be two independent values — `mt-3` on the bar and a `0.75rem`
 * height on the line — that merely happened to agree. Nothing enforced that,
 * so changing the spacing at any breakpoint would have left the connector
 * short of the bar or buried in it, silently, with no error anywhere.
 *
 * Derived rather than MEASURED on purpose. A runtime measurement of the two
 * edges would also be correct, but it has to be re-read on resize and on every
 * frame of the entrance animation (the cards are still moving), and a stale
 * rect is exactly how this kind of line ends up drawn to the wrong place. A
 * shared constant cannot go stale — the gap and the line are the same fact
 * expressed once.
 */
const BAR_GAP_PX = 12;

/** How far below the card's edge the connector starts, so it never sits on the
 *  card's 1px border. Subtracted from the height, never added to the offset
 *  alone — see the note on the connector. */
const CONNECTOR_OFFSET_PX = 1;

/** How long a connector takes to draw before its card's check lands. */
const CONNECT_MS = 190;

const FRAME_MS = 780;
const ERASE_MS = 620;

/* Durations are set INLINE, not with `duration-[420ms]`.
 *
 * That utility silently produces nothing in this build: the compiled stylesheet
 * contains no `duration-[...]` selector at all, only the theme scale, while
 * every other arbitrary value from this same file (max-w-[120px],
 * min-h-[420px], rounded-[18px], transition-[flex-grow]) compiles fine. So the
 * classes were there, the transitions ran at Tailwind's default 150ms, and the
 * choreography was wrong in a way nothing reports — a missing utility class
 * has no error, it just falls back.
 *
 * Inline values cannot be dropped by a build step, and they sit next to the
 * transitionDelay values they have to stay in proportion with.
 */
const BAR_MS = 420;

export const WorkspaceChooser: React.FC<{
  value: string | null;
  /** `null` clears the choice — the bar is a TOGGLE, so it has to be able to
   *  hand back "nothing selected", not just a different id. */
  onChange: (id: string | null) => void;
  /** Raised while the everything-bar is hovered, so the step's own navigation
   *  can get out of the way. Lifted to the parent rather than handled here
   *  because Continue/Skip live outside this component — a shared visual
   *  state has to be owned above both of the things it affects. */
  onEverythingHover?: (hovering: boolean) => void;
}> = ({ value, onChange, onEverythingHover }) => {
  /* The selection is derived from `value` rather than mirrored in state.
   * A local copy would have to be kept in sync with the prop, and the two
   * disagree the moment anything else writes the answer — the parent restoring
   * a saved workspace, say. One source. */
  const picked = parseWorkspace(value);
  const everything = isEverything(picked);

  const [barHover, setBarHover] = useState(false);
  // The burst originates from this element's rect, so it needs a real handle.
  const barRef = useRef<HTMLButtonElement | null>(null);
  /* The grid's box is the region particles must not paint over. One rect for
   * all four cards rather than four: the gaps between them are 12px, and a
   * particle threading a 12px gap between two cards reads as a glitch, not as
   * precision. */
  const gridRef = useRef<HTMLDivElement | null>(null);
  const excludeRefs = useRef([gridRef]).current;
  const [phase, setPhase] = useState<Phase>(value === EVERYTHING_ID ? 'framed' : 'idle');

  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /**
   * The frame draws itself around the cards, from a single point.
   *
   * A dot appears at the bottom centre — directly under the bar — two lines
   * run out from it to both edges, climb the sides, and close across the top.
   * One origin, two travelling ends, one seam. That is what makes it read as
   * being DRAWN rather than as a box appearing.
   *
   * -- NOTHING IS MEASURED ---------------------------------------------------
   *
   * An earlier version measured the bar's vertical band and passed it in as
   * CSS custom properties. It never needed to: the origin is the frame's own
   * bottom centre, which sits under the bar by construction at every
   * breakpoint and every column count. Geometry that does not have to be
   * computed cannot be computed wrongly — and this had already been wrong
   * once, by the 12px `-inset-3` offset between the frame's box and the
   * wrapper's.
   *
   * So this handler only switches state. The whole animation is one CSS class.
   */
  const toggleFrame = useCallback(() => {
    // Mid-animation clicks are ignored rather than queued. Interrupting a draw
    // to start an erase leaves the frame at whatever clip it had reached, and
    // the reverse would then play from the wrong place.
    if (phase === 'framing' || phase === 'unframing') return;

    // ── retract ──
    if (phase === 'framed' || everything) {
      // The selection clears IMMEDIATELY, before the animation. The checks
      // unmount on the same frame the retract begins, which is the correct
      // reverse order — the cards are released, then the frame lets them go.
      // Deferring it would leave four ticks sitting inside a frame that is
      // visibly opening, which reads as a lag rather than a sequence.
      onChange(null);
      if (reduced) { setPhase('idle'); return; }
      setPhase('unframing');
      window.setTimeout(() => setPhase('idle'), ERASE_MS + 40);
      return;
    }

    // ── draw ──
    // Reduced motion still gets the OUTCOME, just not the drawing of it.
    if (reduced) { setPhase('framed'); onChange(EVERYTHING_ID); return; }
    setPhase('framing');
    window.setTimeout(() => { setPhase('framed'); onChange(EVERYTHING_ID); }, FRAME_MS + 40);
  }, [phase, reduced, onChange, everything]);

  /**
   * Toggle one suite.
   *
   * Selecting the LAST missing suite is the same answer as pressing the
   * everything bar, so it runs the frame animation too — arriving at a state
   * by a different route must not produce a different-looking state. Removing
   * one from a complete set retracts it for the same reason.
   */
  const toggleSuite = useCallback((id: string) => {
    if (phase === 'framing' || phase === 'unframing') return;

    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    const nowEverything = isEverything(next);

    onChange(serializeWorkspace(next));

    if (nowEverything && phase === 'idle') {
      if (reduced) { setPhase('framed'); return; }
      setPhase('framing');
      window.setTimeout(() => setPhase('framed'), FRAME_MS + 40);
    } else if (!nowEverything && phase === 'framed') {
      if (reduced) { setPhase('idle'); return; }
      setPhase('unframing');
      window.setTimeout(() => setPhase('idle'), ERASE_MS + 40);
    }
  }, [phase, picked, reduced, onChange]);

  /* -- The choice -------------------------------------------------------- */
  /* `framing` counts as framed so the checks are already scheduled while the
   * frame draws; `unframing` does NOT, so they unmount the instant a retract
   * begins. The asymmetry is the point — the enclosure arrives before the
   * ticks and leaves after them. */
  const framed = phase === 'framed' || phase === 'framing';

  /* The burst only makes sense before a choice exists: once the frame is
   * drawing or drawn, darkening the viewport would fight the thing the user
   * just triggered. */
  const burst = barHover && phase === 'idle';

  return (
    <div className="relative">
      {/* FULL-VIEWPORT overlay, PORTALLED TO <body>.
       *
       * 🔴 The portal is not tidiness, it is the fix for a real bug. Two
       * ancestors of this component carry a `transform`: the `.xeno-stagger`
       * entrance animation (which retains `translateY(0) scale(1)` under
       * `forwards`, so the transform never goes away) and the step container's
       * `translateX` during transitions.
       *
       * A transformed ancestor becomes the containing block for `position:
       * fixed` descendants. So `fixed inset-0` was resolving against the
       * CHOOSER'S box rather than the viewport — the canvas element was laid
       * out at the chooser's size and position while its drawing coordinates
       * came from window.innerWidth/innerHeight. Every particle therefore
       * landed offset and mis-scaled, which is exactly the "appearing away
       * from the border" symptom.
       *
       * No amount of tuning the emitter would have fixed that; the geometry
       * was right and the surface it painted onto was wrong. A portal to
       * <body> escapes every transformed ancestor, and it is the only way to
       * guarantee that at any nesting depth.
       *
       * It also puts the overlay outside `main`, so `main` no longer needs
       * lifting above its siblings to cover the header and footer. */}
      {createPortal(
        <div
          aria-hidden
          style={{ transitionDuration: `${BAR_MS}ms` }}
          className={`pointer-events-none fixed inset-0 z-[60] transition-opacity ease-out
                      ${burst ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* The scrim is painted BY the canvas below, with the bar punched
              out of it — see EdgeParticles.
    
              A DOM spotlight (a transparent box over the bar casting a 9999px
              spread shadow) also solves the stacking problem and was tried
              here first. The canvas won for one reason: it re-measures the
              bar EVERY FRAME. A DOM version has to hold the rect in state, and
              that rect is stale exactly when it matters — during the entrance
              animation the bar is still moving, and on resize it moves again.
              Two surfaces would also have to agree on one number; one surface
              cannot disagree with itself. */}
          <EdgeParticles active={burst} originRef={barRef} excludeRefs={excludeRefs} />
        </div>,
        document.body,
      )}

      {/* No per-card dimming any more — the full-viewport scrim above covers
          these along with everything else, and doing both would double the
          darkening on exactly the elements it is least needed on. */}
      <div ref={gridRef} className="relative z-10 grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SUITES.map((suite, i) => (
          <SuiteCard
            key={suite.id}
            suite={suite}
            index={i}
            selected={picked.includes(suite.id)}
            /* The connector belongs to the EVERYTHING state, not to selection.
             * Picking one suite is a different answer from taking the whole
             * ecosystem, and drawing a line from a single card to the bar would
             * claim a relationship that is not being asserted. */
            connected={framed}
            // Cascade only when the frame made the selection, and only once
            // the frame has CLOSED (86% — the top edge completes at 100%).
            // Starting earlier put the first tick on screen while the top was
            // still drawing, so it landed into an enclosure that did not exist
            // yet, which reads as two animations rather than a consequence.
            checkDelay={framed ? FRAME_MS * 0.86 + i * 95 : 0}
            onSelect={() => toggleSuite(suite.id)}
          />
        ))}
      </div>

      <button
        ref={barRef}
        type="button"
        onClick={toggleFrame}
        onPointerEnter={() => { setBarHover(true); onEverythingHover?.(true); }}
        onPointerLeave={() => { setBarHover(false); onEverythingHover?.(false); }}
        // Focus mirrors hover so a keyboard user gets the same state. Without
        // it the bar lights up for a mouse and stays dead for a tab key.
        onFocus={() => { setBarHover(true); onEverythingHover?.(true); }}
        onBlur={() => { setBarHover(false); onEverythingHover?.(false); }}
        disabled={phase === 'framing' || phase === 'unframing'}
        style={{
          // The gap is set HERE, from the same constant the connector's height
          // is derived from — `mt-3` would be a second source for one fact.
          marginTop: BAR_GAP_PX,
          animation: 'xenoRise 0.5s cubic-bezier(0.22,1,0.36,1) forwards',
          animationDelay: '0.34s',
          opacity: 0,
          // The bar follows the same treatment as the cards, or `edge` would
          // keep four cards black and still light up the bar underneath them.
          ...(framed ? { borderColor: SELECTED.border, background: SELECTED.barBg } : {}),
        }}
        className={`focus-self group relative z-10 flex w-full items-center overflow-hidden
                    rounded-[12px] border px-5 py-4 text-left transition-all duration-200 ease-out
                    will-change-transform disabled:cursor-default
                    ${framed
                      ? ''
                      : 'border-white/[0.14] hover:-translate-y-[3px] hover:border-white/35 active:translate-y-0 active:scale-[0.995]'}`}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: 'radial-gradient(ellipse 60% 140% at 50% 50%, rgba(255,255,255,0.07), transparent 70%)' }}
        />
        {/* -- The bar composes itself on selection ------------------------
            Idle it is one centred line of text: no icon, no count, nothing
            competing with the invitation. Choosing it makes the bar BUILD --
            the square grows in from the left, the text slides over to make
            room, the check lands in the square, and the product count arrives
            on the right.

            The text is not animated directly. It sits in a `flex-1` between
            the two slots, so it moves because they take space. One width
            transition drives the whole rearrangement, which means the three
            parts can never disagree about where the text should be. ------ */}

        {/* Left slot -- zero-width until chosen. `w-0` + overflow-hidden
            rather than `hidden`, because a display change cannot be
            transitioned and the square would pop in at full size. */}
        <span
          style={{ transitionDuration: `${BAR_MS}ms` }}
          className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[8px] border
                      transition-all ease-out
                      ${framed
                        ? 'mr-3.5 h-9 w-9 scale-100 border-white/30 bg-white/[0.14] opacity-100'
                        : 'mr-0 h-9 w-0 scale-75 border-transparent bg-transparent opacity-0'}`}
        >
          {framed && (
            /* The bar's own tick lands LAST -- after all four cards, and after
               the square holding it has finished opening. It is the summary of
               what happened, so it arrives after the thing it summarises. */
            <Check
              style={{ animationDelay: `${FRAME_MS * 0.86 + SUITES.length * 95 + CONNECT_MS}ms` }}
              className="xeno-check-drop h-[18px] w-[18px] text-white"
              strokeWidth={2.5}
            />
          )}
        </span>

        {/* Equal spacers either side, always growing, so the label stays
            CENTRED between whatever flanks it. It shifts slightly left as the
            square and the count take up space, which is motion for free —
            driven entirely by their widths, with nothing to keep in sync.

            An earlier version collapsed the left spacer to pin the label left
            once chosen. Centred throughout is calmer and, more to the point,
            it means the label never moves for a reason the user did not
            cause. */}
        <span aria-hidden className="grow" />

        <span className="relative min-w-0 shrink text-center">
          <span className="block whitespace-nowrap text-[14px] font-medium text-white">
            Complete XENO Experience
          </span>
          <span className="mt-0.5 block text-[12.5px] text-white/40">
            {framed
              ? 'All four suites are yours. Click again to undo.'
              : 'Every suite, every app, in one workspace.'}
          </span>
        </span>

        <span aria-hidden className="grow" />

        {/* Right slot -- the count is meaningless before a choice is made; it
            would be a number floating beside an invitation. Withheld until
            there is something for it to describe.

            Delayed on the way IN so it arrives with the check rather than
            racing it, and immediate on the way OUT so a retract reads as
            decisive rather than as the bar reluctantly letting go. */}
        <span
          style={{
            transitionDuration: `${BAR_MS}ms`,
            transitionDelay: framed ? `${FRAME_MS * 0.86}ms` : '0ms',
          }}
          className={`relative shrink-0 overflow-hidden whitespace-nowrap text-[12px] tabular-nums text-white/30
                      transition-all ease-out
                      ${framed ? 'ml-3 max-w-[120px] opacity-100' : 'ml-0 max-w-0 opacity-0'}`}
        >
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
  /** Whether the line to the bar is drawn. Distinct from `selected`: a suite
   *  can be chosen on its own without being part of the whole ecosystem, and
   *  only the latter is a connection to the bar. */
  connected: boolean;
  /** ms before this card's check lands. Non-zero only when the FRAME selected
   *  everything, so the four ticks cascade instead of appearing as one block.
   *  A direct click stays at 0 — feedback for your own click must be immediate
   *  or it reads as lag. */
  checkDelay?: number;
  onSelect: () => void;
}> = ({ suite, index, selected, connected, checkDelay = 0, onSelect }) => {
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
        boxShadow: selected ? SELECTED.shadow : '0 10px 30px -16px rgba(0,0,0,0.8)',
        ...(selected ? { borderColor: SELECTED.border } : {}),
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
                  ${selected ? '' : 'border-white/[0.07] hover:border-white/[0.22]'}`}
    >
      {/* CONNECTOR — the line the frame runs up from the bar to this card,
          immediately before the card's check lands.

          Anchored to the card's OWN bottom edge (`top-full`, `left-1/2`), so
          it is centred under the card at any column count and any viewport
          with nothing measured. A line positioned from the grid's geometry
          would need re-measuring on every reflow and would be wrong the moment
          the layout changed.

          `origin-bottom` + scaleY is what makes it GROW UPWARD out of the bar
          rather than downward out of the card. The bar is the source, so the
          motion has to start there — the same reason the frame itself draws
          from a point under the bar. */}
      <span
        aria-hidden
        style={{
          /* ── WHY IT OVERLAPS BOTH ENDS ─────────────────────────────────
           *
           * A line drawn exactly from the card's bottom edge to the bar's top
           * edge shows a hairline gap at one end or both. The card's height
           * comes from `items-stretch`, the bar's offset from a rem margin,
           * and the whole page is scaled by devicePixelRatio — so both joins
           * land on fractional device pixels and round independently. There is
           * no value that closes it, because the error changes with zoom and
           * display.
           *
           * So it overlaps NEITHER end. It spans exactly the gap.
           *
           * 🔴 Two wrong versions preceded this, and the second is the more
           * interesting mistake.
           *
           * v1 overlapped both ends — `calc(100% - 1px)`, one pixel up into
           * the card. The card's border is 1px, so a 2px line starting one
           * pixel early painted straight over that stroke.
           *
           * v2 kept a 4px overlap at the BOTTOM, on the reasoning that the bar
           * is later in the DOM at the same z-index and would paint over it.
           * The paint order is correct — and it does not help, because the
           * bar's fill is TRANSLUCENT (`bg-white/[0.06]`). A surface you can
           * see through does not hide what is beneath it; the overlap showed
           * straight through the bar's top stroke.
           *
           * That is the general lesson: "a later sibling covers it" is only
           * true for an OPAQUE later sibling. On this design system almost
           * every surface is a white-alpha wash over the page, so nothing
           * covers anything — an element must not be drawn where it should not
           * be seen.
           *
           * The line now runs from the card's outer bottom edge to the bar's
           * outer top edge and touches both borders without entering either.
           * Height is the gap itself, so it cannot breach whatever the two
           * ends round to.
           *
           * ── TRANSFORM IS ONE INLINE STRING ────────────────────────────
           *
           * `-translate-x-1/2` and `scale-y-*` are both Tailwind transform
           * utilities, composed through shared CSS variables into a single
           * declaration. Two classes sharing one declaration means anything
           * that fails to define one variable takes the WHOLE transform with
           * it, centring included. One explicit string cannot half-apply.
           *
           * `transform-origin: bottom` makes it grow UPWARD out of the bar
           * rather than downward out of the card — the bar is the source.
           *
           * The curve overshoots slightly and settles, which is the same idea
           * as xeno-elements' goo pill: its own note says a rectangle that
           * only slides reads as a scrollbar, and one that deforms reads as
           * something with mass. (That component squashes a travelling pill;
           * there is no reusable filter there, so this borrows the principle,
           * not the code.)
           */
          /* Starts ONE PIXEL below the card's outer edge, and the height
             loses that same pixel so the bottom still lands exactly on the
             bar's top edge.
   
             Both halves are required. Shifting down without shortening would
             push the bottom 1px into the bar — reintroducing at that end
             precisely the breach just removed from this one, and it would not
             be hidden: the bar's fill is translucent, so nothing occludes an
             overlap here. */
          top: `calc(100% + ${CONNECTOR_OFFSET_PX}px)`,
          // The distance it must span, less the pixel it starts late by, so the
          // bottom lands exactly on the bar's top edge however the gap changes.
          height: BAR_GAP_PX - CONNECTOR_OFFSET_PX,
          transform: `translateX(-50%) scaleY(${connected ? 1 : 0})`,
          transformOrigin: 'bottom center',
          transitionProperty: 'transform',
          transitionTimingFunction: 'cubic-bezier(0.34, 0.6, 0.2, 1.28)',
          transitionDelay: `${checkDelay}ms`,
          transitionDuration: `${CONNECT_MS}ms`,
        }}
        className="pointer-events-none absolute left-1/2 w-[2px] bg-white/70"
      />

      {/* ── Header plate ── */}
      <span
        className="flex shrink-0 items-center gap-2 rounded-t-[7px] px-3 py-2.5 transition-colors duration-200"
        style={{ background: selected ? SELECTED.headerBg : '#1a1a1a' }}
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
            style={{ animationDelay: `${checkDelay + CONNECT_MS}ms` }}
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
