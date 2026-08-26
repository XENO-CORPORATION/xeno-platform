import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MessageSquare, CheckCircle2, Clock, Loader2, PenLine, Info, Sparkles, Layers, Search, Hash, User,
} from 'lucide-react';
import ForumShell, {
  RailSearch, RailNeedsAnswer, RailResolved, RailAgents,
} from '../components/forum/ForumShell';
import { AuthorBadge, TagChip, PostAvatar, relativeTime, type ForumThreadSummary } from '../components/forum/primitives';
import * as api from '../components/forum/api';

/**
 * XENO Forum — the stream.
 *
 * Two surfaces over one corpus (D2): **The Record** (unranked, permanent) and
 * **For you** (ranked, personal). The shell is borrowed from the social
 * platforms because their ergonomics genuinely work; the signals are inverted
 * because their objective does not. See ForumShell.tsx for that split in full.
 *
 * The one thing this page will never show is a popularity metric. No views, no
 * likes, no follower counts (D4 — there is no follow graph to count). The action
 * row on every card carries RESOLUTION STATE instead: answered, or unanswered
 * and for how long. That is the thesis rendered as a row of pixels.
 */

interface ForumSpace {
  slug: string; name: string; description: string;
  kind: 'qa' | 'discussion' | 'showcase' | 'feedback' | 'announcement';
  postPolicy: string; threadCount: number;
}

const SORTS = [
  { key: 'active', label: 'Recently active' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'solved', label: 'Answered' },
] as const;

/* ────────────────────────────────────────────────────────────────────────
 * Inline composer — the "What's happening?" affordance.
 *
 * The single best thing the social shells do: posting costs no navigation.
 * Collapsed it is one line; expanded it posts without leaving the stream. The
 * full composer at /forum/new still exists for the long form, and it is where
 * compose-time dedup lives (D10).
 * ──────────────────────────────────────────────────────────────────────── */
