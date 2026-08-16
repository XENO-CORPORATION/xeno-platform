import React from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * SUITE VISUALS — a miniature of the workspace, per suite.
 *
 * ── WHY THESE EXIST ────────────────────────────────────────────────────────
 *
 * The suite cards were an icon, a name and a bullet list, and that is why they
 * read as filler. Every reference worth copying does the same thing instead:
 * the card CONTAINS a small picture of the thing it is offering — a mock
 * editor, a diagram, a preview pane. The illustration is the argument; the
 * text underneath is the caption.
 *
 * So each suite gets a tiny, abstracted version of what that workspace looks
 * like: a canvas with layers and swatches, a document with a chart, a terminal
 * with a flow graph, a conversation with a browser chrome.
 *
 * ── BUILT FROM DIVS, DELIBERATELY ──────────────────────────────────────────
 *
 * No images and no SVG assets. Three reasons, in order of how much they cost:
 *   - a raster asset needs 2x/3x variants and still blurs on a 4K panel, and
 *     this sits on the first screen a new account ever sees;
 *   - the palette has to follow the card's selected/hover state, which a
 *     baked image cannot do;
 *   - it is what the homepage's ProductsShowcase already does, so the two
 *     surfaces stay recognisably the same product.
 *
 * ── THEY ARE ABSTRACT ON PURPOSE ───────────────────────────────────────────
 *
 * Text is drawn as bars, not words. A miniature with real labels invites you
 * to read it, and at this size that is a frustration; as shapes it registers
 * instantly as "an editor" or "a terminal" without asking for attention. It
 * also means no copy to translate and nothing that can go stale when a product
 * changes.
 *
 * `aria-hidden` throughout: this is decoration. The card's real name and
 * product list carry the meaning for anyone not looking at pixels.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Shared frame: the inset "screen" every miniature is drawn inside. */
const Frame: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className = '',
}) => (
  <div
    aria-hidden
    className={`relative h-[116px] w-full overflow-hidden rounded-[8px] border border-white/[0.07] ${className}`}
    style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.045), rgba(0,0,0,0.35))' }}
  >
    {children}
  </div>
);

/** A bar standing in for a line of text. */
const Bar: React.FC<{ w: string; o?: number; h?: number }> = ({ w, o = 0.22, h = 3 }) => (
  <div style={{ width: w, height: h, background: `rgba(255,255,255,${o})`, borderRadius: 2 }} />
);

/* ── Creative: canvas, layer stack, swatches ─────────────────────────────── */

const CreativeVisual: React.FC = () => (
  <Frame>
    <div className="absolute inset-0 flex gap-1.5 p-2">
      {/* layer stack */}
      <div className="flex w-[30%] flex-col gap-1">
        {[0.16, 0.10, 0.08].map((o, i) => (
          <div
            key={i}
            className="flex items-center gap-1 rounded-[3px] border border-white/[0.06] px-1 py-[3px]"
            style={{ background: `rgba(255,255,255,${o * 0.35})` }}
          >
            <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: `rgba(255,255,255,${o + 0.1})` }} />
            <Bar w="70%" o={o} />
          </div>
        ))}
      </div>

      {/* canvas with a shape on it — the one place a gradient reads as artwork */}
      <div className="relative flex-1 overflow-hidden rounded-[5px] border border-white/[0.07]"
           style={{ background: 'radial-gradient(circle at 55% 45%, rgba(255,255,255,0.14), rgba(0,0,0,0.45) 72%)' }}>
        <div className="absolute left-1/2 top-1/2 h-[46%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-[4px] border border-white/25"
             style={{ background: 'linear-gradient(140deg, rgba(255,255,255,0.22), rgba(255,255,255,0.05))' }} />
        {/* selection handles — the detail that says "editor" rather than "image" */}
        {[['12%','12%'],['12%','88%'],['88%','12%'],['88%','88%']].map(([t,l],i)=>(
          <div key={i} className="absolute h-[3px] w-[3px] rounded-[1px] bg-white/60" style={{ top: t, left: l }} />
        ))}
      </div>
    </div>

    {/* swatch row */}
    <div className="absolute bottom-1.5 left-2 flex gap-1">
      {[0.85, 0.55, 0.35, 0.2].map((o, i) => (
        <div key={i} className="h-2 w-2 rounded-[2px] border border-white/10" style={{ background: `rgba(255,255,255,${o})` }} />
      ))}
    </div>
  </Frame>
);

/* ── Office: document page + a small chart ───────────────────────────────── */

