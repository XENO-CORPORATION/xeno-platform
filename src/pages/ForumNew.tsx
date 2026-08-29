import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react';
import ForumShell from '../components/forum/ForumShell';
import { TagChip } from '../components/forum/primitives';
import * as api from '../components/forum/api';

/**
 * Compose a thread.
 *
 * The reason this is its own page rather than a modal: **compose-time dedup
 * (SPEC D10)**. As the title is typed we ask the server whether this has already
 * been answered, and show the matches *before* a new thread exists. Most of an
 * archive's value is destroyed by the same question existing forty times with
 * the answer on the fourth — and the only moment you can prevent that is before
 * the Post button is pressed.
 */

/**
 * Per-space compose copy.
 *
 * "Ask a question" described exactly ONE of five space kinds. Someone who wants
 * to show what they built, propose an architecture, or report a bug was being
 * asked to phrase it as a question — which is what makes forums feel
 * bureaucratic, and is the opposite of the blend this product is going for.
 *
 * The objective (resolution over attention) is enforced in the ranker and in the
 * accept mechanics, never in a button label. So the verb simply describes what
 * you are actually doing.
 */
const COMPOSE_COPY: Record<string, {
  heading: string; verb: string; titleLabel: string; titlePlaceholder: string;
  bodyLabel: string; bodyPlaceholder: string; guidanceTitle: string; guidance: string[];
}> = {
  qa: {
    heading: 'Ask the forum',
    verb: 'Post question',
    titleLabel: 'Question',
    titlePlaceholder: "What actually happens — the way you'd describe it out loud",
    bodyLabel: 'Details',
    bodyPlaceholder: 'What you did, what happened, what you expected.\n\nInclude the product and version, and paste the exact error text — that is what makes this findable for the next person.',
    guidanceTitle: 'How to get answered',
    guidance: [
      'Title it the way you would say it out loud — that is what the next person searches for.',
      'Paste the exact error text. Exact strings are what make a thread findable.',
      'Say which product and version, and what you already tried.',
      'Tag it. An untagged thread reaches nobody in particular.',
    ],
  },
  discussion: {
    heading: 'Start a discussion',
    verb: 'Post',
    titleLabel: 'Topic',
    titlePlaceholder: 'The idea, in one line',
    bodyLabel: 'What you are thinking',
    bodyPlaceholder: 'Lay out the idea and where you are unsure.\n\nDiscussions have no accepted answer — the point is the thinking, not a verdict.',
    guidanceTitle: 'What makes a good thread',
    guidance: [
      'Say what you actually believe, not just what is safe.',
      'Name the trade-off you are stuck on — that is where people can help.',
      'Link the code or spec you are talking about.',
      'Tag it so the people who care find it.',
    ],
  },
  showcase: {
    heading: 'Show what you built',
    verb: 'Post',
    titleLabel: 'What you made',
    titlePlaceholder: 'What it is, in one line',
    bodyLabel: 'Tell us about it',
    bodyPlaceholder: 'What it does, what you used, and anything you had to fight.\n\nScreenshots and links welcome.',
    guidanceTitle: 'Worth including',
    guidance: [
      'Which XENO tools you used, and how.',
      'Anything that was harder than it should have been — that is useful to us.',
      'A link people can actually look at.',
    ],
  },
  feedback: {
    heading: 'Send feedback',
    verb: 'Post',
    titleLabel: 'Summary',
    titlePlaceholder: 'What is wrong, or what is missing',
    bodyLabel: 'Details',
    bodyPlaceholder: 'What you expected, what happened instead, and how to reproduce it.\n\nFor a request: what you are trying to do and why the current way does not work.',
    guidanceTitle: 'How this gets acted on',
    guidance: [
      'Feedback is ranked by how many DIFFERENT people hit it — never by how loud a thread gets.',
      'If someone already reported it, add to that thread instead of opening a new one.',
      'Steps to reproduce beat adjectives.',
      'Tag the product and version.',
    ],
  },
};
const DEFAULT_COPY = COMPOSE_COPY.discussion;

interface Space {
  slug: string;
  name: string;
  kind: string;
  description: string;
  postPolicy: string;
  threadCount: number;
}

