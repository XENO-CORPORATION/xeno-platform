import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
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

interface Space {
  slug: string;
  name: string;
  kind: string;
  description: string;
  postPolicy: string;
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

  return (
    <div className="min-h-screen bg-[#060606] text-white">
      <Header onGetStarted={() => { window.location.href = '/auth'; }} />

      <main className="page-gutter w-full pb-20 pt-28">
        <Link to="/forum" className="inline-flex items-center gap-2 text-[13px] text-white/40 transition-colors hover:text-white/70">
          <ArrowLeft className="h-3.5 w-3.5" />
          Forum
        </Link>

        <h1 className="mt-6 text-[26px] font-semibold tracking-tight">Ask the forum</h1>

        {!signedIn ? (
          <div className="mt-8 rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
            <p className="text-[14px] text-white/60">You need an account to post.</p>
            <a
              href="/auth"
              className="mt-4 inline-flex h-9 items-center rounded-md border border-white/20 px-4 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.06]"
            >
              Sign in
            </a>
            <p className="mt-4 text-[12px] text-white/35">
              Reading the forum never requires an account — only posting does.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 max-w-[72ch] space-y-6">
            {/* Space */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Space</label>
              <select
                value={space}
                onChange={(e) => setSpace(e.target.value)}
                className="w-full cursor-pointer rounded-lg border border-white/[0.09] bg-[#0f0f0f] px-3 py-2.5 text-[14px] text-white/85 outline-none transition-colors focus:border-white/20"
              >
                {spaces.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
              </select>
              {activeSpace && (
                <p className="mt-2 text-[12px] leading-relaxed text-white/35">{activeSpace.description}</p>
              )}
            </div>

            {/* Title */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
                Title
              </label>
              <input
                value={title}
                onChange={(e) => { setTitle(e.target.value); runDedup(e.target.value); }}
                placeholder="What actually happens — the way you'd describe it out loud"
                maxLength={300}
                className="w-full rounded-lg border border-white/[0.09] bg-white/[0.02] px-3.5 py-2.5 text-[14px] text-white/85 outline-none transition-colors placeholder:text-white/25 focus:border-white/20"
              />
              {checkingDupes && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-white/30">
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
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-4">
                <div className="flex items-center gap-2 text-[12.5px] font-medium text-amber-400/80">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  This may already be answered
                </div>
                <ul className="mt-3 space-y-2">
                  {duplicates.map((d) => (
                    <li key={d.shortId}>
                      <Link
                        to={d.url}
                        className="block rounded-md px-2 py-1.5 text-[13px] text-white/65 transition-colors hover:bg-white/[0.04] hover:text-white"
                      >
                        {d.title}
                        {d.isResolved && <span className="ml-2 text-[11px] text-emerald-400/70">resolved</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11.5px] text-white/35">
                  If one of these answers it, read that instead — it keeps the answer in one place.
                  If yours is genuinely different, carry on.
                </p>
              </div>
            )}

            {/* Body */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
                Details
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder={"What you did, what happened, what you expected.\n\nInclude the product and version, and paste the exact error text — that is what makes this findable for the next person."}
                className="w-full resize-y rounded-lg border border-white/[0.09] bg-white/[0.02] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-white/85 outline-none transition-colors placeholder:text-white/25 focus:border-white/20"
              />
              <p className="mt-2 text-[11.5px] text-white/30">Markdown supported. HTML is escaped, not rendered.</p>
            </div>

            {/* Tags */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
                Tags
              </label>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="product:canvas  kind:bug  version:0.36.0"
                className="w-full rounded-lg border border-white/[0.09] bg-white/[0.02] px-3.5 py-2.5 font-mono text-[13px] text-white/85 outline-none transition-colors placeholder:text-white/25 focus:border-white/20"
              />
              <p className="mt-2 text-[11.5px] text-white/30">
                Namespaced: <code className="text-white/45">product:</code>, <code className="text-white/45">version:</code>,{' '}
                <code className="text-white/45">topic:</code>, <code className="text-white/45">kind:</code>. The namespace is
                what lets a thread reach the right people and the right product page.
              </p>
              {tags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {tags.map((t) => <TagChip key={t} tag={t} />)}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/25 bg-red-500/[0.04] px-3.5 py-2.5 text-[13px] text-red-300/90">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || !title.trim() || !body.trim()}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-white/20 px-5 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Post
              </button>
              <Link to="/forum" className="text-[13px] text-white/40 transition-colors hover:text-white/70">Cancel</Link>
            </div>
            </div>

            <aside className="space-y-4 lg:pt-7">
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
                  How to get answered
                </h2>
                <ul className="mt-3 space-y-2.5 text-[12px] leading-relaxed text-white/45">
                  <li>Title it the way you would say it out loud — that is what the next person searches for.</li>
                  <li>Paste the exact error text. Exact strings are what make a thread findable.</li>
                  <li>Say which product and version, and what you already tried.</li>
                  <li>Tag it. An untagged thread reaches nobody in particular.</li>
                </ul>
              </div>
              <p className="px-1 text-[11.5px] leading-relaxed text-white/25">
                Answers can be accepted, so a good question keeps paying out long
                after you have moved on.
              </p>
            </aside>
          </form>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default ForumNew;
