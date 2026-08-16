import React, { useCallback, useRef, useState } from 'react';
import { Palette, FileText, Terminal, MessageSquare, Check, Sparkles } from 'lucide-react';
import {
  SUITES, EVERYTHING_ID, productsForSuite, allAvailableProducts, type Suite,
} from '../../lib/workspaceSuites';
import XenoGlyph from '../auth/XenoGlyph';
import SuiteVisual from './SuiteVisual';
import { productIcon } from '../../lib/productIcons';

/* ═══════════════════════════════════════════════════════════════════════════
 * WORKSPACE CHOOSER — the first and most consequential step.
 *
 * This is not a survey question. The answer decides how the platform lays
 * itself out for this person, so the screen has to feel like it matters: four
 * suites side by side, each showing the real products inside it, and one way
 * to refuse the choice entirely and take the whole ecosystem.
 *
 * ── THE ABSORB ─────────────────────────────────────────────────────────────
 *
 * "Everything" does not just select a fifth option. The four cards fly INTO
 * the centre, shrink and dissolve, and a single XENO card grows out of where
 * they landed — the ecosystem visibly assembling itself out of its parts.
 *
 * It is done with FLIP-style measured transforms, not a canned keyframe: each
 * card's travel is computed at click time from its own box to the grid centre,
 * so the motion is correct at any column count, any viewport, any number of
 * suites. A hardcoded set of translations would be wrong the moment the grid
 * reflows to two columns on a laptop.
 *
 * `prefers-reduced-motion` skips straight to the assembled state. The choice
 * is what matters; the animation is how it feels, and someone who has asked
 * the OS to stop moving things still has to be able to make it.
 * ═══════════════════════════════════════════════════════════════════════════ */

const SUITE_ICON: Record<string, React.ReactNode> = {
  creative:  <Palette className="h-[18px] w-[18px]" />,
  office:    <FileText className="h-[18px] w-[18px]" />,
  developer: <Terminal className="h-[18px] w-[18px]" />,
  connect:   <MessageSquare className="h-[18px] w-[18px]" />,
};

type Phase = 'idle' | 'absorbing' | 'unified';

const ABSORB_MS = 620;

