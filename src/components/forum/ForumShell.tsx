import React from 'react';
import { Link } from 'react-router-dom';
import {
  Home, Layers, Hash, Search, PenLine, Bot, CheckCircle2, Clock,
} from 'lucide-react';
import Header from '../landing-v3/Header';

/**
 * The forum application shell.
 *
 * ── IT IS AN APP, NOT A PAGE ────────────────────────────────────────────────
 *
 * X, Facebook and LinkedIn all do the same thing and it is worth stating
 * precisely, because the first version of this file got it wrong:
 *
 *   • the shell is VIEWPORT HEIGHT and the page itself never scrolls
 *   • the left and right rails are fixed full-height columns
 *   • ONLY the centre column scrolls
 *   • there is NO FOOTER under the feed — an infinite stream has no bottom to
 *     put one at, so a footer there is a promise the layout cannot keep
 *
 * The earlier version scrolled the whole page with sticky rails and a footer
 * after the grid, and then tried to stop the footer colliding with the rails by
 * bounding their height. That was treating the symptom: the collision only
 * existed because the page scrolled at all. Remove the page scroll and the
 * class of bug goes with it.
 *
 * Marketing pages keep the footer. An application surface does not.
 *
 * ── WHAT THIS BORROWS, AND WHAT IT REFUSES ──────────────────────────────────
 *
 * The ergonomics are theirs: persistent nav, composer at the top of the stream,
 * one column to track. The instrumentation is not, because all of it serves
 * time-on-site:
 *
 *   X shows        700K views · 3.3K likes · 423 reposts · Trending · Live now
 *   LinkedIn shows follower counts · "Add to your feed" · promoted posts
 *   Facebook shows Stories · Sponsored inline with content
 *
 * None of it appears here. The same real estate carries the opposite signal:
 * where X puts a view counter we put "unanswered for 3 days"; where they put
 * Trending (ranked by volume) we put "Needs an answer" (ranked by need).
 *
 * No follower counts anywhere — D4. There is no follow graph to count.
 */

interface ForumShellProps {
  children: React.ReactNode;
  rightRail?: React.ReactNode;
  spaces?: Array<{ slug: string; name: string; kind: string; threadCount: number }>;
  activeSpace?: string;
  onSelectSpace?: (slug: string) => void;
  surface?: 'feed' | 'record';
  onSelectSurface?: (s: 'feed' | 'record') => void;
}