const ForumNew: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [space, setSpace] = useState(params.get('space') || 'help');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tagInput, setTagInput] = useState(params.get('product') ? `product:${params.get('product')}` : '');

  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = api.isSignedIn();

  useEffect(() => {
    api.getSpaces()
      .then((r) => setSpaces((r.spaces || []).filter((s: Space) => s.postPolicy !== 'staff_only')))
      .catch(() => setSpaces([]));
  }, []);

  // Debounced dedup — fires on the title, which is what a duplicate shares.
  const dedupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runDedup = useCallback((value: string) => {
    if (dedupTimer.current) clearTimeout(dedupTimer.current);
    if (value.trim().length < 12 || !signedIn) { setDuplicates([]); return; }
    dedupTimer.current = setTimeout(async () => {
      setCheckingDupes(true);
      try {
        const r = await api.dedupCheck(value);
        setDuplicates(r.candidates || []);
      } catch {
        setDuplicates([]);
      } finally {
        setCheckingDupes(false);
      }
    }, 450);
  }, [signedIn]);

  const tags = tagInput.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.createThread({ space, title, body, tags });
      navigate(r.thread.url);
    } catch (err: any) {
      setError(err.message || 'Could not post this.');
      setSubmitting(false);
    }
  };

  const activeSpace = spaces.find((s) => s.slug === space);
  const copy = (activeSpace && COMPOSE_COPY[activeSpace.kind]) || DEFAULT_COPY;

  // The compose page sits in the SAME shell as the stream and the thread. The
  // left nav does not vanish and the column widths do not shift — the container
  // changing under you between pages is what makes a site feel like a set of
  // documents rather than one application.
  return (
    <ForumShell spaces={spaces}>
        <div className="pt-3">
        <Link to="/forum" className="inline-flex items-center gap-2 text-[13px] text-[#79797f] transition-colors hover:text-[#e5e5e9]">
          <ArrowLeft className="h-3.5 w-3.5" />
          Forum
        </Link>

        <h1 className="mt-6 text-[26px] font-semibold tracking-tight">{copy.heading}</h1>

        {!signedIn ? (
          <div className="mt-8 rounded-md border border-white/10 bg-[#060608] p-6">
            <p className="text-[14px] text-[#a8a8b1]">You need an account to post.</p>
            <a
              href="/login"
              className="mt-4 inline-flex h-9 items-center rounded-md border border-white/[0.15] px-4 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.05]"
            >
              Sign in
            </a>
            <p className="mt-4 text-[12px] text-[#79797f]">
              Reading the forum never requires an account — only posting does.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 max-w-[72ch] space-y-6">
            {/* Space */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">Space</label>
              <select
                value={space}
                onChange={(e) => setSpace(e.target.value)}
                className="w-full cursor-pointer rounded-md border border-white/10 bg-[#101011] px-3 py-2.5 text-[14px] text-[#e5e5e9] outline-none transition-colors focus:border-white/[0.15]"
              >
                {spaces.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
              </select>
              {activeSpace && (
                <p className="mt-2 text-[12px] leading-relaxed text-[#79797f]">{activeSpace.description}</p>
              )}
            </div>

            {/* Title */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">
                {copy.titleLabel}
              </label>
              <input
                value={title}
                onChange={(e) => { setTitle(e.target.value); runDedup(e.target.value); }}
                placeholder={copy.titlePlaceholder}
                maxLength={300}
                className="w-full rounded-md border border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-[14px] text-[#e5e5e9] outline-none transition-colors placeholder:text-[#57575e] focus:border-white/[0.15]"
              />
              {checkingDupes && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[#79797f]">
                  <Loader2 className="h-3 w-3 animate-spin" /> checking whether this is already answered…
                </p>
              )}
            </div>

            {/*
              The dedup panel. Deliberately NOT a blocker — it informs and gets
              out of the way. A hard block would be wrong: near-duplicate
              detection is a heuristic, and a false positive that silences a real
              question costs more than a duplicate thread.
            */}
            {duplicates.length > 0 && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.03] p-4">
                <div className="flex items-center gap-2 text-[12.5px] font-medium text-amber-400/80">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  This may already be answered
                </div>
                <ul className="mt-3 space-y-2">
                  {duplicates.map((d) => (
                    <li key={d.shortId}>
                      <Link
                        to={d.url}
                        className="block rounded-md px-2 py-1.5 text-[13px] text-[#a8a8b1] transition-colors hover:bg-white/[0.05] hover:text-white"
                      >
                        {d.title}
                        {d.isResolved && <span className="ml-2 text-[11px] text-emerald-400/70">resolved</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11.5px] text-[#79797f]">
                  If one of these answers it, read that instead — it keeps the answer in one place.
                  If yours is genuinely different, carry on.
                </p>
              </div>
            )}

            {/* Body */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">
                {copy.bodyLabel}
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder={copy.bodyPlaceholder}
                className="w-full resize-y rounded-md border border-white/10 bg-white/[0.02] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-[#e5e5e9] outline-none transition-colors placeholder:text-[#57575e] focus:border-white/[0.15]"
              />
              <p className="mt-2 text-[11.5px] text-[#79797f]">Markdown supported. HTML is escaped, not rendered.</p>
            </div>

            {/* Tags */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">
                Tags
              </label>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="product:canvas  kind:bug  version:0.36.0"
                className="w-full rounded-md border border-white/10 bg-white/[0.02] px-3.5 py-2.5 font-mono text-[13px] text-[#e5e5e9] outline-none transition-colors placeholder:text-[#57575e] focus:border-white/[0.15]"
              />
              <p className="mt-2 text-[11.5px] text-[#79797f]">
                Namespaced: <code className="text-[#a8a8b1]">product:</code>, <code className="text-[#a8a8b1]">version:</code>,{' '}
                <code className="text-[#a8a8b1]">topic:</code>, <code className="text-[#a8a8b1]">kind:</code>. The namespace is
                what lets a thread reach the right people and the right product page.
              </p>
              {tags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {tags.map((t) => <TagChip key={t} tag={t} />)}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-red-500/25 bg-red-500/[0.04] px-3.5 py-2.5 text-[13px] text-red-300/90">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || !title.trim() || !body.trim()}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-white/[0.15] px-5 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {copy.verb}
              </button>
              <Link to="/forum" className="text-[13px] text-[#79797f] transition-colors hover:text-[#e5e5e9]">Cancel</Link>
            </div>
            </div>

            <aside className="space-y-4 lg:pt-7">
              <div className="rounded-md border border-white/10 bg-[#060608] p-4">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#79797f]">
                  {copy.guidanceTitle}
                </h2>
                <ul className="mt-3 space-y-2.5 text-[12px] leading-relaxed text-[#a8a8b1]">
                  {copy.guidance.map((g) => <li key={g}>{g}</li>)}
                </ul>
              </div>
              <p className="px-1 text-[11.5px] leading-relaxed text-[#57575e]">
                {activeSpace?.kind === 'qa'
                  ? 'Answers can be accepted, so a good question keeps paying out long after you have moved on.'
                  : 'Everything here is permanent and searchable — written once, found for years.'}
              </p>
            </aside>
          </form>
        )}
        </div>
    </ForumShell>
  );
};

export default ForumNew;
