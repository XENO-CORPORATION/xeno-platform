import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ArrowRight, Loader2 } from 'lucide-react';
import { PRODUCTS } from '../lib/productCatalog';
import AuthMark from '../components/auth/AuthMark';

/* ═══════════════════════════════════════════════════════════════════════════
 * ONBOARDING
 *
 * Five steps: about you → role → interests → PLAN → where to start.
 *
 * Adapted from the flow the reference product uses, with three departures that
 * exist because our ecosystem is a different shape:
 *
 *  1. INTERESTS ARE CATEGORIES, NOT PRODUCTS. They pick between two platforms
 *     and ten features; the XENO catalog is 37 products across 9 categories.
 *     A tile per product is a wall, and a wall is not a choice. Categories are
 *     derived from the catalog itself, so the flow cannot drift from what
 *     actually ships.
 *
 *  2. THE PLAN STEP IS NOT LAST. Theirs ends on pricing, which means the final
 *     thing a new account sees is a bill. Ours asks for the money and then
 *     hands them somewhere to go, so the flow ends inside the product rather
 *     than on a checkout they declined.
 *
 *  3. IT ENDS BY DOING SOMETHING. The last step is the products matching what
 *     they just told us, sourced from the real catalog. Onboarding that ends
 *     on a survey "submit" spends the user's attention and returns nothing.
 *
 * ── WHAT IS SKIPPABLE, AND WHAT IS NOT ─────────────────────────────────────
 *
 * Every QUESTION is skippable — a required survey between a person and the
 * product they just verified their email for is a tax, and the answers it
 * extracts are the least reliable ones. The PAYWALL is not enforced here at
 * all: skipping the plan step lets them into a workspace they can look at and
 * cannot run, because the gate lives server-side on `canUse`. A client-side
 * paywall is a suggestion; the endpoint is what refuses.
 * ═══════════════════════════════════════════════════════════════════════════ */

const API = '/api/auth';

/** The roles offered. Order is roughly most→least common, not alphabetical:
 *  the list is scanned, and burying the likeliest answer is a cost paid by
 *  most users to spare a few. */
const ROLES = [
  'Personal use', 'Designer', 'Developer', 'Creator',
  'Marketer', 'Studio or agency', 'Education', 'Other',
];

/** Where the "what do you want to do" step gets its options.
 *
 *  Derived from the catalog rather than hand-listed, so a category cannot
 *  appear here with nothing behind it — and a new product joins the flow the
 *  day it ships without anyone remembering to edit this file.
 *
 *  `coming-soon` is filtered out on purpose: offering an interest we cannot
 *  act on produces a recommendation screen full of things you can't open. */
function useAvailableCategories() {
  return useMemo(() => {
    const byCategory = new Map<string, typeof PRODUCTS>();
    for (const p of PRODUCTS) {
      if (p.status === 'coming-soon') continue;
      const list = byCategory.get(p.category) || [];
      list.push(p);
      byCategory.set(p.category, list);
    }
    return [...byCategory.entries()]
      .map(([category, products]) => ({ category, products }))
      .sort((a, b) => b.products.length - a.products.length);
  }, []);
}

type Answers = {
  displayName: string;
  heardFrom: string;
  role: string | null;
  interests: string[];
  marketingOptIn: boolean;
};

/** A sellable item as `/api/billing/config` reports it. `available` is false
 *  when the item has no Stripe price id configured — the server's own fail-safe,
 *  which this UI must respect rather than render a button that cannot charge. */
type CatalogItem = {
  id: string; kind: string; label: string; price: number;
  interval?: string; credits?: number; badge?: string;
  available?: boolean; perSeat?: boolean; plan?: string;
};

/** Money, in the currency the server reports.
 *
 *  Uses Intl rather than a '$' template: the catalog's anchor price is set in
 *  EUR by the monetization strategy, and a hardcoded dollar sign in front of a
 *  euro amount is the kind of error nobody catches until a customer does. */
