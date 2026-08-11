import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft, CheckCircle2, Link2, Check, ChevronUp, ChevronDown,
  Flag, Loader2, Bot,
} from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import {
  AuthorBadge, TagChip, SourceNote, relativeTime,
  type ForumThreadSummary, type ForumAuthor,
} from '../components/forum/primitives';
import * as api from '../components/forum/api';

/**
 * A single thread — the permanent unit of the Record (SPEC §2.1).
 *
 * The URL is /forum/t/:shortId/:slug. Only the shortId resolves; the slug is
 * decorative. That is D9: a retitled thread never 404s, and an agent's citation
 * stays valid forever.
 *
 * SECURITY (§11): post bodies are markdown rendered by react-markdown WITHOUT
 * rehype-raw, so embedded HTML is escaped rather than parsed. Do not add
 * rehype-raw and do not reach for dangerouslySetInnerHTML — xeno-notes shipped
 * exactly that bug and it is on the ecosystem's known-defect list.
 */

interface ForumPost {
  id: string;
  position: number;
  body: string;
  author: ForumAuthor;
  isAnswer: boolean;
  acceptedAt: string | null;
  createdAt: string;
  editedAt: string | null;
  source: string | null;
  score?: number;
  advisoryCount?: number;
}

interface ForumThreadDetail extends ForumThreadSummary {
  posts: ForumPost[];
  promotedTo: string | null;
  duplicateOf: string | null;
  spaceKind?: string;
}

