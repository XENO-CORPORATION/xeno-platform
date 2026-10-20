import React from 'react';

/* Hero mockup — a XENO Research notebook in the workspace (prototypes/xeno-workspace/platform-research.js), recreated
 * in the landing-v3 language (no AI-generated imagery). What it shows is what the platform does: cells run in XENO
 * Box with no network, the run is signed, a re-run says reproduced / changed / not reproduced, and a claimed cell is
 * held or lapsed. The numbers are illustrative, not a real study. Squares only: no circles, no motion. */

const C = { dim: '#5d5850', text: '#a7a099', bright: '#d3cdc3', line: 'rgba(255,255,255,0.07)' };
const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-block rounded-[3px] border border-white/[0.14] px-1.5 py-[1px] text-[10.5px] font-semibold" style={{ color: C.bright }}>{children}</span>
);

const ResearchNotebook: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#08080a] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d0d10] px-3.5 py-2.5 text-[11px]">
      <span style={{ color: C.dim }}>Projects / Thermal study / Notebooks /</span><span style={{ color: C.bright }}>Heat flux</span>
      <span className="ml-auto flex gap-1.5">
        <span className="rounded-[4px] border border-white/[0.1] px-2 py-[2px]" style={{ color: C.text }}>Lock</span>
        <span className="rounded-[4px] border border-white/[0.1] px-2 py-[2px]" style={{ color: C.text }}>Verify</span>
        <span className="rounded-[4px] bg-white/[0.88] px-2 py-[2px] font-semibold text-[#08080a]">Run</span>
      </span>
    </div>
    <div className="h-[clamp(340px,46vh,420px)] space-y-2 px-4 py-3.5 font-mono text-[11.5px] leading-[1.6]">
      <div style={{ color: C.dim }}>Locked · python 3.12 · 41 packages pinned with hashes · runs with no network</div>
      {[['[1]', 'df = pd.read_csv("flux.csv")', '1,204 rows'], ['[2]', 'fit = np.polyfit(df.t, df.q, 1)', 'slope 0.418 ± 0.006']].map(([ix, src, out]) => (
        <div key={ix} className="grid grid-cols-[34px_1fr] gap-2 border-t pt-2" style={{ borderColor: C.line }}>
          <span style={{ color: C.dim }}>{ix}</span>
          <div><div className="rounded-[4px] bg-white/[0.04] px-2.5 py-1.5" style={{ color: C.bright }}>{src}</div><div className="px-2.5 pt-1" style={{ color: C.text }}>{out}</div></div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: C.line }}>
        <Badge>Reproduced</Badge><Badge>Signature valid</Badge><span style={{ color: C.dim }}>re-run in XENO Box · every cell matched</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Held</Badge><span style={{ color: C.text }}>Claim: the fitted slope in cell [2] reproduces</span><span style={{ color: C.dim }}>· checked today</span>
      </div>
    </div>
  </div>
);

export default ResearchNotebook;
