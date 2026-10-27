import React from 'react';

/* Hero mockup — XENO Corpus's Shape canvas, as the desktop app 0.1.0 draws it: a lane per corpus on a
 * dot grid, claims as cards that carry their verdict, and the question bar ("Everything · False now ·
 * Unchecked"). States and wording are the app's own (xeno-corpus app/src/views/Shape.tsx,
 * shapeLogic.ts); the claims are illustrative. Colour appears only for status, as in the app. */

const cards = [
  { id: 'build', claim: 'npm test passes on main', state: 'held' },
  { id: 'ports', claim: 'Capability ports stay in 7331–7339', state: 'held' },
  { id: 'licence', claim: 'Every package declares UNLICENSED', state: 'lapsed' },
  { id: 'docs', claim: 'README install steps still run', state: 'unobserved' },
];
const tone: Record<string, { dot: string; label: string }> = {
  held: { dot: 'bg-[#22c55e]', label: 'HELD' },
  lapsed: { dot: 'bg-[#ef4444]', label: 'LAPSED' },
  unobserved: { dot: 'border border-[#9a9aa1]', label: 'UNKNOWN' },
};

const CorpusShape: React.FC = () => (
  <div className="flex h-full w-full flex-col overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#111114] text-left">
    <div className="flex items-center gap-3 border-b border-white/[0.06] bg-[#0b0b0d] px-3.5 py-2.5">
      <span className="text-[12px] font-semibold text-[#d8d8de]">Corpus</span>
      <span className="rounded-[4px] bg-white/[0.08] px-2 py-0.5 text-[10.5px] text-[#d8d8de]">Shape</span>
      <span className="text-[10.5px] text-[#9a9aa1]">Document · Tenets · Verdicts</span>
      <span className="ml-auto rounded-[4px] bg-[#d8d8de] px-2.5 py-1 text-[10.5px] font-semibold text-[#08080a]">Run pulse</span>
    </div>
    <div
      className="relative flex h-[clamp(304px,40vh,372px)] flex-col gap-3 overflow-hidden px-4 py-3"
      style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1.3px)', backgroundSize: '22px 22px' }}
    >
      <div className="flex gap-1.5">
        {['Everything', 'False now', 'Unchecked'].map((l, i) => (
          <span key={l} className={`rounded-[4px] px-2 py-0.5 text-[10.5px] ${i === 1 ? 'bg-white/[0.12] text-[#ececf1]' : 'text-[#9a9aa1]'}`}>{l}</span>
        ))}
      </div>
      <div className="rounded-[6px] border border-white/[0.08] bg-[#16161a] px-3 py-2.5">
        <div className="flex justify-between font-mono text-[9.5px] tracking-[0.08em] text-[#9a9aa1]">
          <span>PROJECT CORPUS</span><span>1 LAPSED · 1 UNKNOWN</span>
        </div>
        <div className="mt-1 text-center text-[12.5px] font-semibold text-[#d8d8de]">your-repo</div>
        <div className="text-center font-mono text-[9.5px] text-[#9a9aa1]">your-repo/.xeno/corpus</div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {cards.map((c) => (
            <div key={c.id} className={`rounded-[5px] border px-2.5 py-2 ${c.state === 'lapsed' ? 'border-[#ef4444]/40 bg-[#ef4444]/[0.06]' : 'border-white/[0.08] bg-white/[0.02]'}`}>
              <div className="flex items-center gap-1.5 font-mono text-[9px] text-[#9a9aa1]">
                <span className={`inline-block h-[7px] w-[7px] rounded-full ${tone[c.state].dot}`} />{tone[c.state].label}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-[#d8d8de]">{c.claim}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-auto font-mono text-[9.5px] leading-[1.7] text-[#5d5850]">
        Every claim is bound to the check that can prove it false. A claim that was not checked says UNKNOWN, never HELD.
      </div>
    </div>
  </div>
);

export default CorpusShape;