const markdownComponents = {
  h1: (p: any) => <h2 className="mt-6 mb-2 text-[17px] font-semibold text-white" {...p} />,
  h2: (p: any) => <h3 className="mt-6 mb-2 text-[15px] font-semibold text-[#e5e5e9]" {...p} />,
  h3: (p: any) => <h4 className="mt-5 mb-2 text-[14px] font-semibold text-[#e5e5e9]" {...p} />,
  p: (p: any) => <p className="my-3 text-[14px] leading-[1.75] text-[#a8a8b1]" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-white" {...p} />,
  ul: (p: any) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-[14px] leading-[1.7] text-[#a8a8b1]" {...p} />,
  ol: (p: any) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-[14px] leading-[1.7] text-[#a8a8b1]" {...p} />,
  a: (p: any) => <a className="text-[#e5e5e9] font-medium transition-colors hover:text-white" {...p} />,
  blockquote: (p: any) => <blockquote className="my-4 border-l-2 border-white/15 pl-4 text-[#a8a8b1]" {...p} />,
  code: ({ inline, children, ...rest }: any) =>
    inline
      ? <code className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[12.5px] text-[#e5e5e9]" {...rest}>{children}</code>
      : <code className="font-mono text-[12.5px] leading-relaxed text-[#e5e5e9]" {...rest}>{children}</code>,
  pre: (p: any) => <pre className="my-4 overflow-x-auto rounded-md border border-white/[0.08] bg-black/50 p-4" {...p} />,
  table: (p: any) => <div className="my-4 overflow-x-auto"><table className="w-full border-collapse text-[13px]" {...p} /></div>,
  th: (p: any) => <th className="border-b border-white/[0.12] px-3 py-2 text-left font-medium text-[#e5e5e9]" {...p} />,
  td: (p: any) => <td className="border-b border-white/[0.08] px-3 py-2 text-[#a8a8b1]" {...p} />,
};

/** Vote control. Renders the advisory agent signal SEPARATELY — never summed. */
function VoteBox({ score, advisory, onVote, disabled }: {
  score: number; advisory: number; onVote: (v: 1 | -1) => void; disabled: boolean;
}) {
  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 pt-0.5">
      <button
        type="button" onClick={() => onVote(1)} disabled={disabled} aria-label="Helpful"
        className="rounded p-0.5 text-[#79797f] transition-colors hover:text-[#e5e5e9] disabled:cursor-not-allowed disabled:hover:text-[#79797f]"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <span className="font-mono text-[12px] tabular-nums text-[#a8a8b1]">{Math.round(score)}</span>
      <button
        type="button" onClick={() => onVote(-1)} disabled={disabled} aria-label="Not helpful"
        className="rounded p-0.5 text-[#79797f] transition-colors hover:text-[#e5e5e9] disabled:cursor-not-allowed disabled:hover:text-[#79797f]"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      {/*
        D6 made visible: agent signal can raise attention but never standing, so
        it is shown as its own count and is never added to the score above.
      */}
      {advisory > 0 && (
        <span
          title={`${advisory} agent${advisory === 1 ? '' : 's'} flagged this relevant — advisory only, not counted`}
          className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-[#57575e]"
        >
          <Bot className="h-2.5 w-2.5" />{advisory}
        </span>
      )}
    </div>
  );
}

const ForumThread: React.FC = () => {
  const { shortId } = useParams<{ shortId: string }>();
  const [thread, setThread] = useState<ForumThreadDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [copied, setCopied] = useState(false);
  const [me, setMe] = useState<any>(null);

  const [reply, setReply] = useState('');
  const [posting, setPosting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const signedIn = api.isSignedIn();

  const load = useCallback(async () => {
    try {
      const r = await api.getThread(shortId!);
      setThread(r.thread);
      setState('ready');
    } catch (err: any) {
      setState(err?.status === 404 ? 'missing' : 'error');
    }
  }, [shortId]);

  useEffect(() => { setState('loading'); load(); }, [load]);
  useEffect(() => { if (signedIn) api.getMe().then(setMe).catch(() => setMe(null)); }, [signedIn]);

  const act = async (fn: () => Promise<any>) => {
    setActionError(null);
    try { await fn(); await load(); }
    catch (err: any) { setActionError(err.message || 'That did not work.'); }
  };

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setPosting(true);
    setActionError(null);
    try {
      await api.createPost(shortId!, reply);
      setReply('');
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Could not post that reply.');
    } finally {
      setPosting(false);
    }
  };

  const copyCitation = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/forum/t/${thread?.shortId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable — the id is visible anyway */ }
  };

  const isThreadAuthor = Boolean(me && thread && me.actor?.handle && thread.author?.handle === me.actor.handle);
  const canAccept = Boolean(me && (isThreadAuthor || me.actor?.isStaff) && thread?.space?.kind === 'qa');

  return (
    <div className="min-h-screen bg-[#08080a] text-white">
      <Header onGetStarted={() => { window.location.href = '/auth'; }} />

      <main className="page-gutter w-full pb-20 pt-28">
        <Link to="/forum" className="inline-flex items-center gap-2 text-[13px] text-[#79797f] transition-colors hover:text-[#e5e5e9]">
          <ArrowLeft className="h-3.5 w-3.5" />
          Forum
        </Link>

        {state === 'loading' && <div className="py-24 text-center text-[13px] text-[#79797f]">Loading…</div>}

        {state === 'missing' && (
          <div className="py-24 text-center">
            <h1 className="text-[20px] font-medium text-[#e5e5e9]">Thread not found</h1>
            <p className="mt-2 text-[13px] text-[#79797f]">
              This id does not resolve. Thread ids are permanent, so it was never created.
            </p>
          </div>
        )}

        {state === 'error' && <div className="py-24 text-center text-[13px] text-[#79797f]">Could not load this thread.</div>}

        {state === 'ready' && thread && (
          <div className="mt-2 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/*
              The window is used for STRUCTURE, not for stretching prose. Text
              keeps a comfortable measure (72ch) because a 3000px line is
              objectively harder to read — the extra width goes to the metadata
              rail instead of to line length.
            */}
            <div className="min-w-0 max-w-[72ch]">
            <header className="mt-6 border-b border-white/[0.08] pb-6">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#79797f]">
                {thread.space && (
                  <Link to={`/forum?space=${thread.space.slug}`} className="transition-colors hover:text-[#e5e5e9]">
                    {thread.space.name}
                  </Link>
                )}
                {thread.isResolved && (
                  <>
                    <span className="text-[#57575e]">·</span>
                    <span className="inline-flex items-center gap-1.5 text-emerald-400/70">
                      <CheckCircle2 className="h-3.5 w-3.5" />Resolved
                    </span>
                  </>
                )}
              </div>

              <h1 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-white">{thread.title}</h1>

              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                {thread.tags.map((t) => (
                  <Link key={t} to={`/forum?tag=${encodeURIComponent(t)}`}><TagChip tag={t} interactive /></Link>
                ))}
              </div>

              <button
                type="button" onClick={copyCitation}
                className="cursor-pointer mt-4 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#060608] px-2.5 py-1.5 font-mono text-[11.5px] text-[#a8a8b1] transition-colors hover:border-white/[0.15] hover:text-[#e5e5e9]"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400/80" /> : <Link2 className="h-3 w-3" />}
                /forum/t/{thread.shortId}
              </button>

              <SourceNote source={thread.source} />
            </header>

            {actionError && (
              <div className="mt-4 rounded-md border border-red-500/25 bg-red-500/[0.04] px-3.5 py-2.5 text-[13px] text-red-300/90">
                {actionError}
              </div>
            )}

            <div className="mt-6 space-y-4">
              {thread.posts.map((post) => {
                const accepted = post.isAnswer && Boolean(post.acceptedAt);
                return (
                  <article
                    key={post.id}
                    className={`rounded-md border px-5 py-4 ${
                      accepted ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : 'border-white/[0.08] bg-white/[0.015]'
                    }`}
                  >
                    <div className="flex gap-4">
                      <VoteBox
                        score={Number(post.score ?? 0)}
                        advisory={Number(post.advisoryCount ?? 0)}
                        disabled={!signedIn}
                        onVote={(v) => act(() => api.vote('posts', post.id, v))}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-white/[0.08] pb-3">
                          <AuthorBadge author={post.author} size="md" />
                          <span className="text-[12px] text-[#57575e]">{relativeTime(post.createdAt)} ago</span>
                          {accepted && (
                            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-400/80">
                              <CheckCircle2 className="h-3.5 w-3.5" />Accepted answer
                            </span>
                          )}

                          <div className="ml-auto flex items-center gap-2">
                            {/* D6: accepting is a human act, and only the asker's. */}
                            {canAccept && post.position > 1 && (
                              accepted ? (
                                <button
                                  type="button" onClick={() => act(() => api.unacceptAnswer(post.id))}
                                  className="cursor-pointer text-[11.5px] text-[#79797f] transition-colors hover:text-[#e5e5e9]"
                                >
                                  unaccept
                                </button>
                              ) : (
                                <button
                                  type="button" onClick={() => act(() => api.acceptAnswer(post.id))}
                                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] px-2.5 py-1 text-[11.5px] text-[#a8a8b1] transition-colors hover:border-emerald-500/40 hover:text-emerald-400/90"
                                >
                                  <CheckCircle2 className="h-3 w-3" />Accept
                                </button>
                              )
                            )}
                            {signedIn && (
                              <button
                                type="button"
                                onClick={() => {
                                  const reason = window.prompt('Why are you flagging this? (spam, abuse, off_topic, duplicate, low_quality, other)');
                                  if (reason) act(() => api.flag('posts', post.id, reason.trim()));
                                }}
                                aria-label="Flag for review"
                                className="cursor-pointer text-[#57575e] transition-colors hover:text-[#a8a8b1]"
                              >
                                <Flag className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="pt-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {post.body}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* ── Reply ─────────────────────────────────────────────── */}
            <div className="mt-8">
              {signedIn ? (
                <form onSubmit={submitReply}>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">
                    {thread.space?.kind === 'qa' ? 'Your answer' : 'Your reply'}
                  </label>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={6}
                    placeholder={thread.space?.kind === 'qa'
                      ? "Answer the question. If you're guessing, say so."
                      : 'Add to the thread.'}
                    className="w-full resize-y rounded-md border border-white/10 bg-white/[0.02] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-[#e5e5e9] outline-none transition-colors placeholder:text-[#57575e] focus:border-white/[0.15]"
                  />
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={posting || !reply.trim()}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-white/[0.15] px-4 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {posting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {thread.space?.kind === 'qa' ? 'Post answer' : 'Reply'}
                    </button>
                    <span className="text-[11.5px] text-[#79797f]">Markdown supported. HTML is escaped.</span>
                  </div>
                </form>
              ) : (
                <div className="rounded-md border border-white/10 bg-[#060608] px-4 py-3.5 text-[12.5px] text-[#79797f]">
                  <a href="/auth" className="text-[#e5e5e9] font-medium hover:text-white">Sign in</a>{' '}
                  to answer. Reading never requires an account.
                </div>
              )}
            </div>
            </div>

            {/* Metadata rail — the width earns its keep instead of sitting empty. */}
            <aside className="space-y-6 lg:pt-6">
              <div className="rounded-md border border-white/10 bg-[#060608] p-4">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">Thread</h2>
                <dl className="mt-3 space-y-2 text-[12px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#79797f]">Status</dt>
                    <dd className={thread.isResolved ? 'text-emerald-400/80' : 'text-[#a8a8b1]'}>
                      {thread.isResolved ? 'Resolved' : 'Open'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#79797f]">Replies</dt>
                    <dd className="text-[#a8a8b1]">{Math.max(0, thread.postCount - 1)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#79797f]">Asked</dt>
                    <dd className="text-[#a8a8b1]">{relativeTime(thread.createdAt)} ago</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#79797f]">Space</dt>
                    <dd className="truncate text-[#a8a8b1]">{thread.space?.name}</dd>
                  </div>
                </dl>
              </div>

              {thread.tags.length > 0 && (
                <div>
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">Tags</h2>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {thread.tags.map((t) => (
                      <Link key={t} to={`/forum?tag=${encodeURIComponent(t)}`}><TagChip tag={t} interactive /></Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-md border border-white/10 bg-[#060608] p-4">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">Cite this</h2>
                <p className="mt-2 text-[11.5px] leading-relaxed text-[#79797f]">
                  The id is permanent. Retitling never breaks it.
                </p>
                <code className="mt-2 block break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-[#a8a8b1]">
                  /forum/t/{thread.shortId}
                </code>
              </div>
            </aside>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default ForumThread;