function formatPrice(amount: number, currency = 'usd') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currency.toUpperCase(),
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount}`;
  }
}

const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const categories = useAvailableCategories();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(true);
  const [answers, setAnswers] = useState<Answers>({
    displayName: '', heardFrom: '', role: null, interests: [], marketingOptIn: true,
  });

  /* Billing. `enabled` is the server telling us whether checkout can actually
   * complete — it is false whenever Stripe is unconfigured. We render from it
   * rather than from a hardcoded plan list so this screen cannot advertise a
   * price the platform is not able to take. */
  const [billing, setBilling] = useState<{ enabled: boolean; currency: string; catalog: CatalogItem[] } | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const token = () => localStorage.getItem('token');

  /* Never show this flow to somebody who already finished or dismissed it —
   * including on a plain reload, which is the common way to see it twice. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/onboarding`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        const data = await res.json();
        if (!cancelled && data?.done) { navigate('/overview', { replace: true }); return; }
      } catch {
        // Unreachable API is not a reason to trap someone on a survey.
      }
      if (!cancelled) setChecking(false);
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  /* Load the plan catalog up front, not on arrival at the plan step — a
   * spinner where the price should be is the worst possible moment to make
   * someone wait. Failure leaves `billing` null, which the step renders as
   * "plans are not available", never as a broken or empty price. */
  useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/config')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.success) {
          setBilling({ enabled: Boolean(d.enabled), currency: d.currency || 'usd', catalog: d.catalog || [] });
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  /** Start checkout. Only ever called for an item the server marked available. */
  const startCheckout = async (itemId: string) => {
    setCheckingOut(itemId);
    try {
      await save({ ...answers, completed: true });
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ itemId }),
      });
      const data = await res.json();
      // A checkout URL is an EXTERNAL origin (Stripe), so this is a full
      // document navigation, never react-router.
      if (data?.url) { window.location.assign(data.url); return; }
      setCheckingOut(null);
    } catch {
      setCheckingOut(null);
    }
  };

  /** Persist progress. Fire-and-forget by default: a survey answer failing to
   *  save must never block the person from moving on. */
  const save = async (patch: Record<string, unknown>, { wait = false } = {}) => {
    const body = JSON.stringify(patch);
    const req = fetch(`${API}/onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body,
    }).catch(() => undefined);
    if (wait) { setSaving(true); await req; setSaving(false); }
  };

  /* `startingPoint` is recorded as the SLUG, but the destination is not
   * derivable from it: a `web` product runs inside the site and carries its
   * own `launchPath`, while a desktop one has to go to its product page to be
   * downloaded. Sending a web product to /product/<slug> would land a
   * signed-in user on a marketing page for something they can just open. */
  const finish = async (product?: { slug: string; launchPath?: string; delivery: string }) => {
    await save({ ...answers, startingPoint: product?.slug, completed: true }, { wait: true });
    const to = product
      ? (product.delivery === 'web' && product.launchPath) || `/product/${product.slug}`
      : '/overview';
    navigate(to, { replace: true });
  };

  const skipAll = async () => {
    await save({ ...answers, skipped: true }, { wait: true });
    navigate('/overview', { replace: true });
  };

  /* Recommendations for the final step. Products whose category the user
   * ticked, best-status first, capped at six — a "here is where to start"
   * screen showing twenty things has not actually started anyone. */
  /* Subscriptions only. Credit packs are in the same catalog but are the wrong
   * thing to put in front of a new account: they are a top-up for someone who
   * already has a plan and ran out, and offering both here turns one decision
   * into a comparison between two unrelated purchases. */
  const subscriptions = useMemo(
    () => (billing?.catalog || []).filter((i) => i.kind === 'subscription' && i.plan !== 'internal'),
    [billing],
  );

  const recommended = useMemo(() => {
    const rank = (s: string) => (s === 'shipping' ? 0 : s === 'beta' ? 1 : 2);
    const picked = answers.interests.length
      ? PRODUCTS.filter((p) => answers.interests.includes(p.category) && p.status !== 'coming-soon')
      : PRODUCTS.filter((p) => p.status === 'shipping');
    return [...picked].sort((a, b) => rank(a.status) - rank(b.status)).slice(0, 6);
  }, [answers.interests]);

  if (checking) {
    return (
      <div className="h-screen h-[100dvh] grid place-items-center bg-[#000000]">
        <Loader2 className="w-5 h-5 animate-spin text-white/30" />
      </div>
    );
  }

  const STEPS = 5;

  return (
    <div className="h-screen h-[100dvh] overflow-hidden bg-[#000000] text-white flex flex-col">
      {/* Same mark, same corner as the auth surface — this is the next screen
          in that sequence, and moving the logo between them reads as arriving
          somewhere else. */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-5">
        <span className="text-[12.5px] text-white/35">
          Step {step + 1} of {STEPS}
        </span>
        <AuthMark />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center px-6 py-4">
          <div className="w-full max-w-[560px]">

            {/* ── 0 · About you ─────────────────────────────────────────── */}
            {step === 0 && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h1 className="text-[26px] font-semibold tracking-tight text-balance">
                    Let's set up your workspace
                  </h1>
                  <p className="text-[13.5px] leading-relaxed text-white/45">
                    Three short questions. All of them optional — skip any and nothing breaks.
                  </p>
                </div>

                <div className="space-y-4">
                  <Field label="What should we call you?" optional>
                    <input
                      autoFocus
                      value={answers.displayName}
                      onChange={(e) => setAnswers((a) => ({ ...a, displayName: e.target.value }))}
                      placeholder="Emilian"
                      className={inputCls}
                    />
                  </Field>

                  <Field label="How did you hear about XENO?" optional>
                    <input
                      value={answers.heardFrom}
                      onChange={(e) => setAnswers((a) => ({ ...a, heardFrom: e.target.value }))}
                      placeholder="A podcast, a friend, X…"
                      className={inputCls}
                    />
                  </Field>
                </div>

                {/* Unticked writes an opt-out; ticked writes nothing, because
                    subscribed is already the default state. */}
                <label className="flex items-start gap-3 cursor-pointer group">
                  <Checkbox
                    checked={answers.marketingOptIn}
                    onChange={(v) => setAnswers((a) => ({ ...a, marketingOptIn: v }))}
                  />
                  <span className="text-[12.5px] leading-relaxed text-white/45 group-hover:text-white/60 transition-colors">
                    Send me product updates and release notes. You can unsubscribe from any
                    email, at any time.
                  </span>
                </label>

                <Nav
                  onNext={() => { save(answers); setStep(1); }}
                  onSkip={skipAll}
                  nextLabel="Continue"
                />
              </div>
            )}

            {/* ── 1 · Role ──────────────────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h1 className="text-[26px] font-semibold tracking-tight text-balance">
                    {answers.displayName ? `Nice to meet you, ${answers.displayName}.` : 'A bit about you'}
                  </h1>
                  <p className="text-[13.5px] text-white/45">Which of these fits best?</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map((role) => (
                    <Tile
                      key={role}
                      selected={answers.role === role}
                      onClick={() => {
                        const next = { ...answers, role };
                        setAnswers(next); save(next); setStep(2);
                      }}
                    >
                      {role}
                    </Tile>
                  ))}
                </div>

                <Nav onBack={() => setStep(0)} onSkip={() => setStep(2)} />
              </div>
            )}

            {/* ── 2 · Interests ─────────────────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h1 className="text-[26px] font-semibold tracking-tight text-balance">
                    What do you want to do here?
                  </h1>
                  <p className="text-[13.5px] text-white/45">
                    Pick any that apply — this decides what we put in front of you next.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {categories.map(({ category, products }) => {
                    const on = answers.interests.includes(category);
                    return (
                      <Tile
                        key={category}
                        selected={on}
                        onClick={() =>
                          setAnswers((a) => ({
                            ...a,
                            interests: on
                              ? a.interests.filter((c) => c !== category)
                              : [...a.interests, category],
                          }))
                        }
                      >
                        <span className="flex items-center justify-between gap-2 w-full">
                          <span>{category}</span>
                          {/* The count is honest signal, not decoration: it
                              says how much is actually behind the tile. */}
                          <span className="text-[11px] text-white/30 tabular-nums">
                            {products.length}
                          </span>
                        </span>
                      </Tile>
                    );
                  })}
                </div>

                <Nav
                  onBack={() => setStep(1)}
                  onNext={() => { save(answers); setStep(3); }}
                  onSkip={() => setStep(3)}
                  nextLabel="Continue"
                  nextDisabled={answers.interests.length === 0}
                />
              </div>
            )}

            {/* ── 3 · Plan ──────────────────────────────────────────────────
                Placed AFTER the value questions, not before. They have just
                told us what they want to build; asking for money at that point
                is a different conversation from asking a stranger on arrival.
                ─────────────────────────────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h1 className="text-[26px] font-semibold tracking-tight text-balance">
                    Choose your plan
                  </h1>
                  <p className="text-[13.5px] leading-relaxed text-white/45">
                    A plan unlocks everything you just picked. Without one you can browse the
                    workspace and read the docs, but generation, agents and cloud projects stay
                    locked.
                  </p>
                </div>

                {subscriptions.length > 0 ? (
                  <div className="space-y-2">
                    {subscriptions.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-[4px] border border-white/[0.08] bg-white/[0.02] p-4 space-y-3"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="flex items-baseline gap-2">
                            <span className="text-[14px] font-medium text-white/90">{item.label}</span>
                            {item.badge && (
                              <span className="text-[10px] uppercase tracking-wider text-white/40 border border-white/10 px-1.5 py-0.5 rounded-[2px]">
                                {item.badge}
                              </span>
                            )}
                          </span>
                          <span className="text-[15px] font-semibold text-white tabular-nums">
                            {formatPrice(item.price, billing?.currency)}
                            <span className="text-[12px] font-normal text-white/40">
                              /{item.interval || 'month'}{item.perSeat ? ' · seat' : ''}
                            </span>
                          </span>
                        </div>

                        <button
                          type="button"
                          disabled={!item.available || checkingOut !== null}
                          onClick={() => startCheckout(item.id)}
                          className="w-full px-4 py-2.5 rounded-[4px] bg-white text-black text-[13px] font-medium
                                     hover:bg-white/90 transition-colors
                                     disabled:opacity-25 disabled:cursor-not-allowed"
                        >
                          {checkingOut === item.id ? 'Opening checkout…'
                            : item.available ? `Get ${item.label}`
                            : 'Not yet available'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* No sellable plan. Says so plainly rather than rendering a
                   * dead price card — a "Select plan" button that cannot charge
                   * is worse than an honest empty state. */
                  <div className="rounded-[4px] border border-white/[0.08] bg-white/[0.02] px-4 py-5">
                    <p className="text-[13px] text-white/70">Plans aren't open yet.</p>
                    <p className="text-[12.5px] text-white/40 mt-1 leading-relaxed">
                      Your account is ready. We'll email you the moment subscriptions go live —
                      nothing to do until then.
                    </p>
                  </div>
                )}

                <Nav
                  onBack={() => setStep(2)}
                  onNext={() => setStep(4)}
                  onSkip={() => setStep(4)}
                  nextLabel="Maybe later"
                />
              </div>
            )}

            {/* ── 4 · The payoff ────────────────────────────────────────── */}
            {step === 4 && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h1 className="text-[26px] font-semibold tracking-tight text-balance">
                    Here's where to start
                  </h1>
                  <p className="text-[13.5px] text-white/45">
                    {answers.interests.length
                      ? 'Based on what you picked. Everything else stays available from the workspace.'
                      : 'The products that are furthest along. Everything else is in the workspace.'}
                  </p>
                </div>

                <div className="space-y-2">
                  {recommended.map((p) => (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => finish(p.slug)}
                      disabled={saving}
                      className="w-full text-left px-4 py-3 rounded-[4px] border border-white/[0.08]
                                 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.16]
                                 transition-colors group flex items-center gap-3 disabled:opacity-50"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[13.5px] font-medium text-white/90">{p.name}</span>
                          {/* Status is shown, not hidden. Sending someone to a
                              beta without saying so is how the first
                              impression becomes "it's broken". */}
                          {p.status === 'beta' && (
                            <span className="text-[10px] uppercase tracking-wider text-white/35 border border-white/10 px-1.5 py-0.5 rounded-[2px]">
                              Beta
                            </span>
                          )}
                        </span>
                        <span className="block text-[12px] text-white/40 truncate mt-0.5">
                          {p.tagline}
                        </span>
                      </span>
                      <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors flex-shrink-0" />
                    </button>
                  ))}
                </div>

                <Nav
                  onBack={() => setStep(3)}
                  onNext={() => finish()}
                  nextLabel={saving ? 'Saving…' : 'Go to my workspace'}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Progress. Four steps, so dots carry real information — with twelve
          they would be decoration. */}
      <div className="flex-shrink-0 flex items-center justify-center gap-1.5 py-6">
        {Array.from({ length: STEPS }).map((_, i) => (
          <span
            key={i}
            className={`h-1 rounded-full transition-all duration-300 ${
              i === step ? 'w-6 bg-white/70' : i < step ? 'w-1.5 bg-white/30' : 'w-1.5 bg-white/10'
            }`}
          />
        ))}
      </div>
    </div>
  );
};

/* ── small pieces ────────────────────────────────────────────────────────── */

const inputCls =
  'w-full px-3.5 py-2.5 rounded-[4px] bg-white/[0.03] border border-white/[0.08] ' +
  'text-[13.5px] text-white placeholder:text-white/25 outline-none ' +
  'focus:border-white/25 focus:bg-white/[0.05] transition-colors duration-150';

const Field: React.FC<{ label: string; optional?: boolean; children: React.ReactNode }> = ({
  label, optional, children,
}) => (
  <label className="block space-y-1.5">
    <span className="text-[12.5px] text-white/55">
      {label}{optional && <span className="text-white/25"> (optional)</span>}
    </span>
    {children}
  </label>
);

/** Square, 2px radius — DESIGN_SYSTEM forbids circles and pills. */
const Checkbox: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({
  checked, onChange,
}) => (
  <>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="sr-only peer"
    />
    <span
      aria-hidden
      className={`mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded-[2px] border
                  transition-colors duration-150 peer-focus-visible:ring-1 peer-focus-visible:ring-white/40
                  ${checked ? 'bg-white border-white' : 'border-white/20 bg-transparent'}`}
    >
      {checked && <Check className="h-3 w-3 text-black" strokeWidth={3} />}
    </span>
  </>
);

const Tile: React.FC<{
  selected: boolean; onClick: () => void; children: React.ReactNode;
}> = ({ selected, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={`px-4 py-3 rounded-[4px] border text-[13px] text-left transition-colors duration-150
                ${selected
                  ? 'border-white/40 bg-white/[0.08] text-white'
                  : 'border-white/[0.08] bg-white/[0.02] text-white/70 hover:border-white/20 hover:text-white/90'}`}
  >
    {children}
  </button>
);

/** Back / Skip / Next. Skip is always present and always plain text — a skip
 *  styled to compete with the primary action is a dark pattern in reverse. */
const Nav: React.FC<{
  onBack?: () => void; onNext?: () => void; onSkip?: () => void;
  nextLabel?: string; nextDisabled?: boolean;
}> = ({ onBack, onNext, onSkip, nextLabel, nextDisabled }) => (
  <div className="flex items-center gap-4 pt-1">
    {onNext && (
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="px-5 py-2.5 rounded-[4px] bg-white text-black text-[13px] font-medium
                   hover:bg-white/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {nextLabel || 'Continue'}
      </button>
    )}
    {onBack && (
      <button type="button" onClick={onBack}
        className="text-[12.5px] text-white/45 hover:text-white/75 transition-colors">
        Back
      </button>
    )}
    {onSkip && (
      <button type="button" onClick={onSkip}
        className="text-[12.5px] text-white/30 hover:text-white/60 transition-colors ml-auto">
        Skip
      </button>
    )}
  </div>
);

export default Onboarding;