function InlineComposer({ spaces, onPosted, initial = '\u2022' }: { spaces: ForumSpace[]; onPosted: () => void; initial?: string }) {
  const [open, setOpen] = useState(false);
  const [space, setSpace] = useState('help');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const postable = spaces.filter((s) => s.postPolicy !== 'staff_only');
  const active = postable.find((s) => s.slug === space);
  const prompt = active?.kind === 'qa' ? 'What are you stuck on?'
    : active?.kind === 'showcase' ? 'What did you build?'
    : active?.kind === 'feedback' ? "What's wrong, or missing?"
    : 'What are you thinking about?';

  if (!api.isSignedIn()) {
    return (
      <div className="rounded-md border border-white/10 bg-[#060608] px-4 py-3.5 text-[13px] text-[#a8a8b1]">
        <a href="/login" className="text-[#e5e5e9] font-medium hover:text-white">Sign in</a>{' '}
        to post. Reading never needs an account.
      </div>
    );
  }

  if (!open) {
    // Reads as an INPUT, not a button. Every social composer does this — an
    // avatar beside a field you can obviously type into — and it is the single
    // cheapest signal that this is a place where you write rather than a link
    // that takes you somewhere else.
    //
    // The avatar is a SQUARE. DESIGN_SYSTEM.md §3: "No circles. Anywhere." — so
    // the one motif every one of these platforms shares is the one we do not
    // copy.
    return (
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-white/10 bg-[#060608] text-[13px] font-medium text-[#a8a8b1]">
          {initial}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer flex h-10 flex-1 items-center rounded-md border border-white/10 bg-[#060608] px-4 text-left text-[14px] text-[#79797f] transition-colors hover:border-white/[0.15] hover:text-[#a8a8b1]"
        >
          {prompt}
        </button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.createThread({ space, title, body, tags: [] });
      setTitle(''); setBody(''); setOpen(false);
      onPosted();
    } catch (err: any) {
      setError(err.message || 'Could not post that.');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="rounded-md border border-white/[0.15] bg-[#060608] p-4">
      <div className="flex items-center gap-2">
        <select
          value={space} onChange={(e) => setSpace(e.target.value)}
          className="cursor-pointer rounded-md border border-white/10 bg-[#101011] px-2.5 py-1.5 text-[12.5px] text-[#e5e5e9] outline-none"
        >
          {postable.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </select>
        <span className="text-[11.5px] text-[#57575e]">
          {active?.kind === 'qa' ? 'answers can be accepted here' : 'no accepted answer in this space'}
        </span>
      </div>

      <input
        autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300}
        placeholder={prompt}
        className="mt-3 w-full bg-transparent text-[17px] text-white outline-none placeholder:text-[#57575e]"
      />
      <textarea
        value={body} onChange={(e) => setBody(e.target.value)} rows={4}
        placeholder="Add the detail that makes it answerable — version, exact error, what you tried."
        className="mt-2 w-full resize-y bg-transparent text-[14px] leading-relaxed text-[#e5e5e9] outline-none placeholder:text-[#57575e]"
      />

      {error && <div className="mb-2 text-[12.5px] text-red-300/90">{error}</div>}

      <div className="flex items-center justify-between border-t border-white/[0.08] pt-3">
        <Link to="/forum/new" className="text-[12px] text-[#79797f] transition-colors hover:text-[#e5e5e9]">
          Full composer — tags, and a duplicate check
        </Link>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOpen(false)} className="cursor-pointer text-[13px] text-[#79797f] hover:text-[#e5e5e9]">
            Cancel
          </button>
          <button
            type="submit" disabled={busy || !title.trim() || !body.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/[0.15] bg-white/[0.15] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.25] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Post
          </button>
        </div>
      </div>
    </form>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The card.
 *
 * Compare its action row to X's: `581 replies · 423 reposts · 3.3K likes ·
 * 700K views`. Three of those four are popularity and the fourth is a raw
 * attention counter. Ours reads `4 replies · Answered`, or
 * `2 replies · Unanswered · waiting 3d`.
 *
 * Same position, same glance, opposite meaning: theirs tells you how much
 * attention a post captured, ours tells you whether it still needs a person.
 * ──────────────────────────────────────────────────────────────────────── */
function PostCard({ thread, why }: { thread: ForumThreadSummary; why?: string }) {
  const isQa = thread.space?.kind === 'qa';
  const waiting = isQa && !thread.isResolved;
  const replies = Math.max(0, thread.postCount - 1);

  return (
    <article className="border-b border-white/[0.08] transition-colors hover:bg-white/[0.05]">
      <Link to={thread.url} onClick={() => api.markOpened(thread.shortId)} className="flex gap-3 px-4 py-4">
        <PostAvatar author={thread.author} />
        <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
          <AuthorBadge author={thread.author} />
          <span className="text-[#57575e]">·</span>
          <span className="text-[#79797f]">{relativeTime(thread.createdAt)} ago</span>
          {thread.space && (
            <>
              <span className="text-[#57575e]">·</span>
              <span className="text-[#79797f]">{thread.space.name}</span>
            </>
          )}
        </div>

        {/* Why this is on your feed — D11. Never present on the Record. */}
        {why && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] text-[#79797f]">
            <Info className="h-3 w-3" />
            {why}
          </div>
        )}

        <h3 className="mt-1.5 text-[16px] font-medium leading-snug text-white">
          {thread.title}
        </h3>

        {thread.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {thread.tags.slice(0, 4).map((t) => <TagChip key={t} tag={t} />)}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 text-[#79797f]">
            <MessageSquare className="h-3.5 w-3.5" />
            {replies} {replies === 1 ? 'reply' : 'replies'}
          </span>

          {isQa && thread.isResolved && (
            <span className="inline-flex items-center gap-1.5 text-emerald-400/75">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Answered
            </span>
          )}

          {waiting && (
            <span className="inline-flex items-center gap-1.5 text-amber-400/70">
              <Clock className="h-3.5 w-3.5" />
              Unanswered · waiting {relativeTime(thread.createdAt)}
            </span>
          )}

          {thread.source && <span className="text-[#57575e]">from the engineering log</span>}
        </div>
        </div>
      </Link>
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

const Forum: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const space = params.get('space') || '';
  const tag = params.get('tag') || '';
  const sort = params.get('sort') || 'active';

  const [spaces, setSpaces] = useState<ForumSpace[]>([]);
  const [threads, setThreads] = useState<ForumThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [surface, setSurface] = useState<'feed' | 'record' | 'mine'>('record');
  const [mine, setMine] = useState<any[] | null>(null);
  const [mineLoading, setMineLoading] = useState(false);
  const [feedItems, setFeedItems] = useState<any[]>([]);
  const [feedRanker, setFeedRanker] = useState('unsolved-for-me');
  const [feedRankers, setFeedRankers] = useState<Record<string, string>>({});
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [queryInput, setQueryInput] = useState('');
  const [searchResults, setSearchResults] = useState<ForumThreadSummary[] | null>(null);

  const [initial, setInitial] = useState('\u2022');
  const [viewer, setViewer] = useState<any>(null);
  const [signedOut, setSignedOut] = useState(false);
  const signedIn = api.isSignedIn() && !signedOut;
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    api.getSpaces().then((r) => setSpaces(r.spaces || [])).catch(() => setSpaces([]));
  }, []);

  // Just enough identity for the composer avatar and the header. Fails
  // silently — a missing initial is a dot, never an error.
  useEffect(() => {
    if (!api.isSignedIn()) return;
    api.getMe()
      .then((r) => {
        if (r?.actor) setViewer(r.actor);
        const name = r?.actor?.displayName || r?.actor?.handle || '';
        if (name) setInitial(name.trim().charAt(0).toUpperCase());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams();
    if (space) qs.set('space', space);
    if (tag) qs.set('tag', tag);
    if (sort) qs.set('sort', sort);
    api.getThreads(qs.toString())
      .then((r) => { if (!cancelled) setThreads(r.threads || []); })
      .catch(() => { if (!cancelled) setThreads([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [space, tag, sort, reloadKey]);

  // Fetched on selection, not on mount: most visits never open it, and a
  // history query is the most expensive read in the product.
  useEffect(() => {
    if (surface !== 'mine' || !signedIn) return;
    let cancelled = false;
    setMineLoading(true);
    api.getMyActivity()
      .then((r) => { if (!cancelled) setMine(r.threads || []); })
      .catch(() => { if (!cancelled) setMine([]); })
      .finally(() => { if (!cancelled) setMineLoading(false); });
    return () => { cancelled = true; };
  }, [surface, signedIn, reloadKey]);

  useEffect(() => {
    if (surface !== 'feed' || !signedIn) return;
    let cancelled = false;
    setFeedLoading(true); setFeedError(null);
    api.getFeed(feedRanker)
      .then((r) => { if (cancelled) return; setFeedItems(r.items || []); setFeedRankers(r.rankers || {}); })
      .catch((e) => {
        if (cancelled) return;
        // 401 = the token was stale and api.ts has just cleared it. That is not an
        // error to show; it means "you are signed out", so fall back to that view.
        if (e?.status === 401) { setSignedOut(true); setFeedItems([]); return; }
        setFeedError(e.message || 'Could not load your feed.');
      })
      .finally(() => { if (!cancelled) setFeedLoading(false); });
    return () => { cancelled = true; };
  }, [surface, feedRanker, signedIn, reloadKey]);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setSearchResults(null); return; }
    try {
      const r = await api.search(trimmed);
      setSearchResults(r.results || []);
    } catch { setSearchResults([]); }
  }, []);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const activeSpace = useMemo(() => spaces.find((s) => s.slug === space), [spaces, space]);

  // Rail data, derived from what is already loaded — no extra requests, and no
  // "trending" computation anywhere.
  const needsAnswer = useMemo(
    () => threads
      .filter((t) => t.space?.kind === 'qa' && !t.isResolved)
      .map((t) => ({ ...t, waitedFor: relativeTime(t.createdAt) }))
      .slice(0, 5),
    [threads],
  );
  const recentlyResolved = useMemo(() => threads.filter((t) => t.isResolved).slice(0, 4), [threads]);

  const rightRail = (
    <>
      <RailSearch
        value={queryInput}
        onChange={(e: any) => { setQueryInput(e.target.value); if (!e.target.value.trim()) setSearchResults(null); }}
        onSubmit={(e: any) => { e.preventDefault(); runSearch(queryInput); }}
        onClear={() => { setQueryInput(''); setSearchResults(null); }}
        resultCount={searchResults?.length}
      />
      <RailNeedsAnswer threads={needsAnswer} />
      <RailResolved threads={recentlyResolved} />
      <RailAgents />
    </>
  );

  const visible = searchResults ?? threads;

  return (
    <ForumShell
        spaces={spaces}
        activeSpace={space}
        onSelectSpace={(s) => setParam('space', s === space ? '' : s)}
        surface={surface}
        onSelectSurface={setSurface}
        rightRail={rightRail}
        viewer={viewer}
      >
        {/*
          Segmented control, not an underlined tab bar.

          The underline is an X/Twitter convention and it came in with the rest of
          that borrow. DESIGN_SYSTEM.md has no underlined tab: the selected state
          is `white/0.15` with `borderStrong`, and the shape language is
          rectangles with a small radius. A segment that fills when active says
          "this one is on" using the same vocabulary as every other control in the
          system, instead of a floating bar that belongs to a different one.
        */}
        {/*
          ONE header strip, not three.

          The centre column had a segmented control, then a composer, then a
          separate filter row — three bands of chrome before a single piece of
          content. X and LinkedIn both get to content in two. Surface switch and
          sort now share one line, and the space name is gone from here entirely
          because the left rail already highlights which space you are in;
          repeating it was the third strip's only real job.
        */}
        <div className="sticky top-0 z-10 mb-4 flex items-center justify-between gap-3 border-b border-white/[0.08] bg-[#08080a]/90 py-3 backdrop-blur-xl">
          <div className="inline-flex gap-1 rounded-md border border-white/[0.08] bg-[#060608] p-1">
            {([
              ['record', 'The Record', Layers],
              ['feed', 'For you', Sparkles],
              ...(signedIn ? [['mine', 'Yours', User]] : []),
            ] as const).map(([key, label, Icon]: any) => (
              <button
                key={key} type="button" onClick={() => setSurface(key as any)}
                className={`cursor-pointer inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13.5px] transition-colors ${
                  surface === key
                    ? 'border border-white/[0.15] bg-white/[0.15] font-medium text-white'
                    : 'border border-transparent text-[#a8a8b1] hover:bg-white/[0.05] hover:text-[#e5e5e9]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {surface === 'record' && (
            <select
              value={sort} onChange={(e) => setParam('sort', e.target.value)}
              className="cursor-pointer shrink-0 rounded-md border border-white/[0.08] bg-[#101011] px-2.5 py-2 text-[12.5px] text-[#a8a8b1] outline-none transition-colors hover:text-[#e5e5e9]"
            >
              {SORTS.map((so) => <option key={so.key} value={so.key}>{so.label}</option>)}
            </select>
          )}
        </div>

        {/*
          ── Compact controls: present only where the rails are NOT ────────────

          The rails own these controls at desktop — search in the right rail,
          spaces in the left. But the two rails appear at DIFFERENT breakpoints
          (right at lg / 1024, left at xl / 1280), so between them there was a
          band where the left rail had already vanished and nothing replaced it:
          from 1024px down there was no way to filter by space AT ALL, and from
          1024px down, no way to search either.

          That gap came from a correct decision applied one breakpoint too
          widely. The centre column dropped its space filter because "the left
          rail already highlights which space you are in" — true at xl, false
          on every laptop narrower than 1280 and every phone.

          So each control reappears exactly where its rail disappears, and not
          one pixel earlier:
            • search — lg:hidden  (right rail covers >= 1024)
            • spaces — xl:hidden  (left rail covers >= 1280)

          Between 1024 and 1279 that yields chips but no search box, which is
          the correct answer rather than a compromise: search is already on
          screen in the rail, space navigation is not.
        */}
        <div className="mb-4 space-y-3">
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(queryInput); }}
            className="relative px-4 lg:hidden"
          >
            <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-[#79797f]" />
            <input
              value={queryInput}
              onChange={(e) => { setQueryInput(e.target.value); if (!e.target.value.trim()) setSearchResults(null); }}
              placeholder="Search the record"
              className="w-full rounded-md border border-white/10 bg-[#060608] py-2.5 pl-10 pr-4 text-[13.5px] text-[#e5e5e9] outline-none transition-colors placeholder:text-[#57575e] focus:border-white/[0.15]"
            />
          </form>

          {spaces.length > 0 && (
            /* Horizontally scrollable, edge-to-edge — the phone pattern. The
               negative margin lets chips bleed to the screen edge so the row
               reads as scrollable instead of clipped. */
            <div className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] xl:hidden">
              <button
                type="button"
                onClick={() => setParam('space', '')}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] transition-colors ${
                  !space
                    ? 'border-white/[0.15] bg-white/[0.15] font-medium text-white'
                    : 'border-white/[0.08] bg-[#060608] text-[#a8a8b1] hover:text-[#e5e5e9]'
                }`}
              >
                All
              </button>
              {spaces.map((sp) => (
                <button
                  key={sp.slug}
                  type="button"
                  onClick={() => setParam('space', sp.slug === space ? '' : sp.slug)}
                  className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] transition-colors ${
                    space === sp.slug
                      ? 'border-white/[0.15] bg-white/[0.15] font-medium text-white'
                      : 'border-white/[0.08] bg-[#060608] text-[#a8a8b1] hover:text-[#e5e5e9]'
                  }`}
                >
                  <Hash className="h-3 w-3 shrink-0 opacity-60" />
                  {sp.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4 pb-16">
          <div className="px-4">
            <InlineComposer spaces={spaces} onPosted={() => setReloadKey((k) => k + 1)} initial={initial} />
          </div>

          {surface === 'mine' ? (
            /*
              Your own history. Deliberately NOT ranked and NOT scored — this is
              a memory aid, and the only useful order for "where was that thing"
              is when it last moved.

              Each row says whether you ASKED or ANSWERED. Those are different
              memories, and a list that flattens them is harder to scan, not
              simpler — the same explain-yourself rule the Feed follows (D11).
            */
            mineLoading && mine === null ? (
              <div className="flex justify-center py-10 text-[#57575e]"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : !mine?.length ? (
              <div className="mx-4 rounded-md border border-white/10 bg-[#060608] px-4 py-3.5 text-[13px] text-[#a8a8b1]">
                Nothing yet. Threads you ask or answer show up here.
              </div>
            ) : (
              <div>
                {mine.map((t: any) => (
                  <div key={t.shortId}>
                    <div className="px-4 pt-3 text-[11.5px] text-[#57575e]">
                      {t.mine === 'asked'
                        ? 'You asked this'
                        : t.myReplies > 1
                          ? 'You answered this · ' + t.myReplies + ' replies'
                          : 'You answered this'}
                    </div>
                    <PostCard thread={t} />
                  </div>
                ))}
              </div>
            )
          ) : surface === 'feed' ? (
            !signedIn ? (
              <div className="mx-4 rounded-md border border-white/10 bg-[#060608] px-4 py-3.5 text-[13px] text-[#a8a8b1]">
                <a href="/login" className="text-[#e5e5e9] font-medium hover:text-white">Sign in</a>{' '}
                for a personal feed. The Record is readable by anyone.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 px-4">
                  {Object.entries(feedRankers).map(([key, label]) => (
                    <button
                      key={key} type="button" onClick={() => setFeedRanker(key)}
                      className={`cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
                        feedRanker === key ? 'bg-white/[0.15] text-white' : 'text-[#a8a8b1] hover:text-[#e5e5e9]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="flex items-start gap-2 px-4 text-[11.5px] leading-relaxed text-[#79797f]">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Ranked to get questions answered, not to keep you scrolling. Every item says why
                  it is here, and anything you have read drops away.
                </p>
                {feedError && <div className="mx-4 text-[13px] text-red-300/90">{feedError}</div>}
                {feedLoading ? (
                  <div className="py-16 text-center text-[13px] text-[#79797f]">Loading…</div>
                ) : feedItems.length === 0 ? (
                  <div className="py-16 text-center text-[13px] text-[#79797f]">Nothing needs you right now.</div>
                ) : (
                  <div>{feedItems.map((i) => <PostCard key={i.shortId} thread={i} why={i.why} />)}</div>
                )}
              </>
            )
          ) : (
            <>
              {/* Only the things the header cannot carry: an active tag, and a
                  search result count. The space name lives in the left rail. */}
              {(tag || searchResults) && (
                <div className="flex items-center gap-2 px-4 text-[12.5px] text-[#79797f]">
                  {searchResults && <span>{searchResults.length} results</span>}
                  {tag && (
                    <button
                      type="button" onClick={() => setParam('tag', '')}
                      className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#060608] px-2 py-1 text-[#a8a8b1] transition-colors hover:border-white/[0.15] hover:text-[#e5e5e9]"
                    >
                      {tag}<span className="text-[#57575e]">×</span>
                    </button>
                  )}
                </div>
              )}

              {loading ? (
                <div className="py-16 text-center text-[13px] text-[#79797f]">Loading…</div>
              ) : visible.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-[#79797f]">Nothing here yet.</div>
              ) : (
                <div>{visible.map((t) => <PostCard key={t.shortId} thread={t} />)}</div>
              )}
            </>
          )}
        </div>
    </ForumShell>
  );
};

export default Forum;
