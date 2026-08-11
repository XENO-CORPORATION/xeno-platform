import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home, Layers, Hash, Search, PenLine, Bot, CheckCircle2, Clock,
} from 'lucide-react';
import Header from '../landing-v3/Header';

/**
 * The forum application shell.
 *
 * ── WHAT THIS BORROWS, AND WHAT IT REFUSES ──────────────────────────────────
 *
 * X, Facebook and LinkedIn converged on the same shell — persistent left nav,
 * an inline composer at the top of the stream, a centre column, a context rail —
 * because it genuinely works. Destinations stay reachable, posting costs no
 * navigation, and the eye has one column to track. We take all of that.
 *
 * What we do NOT take is the instrumentation, because every one of those numbers
 * exists to serve time-on-site:
 *
 *   X shows        700K views · 3.3K likes · 423 reposts · Trending · Live now
 *   LinkedIn shows follower counts · "Add to your feed" · promoted posts
 *   Facebook shows Stories · Sponsored inline with content
 *
 * None of that appears here. The same real estate carries the opposite signal:
 * where X puts a view counter, we put "unanswered for 3 days". Where they put
 * Trending (ranked by volume), we put "Needs an answer" (ranked by need). The
 * layout is theirs; the objective function is ours.
 *
 * No follower counts anywhere — D4. There is no follow graph to count.
 */

interface ForumShellProps {
  children: React.ReactNode;
  rightRail?: React.ReactNode;
  spaces?: Array<{ slug: string; name: string; kind: string; threadCount: number }>;
  activeSpace?: string;
  onSelectSpace?: (slug: string) => void;
  /** 'feed' | 'record' — which surface the centre column is showing. */
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
}) => {
  const { pathname } = useLocation();
  const onIndex = pathname === '/forum';

  return (
    <div className="min-h-screen bg-[#08080a] text-white">
      <Header onGetStarted={() => { window.location.href = '/auth'; }} />

      <div className="page-gutter w-full pb-16 pt-24">
        <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[236px_minmax(0,1fr)_340px]">

          {/* ── Left nav — persistent, the way every social shell does it ── */}
          <aside className="hidden xl:block">
            <div className="sticky top-24 space-y-6">
              <nav className="space-y-0.5">
                <NavItem
                  icon={Home} label="For you" active={onIndex && surface === 'feed'}
                  onClick={() => onSelectSurface?.('feed')}
                />
                <NavItem
                  icon={Layers} label="The Record" active={onIndex && surface === 'record'}
                  onClick={() => onSelectSurface?.('record')}
                />
              </nav>

              {spaces.length > 0 && (
                <div>
                  <h2 className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">
                    Spaces
                  </h2>
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

              {/*
                The big primary action, the one thing every social shell gets
                right: posting is never more than one click from anywhere.
              */}
              <Link
                to="/forum/new"
                className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/[0.15] bg-white/[0.15] text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.25]"
              >
                <PenLine className="h-4 w-4" />
                New post
              </Link>
            </div>
          </aside>

          {/* ── Centre ─────────────────────────────────────────────── */}
          <main className="min-w-0">{children}</main>

          {/* ── Right rail ─────────────────────────────────────────── */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-5">{rightRail}</div>
          </aside>
        </div>
      </div>
    </div>
  );
};

/** Search box for the right rail — the one thing X puts there that we keep verbatim. */
export function RailSearch({ value, onChange, onSubmit, onClear, resultCount }: any) {
  return (
    <form onSubmit={onSubmit} className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#79797f]" />
      <input
        value={value}
        onChange={onChange}
        placeholder="Search the record"
        className="w-full rounded-md border border-white/10 bg-white/[0.03] py-2.5 pl-10 pr-4 text-[13.5px] text-[#e5e5e9] outline-none transition-colors placeholder:text-[#57575e] focus:border-white/[0.15] focus:bg-white/[0.05]"
      />
      {typeof resultCount === 'number' && (
        <div className="mt-2 flex items-center gap-3 px-1 text-[12px] text-[#79797f]">
          <span>{resultCount} result{resultCount === 1 ? '' : 's'}</span>
          <button type="button" onClick={onClear} className="cursor-pointer text-[#a8a8b1] underline underline-offset-2 hover:text-[#e5e5e9]">
            clear
          </button>
        </div>
      )}
    </form>
  );
}

/**
 * "Needs an answer" — this occupies the slot where X puts **Trending** and
 * LinkedIn puts **Add to your feed**.
 *
 * Trending ranks by volume, which is why it rewards outrage. This ranks by an
 * unanswered question's age, which rewards closing loops. Same placement, same
 * glanceability, opposite incentive.
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
              <span className="line-clamp-2 text-[13px] leading-snug text-[#a8a8b1] transition-colors group-hover:text-white">
                {t.title}
              </span>
              <span className="mt-1 block text-[11.5px] text-[#79797f]">
                waiting {t.waitedFor}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Recently resolved — the archive growing. The anti-Stories: permanent, not ephemeral. */
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

/** The agent surface, advertised where the competition advertises Premium. */
export function RailAgents() {
  return (
    <div className="rounded-md border border-white/10 bg-[#060608] p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#e5e5e9]">
        <Bot className="h-3.5 w-3.5 text-[#a8a8b1]" />
        Readable by agents
      </h2>
      <p className="mt-2 text-[12px] leading-relaxed text-[#79797f]">
        Every thread has a permanent, citable id and is reachable over the API —
        so an agent can search this and quote it back with a link.
      </p>
      <code className="mt-2.5 block break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-[#a8a8b1]">
        GET /api/forum/search?q=…
      </code>
    </div>
  );
}

export default ForumShell;
