import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCircle2, MessageSquare, Loader2 } from 'lucide-react';
import * as api from './api';

/**
 * The unread bell — the visible end of WP1's return path.
 *
 * ── THE BADGE IS WHITE, NOT RED. THIS IS NOT A STYLE PREFERENCE ─────────────
 *
 * `DESIGN_SYSTEM.md` is explicit: *"Additional colors (green, red, amber)
 * appear ONLY in semantic/status contexts (success, error, warning) — never for
 * brand or interactive styling."*
 *
 * "You have three answers" is not an error, a warning, or a failure. Every
 * consumer app paints this red because red is the colour that wins attention
 * auctions — which is the exact instinct SPEC §5.4 exists to refuse. The badge
 * is the monochromatic accent, like every other interactive affordance here.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 *   • no polling while the tab is hidden. A background tab that talks to the
 *     server every minute forever is a cost with no reader on the other end.
 *   • no count above 9. The difference between 12 and 40 unread changes nothing
 *     about what you do next, and a big number is a guilt mechanic.
 *   • no bell at all when signed out — rather than a bell that bounces you to
 *     /auth. A control that cannot do its job should not be drawn.
 */

const POLL_MS = 60000;

type Notification = {
  id: string;
  kind: 'answer' | 'reply' | 'accepted' | 'mention';
  createdAt: string;
  read: boolean;
  actor: { name: string; kind: string } | null;
  thread: { shortId: string; title: string; url: string } | null;
};

/** Plain language, and the verb does the work — no "New activity on…" padding. */
function describe(n: Notification): string {
  const who = n.actor?.name || 'Someone';
  const agent = n.actor?.kind === 'agent' ? ' (agent)' : '';
  switch (n.kind) {
    case 'answer':   return `${who}${agent} answered your question`;
    case 'reply':    return `${who}${agent} replied`;
    case 'accepted': return 'Your answer was accepted';
    case 'mention':  return `${who}${agent} mentioned you`;
    default:         return 'New activity';
  }
}

const ICON = {
  answer: MessageSquare,
  reply: MessageSquare,
  accepted: CheckCircle2,
  mention: MessageSquare,
} as const;

function relative(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const signedIn = api.isSignedIn();

  /** Count only — cheap enough to run on an interval. */
  const refreshCount = useCallback(() => {
    if (!api.isSignedIn()) return;
    api.getNotifications(true)
      .then((r) => setUnread(Number(r?.unread ?? 0)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    refreshCount();

    // Only while the tab is actually being looked at. A hidden tab polling
    // forever costs the server and tells nobody anything.
    const tick = () => { if (document.visibilityState === 'visible') refreshCount(); };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [signedIn, refreshCount]);

  /** The full list is fetched only when the panel is actually opened. */
  const openPanel = useCallback(() => {
    setOpen(true);
    setLoading(true);
    api.getNotifications()
      .then((r) => { setItems(r?.notifications ?? []); setUnread(Number(r?.unread ?? 0)); })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  // Close on outside click and on Escape. Escape matters more than it looks:
  // it is the only way out for someone who opened this by keyboard.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openItem = (n: Notification) => {
    setOpen(false);
    // Optimistic: mark read locally, then tell the server. Reading a
    // notification is not a transaction — if the call fails the next refresh
    // corrects it, and making someone wait to navigate is the wrong trade.
    if (!n.read) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? cur);
      api.markNotificationsRead([n.id]).catch(() => {});
    }
    if (n.thread) navigate(n.thread.url);
  };

  const markAll = () => {
    setUnread(0);
    setItems((cur) => cur?.map((x) => ({ ...x, read: true })) ?? cur);
    api.markNotificationsRead().catch(() => {});
  };

  if (!signedIn) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        className={`relative grid h-9 w-9 cursor-pointer place-items-center rounded-md transition-colors ${
          open ? 'bg-white/[0.10] text-white' : 'text-[#a8a8b1] hover:bg-white/[0.06] hover:text-[#e5e5e9]'
        }`}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          // Monochromatic. See the header comment — red here would claim this is
          // a fault, and DESIGN_SYSTEM.md reserves red for exactly that.
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-[4px] bg-white px-1 text-[10px] font-semibold leading-none text-black">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[340px] overflow-hidden rounded-md border border-white/10 bg-[#060608] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-3.5 py-2.5">
            <h2 className="text-[13px] font-semibold text-[#e5e5e9]">Notifications</h2>
            {unread > 0 && (
              <button
                type="button" onClick={markAll}
                className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] text-[#79797f] transition-colors hover:text-[#e5e5e9]"
              >
                <Check className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {loading && items === null ? (
              <div className="flex items-center justify-center py-8 text-[#57575e]">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : !items?.length ? (
              // Honest, not chirpy. There is no "You're all caught up! 🎉" here —
              // the product has nothing to celebrate about an empty list.
              <p className="px-3.5 py-8 text-center text-[12.5px] text-[#57575e]">
                Nothing yet. When someone answers you, it shows up here.
              </p>
            ) : (
              <ul>
                {items.map((n) => {
                  const Icon = ICON[n.kind] ?? MessageSquare;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={`flex w-full cursor-pointer items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.04] ${
                          n.read ? '' : 'bg-white/[0.03]'
                        }`}
                      >
                        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${n.read ? 'text-[#57575e]' : 'text-[#a8a8b1]'}`} />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[12.5px] leading-snug ${n.read ? 'text-[#79797f]' : 'text-[#e5e5e9]'}`}>
                            {describe(n)}
                          </span>
                          {n.thread && (
                            <span className="mt-0.5 block truncate text-[12px] text-[#79797f]">{n.thread.title}</span>
                          )}
                          <span className="mt-1 block text-[11px] text-[#57575e]">{relative(n.createdAt)}</span>
                        </span>
                        {!n.read && <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white/70" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