const OfficeVisual: React.FC = () => (
  <Frame>
    <div className="absolute inset-0 flex gap-1.5 p-2">
      {/* page */}
      <div className="flex w-[54%] flex-col gap-[5px] rounded-[5px] border border-white/[0.07] px-2 py-2"
           style={{ background: 'rgba(255,255,255,0.035)' }}>
        <Bar w="62%" o={0.4} h={4} />
        <div className="mt-0.5 flex flex-col gap-[3px]">
          <Bar w="100%" /><Bar w="92%" /><Bar w="97%" /><Bar w="70%" />
        </div>
      </div>

      {/* chart */}
      <div className="flex flex-1 flex-col justify-end gap-[3px] rounded-[5px] border border-white/[0.07] p-1.5"
           style={{ background: 'rgba(255,255,255,0.025)' }}>
        <div className="flex h-full items-end gap-[3px]">
          {[42, 68, 30, 84, 56].map((h, i) => (
            <div key={i} className="flex-1 rounded-[2px]"
                 style={{ height: `${h}%`, background: `rgba(255,255,255,${0.14 + i * 0.06})` }} />
          ))}
        </div>
      </div>
    </div>
  </Frame>
);

/* ── Developer: terminal + a node graph ──────────────────────────────────── */

const DeveloperVisual: React.FC = () => (
  <Frame>
    <div className="absolute inset-0 flex flex-col gap-1.5 p-2">
      {/* terminal */}
      <div className="flex flex-1 flex-col gap-[4px] rounded-[5px] border border-white/[0.07] px-2 py-1.5"
           style={{ background: 'rgba(0,0,0,0.4)' }}>
        {[['8%', '46%'], ['8%', '62%'], ['8%', '34%']].map(([p, w], i) => (
          <div key={i} className="flex items-center gap-1">
            {/* a prompt caret, so it reads as a shell and not a paragraph */}
            <div className="h-[3px] shrink-0 rounded-[1px] bg-white/35" style={{ width: p }} />
            <Bar w={w} o={i === 2 ? 0.14 : 0.24} />
          </div>
        ))}
        <div className="mt-[1px] h-[7px] w-[2px] bg-white/50" />
      </div>

      {/* node graph */}
      <div className="relative h-[30px] shrink-0 rounded-[5px] border border-white/[0.07]"
           style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="absolute left-[12%] top-1/2 h-[1px] w-[76%] -translate-y-1/2 bg-white/12" />
        {['12%', '44%', '76%'].map((l, i) => (
          <div key={i}
               className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border"
               style={{
                 left: l,
                 borderColor: i === 1 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.14)',
                 background: i === 1 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)',
               }} />
        ))}
      </div>
    </div>
  </Frame>
);

/* ── Connect: conversation + browser chrome ──────────────────────────────── */

const ConnectVisual: React.FC = () => (
  <Frame>
    <div className="absolute inset-0 flex flex-col p-2">
      {/* tab strip */}
      <div className="mb-1.5 flex shrink-0 items-center gap-1">
        <div className="flex gap-[3px]">
          {[0.3, 0.2, 0.14].map((o, i) => (
            <div key={i} className="h-[4px] w-[4px] rounded-full" style={{ background: `rgba(255,255,255,${o})` }} />
          ))}
        </div>
        <div className="ml-1 h-[9px] flex-1 rounded-[3px] border border-white/[0.07]" style={{ background: 'rgba(255,255,255,0.04)' }} />
      </div>

      {/* messages — alternating sides is what makes it read as a conversation */}
      <div className="flex flex-1 flex-col justify-center gap-[5px]">
        <div className="max-w-[62%] self-start rounded-[6px] rounded-bl-[2px] border border-white/[0.07] px-1.5 py-1"
             style={{ background: 'rgba(255,255,255,0.05)' }}>
          <Bar w="42px" o={0.26} /><div className="mt-[3px]" /><Bar w="28px" o={0.14} />
        </div>
        <div className="max-w-[62%] self-end rounded-[6px] rounded-br-[2px] border border-white/20 px-1.5 py-1"
             style={{ background: 'rgba(255,255,255,0.13)' }}>
          <Bar w="36px" o={0.5} /><div className="mt-[3px]" /><Bar w="46px" o={0.3} />
        </div>
        <div className="flex items-center gap-[3px] self-start pl-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[3px] w-[3px] rounded-full bg-white/30" />
          ))}
        </div>
      </div>
    </div>
  </Frame>
);

/* ── Everything: the four, composited ────────────────────────────────────── */

const EverythingVisual: React.FC = () => (
  <div aria-hidden className="grid grid-cols-2 gap-1.5">
    {/* Deliberately the same four miniatures at quarter size rather than a new
        fifth illustration — "everything" should look like the sum of what was
        on offer, not like a separate product. */}
    <div className="scale-[0.99]"><CreativeVisual /></div>
    <div className="scale-[0.99]"><OfficeVisual /></div>
    <div className="scale-[0.99]"><DeveloperVisual /></div>
    <div className="scale-[0.99]"><ConnectVisual /></div>
  </div>
);

const VISUALS: Record<string, React.FC> = {
  creative: CreativeVisual,
  office: OfficeVisual,
  developer: DeveloperVisual,
  connect: ConnectVisual,
  everything: EverythingVisual,
};

/** The miniature for a suite id. Renders nothing for an unknown id rather than
 *  throwing — a new suite without artwork should degrade to a plain card, not
 *  take the onboarding screen down. */
export const SuiteVisual: React.FC<{ suiteId: string }> = ({ suiteId }) => {
  const V = VISUALS[suiteId];
  return V ? <V /> : null;
};

export default SuiteVisual;