function NavItem({ icon: Icon, label, active, onClick, to, count }: any) {
  const cls = `group flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] transition-colors ${
    active ? 'bg-white/[0.15] text-white' : 'text-[#a8a8b1] hover:bg-white/[0.05] hover:text-[#e5e5e9]'
  }`;
  const inner = (
    <>
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' && <span className="shrink-0 text-[12px] text-[#57575e]">{count}</span>}
    </>
  );
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

const ForumShell: React.FC<ForumShellProps> = ({
  children, rightRail, spaces = [], activeSpace = '', onSelectSpace, surface = 'record', onSelectSurface,
}) => (
  // h-screen + overflow-hidden: the PAGE never scrolls. pt-14 clears the fixed
  // 56px site header. min-h-0 on the body is what actually lets the children
  // overflow — without it a grid/flex child refuses to shrink below its content
  // and the inner scrollbars silently never appear.
  <div className="flex h-screen flex-col overflow-hidden bg-[#08080a] pt-14 text-white">
    <Header onGetStarted={() => { window.location.href = '/auth'; }} />

    <div className="page-gutter grid min-h-0 w-full flex-1 gap-x-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[236px_minmax(0,1fr)_340px]">

      {/* ── Left rail — fixed full height, scrolls only if it overflows ── */}
      <aside className="hidden min-h-0 flex-col overflow-y-auto py-5 xl:flex">
        <nav className="space-y-0.5">
          <NavItem icon={Home} label="For you" active={surface === 'feed'} onClick={() => onSelectSurface?.('feed')} />
          <NavItem icon={Layers} label="The Record" active={surface === 'record'} onClick={() => onSelectSurface?.('record')} />
        </nav>

        {spaces.length > 0 && (
          <div className="mt-6">
            <h2 className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">Spaces</h2>
            <nav className="mt-2 space-y-0.5">
              {spaces.map((sp) => (
                <NavItem
                  key={sp.slug} icon={Hash} label={sp.name} count={sp.threadCount}
                  active={activeSpace === sp.slug}
                  onClick={() => { onSelectSurface?.('record'); onSelectSpace?.(sp.slug); }}
                />
              ))}
            </nav>
          </div>
        )}

        <Link
          to="/forum/new"
          className="mt-6 flex h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-white/[0.15] bg-white/[0.15] text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.25]"
        >
          <PenLine className="h-4 w-4" />
          New post
        </Link>

        {/*
          The legal links live HERE, at the bottom of a rail, exactly where X and
          LinkedIn put theirs — not in a footer under an endless stream. mt-auto
          pins them to the bottom of the rail without needing a footer at all.
        */}
        <div className="mt-auto pt-8">
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 text-[11px] text-[#57575e]">
            <Link to="/privacy" className="transition-colors hover:text-[#a8a8b1]">Privacy</Link>
            <Link to="/terms" className="transition-colors hover:text-[#a8a8b1]">Terms</Link>
            <Link to="/docs" className="transition-colors hover:text-[#a8a8b1]">Docs</Link>
            <span>© {new Date().getFullYear()} XENO</span>
          </div>
        </div>
      </aside>

      {/* ── Centre — THE ONLY SCROLLING COLUMN ─────────────────────── */}
      <main className="min-h-0 overflow-y-auto">{children}</main>

      {/* ── Right rail — fixed full height ─────────────────────────── */}
      <aside className="hidden min-h-0 overflow-y-auto py-5 lg:block">
        <div className="space-y-5 pb-6">{rightRail}</div>
      </aside>
    </div>
  </div>
);

/** Search — the one thing X puts in the rail that we keep verbatim. */
export function RailSearch({ value, onChange, onSubmit, onClear, resultCount }: any) {
  return (
    <form onSubmit={onSubmit} className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#79797f]" />
      <input
        value={value} onChange={onChange} placeholder="Search the record"
        className="w-full rounded-md border border-white/10 bg-[#060608] py-2.5 pl-10 pr-4 text-[13.5px] text-[#e5e5e9] outline-none transition-colors placeholder:text-[#57575e] focus:border-white/[0.15]"
      />
      {typeof resultCount === 'number' && (
        <div className="mt-2 flex items-center gap-3 px-1 text-[12px] text-[#79797f]">
          <span>{resultCount} result{resultCount === 1 ? '' : 's'}</span>
          <button type="button" onClick={onClear} className="cursor-pointer font-medium text-[#a8a8b1] hover:text-[#e5e5e9]">clear</button>
        </div>
      )}
    </form>
  );
}

/**
 * "Needs an answer" — the slot where X puts **Trending** and LinkedIn puts
 * **Add to your feed**. Trending ranks by volume, which is why it rewards
 * outrage. This ranks by how long a question has gone unanswered, which rewards
 * closing loops. Same placement, opposite incentive.
 */
export function RailNeedsAnswer({ threads = [] }: { threads: any[] }) {
  if (!threads.length) return null;
  return (
    <div className="rounded-md border border-white/10 bg-[#060608] p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#e5e5e9]">
        <Clock className="h-3.5 w-3.5 text-amber-400/70" />
        Needs an answer
      </h2>
      <ul className="mt-3 space-y-3">
        {threads.slice(0, 5).map((t) => (
          <li key={t.shortId}>
            <Link to={t.url} className="group block">
              <span className="line-clamp-2 text-[13px] leading-snug text-[#a8a8b1] transition-colors group-hover:text-white">{t.title}</span>
              <span className="mt-1 block text-[11.5px] text-[#79797f]">waiting {t.waitedFor}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Recently answered — the anti-Stories: permanent, not ephemeral. */
export function RailResolved({ threads = [] }: { threads: any[] }) {
  if (!threads.length) return null;
  return (
    <div className="rounded-md border border-white/10 bg-[#060608] p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#e5e5e9]">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/70" />
        Recently answered
      </h2>
      <ul className="mt-3 space-y-2.5">
        {threads.slice(0, 4).map((t) => (
          <li key={t.shortId}>
            <Link to={t.url} className="line-clamp-2 block text-[13px] leading-snug text-[#a8a8b1] transition-colors hover:text-[#e5e5e9]">
              {t.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The agent surface, where the competition advertises Premium. */
export function RailAgents() {
  return (
    <div className="rounded-md border border-white/10 bg-[#060608] p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#e5e5e9]">
        <Bot className="h-3.5 w-3.5 text-[#79797f]" />
        Readable by agents
      </h2>
      <p className="mt-2 text-[12px] leading-relaxed text-[#79797f]">
        Every thread has a permanent, citable id and is reachable over the API — so an
        agent can search this and quote it back with a link.
      </p>
      <code className="mt-2.5 block break-all rounded border border-white/[0.08] bg-black/40 px-2 py-1.5 font-mono text-[11px] text-[#a8a8b1]">
        GET /api/forum/search?q=…
      </code>
    </div>
  );
}

export default ForumShell;
