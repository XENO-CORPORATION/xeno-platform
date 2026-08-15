import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, MessageSquare } from 'lucide-react';

/**
 * "Known issues and answers" — the Forum, on the page where it is relevant.
 *
 * ── WHY HERE AND NOT IN THE NAV ─────────────────────────────────────────────
 *
 * D12 holds the top-level nav slot until there is a reason to click it, and with
 * nine seeded threads and no user posts there is not one yet. But a person on
 * the Pixel product page who is deciding whether Pixel works has a reason RIGHT
 * NOW — and the answer is three threads away.
 *
 * Contextual discovery beats global discovery for a young forum: the nav slot
 * asks people to go and look, this puts it in front of the one person already
 * asking the question.
 *
 * ── 🔴 IT RENDERS NOTHING WHEN THERE IS NOTHING ─────────────────────────────
 *
 * No threads for this product means no section at all — not an empty "Community"
 * heading, not a "no discussions yet" placeholder. An empty section on a product
 * page advertises a dead forum to the exact audience you least want to tell, and
 * it is the same mistake D12 exists to prevent, one level down.
 *
 * Fails silently for the same reason: a forum outage must not put an error box
 * on a product page.
 */

type Thread = {
  shortId: string;
  title: string;
  url: string;
  status: string;
  isResolved?: boolean;
  postCount?: number;
};

const ForumThreadsWidget: React.FC<{ slug: string; limit?: number }> = ({ slug, limit = 4 }) => {
  const [threads, setThreads] = useState<Thread[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/forum/threads?tag=${encodeURIComponent(`product:${slug}`)}&limit=${limit}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => { if (!cancelled) setThreads(r?.threads ?? []); })
      .catch(() => { if (!cancelled) setThreads([]); });
    return () => { cancelled = true; };
  }, [slug, limit]);

  // Nothing to show, or not loaded yet → render nothing. No skeleton either:
  // a placeholder that resolves to nothing is a layout shift announcing an
  // absence.
  if (!threads?.length) return null;

  const resolved = threads.filter((t) => t.isResolved || t.status === 'resolved').length;

  return (
    <section className="page-gutter pb-[clamp(56px,8vh,110px)] pt-[clamp(20px,3vh,40px)]">
      <div className="mx-auto max-w-[820px]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#756f66]">
            Known issues and answers
          </h2>
          <Link
            to={`/forum?tag=${encodeURIComponent(`product:${slug}`)}`}
            className="text-[12.5px] text-[#827b71] transition-colors hover:text-white"
          >
            Open the forum →
          </Link>
        </div>

        <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-md border border-white/[0.08] bg-[#0a0a0c]">
          {threads.map((t) => (
            <li key={t.shortId}>
              <Link to={t.url} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
                {/*
                  Resolution state, not popularity. The product pages inherit the
                  Forum's rule: no view counts, no vote totals — what a reader
                  needs here is whether the problem has an answer.
                */}
                {(t.isResolved || t.status === 'resolved') ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/70" />
                ) : (
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#57575e]" />
                )}
                <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-[#c9c2b9]">{t.title}</span>
              </Link>
            </li>
          ))}
        </ul>

        {resolved > 0 && (
          <p className="mt-2.5 text-[11.5px] text-[#69635b]">
            {resolved} of these {resolved === 1 ? 'has' : 'have'} an accepted answer.
          </p>
        )}
      </div>
    </section>
  );
};

export default ForumThreadsWidget;
