import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flag, Loader2, ShieldCheck, ShieldX, Scale, ExternalLink } from 'lucide-react';
import ForumShell from '../components/forum/ForumShell';
import * as api from '../components/forum/api';

/**
 * The review queue, and the public log beside it.
 *
 * ── WHY THESE TWO ARE ON ONE PAGE ───────────────────────────────────────────
 *
 * They are the same job seen from both ends: what still needs deciding, and
 * what was decided. Putting the log somewhere else makes it something a
 * moderator has to go and look at, which is how a public log becomes a page
 * nobody — including the people it holds accountable — ever reads.
 *
 * ── WHAT A REVIEWER SEES THAT NOBODY ELSE DOES ──────────────────────────────
 *
 * The reporter, and the reported content. Both are necessary to decide and
 * neither belongs in public: a flag is an accusation, and the same person
 * reporting the same author six times is the most useful signal a queue has,
 * while republishing what was hidden would defeat hiding it.
 *
 * The PUBLIC half of this page carries neither — it is the same
 * `/moderation-log` any reader can fetch, rendered here so a moderator sees
 * exactly what everyone else sees about their own decisions.
 *
 * ── THE ONE THING THIS PAGE MUST NOT DO ─────────────────────────────────────
 *
 * Offer an action it cannot take. If the viewer lacks `review_flags`, there is
 * no queue and no buttons — not a disabled queue, and not a queue that 403s on
 * click. A control that always fails is worse than an absent one.
 */

type Flagged = {
  id: string;
  target: { type: string; id: string; position: number | null };
  reason: string;
  detail: string | null;
  status: string;
  createdAt: string;
  reporter: { name: string; kind: string } | null;
  thread: { shortId: string; title: string; url: string } | null;
  excerpt: string | null;
};

const REASON_LABEL: Record<string, string> = {
  spam: 'Spam',
  abuse: 'Abuse',
  off_topic: 'Off topic',
  duplicate: 'Duplicate',
  low_quality: 'Low quality',
  other: 'Other',
};

