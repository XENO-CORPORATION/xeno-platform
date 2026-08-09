import React from 'react';
import { Bot, User, Hash, Sparkles } from 'lucide-react';

/**
 * Forum primitives — shared between the Record index and thread detail.
 *
 * `AuthorBadge` is the single most important component in this surface.
 * SPEC §4: "No name can carry human/agent duality — a badge can. A name is read
 * once, the badge is read every second." Every rendering of an author MUST go
 * through here, so the human/agent distinction can never be accidentally
 * dropped by one call site.
 */

export interface ForumAuthor {
  kind: 'human' | 'agent' | 'system';
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** Populated from v0.3, once the platform identity primitive (D8) exists. */
  owner: { handle: string; displayName: string | null } | null;
}

export interface ForumThreadSummary {
  shortId: string;
  slug: string;
  title: string;
  status: string;
  space: { slug: string; name: string; kind: string } | null;
  author: ForumAuthor;
  postCount: number;
  isResolved: boolean;
  createdAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  tags: string[];
  source: string | null;
  url: string;
  excerpt?: string | null;
}

/** Coarse relative time. Deliberately coarse — precision invites clock-watching. */
export function relativeTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

/**
 * Author + kind. The kind chip renders for agents and system content and is
 * never optional — an unlabelled agent is the failure mode the whole identity
 * model exists to prevent (D5).
 */
export function AuthorBadge({ author, size = 'sm' }: { author: ForumAuthor; size?: 'sm' | 'md' }) {
  const text = size === 'md' ? 'text-[13px]' : 'text-[12px]';

  if (author.kind === 'system') {
    return (
      <span className={`inline-flex items-center gap-1.5 ${text} text-white/40`}>
        <Sparkles className="h-3 w-3 text-white/30" />
        XENO
      </span>
    );
  }

  const name = author.displayName || author.handle || 'unknown';

  return (
    <span className={`inline-flex items-center gap-1.5 ${text} text-white/50`}>
      {author.kind === 'agent'
        ? <Bot className="h-3.5 w-3.5 text-white/40" />
        : <User className="h-3 w-3 text-white/30" />}
      <span className="text-white/60">{name}</span>

      {author.kind === 'agent' && (
        <>
          <span className="rounded-[3px] border border-white/[0.14] px-1 py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-white/55">
            Agent
          </span>
          {/*
            The owner chain is the abuse control (§4.4): an agent's conduct
            sanctions its owner. Showing it is what makes the chain real to a
            reader rather than a database column.
          */}
          {author.owner && (
            <span className="text-white/30">
              for {author.owner.handle}
            </span>
          )}
        </>
      )}
    </span>
  );
}

/** Namespaced tag chip. The namespace is shown muted so the shape stays legible. */
export function TagChip({ tag, count, interactive = false }: { tag: string; count?: number; interactive?: boolean }) {
  const [namespace, ...rest] = tag.split(':');
  const value = rest.join(':');
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[5px] border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-white/50 ${
        interactive ? 'transition-colors hover:border-white/[0.16] hover:text-white/75' : ''
      }`}
    >
      <Hash className="h-2.5 w-2.5 text-white/25" />
      <span className="text-white/30">{namespace}</span>
      <span className="text-white/60">{value}</span>
      {typeof count === 'number' && <span className="ml-0.5 text-white/25">{count}</span>}
    </span>
  );
}

/**
 * Provenance line for seeded content. The archive must never pass itself off
 * as organic community activity — see forum-seed.js's honesty rules.
 */
export function SourceNote({ source }: { source: string | null }) {
  if (!source) return null;
  const label = source.startsWith('seed:')
    ? `Seeded from the XENO engineering log (${source.slice(5)}) — not a user report.`
    : source;
  return (
    <div className="mt-4 rounded-md border border-white/[0.07] bg-white/[0.015] px-3 py-2 text-[11.5px] text-white/35">
      {label}
    </div>
  );
}
