import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, MessageSquare, CheckCircle2, Clock, Hash, Bot, Sparkles, Info } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { AuthorBadge, TagChip, relativeTime, type ForumThreadSummary } from '../components/forum/primitives';
import * as api from '../components/forum/api';

/**
 * XENO Forum — the Record (SPEC "XENO FORUM - SPEC.md" §5.1).
 *
 * This page renders the UNRANKED Record: sort is activity/newest/oldest only.
 * There is no score, no personalization, and deliberately no "trending" or
 * "popular" sort — §5.4 lists those as forbidden signals, and a sort option is
 * how they creep back in.
 *
 * The personal, ranked Feed is a separate surface and arrives in v0.4, where
 * every card must render WHY it is there (D11).
 *
 * Styling follows the root DESIGN_SYSTEM.md: dark, monochromatic, no brand
 * colour. Semantic colour appears only for status (resolved).
 */

interface ForumSpace {
  slug: string;
  name: string;
  description: string;
  kind: 'qa' | 'discussion' | 'showcase' | 'feedback' | 'announcement';
  postPolicy: string;
  threadCount: number;
}

interface ForumTag {
  tag: string;
  namespace: string;
  value: string;
  threadCount: number;
}

const SORTS = [
  { key: 'active', label: 'Recently active' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'solved', label: 'Solved' },
] as const;

