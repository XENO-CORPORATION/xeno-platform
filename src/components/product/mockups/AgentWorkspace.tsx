import React from 'react';

/* Hero mockup — the XENO Agent desktop workspace, recreated in the landing-v3
 * language (no AI-generated imagery, no screenshots). Faithful to what the app
 * actually is: a frameless window whose HEADER carries durable conversation
 * session tabs (Ctrl+T / Ctrl+W / Ctrl+Tab), a workspace rail, a turn showing
 * tool calls with a reviewable diff, and an integrated terminal.
 *
 * The provider/model chip is deliberately generic. The real interface builds its
 * catalog from live provider descriptors and hardcodes no model family, so
 * naming one here would misrepresent the product.
 *
 * The UNSIGNED BUILD badge is in the mockup because it is in the app. Showing
 * the honest thing the product does is better than quietly cropping it out.
 *
 * Accent uses rgb(var(--acc)) so the theme switch recolors it; diff red/green
 * are fixed semantics. Sibling of AgentCliTerminal (the terminal product). */

const V = 'rgb(var(--acc))';
const C = {
  green: '#5fd08a',
  red: '#e88a8a',
  dim: '#5d5850',
  text: '#a7a099',
  bright: '#d3cdc3',
};

/** A conversation session tab in the app header. */
function Tab({ label, active, status }: { label: string; active?: boolean; status?: 'running' | 'idle' }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-t-[5px] border-x border-t px-2.5 py-1 text-[10.5px] ${
        active ? 'border-white/[0.10] bg-[#111114]' : 'border-transparent bg-transparent'
      }`}
      style={{ color: active ? C.bright : C.dim }}
    >
      {status === 'running' ? (
        <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: V }} />
      ) : (
        <span className="h-1.5 w-1.5 rounded-[1px] border" style={{ borderColor: C.dim }} />
      )}
      <span>{label}</span>
      <span style={{ color: C.dim }}>×</span>
    </div>
  );
}

/** A tool call the agent made, with its result. */
function ToolRow({ name, args, result }: { name: string; args: string; result: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline gap-1.5">
        <span style={{ color: V }}>■</span>
        <span style={{ color: C.bright }}>{name}</span>
        <span style={{ color: C.dim }}>({args})</span>
      </div>
      <div className="pl-3.5" style={{ color: C.dim }}>
        <span className="mr-1.5">⎿</span>
        {result}
      </div>
    </div>
  );
}

const AgentWorkspace: React.FC = () => (
  <div className="relative mx-auto w-full max-w-[860px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#08080a] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* frameless titlebar + session tabs */}
    <div className="flex items-end justify-between border-b border-white/[0.06] bg-[#0d0d10] pl-3 pr-2 pt-2">
      <div className="flex items-end gap-1">
        <span className="mb-1.5 mr-2 text-[10.5px] font-semibold tracking-wide" style={{ color: V }}>
          XENO AGENT
        </span>
        <Tab label="acme-api" active status="running" />
        <Tab label="rate limiter" status="idle" />
        <Tab label="flaky test" status="idle" />
        <span className="mb-1 px-1.5 text-[11px]" style={{ color: C.dim }}>+</span>
      </div>
      <div className="mb-1.5 flex items-center gap-3 text-[10px]" style={{ color: C.dim }}>
        <span>—</span>
        <span>▢</span>
        <span>×</span>
      </div>
    </div>

    <div className="flex h-[clamp(392px,52vh,468px)]">
      {/* workspace rail */}
      <div className="hidden w-[164px] shrink-0 flex-col gap-3 border-r border-white/[0.06] px-3 py-3 sm:flex">
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-[0.14em]" style={{ color: C.dim }}>
            Workspace
          </div>
          <div className="truncate font-mono text-[10.5px]" style={{ color: C.bright }}>
            ~/acme-api
          </div>
        </div>
        <div className="space-y-1 font-mono text-[10.5px]" style={{ color: C.text }}>
          <div style={{ color: C.dim }}>src/</div>
          <div className="pl-2">auth/</div>
          <div className="pl-4" style={{ color: C.bright }}>
            session.ts
          </div>
          <div className="pl-4">tokens.ts</div>
          <div className="pl-2">server.ts</div>
        </div>
        <div className="mt-auto space-y-1">
          <div className="text-[9px] uppercase tracking-[0.14em]" style={{ color: C.dim }}>
            Checkpoints
          </div>
          <div className="font-mono text-[10px]" style={{ color: C.text }}>
            3 · restore verified
          </div>
        </div>
      </div>

      {/* conversation */}
      <div className="flex min-w-0 flex-1 flex-col justify-between px-4 py-3 font-mono text-[11.5px] leading-[1.7]">
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <span style={{ color: V }}>›</span>
            <span style={{ color: C.bright }}>
              add a token-bucket rate limiter to /login and keep the auth suite green
            </span>
          </div>

          <div className="space-y-1.5" style={{ color: C.text }}>
            <ToolRow name="Read" args="src/auth/session.ts" result="128 lines" />
            <ToolRow
              name="Edit"
              args="src/auth/session.ts"
              result={
                <>
                  <span>proposed </span>
                  <span style={{ color: C.red }}>-1</span>
                  <span> / </span>
                  <span style={{ color: C.green }}>+7</span>
                  <div className="mt-1 space-y-px rounded-[3px] border border-white/[0.07] p-1">
                    <div className="rounded-[2px] px-1" style={{ color: C.red, background: 'rgba(120,30,30,0.28)' }}>
                      - export async function login(req) {'{'}
                    </div>
                    <div className="rounded-[2px] px-1" style={{ color: C.green, background: 'rgba(24,70,32,0.30)' }}>
                      + const limiter = tokenBucket({'{'} rate: 100, per: '1m' {'}'});
                    </div>
                    <div className="rounded-[2px] px-1" style={{ color: C.green, background: 'rgba(24,70,32,0.30)' }}>
                      + if (!limiter.take(req.ip)) return tooMany();
                    </div>
                    <div className="px-1" style={{ color: C.dim }}>
                      … +4 lines
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px]">
                    <span className="rounded-[3px] border px-1.5 py-0.5" style={{ borderColor: 'rgba(255,255,255,0.16)', color: C.bright }}>
                      Accept file
                    </span>
                    <span className="rounded-[3px] border px-1.5 py-0.5" style={{ borderColor: 'rgba(255,255,255,0.10)', color: C.dim }}>
                      Accept hunk
                    </span>
                    <span className="rounded-[3px] border px-1.5 py-0.5" style={{ borderColor: 'rgba(255,255,255,0.10)', color: C.dim }}>
                      Reject
                    </span>
                  </div>
                </>
              }
            />
          </div>

          {/* terminal */}
          <div className="rounded-[4px] border border-white/[0.07] bg-[#0b0b0e] px-2 py-1.5">
            <div className="mb-0.5 text-[9px] uppercase tracking-[0.14em]" style={{ color: C.dim }}>
              Terminal
            </div>
            <div style={{ color: C.text }}>
              <span style={{ color: C.dim }}>$</span> npm test -- auth
            </div>
            <div>
              <span style={{ color: C.green }}>✓</span> <span style={{ color: C.dim }}>24 passed (1.8s)</span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="border-t border-white/[0.06] pt-2">
            <span style={{ color: V }}>›</span> <span style={{ color: C.dim }}>Ask, or describe a change…</span>
          </div>
          <div className="flex items-center justify-between text-[10px]" style={{ color: C.dim }}>
            <span>connected provider · reasoning: high</span>
            <span>session restored · 3 tabs</span>
          </div>
        </div>
      </div>
    </div>

    {/* the badge the real app shows — it is unsigned, and it says so */}
    <div
      className="pointer-events-none absolute bottom-2.5 right-2.5 rounded-[3px] border px-1.5 py-[3px] text-[9px] tracking-[0.08em]"
      style={{ borderColor: 'rgba(255,255,255,0.22)', background: 'rgba(10,10,10,0.86)', color: 'rgba(255,255,255,0.72)' }}
    >
      UNSIGNED BUILD
    </div>
  </div>
);

export default AgentWorkspace;