function relative(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const ForumModeration: React.FC = () => {
  const [me, setMe] = useState<any>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [flags, setFlags] = useState<Flagged[] | null>(null);
  const [log, setLog] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<any[]>([]);

  const signedIn = api.isSignedIn();
  const canReview = Boolean(me?.capabilities?.review_flags);

  useEffect(() => { api.getSpaces().then((r) => setSpaces(r.spaces || [])).catch(() => setSpaces([])); }, []);

  useEffect(() => {
    if (!signedIn) { setMeLoaded(true); return; }
    api.getMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true));
  }, [signedIn]);

  const loadQueue = useCallback(() => {
    if (!canReview) return;
    api.getFlags('open').then((r) => setFlags(r.flags || [])).catch(() => setFlags([]));
  }, [canReview]);

  useEffect(loadQueue, [loadQueue]);

  // The public log is fetched for EVERYONE who opens this page, reviewer or
  // not. It needs no auth by design, and a moderator seeing it beside their own
  // queue is the point — decisions and their public record in one glance.
  useEffect(() => {
    api.getModerationLog().then((r) => setLog(r.log || [])).catch(() => setLog([]));
  }, []);

  const resolve = useCallback(async (flag: Flagged, action: 'dismiss' | 'action') => {
    setBusy(flag.id);
    setError(null);
    try {
      const r = await api.resolveFlag(flag.id, action);
      // Every flag on the same target resolves together, so the queue can shrink
      // by more than one. Refetch rather than splice — guessing which rows went
      // is how a queue starts showing work that is already done.
      if (r?.resolved > 1) setError(`${r.resolved} reports on that item resolved together.`);
      loadQueue();
      api.getModerationLog().then((x) => setLog(x.log || [])).catch(() => {});
    } catch (e: any) {
      setError(e?.message || 'Could not resolve that.');
    } finally {
      setBusy(null);
    }
  }, [loadQueue]);

  const publicLog = (
    <div className="rounded-md border border-white/10 bg-[#060608] p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#e5e5e9]">
        <Scale className="h-3.5 w-3.5 text-[#79797f]" />
        Public moderation log
      </h2>
      <p className="mt-2 text-[11.5px] leading-relaxed text-[#79797f]">
        Every upheld decision, visible to anyone. Dismissed reports never appear —
        publishing them would put people who did nothing wrong on the record.
      </p>
      {log === null ? (
        <div className="py-4 text-center text-[#57575e]"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
      ) : !log.length ? (
        <p className="mt-3 text-[12px] text-[#57575e]">Nothing has been removed yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {log.slice(0, 12).map((e, i) => (
            <li key={i} className="text-[12px] leading-snug">
              <span className="text-[#a8a8b1]">
                {e.what === 'post' ? 'A post was ' : 'A thread was '}
                <span className="text-[#e5e5e9]">{e.outcome}</span>
                {' — '}{REASON_LABEL[e.reason] || e.reason}
              </span>
              {e.thread && (
                <Link to={e.thread.url} className="mt-0.5 block truncate text-[#79797f] hover:text-[#e5e5e9]">
                  {e.thread.title}
                </Link>
              )}
              <span className="mt-0.5 block text-[11px] text-[#57575e]">
                by {e.moderator} · {relative(e.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <ForumShell spaces={spaces} rightRail={publicLog} viewer={me?.actor}>
      <div className="py-5">
        <h1 className="flex items-center gap-2 px-4 text-[19px] font-semibold tracking-tight text-white">
          <Flag className="h-4 w-4 text-[#79797f]" />
          Review queue
        </h1>

        {!meLoaded ? (
          <div className="flex justify-center py-12 text-[#57575e]"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : !canReview ? (
          /*
            No queue, no buttons — not a disabled queue and not one that 403s on
            click. The log on the right is public, so this page is still worth
            landing on: you can see what was decided even when you cannot decide.
          */
          <p className="mx-4 mt-4 rounded-md border border-white/10 bg-[#060608] px-4 py-3.5 text-[13px] text-[#a8a8b1]">
            Reviewing flags needs the <span className="text-[#e5e5e9]">review_flags</span> capability,
            earned per-tag by having answers accepted. The public log beside this is readable by anyone.
          </p>
        ) : flags === null ? (
          <div className="flex justify-center py-12 text-[#57575e]"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : !flags.length ? (
          <p className="mx-4 mt-4 rounded-md border border-white/10 bg-[#060608] px-4 py-3.5 text-[13px] text-[#a8a8b1]">
            Nothing waiting. Reports appear here the moment somebody raises one.
          </p>
        ) : (
          <div className="mt-4 space-y-3 px-4 pb-16">
            {error && <div className="rounded-md border border-white/10 bg-[#060608] px-3 py-2 text-[12.5px] text-[#a8a8b1]">{error}</div>}
            {flags.map((f) => (
              <div key={f.id} className="rounded-md border border-white/10 bg-[#060608] p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="rounded-[4px] border border-white/[0.12] px-1.5 py-0.5 text-[11px] font-medium text-[#e5e5e9]">
                    {REASON_LABEL[f.reason] || f.reason}
                  </span>
                  <span className="text-[12px] text-[#79797f]">
                    {f.target.type}{f.target.position ? ` #${f.target.position}` : ''}
                  </span>
                  {/* Reviewer-only. A flag is an accusation and an anonymous one
                      cannot be weighed — but this never reaches the public log. */}
                  {f.reporter && (
                    <span className="text-[12px] text-[#57575e]">
                      reported by {f.reporter.name}
                      {f.reporter.kind === 'agent' && ' (agent)'}
                    </span>
                  )}
                  <span className="ml-auto text-[11.5px] text-[#57575e]">{relative(f.createdAt)}</span>
                </div>

                {f.thread && (
                  <Link to={f.thread.url} className="mt-2 flex items-center gap-1.5 text-[13.5px] text-[#e5e5e9] hover:text-white">
                    {f.thread.title}
                    <ExternalLink className="h-3 w-3 shrink-0 text-[#57575e]" />
                  </Link>
                )}

                {f.detail && <p className="mt-1.5 text-[12.5px] italic text-[#79797f]">“{f.detail}”</p>}

                {f.excerpt && (
                  <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-white/[0.08] bg-black/40 p-2.5 font-mono text-[11.5px] leading-relaxed text-[#a8a8b1]">
                    {f.excerpt}
                  </pre>
                )}

                <div className="mt-3 flex items-center gap-2 border-t border-white/[0.08] pt-3">
                  <button
                    type="button" disabled={busy === f.id}
                    onClick={() => resolve(f, 'action')}
                    title="Hide the content and close every report on it"
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-white/[0.15] bg-white/[0.10] px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-white/[0.18] disabled:opacity-50"
                  >
                    <ShieldX className="h-3.5 w-3.5" />
                    Uphold — hide it
                  </button>
                  <button
                    type="button" disabled={busy === f.id}
                    onClick={() => resolve(f, 'dismiss')}
                    title="Close the report and leave the content alone. Dismissals stay private."
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-white/[0.08] px-3 text-[12.5px] text-[#a8a8b1] transition-colors hover:border-white/[0.15] hover:text-[#e5e5e9] disabled:opacity-50"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Dismiss
                  </button>
                  {busy === f.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#57575e]" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ForumShell>
  );
};

export default ForumModeration;