function ThreadRow({ thread }: { thread: ForumThreadSummary }) {
  const waiting = !thread.isResolved && thread.space?.kind === 'qa';

  return (
    <Link
      to={thread.url}
      className="group block border-b border-white/[0.06] px-1 py-5 transition-colors hover:bg-white/[0.02]"
    >
      <div className="flex items-start gap-4">
        <div className="mt-0.5 shrink-0">
          {thread.isResolved ? (
            <CheckCircle2 className="h-[18px] w-[18px] text-emerald-400/70" aria-label="Resolved" />
          ) : (
            <MessageSquare className="h-[18px] w-[18px] text-white/25" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-medium leading-snug text-white/85 transition-colors group-hover:text-white">
            {thread.title}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-white/40">
            {thread.space && (
              <span className="text-white/50">{thread.space.name}</span>
            )}
            <span className="text-white/20">·</span>
            <AuthorBadge author={thread.author} />
            <span className="text-white/20">·</span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {thread.postCount}
            </span>

            {/*
              Waiting time is surfaced because §5.2 makes it a NEED signal — an
              unanswered question GAINS urgency with age. It is not "freshness",
              which §5.4 forbids as a ranking input.
            */}
            {waiting && (
              <>
                <span className="text-white/20">·</span>
                <span className="inline-flex items-center gap-1 text-amber-400/60">
                  <Clock className="h-3 w-3" />
                  unanswered for {relativeTime(thread.createdAt)}
                </span>
              </>
            )}
          </div>

          {thread.tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {thread.tags.map((t) => <TagChip key={t} tag={t} />)}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

const Forum: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const space = params.get('space') || '';
  const tag = params.get('tag') || '';
  const sort = params.get('sort') || 'active';

  const [spaces, setSpaces] = useState<ForumSpace[]>([]);
  const [tags, setTags] = useState<ForumTag[]>([]);
  const [threads, setThreads] = useState<ForumThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // The two surfaces over one corpus (D2): the Record is unranked and permanent,
  // the Feed is personal and ranked. Never two copies of the data — one corpus,
  // two views.
  const [surface, setSurface] = useState<'record' | 'feed'>('record');
  const [feedItems, setFeedItems] = useState<any[]>([]);
  const [feedRanker, setFeedRanker] = useState('unsolved-for-me');
  const [feedRankers, setFeedRankers] = useState<Record<string, string>>({});
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const signedIn = api.isSignedIn();

  const [queryInput, setQueryInput] = useState('');
  const [searchResults, setSearchResults] = useState<ForumThreadSummary[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [spaceRes, tagRes] = await Promise.all([
          fetch('/api/forum/spaces'),
          fetch('/api/forum/tags?limit=24'),
        ]);
        const spaceJson = await spaceRes.json();
        const tagJson = await tagRes.json();
        if (cancelled) return;
        setSpaces(spaceJson.spaces || []);
        setTags(tagJson.tags || []);
      } catch {
        if (!cancelled) { setSpaces([]); setTags([]); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const qs = new URLSearchParams();
        if (space) qs.set('space', space);
        if (tag) qs.set('tag', tag);
        if (sort) qs.set('sort', sort);
        const res = await fetch(`/api/forum/threads?${qs}`);
        const json = await res.json();
        if (cancelled) return;
        setThreads(json.threads || []);
      } catch {
        if (!cancelled) setThreads([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [space, tag, sort]);

  useEffect(() => {
    if (surface !== 'feed' || !signedIn) return;
    let cancelled = false;
    setFeedLoading(true);
    setFeedError(null);
    api.getFeed(feedRanker)
      .then((r) => {
        if (cancelled) return;
        setFeedItems(r.items || []);
        setFeedRankers(r.rankers || {});
      })
      .catch((e) => { if (!cancelled) setFeedError(e.message || 'Could not load your feed.'); })
      .finally(() => { if (!cancelled) setFeedLoading(false); });
    return () => { cancelled = true; };
  }, [surface, feedRanker, signedIn]);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/forum/search?q=${encodeURIComponent(trimmed)}`);
      const json = await res.json();
      setSearchResults(json.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const visible = searchResults ?? threads;
  const activeSpace = useMemo(() => spaces.find((s) => s.slug === space), [spaces, space]);

  return (
    <div className="min-h-screen bg-[#060606] text-white">
      <Header onGetStarted={() => { window.location.href = '/auth'; }} />

      <main className="page-gutter w-full pb-20 pt-28">
        {/* ── Masthead ─────────────────────────────────────────── */}
        <div className="border-b border-white/[0.07] pb-8">
          <h1 className="text-[34px] font-semibold tracking-tight">Forum</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/45">
            A public, permanent record of what this ecosystem figured out — readable by
            people and by agents. Questions get answered once and stay answered.
          </p>

          {/*
            v0.2: the Record is writable. The read-only banner that stood here is
            gone rather than reworded — a stale honesty notice is worse than none,
            because it trains people to ignore the next one.
          */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              to="/forum/new"
              className="inline-flex h-9 items-center rounded-md border border-white/20 px-4 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.06]"
            >
              New post
            </Link>
            <span className="text-[12px] text-white/35">
              Ask, discuss, report, or show what you built. Reading never needs an account.
            </span>
          </div>
        </div>

        {/* ── Search ───────────────────────────────────────────── */}
        <div className="mt-8">
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(queryInput); }}
            className="relative"
          >
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              value={queryInput}
              onChange={(e) => {
                setQueryInput(e.target.value);
                if (!e.target.value.trim()) setSearchResults(null);
              }}
              placeholder="Search the record — paste an exact error message"
              className="w-full rounded-lg border border-white/[0.09] bg-white/[0.02] py-3 pl-10 pr-4 text-[14px] text-white/85 outline-none transition-colors placeholder:text-white/25 focus:border-white/20 focus:bg-white/[0.035]"
            />
          </form>
          {searchResults !== null && (
            <div className="mt-3 flex items-center gap-3 text-[12px] text-white/40">
              <span>
                {searching ? 'Searching…' : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}
              </span>
              <button
                type="button"
                onClick={() => { setQueryInput(''); setSearchResults(null); }}
                className="text-white/50 underline underline-offset-2 transition-colors hover:text-white/80"
              >
                clear
              </button>
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[210px_minmax(0,1fr)_280px]">
          {/* ── Left rail: spaces ──────────────────────────────── */}
          <aside className="hidden xl:block">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Spaces</h2>
            <nav className="mt-3 space-y-0.5">
              <button
                type="button"
                onClick={() => setParam('space', '')}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                  !space ? 'bg-white/[0.09] text-white' : 'text-white/45 hover:text-white/75'
                }`}
              >
                All
              </button>
              {spaces.map((sp) => (
                <button
                  key={sp.slug}
                  type="button"
                  onClick={() => setParam('space', sp.slug)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                    space === sp.slug ? 'bg-white/[0.09] text-white' : 'text-white/45 hover:text-white/75'
                  }`}
                >
                  <span className="truncate">{sp.name}</span>
                  <span className="shrink-0 text-white/25">{sp.threadCount}</span>
                </button>
              ))}
            </nav>
          </aside>

          {/* ── Threads ────────────────────────────────────────── */}
          <div className="min-w-0">
            {/* ── Record vs Feed (D2) ──────────────────────────────── */}
            <div className="mb-4 flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-1">
              <button
                type="button" onClick={() => setSurface('record')}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
                  surface === 'record' ? 'bg-white/[0.09] text-white' : 'text-white/45 hover:text-white/75'}`}
              >
                The Record
              </button>
              <button
                type="button" onClick={() => setSurface('feed')}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
                  surface === 'feed' ? 'bg-white/[0.09] text-white' : 'text-white/45 hover:text-white/75'}`}
              >
                <Sparkles className="h-3 w-3" />
                For you
              </button>
            </div>

            {/* Sort — the spaces themselves live in the left rail now. */}
            <div className={`flex items-center justify-between border-b border-white/[0.07] pb-4 ${surface === 'feed' ? 'hidden' : ''}`}>
              <span className="text-[12.5px] text-white/40">
                {activeSpace ? activeSpace.name : 'All spaces'}
              </span>
              <select
                value={sort}
                onChange={(e) => setParam('sort', e.target.value)}
                className="cursor-pointer rounded-md border border-white/[0.09] bg-[#0f0f0f] px-2.5 py-1.5 text-[12px] text-white/60 outline-none transition-colors hover:text-white/85"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>

            {activeSpace && (
              <p className="pt-4 text-[13px] leading-relaxed text-white/40">{activeSpace.description}</p>
            )}

            {tag && (
              <div className="pt-4">
                <button
                  type="button"
                  onClick={() => setParam('tag', '')}
                  className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.07] px-2 py-1 text-[12px] text-white/70 transition-colors hover:bg-white/[0.11]"
                >
                  <Hash className="h-3 w-3" />
                  {tag}
                  <span className="ml-1 text-white/35">×</span>
                </button>
              </div>
            )}

            {surface === 'feed' ? (
              <div className="mt-2">
                {!signedIn ? (
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3.5 text-[12.5px] text-white/40">
                    <a href="/auth" className="text-white/70 underline underline-offset-2 hover:text-white">Sign in</a>{' '}
                    to get a feed. The Record is readable by anyone.
                  </div>
                ) : (
                  <>
                    {/*
                      The ranker is USER-SELECTABLE (§5.6). You can always leave.
                      A feed you cannot opt out of is the thing we are replacing.
                    */}
                    <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.07] pb-4">
                      {Object.entries(feedRankers).map(([key, label]) => (
                        <button
                          key={key} type="button" onClick={() => setFeedRanker(key)}
                          className={`rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
                            feedRanker === key ? 'bg-white/[0.09] text-white' : 'text-white/45 hover:text-white/75'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <p className="flex items-start gap-2 py-3 text-[11.5px] leading-relaxed text-white/30">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      Ranked to get questions answered — not to keep you here. Every item says why
                      it is on your list, and anything you have already read drops away.
                    </p>

                    {feedError && (
                      <div className="rounded-lg border border-red-500/25 bg-red-500/[0.04] px-3.5 py-2.5 text-[13px] text-red-300/90">{feedError}</div>
                    )}
                    {feedLoading ? (
                      <div className="py-16 text-center text-[13px] text-white/30">Loading…</div>
                    ) : feedItems.length === 0 ? (
                      <div className="py-16 text-center text-[13px] text-white/30">
                        Nothing needs you right now.
                      </div>
                    ) : (
                      feedItems.map((item) => (
                        <Link
                          key={item.shortId}
                          to={item.url}
                          onClick={() => api.markOpened(item.shortId)}
                          className="group block border-b border-white/[0.06] px-1 py-5 transition-colors hover:bg-white/[0.02]"
                        >
                          <h3 className="text-[15px] font-medium leading-snug text-white/85 transition-colors group-hover:text-white">
                            {item.title}
                          </h3>
                          {/*
                            D11 — the ship gate made visible. If this line is ever
                            empty, the ranker placed something it cannot justify.
                          */}
                          <div className="mt-1.5 text-[12px] text-white/45">{item.why}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-white/35">
                            {item.space && <span>{item.space.name}</span>}
                            <span className="text-white/20">·</span>
                            <AuthorBadge author={item.author} />
                            {item.tags?.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {item.tags.slice(0, 3).map((t: string) => <TagChip key={t} tag={t} />)}
                              </div>
                            )}
                          </div>
                        </Link>
                      ))
                    )}
                  </>
                )}
              </div>
            ) : (
            <div className="mt-2">
              {loading && searchResults === null ? (
                <div className="py-16 text-center text-[13px] text-white/30">Loading…</div>
              ) : visible.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-white/30">
                  Nothing here yet.
                </div>
              ) : (
                visible.map((t) => <ThreadRow key={t.shortId} thread={t} />)
              )}
            </div>
            )}
          </div>

          {/* ── Sidebar ────────────────────────────────────────── */}
          <aside className="space-y-8">
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Tags</h2>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button key={t.tag} type="button" onClick={() => setParam('tag', t.tag)}>
                    <TagChip tag={t.tag} count={t.threadCount} interactive />
                  </button>
                ))}
                {tags.length === 0 && <span className="text-[12px] text-white/25">—</span>}
              </div>
            </div>

            {/*
              The agent surface is stated on the page itself, not buried in docs.
              D9 makes machine-readability a contract; a forum that agents can
              query is the differentiator, so it is advertised where humans and
              agents both land.
            */}
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
              <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
                <Bot className="h-3.5 w-3.5" />
                For agents
              </h2>
              <p className="mt-2.5 text-[12px] leading-relaxed text-white/40">
                Every thread is readable over the API with a stable, citable id.
              </p>
              <code className="mt-2.5 block break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/50">
                GET /api/forum/search?q=…
              </code>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/30">
                Posting, subscriptions and the MCP server open when agent accounts do.
              </p>
            </div>
          </aside>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Forum;
