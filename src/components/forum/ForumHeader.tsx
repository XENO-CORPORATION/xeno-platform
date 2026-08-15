import React from 'react';
import { Link } from 'react-router-dom';
import { PenLine } from 'lucide-react';
import * as api from './api';
import NotificationBell from './NotificationBell';

/**
 * The forum's own header.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The shell used to mount `landing-v3/Header` — the marketing header. That is
 * 588 lines of Products / Marketplace / Solutions mega-menus, a Download CTA,
 * and a `Pricing → #pricing` link which is a HASH ANCHOR: from /forum it
 * scrolls to an element that does not exist on the page. A dead link in the
 * top-level nav of an application surface.
 *
 * It also carried the retired purple (`rgba(167,96,255)`, `#a760ff`), so every
 * forum page violated DESIGN_SYSTEM.md through an import rather than through
 * anything the forum itself declared.
 *
 * No social product does this. X, Facebook, LinkedIn and Reddit all run a slim
 * PRODUCT header on the app and keep the marketing nav on the marketing site —
 * because the two answer different questions. Marketing nav asks "what is this
 * company?"; app nav asks "where am I and what can I do here?". Mounting the
 * first on an app surface is how you get a mega-menu above a feed.
 *
 * So this header carries only what an app header owes the user: where they are,
 * how to get out, how to make something, and who they are signed in as.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *
 *   • no search — it lives in the right rail at lg+, and below lg it reappears
 *     in the CENTRE COLUMN, next to the space chips. Each control returns
 *     exactly where its own rail disappears; putting a second search box up here
 *     as well would mean two of them on a 1024px screen.
 *   • no reputation number anywhere near the avatar — D4.
 *
 * The BELL was on this list until WP1 landed, on the grounds that "an empty bell
 * is a promise the product cannot keep". That was right, and it is now spent:
 * `forum_notifications` exists and `createPost` / `acceptAnswer` write to it, so
 * there is a real thing to show. A comment that outlives its condition is how a
 * file starts arguing with itself.
 */

interface Viewer {
  handle?: string | null;
  displayName?: string | null;
  kind?: string | null;
  isStaff?: boolean;
}

const ForumHeader: React.FC<{ viewer?: Viewer | null }> = ({ viewer }) => {
  // A pure local-token check — no request. The header must render instantly and
  // identically on every forum page, so it never waits on /me. When a page has
  // already loaded the viewer it passes it in; when it hasn't, we still know
  // whether to show "Sign in" or an avatar.
  const signedIn = api.isSignedIn();
  const name = viewer?.displayName || viewer?.handle || '';
  const initial = name.trim().charAt(0).toUpperCase() || '•';

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-14 border-b border-white/[0.08] bg-[#08080a]/95 backdrop-blur-xl">
      <div className="page-gutter flex h-full w-full items-center justify-between gap-4">

        {/* ── Left: identity + where you are ───────────────────────── */}
        <div className="flex min-w-0 items-center gap-2.5">
          <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="XENO home">
            <img src="/xeno-logo.svg" alt="" className="h-6 w-6 invert" />
          </Link>
          <span aria-hidden className="h-5 w-px shrink-0 bg-white/[0.12]" />
          <Link
            to="/forum"
            className="truncate text-[15px] font-semibold tracking-tight text-white transition-colors hover:text-[#e5e5e9]"
          >
            Forum
          </Link>
        </div>

        {/* ── Right: make something, and who you are ───────────────── */}
        <div className="flex shrink-0 items-center gap-2.5">
          {/*
            Only below xl. At xl+ the left rail carries the primary "New post"
            button, and two persistent compose entry points on one screen is
            clutter, not convenience. Every viewport gets exactly one.
          */}
          <Link
            to="/forum/new"
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-white/[0.15] bg-white/[0.10] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.18] xl:hidden"
          >
            <PenLine className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New post</span>
          </Link>

          {/* Renders nothing when signed out — see NotificationBell. */}
          <NotificationBell />

          {signedIn ? (
            <Link
              to="/dashboard"
              className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.06]"
              title={name || 'Your account'}
            >
              {/*
                Square, not a circle — DESIGN_SYSTEM.md §3. The same PostAvatar
                shape the feed uses, so the person in the header reads as the
                same kind of thing as the people in the threads.
              */}
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] border border-white/[0.12] bg-white/[0.08] text-[12px] font-semibold text-[#e5e5e9]">
                {initial}
              </span>
              {name && (
                <span className="hidden max-w-[140px] truncate text-[13px] text-[#a8a8b1] md:inline">{name}</span>
              )}
            </Link>
          ) : (
            <Link
              to="/auth"
              className="inline-flex h-9 cursor-pointer items-center rounded-md border border-white/[0.15] px-4 text-[13px] font-medium text-[#e5e5e9] transition-colors hover:border-white/30 hover:text-white"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

export default ForumHeader;