export const WorkspaceChooser: React.FC<{
  value: string | null;
  onChange: (id: string) => void;
}> = ({ value, onChange }) => {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [phase, setPhase] = useState<Phase>(value === EVERYTHING_ID ? 'unified' : 'idle');
  const [flight, setFlight] = useState<Record<string, React.CSSProperties>>({});

  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /** Fly every card into the grid's centre, then swap in the unified card. */
  const absorb = useCallback(() => {
    if (phase !== 'idle') return;

    if (reduced) { setPhase('unified'); onChange(EVERYTHING_ID); return; }

    const grid = gridRef.current;
    if (!grid) { setPhase('unified'); onChange(EVERYTHING_ID); return; }

    const g = grid.getBoundingClientRect();
    const cx = g.left + g.width / 2;
    const cy = g.top + g.height / 2;

    // Measure BEFORE mutating anything — reading a box after a style change
    // that triggers layout gives you the post-change geometry, and the whole
    // animation would then travel from the wrong place.
    const next: Record<string, React.CSSProperties> = {};
    for (const s of SUITES) {
      const el = cardRefs.current[s.id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const dx = cx - (r.left + r.width / 2);
      const dy = cy - (r.top + r.height / 2);
      next[s.id] = {
        transform: `translate(${dx}px, ${dy}px) scale(0.28)`,
        opacity: 0,
        // Cards nearest the centre arrive first, so the collapse reads as a
        // gather rather than four things moving in lockstep.
        transitionDelay: `${Math.min(90, Math.abs(dx) / 14)}ms`,
      };
    }

    setFlight(next);
    setPhase('absorbing');
    window.setTimeout(() => { setPhase('unified'); onChange(EVERYTHING_ID); }, ABSORB_MS);
  }, [phase, reduced, onChange]);

  const reopen = () => { setPhase('idle'); setFlight({}); };

  /* ── The assembled state ───────────────────────────────────────────────── */
  if (phase === 'unified') {
    const all = allAvailableProducts();
    return (
      <div className="xeno-scale-in">
        <div
          className="relative overflow-hidden rounded-[16px] border border-white/30 p-7"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02))',
            boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.18), 0 30px 70px -28px rgba(0,0,0,0.95)',
          }}
        >
          {/* A single soft bloom behind the mark — the light the pieces
              collapsed into. Decorative, so it never eats a click. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse 45% 60% at 50% 0%, rgba(255,255,255,0.09), transparent 70%)' }}
          />

          <div className="relative flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-white/25 bg-white/[0.10]">
              <XenoGlyph className="h-6 w-6 text-white" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[17px] font-semibold text-white">The full XENO workspace</span>
                <span className="rounded-[5px] border border-white/25 px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white/80">
                  Everything
                </span>
              </div>
              <p className="mt-1 text-[13px] text-white/45">
                Every suite, every app, one workspace. {all.length} products available today.
              </p>
            </div>
            <Check className="mt-1 h-5 w-5 shrink-0 text-white" strokeWidth={2.5} />
          </div>

          {/* The suites that just collapsed in, listed so the card is a
              summary of what was chosen rather than an opaque "everything". */}
          <div className="relative mt-6 grid gap-2.5 sm:grid-cols-4">
            {SUITES.map((s) => (
              <div key={s.id} className="rounded-[9px] border border-white/[0.10] bg-white/[0.03] px-3 py-2.5">
                <span className="flex items-center gap-2 text-[12.5px] font-medium text-white/80">
                  <span className="text-white/50">{SUITE_ICON[s.id]}</span>
                  {s.name}
                </span>
                <span className="mt-0.5 block text-[11px] tabular-nums text-white/30">
                  {productsForSuite(s).length} products
                </span>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={reopen}
          className="focus-self mt-4 text-[12.5px] text-white/35 transition-colors hover:text-white/70"
        >
          Pick a single workspace instead
        </button>
      </div>
    );
  }

  /* ── The choice ────────────────────────────────────────────────────────── */
  return (
    <div>
      <div ref={gridRef} className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SUITES.map((suite, i) => (
          <SuiteCard
            key={suite.id}
            suite={suite}
            index={i}
            selected={value === suite.id}
            absorbing={phase === 'absorbing'}
            flightStyle={flight[suite.id]}
            onSelect={() => onChange(suite.id)}
            registerRef={(el) => { cardRefs.current[suite.id] = el; }}
          />
        ))}
      </div>

      {/* The refusal-to-choose, given equal weight to the grid above it. */}
      <button
        type="button"
        onClick={absorb}
        disabled={phase === 'absorbing'}
        style={{ animation: 'xenoRise 0.5s cubic-bezier(0.22,1,0.36,1) forwards', animationDelay: '0.28s', opacity: 0 }}
        className="focus-self group relative mt-3 flex w-full items-center gap-3.5 overflow-hidden rounded-[12px]
                   border border-white/[0.14] px-5 py-4 text-left transition-all duration-200 ease-out
                   will-change-transform hover:-translate-y-[3px] hover:border-white/35
                   active:translate-y-0 active:scale-[0.995] disabled:cursor-default"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: 'radial-gradient(ellipse 60% 140% at 50% 50%, rgba(255,255,255,0.07), transparent 70%)' }}
        />
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-white/20 bg-white/[0.07]">
          <Sparkles className="h-[18px] w-[18px] text-white/85" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-white">
            Or take the full XENO experience
          </span>
          <span className="mt-0.5 block text-[12.5px] text-white/40">
            Every suite in one workspace — you can narrow it later.
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
  absorbing: boolean;
  flightStyle?: React.CSSProperties;
  onSelect: () => void;
  registerRef: (el: HTMLElement | null) => void;
}> = ({ suite, index, selected, absorbing, flightStyle, onSelect, registerRef }) => {
  const products = productsForSuite(suite);

  return (
    <button
      ref={registerRef as React.Ref<HTMLButtonElement>}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        background: selected
          ? 'linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.018))'
          : 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.008))',
        boxShadow: selected
          ? 'inset 0 1px 0 0 rgba(255,255,255,0.16), 0 20px 46px -18px rgba(0,0,0,0.92)'
          : 'inset 0 1px 0 0 rgba(255,255,255,0.05), 0 10px 30px -16px rgba(0,0,0,0.8)',
        ...(absorbing
          ? { transition: `transform ${ABSORB_MS}ms cubic-bezier(0.55,0,0.35,1), opacity ${ABSORB_MS}ms ease-in`, ...flightStyle }
          : { animation: 'xenoRise 0.6s cubic-bezier(0.16,1.02,0.3,1) forwards', animationDelay: `${0.06 + index * 0.07}s`, opacity: 0 }),
      }}
      className={`focus-self group relative flex flex-col rounded-[14px] border p-3.5 text-left
                  ${absorbing
                    ? ''
                    : 'transition-[border-color,transform,box-shadow] duration-200 ease-out will-change-transform hover:-translate-y-[5px] active:translate-y-0'}
                  ${selected ? 'border-white/45' : 'border-white/[0.10] hover:border-white/[0.28]'}`}
    >
      {/* The miniature. Same role as the reference card's gradient thumbnail —
          it is what the card is ABOUT, and it goes first. */}
      <SuiteVisual suiteId={suite.id} />

      <span className="mt-3 flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold leading-tight text-white">{suite.name}</span>
          <span className="mt-1 block text-[11.5px] leading-snug text-white/35">{suite.tagline}</span>
        </span>
        <span
          aria-hidden
          className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] bg-white transition-all duration-200
                     ${selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}
        >
          <Check className="h-3 w-3 text-black" strokeWidth={3} />
        </span>
      </span>

      {/* Divider + "Includes" + a two-column icon grid — the anatomy of the
          reference card. Every product carries its own mark, because a column
          of identical bullets reads as a checklist rather than a set of
          distinct tools. */}
      <span className="mt-3.5 block border-t border-white/[0.07] pt-3">
        <span className="block text-[9.5px] font-semibold uppercase tracking-[0.13em] text-white/25">
          Includes
        </span>
        <span className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-[7px]">
          {products.map((p) => (
            <span key={p.slug} className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-white/35 transition-colors duration-200 group-hover:text-white/60">
                {productIcon(p.slug)}
              </span>
              {/* The catalog prefixes every name with "XENO"; inside a XENO
                  workspace card that word is on every line and carries nothing. */}
              <span className="truncate text-[11.5px] text-white/65">
                {p.name.replace(/^XENO\s+/, '')}
              </span>
            </span>
          ))}
        </span>
      </span>
    </button>
  );
};

export default WorkspaceChooser;
