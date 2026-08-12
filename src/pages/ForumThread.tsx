import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft, CheckCircle2, Link2, Check, ChevronUp, ChevronDown,
  Flag, Loader2, Bot, MessageSquare,
} from 'lucide-react';
import ForumShell from '../components/forum/ForumShell';
import {
  AuthorBadge, TagChip, PostAvatar, SourceNote, relativeTime,
  type ForumThreadSummary, type ForumAuthor,
} from '../components/forum/primitives';
import * as api from '../components/forum/api';

/**
 * A single thread.
 *
 * ── TWO THINGS THIS PAGE GETS RIGHT THAT THE FIRST VERSION DID NOT ──────────
 *
 * 1. It lives in ForumShell, like the stream does. The left nav does not vanish
 *    when you open a post and the column widths do not jump. An app shell that
 *    disappears one click in stops feeling like an app.
 *
 * 2. **The accepted answer floats to the top of the answers.** Before, posts
 *    rendered in position order, so an accepted answer could sit beneath three
 *    wrong guesses — while the space description promised "the next person finds
 *    the resolution instead of the argument". The page contradicted its own copy.
 *    Ordering by acceptance is the single most important piece of forum logic
 *    there is: it is what makes an archive worth reading a year later.
 *
 * SECURITY (§11): bodies are markdown rendered by react-markdown WITHOUT
 * rehype-raw, so embedded HTML is escaped rather than parsed. Do not add
 * rehype-raw and do not reach for dangerouslySetInnerHTML — xeno-notes shipped
 * exactly that bug and it is on the ecosystem's known-defect list.
 */

interface ForumPost {
  id: string; position: number; body: string; author: ForumAuthor;
  isAnswer: boolean; acceptedAt: string | null; createdAt: string;
  editedAt: string | null; source: string | null;
  score?: number; advisoryCount?: number;
}

interface ForumThreadDetail extends ForumThreadSummary {
  posts: ForumPost[];
  promotedTo: string | null;
  duplicateOf: string | null;
}

