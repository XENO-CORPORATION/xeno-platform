import React, { useCallback, useRef, useState } from 'react';
import { Palette, FileText, Terminal, MessageSquare, Check } from 'lucide-react';
import {
  SUITES, EVERYTHING_ID, productsForSuite, availableForSuite, allAvailableProducts, type Suite,
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
  const [barHover, setBarHover] = useState(false);
  // The burst originates from this element's rect, so it needs a real handle.
  const barRef = useRef<HTMLButtonElement | null>(null);
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
    if (phase === 'framed') {
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
  }, [phase, reduced, onChange]);

  /** Picking one suite retracts the frame — the two answers are exclusive. */
  const collapseFrame = useCallback(() => {
    setPhase('idle');
  }, []);

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
      {/* FULL-VIEWPORT overlay: a scrim that darkens everything, and the dot
          field bursting out of the bar's edges across it.

          `fixed inset-0` deliberately — the effect is about the whole screen
          receding, so containing it to this component would be the version I
          built first and it read as a texture inside a panel rather than as
          the page giving way.

          It sits at z-[60] with the bar lifted to z-[70], so the bar is the
          one thing NOT dimmed. pointer-events-none throughout: the overlay
          covers the bar's own hit area, and swallowing the click it exists to
          advertise would be the worst possible bug here. */}
      <div
        aria-hidden
        style={{ transitionDuration: `${BAR_MS}ms` }}
        className={`pointer-events-none fixed inset-0 z-[60] transition-opacity ease-out
                    ${burst ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="absolute inset-0 bg-black/72" />
        <EdgeParticles active={burst} originRef={barRef} />
      </div>

      {/* THE FRAME. Behind everything (z-0, cards are z-10) and outside the
          content box (-inset-3), so it reads as enclosing the grid rather than
          as another card in it. Pointer-events off: it is a statement, not a
          control — the bar underneath stays clickable through it. */}
      {phase !== 'idle' && (
        <div
          aria-hidden
          style={{
            boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.42), 0 24px 60px -30px rgba(0,0,0,0.9)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.008))',
          }}
          className={`pointer-events-none absolute -inset-3 z-0 rounded-[18px] ${
            phase === 'unframing' ? 'xeno-frame-erase' : 'xeno-frame-draw'
          }`}
        />
      )}

      {/* No per-card dimming any more — the full-viewport scrim above covers
          these along with everything else, and doing both would double the
          darkening on exactly the elements it is least needed on. */}
      <div className="relative z-10 grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        onClick={toggleFrame}
        onPointerEnter={() => { setBarHover(true); onEverythingHover?.(true); }}
        onPointerLeave={() => { setBarHover(false); onEverythingHover?.(false); }}
        // Focus mirrors hover so a keyboard user gets the same state. Without
        // it the bar lights up for a mouse and stays dead for a tab key.
        onFocus={() => { setBarHover(true); onEverythingHover?.(true); }}
        onBlur={() => { setBarHover(false); onEverythingHover?.(false); }}
        disabled={phase === 'framing' || phase === 'unframing'}
        style={{ animation: 'xenoRise 0.5s cubic-bezier(0.22,1,0.36,1) forwards', animationDelay: '0.34s', opacity: 0 }}
        className={`focus-self group relative mt-3 flex w-full items-center overflow-hidden
                    ${burst ? 'z-[70]' : 'z-10'}
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
              style={{ animationDelay: `${FRAME_MS * 0.86 + SUITES.length * 95}ms` }}
              className="xeno-check-drop h-[18px] w-[18px] text-white"
              strokeWidth={2.5}
            />
          )}
        </span>

        {/* -- Centred to left-aligned, WITHOUT flipping text-align ---------
            The obvious version toggles `text-center` -> `text-left`. That is
            what caused the lurch: text-align flips on the FIRST frame, so the
            label snapped hard left while the square was still 0 wide, and then
            the growing square shoved it back right. Two opposing movements in
            one gesture.

            `flex-grow` is animatable, so a spacer does the job instead. Idle,
            spacers on both sides grow equally and the label sits centred;
            chosen, the left spacer collapses to 0 and the label slides over as
            one continuous motion. Nothing is measured, nothing snaps, and the
            label only ever travels in one direction. ------------------------ */}
        <span
          aria-hidden
          style={{ transitionDuration: `${BAR_MS}ms` }}
          className={`transition-[flex-grow] ease-out ${framed ? 'grow-0' : 'grow'}`}
        />

        <span className="relative min-w-0 shrink text-left">
          <span className="block whitespace-nowrap text-[14px] font-medium text-white">
            {framed ? 'The full XENO workspace' : 'Or take the full XENO experience'}
          </span>
          <span className="mt-0.5 block text-[12.5px] text-white/40">
            {framed
              ? 'All four suites, together. Click again to undo, or pick a single card.'
              : 'Every suite in one workspace \u2014 you can narrow it later.'}
          </span>
        </span>

        {/* The right spacer always grows, so it absorbs whatever the left one
            gives up. Without it the label would be pinned to the right edge in
            the idle state rather than centred. */}
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
