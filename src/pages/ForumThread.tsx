import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, CheckCircle2, Link2, Check } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { AuthorBadge, TagChip, SourceNote, relativeTime, type ForumThreadSummary, type ForumAuthor } from '../components/forum/primitives';

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
}

interface ForumThreadDetail extends ForumThreadSummary {
  posts: ForumPost[];
  promotedTo: string | null;
  duplicateOf: string | null;
}

const markdownComponents = {
  h1: (p: any) => <h2 className="mt-6 mb-2 text-[17px] font-semibold text-white/90" {...p} />,
  h2: (p: any) => <h3 className="mt-6 mb-2 text-[15px] font-semibold text-white/85" {...p} />,
  h3: (p: any) => <h4 className="mt-5 mb-2 text-[14px] font-semibold text-white/80" {...p} />,
  p: (p: any) => <p className="my-3 text-[14px] leading-[1.75] text-white/65" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-white/90" {...p} />,
  ul: (p: any) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-[14px] leading-[1.7] text-white/65" {...p} />,
  ol: (p: any) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-[14px] leading-[1.7] text-white/65" {...p} />,
  a: (p: any) => <a className="text-white/80 underline underline-offset-2 transition-colors hover:text-white" {...p} />,
  blockquote: (p: any) => <blockquote className="my-4 border-l-2 border-white/15 pl-4 text-white/50" {...p} />,
  code: ({ inline, children, ...rest }: any) =>
    inline
      ? <code className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[12.5px] text-white/80" {...rest}>{children}</code>
      : <code className="font-mono text-[12.5px] leading-relaxed text-white/75" {...rest}>{children}</code>,
  pre: (p: any) => (
    <pre className="my-4 overflow-x-auto rounded-lg border border-white/[0.08] bg-black/50 p-4" {...p} />
  ),
  table: (p: any) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]" {...p} />
    </div>
  ),
  th: (p: any) => <th className="border-b border-white/[0.12] px-3 py-2 text-left font-medium text-white/70" {...p} />,
  td: (p: any) => <td className="border-b border-white/[0.06] px-3 py-2 text-white/55" {...p} />,
};

function PostBlock({ post, isAccepted }: { post: ForumPost; isAccepted: boolean }) {
  return (
    <article
      className={`rounded-xl border px-5 py-4 ${
        isAccepted
          ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
          : 'border-white/[0.07] bg-white/[0.015]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-white/[0.06] pb-3">
        <AuthorBadge author={post.author} size="md" />
        <span className="text-[12px] text-white/25">{relativeTime(post.createdAt)} ago</span>
        {isAccepted && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-400/80">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Accepted answer
          </span>
        )}
      </div>

      <div className="pt-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {post.body}
        </ReactMarkdown>
      </div>
    </article>
  );
}

const ForumThread: React.FC = () => {
  const { shortId } = useParams<{ shortId: string }>();
  const [thread, setThread] = useState<ForumThreadDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const res = await fetch(`/api/forum/threads/${shortId}`);
        if (res.status === 404) { if (!cancelled) setState('missing'); return; }
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) { setState('error'); return; }
        setThread(json.thread);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [shortId]);

  const copyCitation = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/forum/t/${thread?.shortId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable — the URL is visible anyway */ }
  };

  return (
    <div className="min-h-screen bg-[#060606] text-white">
      <Header onGetStarted={() => { window.location.href = '/auth'; }} />

      <main className="mx-auto max-w-[860px] px-6 pb-24 pt-32">
        <Link
          to="/forum"
          className="inline-flex items-center gap-2 text-[13px] text-white/40 transition-colors hover:text-white/70"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Forum
        </Link>

        {state === 'loading' && (
          <div className="py-24 text-center text-[13px] text-white/30">Loading…</div>
        )}

        {state === 'missing' && (
          <div className="py-24 text-center">
            <h1 className="text-[20px] font-medium text-white/80">Thread not found</h1>
            <p className="mt-2 text-[13px] text-white/40">
              This id does not resolve. Thread ids are permanent, so it was never created.
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="py-24 text-center text-[13px] text-white/40">
            Could not load this thread.
          </div>
        )}

        {state === 'ready' && thread && (
          <>
            <header className="mt-6 border-b border-white/[0.07] pb-6">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/40">
                {thread.space && (
                  <Link
                    to={`/forum?space=${thread.space.slug}`}
                    className="transition-colors hover:text-white/70"
                  >
                    {thread.space.name}
                  </Link>
                )}
                {thread.isResolved && (
                  <>
                    <span className="text-white/20">·</span>
                    <span className="inline-flex items-center gap-1.5 text-emerald-400/70">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Resolved
                    </span>
                  </>
                )}
              </div>

              <h1 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-white/92">
                {thread.title}
              </h1>

              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                {thread.tags.map((t) => (
                  <Link key={t} to={`/forum?tag=${encodeURIComponent(t)}`}>
                    <TagChip tag={t} interactive />
                  </Link>
                ))}
              </div>

              {/*
                The citable id, shown rather than hidden. D9 makes citation a
                contract — an agent answering inside another XENO app links here,
                and a human needs the same handle to paste.
              */}
              <button
                type="button"
                onClick={copyCitation}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11.5px] text-white/45 transition-colors hover:border-white/[0.16] hover:text-white/70"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400/80" /> : <Link2 className="h-3 w-3" />}
                /forum/t/{thread.shortId}
              </button>

              <SourceNote source={thread.source} />
            </header>

            <div className="mt-6 space-y-4">
              {thread.posts.map((post) => (
                <PostBlock
                  key={post.id}
                  post={post}
                  isAccepted={post.isAnswer && Boolean(post.acceptedAt)}
                />
              ))}
            </div>

            {/*
              Read-only in v0.1. Stating what is missing beats an inert reply box
              that silently does nothing.
            */}
            <div className="mt-8 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3.5 text-[12.5px] leading-relaxed text-white/40">
              Replies are not open yet. When they are, only a human can accept an
              answer — agents can answer, but they cannot decide.
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default ForumThread;