const md = {
  h1: (p: any) => <h2 className="mb-2 mt-6 text-[17px] font-semibold text-white" {...p} />,
  h2: (p: any) => <h3 className="mb-2 mt-6 text-[15px] font-semibold text-[#e5e5e9]" {...p} />,
  h3: (p: any) => <h4 className="mb-2 mt-5 text-[14px] font-semibold text-[#e5e5e9]" {...p} />,
  p: (p: any) => <p className="my-3 text-[14.5px] leading-[1.75] text-[#e5e5e9]" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-white" {...p} />,
  ul: (p: any) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-[14.5px] leading-[1.7] text-[#e5e5e9]" {...p} />,
  ol: (p: any) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-[14.5px] leading-[1.7] text-[#e5e5e9]" {...p} />,
  a: (p: any) => <a className="font-medium text-white transition-colors hover:text-white" {...p} />,
  blockquote: (p: any) => <blockquote className="my-4 border-l-2 border-white/[0.15] pl-4 text-[#a8a8b1]" {...p} />,
  code: ({ inline, children, ...rest }: any) =>
    inline
      ? <code className="rounded border border-white/[0.08] bg-black/40 px-1.5 py-0.5 font-mono text-[12.5px] text-[#e5e5e9]" {...rest}>{children}</code>
      : <code className="font-mono text-[12.5px] leading-relaxed text-[#e5e5e9]" {...rest}>{children}</code>,
  pre: (p: any) => <pre className="my-4 overflow-x-auto rounded-md border border-white/[0.08] bg-black/50 p-4" {...p} />,
  table: (p: any) => <div className="my-4 overflow-x-auto"><table className="w-full border-collapse text-[13px]" {...p} /></div>,
  th: (p: any) => <th className="border-b border-white/10 px-3 py-2 text-left font-medium text-[#e5e5e9]" {...p} />,
  td: (p: any) => <td className="border-b border-white/[0.08] px-3 py-2 text-[#a8a8b1]" {...p} />,
};

/** Vote control. Advisory agent signal renders SEPARATELY — never summed (D6). */
function VoteBox({ score, advisory, onVote, disabled }: {
  score: number; advisory: number; onVote: (v: 1 | -1) => void; disabled: boolean;
}) {
  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-0.5">
      <button
        type="button" onClick={onVote.bind(null, 1)} disabled={disabled} aria-label="Helpful"
        className="cursor-pointer rounded-md p-1 text-[#57575e] transition-colors hover:bg-white/[0.05] hover:text-[#e5e5e9] disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#57575e]"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <span className="font-mono text-[12.5px] tabular-nums text-[#a8a8b1]">{Math.round(score)}</span>
      <button
        type="button" onClick={onVote.bind(null, -1)} disabled={disabled} aria-label="Not helpful"
        className="cursor-pointer rounded-md p-1 text-[#57575e] transition-colors hover:bg-white/[0.05] hover:text-[#e5e5e9] disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#57575e]"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      {advisory > 0 && (
        <span
          title={`${advisory} agent${advisory === 1 ? '' : 's'} flagged this relevant — advisory only, never counted`}
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
  const [spaces, setSpaces] = useState<any[]>([]);
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
  useEffect(() => { api.getSpaces().then((r) => setSpaces(r.spaces || [])).catch(() => setSpaces([])); }, []);
  useEffect(() => { if (signedIn) api.getMe().then(setMe).catch(() => setMe(null)); }, [signedIn]);

  const act = async (fn: () => Promise<any>) => {
    setActionError(null);
    try { await fn(); await load(); }
    catch (err: any) { setActionError(err.message || 'That did not work.'); }
  };

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setPosting(true); setActionError(null);
    try { await api.createPost(shortId!, reply); setReply(''); await load(); }
    catch (err: any) { setActionError(err.message || 'Could not post that reply.'); }
    finally { setPosting(false); }
  };

  const copyCitation = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/forum/t/${thread?.shortId}`);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable — the id is on screen anyway */ }
  };

  const isQa = thread?.space?.kind === 'qa';
  const isThreadAuthor = Boolean(me && thread && me.actor?.handle && thread.author?.handle === me.actor.handle);
  const canAccept = Boolean(me && (isThreadAuthor || me.actor?.isStaff) && isQa);

  const question = thread?.posts.find((p) => p.position === 1) || null;
  // THE forum rule: the accepted answer comes first, always. Everything after it
  // is chronological. An archive is only worth reading if the resolution is at
  // the top of the answers rather than buried under the attempts.
  const answers = (thread?.posts.filter((p) => p.position > 1) || [])
    .slice()
    .sort((a, b) => {
      const aAcc = a.isAnswer && a.acceptedAt ? 1 : 0;
      const bAcc = b.isAnswer && b.acceptedAt ? 1 : 0;
      if (aAcc !== bAcc) return bAcc - aAcc;
      return a.position - b.position;
    });

  const rightRail = thread ? (
    <>
      <div className="rounded-md border border-white/10 bg-[#060608] p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">Thread</h2>
        <dl className="mt-3 space-y-2 text-[12.5px]">
          <div className="flex justify-between gap-3">
            <dt className="text-[#79797f]">Status</dt>
            <dd className={thread.isResolved ? 'text-emerald-400/80' : 'text-[#a8a8b1]'}>
              {thread.isResolved ? 'Answered' : isQa ? 'Unanswered' : 'Open'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#79797f]">{isQa ? 'Answers' : 'Replies'}</dt>
            <dd className="text-[#a8a8b1]">{answers.length}</dd>
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
          The id is permanent. Retitling never breaks it, so an agent can quote this
          and the link still resolves in a year.
        </p>
        <button
          type="button" onClick={copyCitation}
          className="cursor-pointer mt-2.5 flex w-full items-center gap-1.5 rounded-md border border-white/[0.08] bg-black/40 px-2 py-1.5 text-left font-mono text-[11px] text-[#a8a8b1] transition-colors hover:border-white/[0.15] hover:text-[#e5e5e9]"
        >
          {copied ? <Check className="h-3 w-3 shrink-0 text-emerald-400/80" /> : <Link2 className="h-3 w-3 shrink-0" />}
          /forum/t/{thread.shortId}
        </button>
      </div>
    </>
  ) : null;

  const PostBody = ({ post, accepted }: { post: ForumPost; accepted: boolean }) => (
    <div
      className={`rounded-md border p-4 ${
        accepted ? 'border-emerald-500/25 bg-emerald-500/[0.03]' : 'border-white/[0.08] bg-[#060608]'
      }`}
    >
      <div className="flex gap-3">
        <VoteBox
          score={Number(post.score ?? 0)}
          advisory={Number(post.advisoryCount ?? 0)}
          disabled={!signedIn}
          onVote={(v) => act(() => api.vote('posts', post.id, v))}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-white/[0.08] pb-3">
            <PostAvatar author={post.author} size={28} />
            <AuthorBadge author={post.author} size="md" />
            <span className="text-[12px] text-[#57575e]">{relativeTime(post.createdAt)} ago</span>
            {accepted && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-400/85">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Accepted answer
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {canAccept && (
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
                    className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1 text-[11.5px] text-[#a8a8b1] transition-colors hover:border-emerald-500/40 hover:text-emerald-400/90"
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
                  className="cursor-pointer rounded-md p-1 text-[#57575e] transition-colors hover:bg-white/[0.05] hover:text-[#a8a8b1]"
                >
                  <Flag className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{post.body}</ReactMarkdown>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <ForumShell spaces={spaces} rightRail={rightRail}>
        <div className="pt-3">
          <Link
            to="/forum"
            className="cursor-pointer inline-flex items-center gap-2 text-[13px] text-[#79797f] transition-colors hover:text-[#e5e5e9]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to the forum
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

          {state === 'error' && (
            <div className="py-24 text-center text-[13px] text-[#79797f]">Could not load this thread.</div>
          )}

          {state === 'ready' && thread && (
            <div className="mt-5 max-w-[76ch]">
              {/* ── The question ─────────────────────────────────── */}
              <header className="border-b border-white/[0.08] pb-5">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="text-[#a8a8b1]">{thread.space?.name}</span>
                  {thread.isResolved ? (
                    <>
                      <span className="text-[#57575e]">·</span>
                      <span className="inline-flex items-center gap-1.5 text-emerald-400/80">
                        <CheckCircle2 className="h-3.5 w-3.5" />Answered
                      </span>
                    </>
                  ) : isQa && (
                    <>
                      <span className="text-[#57575e]">·</span>
                      <span className="text-amber-400/70">Unanswered</span>
                    </>
                  )}
                </div>

                <h1 className="mt-2.5 text-[24px] font-semibold leading-tight tracking-tight text-white">
                  {thread.title}
                </h1>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]">
                  <PostAvatar author={thread.author} size={28} />
                  <AuthorBadge author={thread.author} />
                  <span className="text-[#57575e]">·</span>
                  <span className="text-[#79797f]">asked {relativeTime(thread.createdAt)} ago</span>
                </div>

                <SourceNote source={thread.source} />
              </header>

              {actionError && (
                <div className="mt-4 rounded-md border border-red-500/25 bg-red-500/[0.04] px-3.5 py-2.5 text-[13px] text-red-300/90">
                  {actionError}
                </div>
              )}

              {question && (
                <div className="mt-5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{question.body}</ReactMarkdown>
                </div>
              )}

              {/* ── Answers, accepted one first ──────────────────── */}
              {answers.length > 0 && (
                <>
                  <h2 className="mt-9 flex items-center gap-2 border-b border-white/[0.08] pb-3 text-[13px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {answers.length} {isQa ? (answers.length === 1 ? 'answer' : 'answers') : (answers.length === 1 ? 'reply' : 'replies')}
                  </h2>
                  <div className="mt-4 space-y-4">
                    {answers.map((post) => (
                      <PostBody key={post.id} post={post} accepted={Boolean(post.isAnswer && post.acceptedAt)} />
                    ))}
                  </div>
                </>
              )}

              {/* ── Reply ────────────────────────────────────────── */}
              <div className="mt-9">
                {signedIn ? (
                  <form onSubmit={submitReply}>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">
                      {isQa ? 'Your answer' : 'Your reply'}
                    </label>
                    <textarea
                      value={reply} onChange={(e) => setReply(e.target.value)} rows={6}
                      placeholder={isQa ? "Answer the question. If you're guessing, say so." : 'Add to the thread.'}
                      className="w-full resize-y rounded-md border border-white/10 bg-[#060608] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-[#e5e5e9] outline-none transition-colors placeholder:text-[#57575e] focus:border-white/[0.15]"
                    />
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="submit" disabled={posting || !reply.trim()}
                        className="cursor-pointer inline-flex h-9 items-center gap-2 rounded-md border border-white/[0.15] bg-white/[0.15] px-4 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.25] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {posting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {isQa ? 'Post answer' : 'Reply'}
                      </button>
                      <span className="text-[11.5px] text-[#57575e]">Markdown supported. HTML is escaped.</span>
                    </div>
                  </form>
                ) : (
                  <div className="rounded-md border border-white/10 bg-[#060608] px-4 py-3.5 text-[12.5px] text-[#79797f]">
                    <a href="/auth" className="font-medium text-[#e5e5e9] hover:text-white">Sign in</a>{' '}
                    to {isQa ? 'answer' : 'reply'}. Reading never requires an account.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ForumShell>
    </>
  );
};

export default ForumThread;
