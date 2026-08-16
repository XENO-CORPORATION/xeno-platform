import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Loader2, Check, Sparkles, PenTool, Code2, Clapperboard,
  Megaphone, Building2, GraduationCap, MoreHorizontal,
  Palette, Layers, Boxes, Terminal, FileText, MessageSquare, Wand2, Library, Globe,
} from 'lucide-react';
import { PRODUCTS } from '../lib/productCatalog';
import AuthMark from '../components/auth/AuthMark';
import { Card, Inset, Eyebrow, SelectTile, Progress, cx } from '../components/onboarding/OnboardingPieces';

/* ═══════════════════════════════════════════════════════════════════════════
 * ONBOARDING
 *
 * Five steps: about you → role → interests → plan → where to start.
 *
 * ── HOW IT DIFFERS FROM THE REFERENCE FLOW ─────────────────────────────────
 *
 *  1. INTERESTS ARE CATEGORIES, NOT PRODUCTS. They choose between two
 *     platforms and ten features; the XENO catalog is 37 products across 9
 *     categories. A tile per product is a wall, and a wall is not a choice.
 *     Categories are derived from the catalog itself, so the flow cannot
 *     advertise a category with nothing behind it and a product joins the day
 *     it ships.
 *
 *  2. THE PLAN STEP IS NOT LAST. Theirs ends on pricing, so the final thing a
 *     new account sees is a bill it declined. Ours asks, then hands them
 *     somewhere to go.
 *
 *  3. IT ENDS BY DOING SOMETHING — the products matching what they just told
 *     us, from the real catalog.
 *
 * ── WHAT IS SKIPPABLE ──────────────────────────────────────────────────────
 *
 * Every QUESTION. A required survey between a person and the product they just
 * verified their email for is a tax, and the answers it extracts are the least
 * reliable ones. The PAYWALL is not enforced here at all — skipping the plan
 * step lets them into a workspace they can look at and cannot run, because the
 * gate lives server-side on `canUse`. A client-side paywall is a suggestion;
 * the endpoint is what refuses.
 * ═══════════════════════════════════════════════════════════════════════════ */

const API = '/api/auth';

/** Roles, each with a mark. Ordered most→least common rather than
 *  alphabetically: the list is scanned, and burying the likeliest answer taxes
 *  most users to spare a few. */
const ROLES: Array<{ label: string; icon: React.ReactNode }> = [
  { label: 'Personal use',     icon: <Sparkles className="h-4 w-4" /> },
  { label: 'Designer',         icon: <PenTool className="h-4 w-4" /> },
  { label: 'Developer',        icon: <Code2 className="h-4 w-4" /> },
  { label: 'Creator',          icon: <Clapperboard className="h-4 w-4" /> },
  { label: 'Marketer',         icon: <Megaphone className="h-4 w-4" /> },
  { label: 'Studio or agency', icon: <Building2 className="h-4 w-4" /> },
  { label: 'Education',        icon: <GraduationCap className="h-4 w-4" /> },
  { label: 'Other',            icon: <MoreHorizontal className="h-4 w-4" /> },
];

/** A mark per catalog category. Falls back rather than throwing: a category
 *  added to the catalog tomorrow gets a generic icon, never a crash or a hole
 *  in the grid. */
const CATEGORY_ICON: Record<string, React.ReactNode> = {
  Create:   <Palette className="h-4 w-4" />,
  Design:   <Layers className="h-4 w-4" />,
  Build:    <Boxes className="h-4 w-4" />,
  Develop:  <Terminal className="h-4 w-4" />,
  Office:   <FileText className="h-4 w-4" />,
  Connect:  <MessageSquare className="h-4 w-4" />,
  Generate: <Wand2 className="h-4 w-4" />,
  Library:  <Library className="h-4 w-4" />,
  Platform: <Globe className="h-4 w-4" />,
};

/** Options for the interests step, derived from the catalog.
 *
 *  `coming-soon` is filtered out on purpose: offering an interest we cannot act
 *  on produces a recommendation screen full of things you cannot open. */
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
 *  when the item has no Stripe price id — the server's own fail-safe, which
 *  this UI respects rather than rendering a button that cannot charge. */
type CatalogItem = {
  id: string; kind: string; label: string; price: number;
  interval?: string; credits?: number; badge?: string;
  available?: boolean; perSeat?: boolean; plan?: string;
};

/** Money in the server's currency. Intl rather than a '$' template: the anchor
 *  price is set in EUR, and a hardcoded dollar sign in front of a euro amount
 *  is an error customers find before we do. */
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

const STEPS = 5;

const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const categories = useAvailableCategories();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(true);
  const [answers, setAnswers] = useState<Answers>({
    displayName: '', heardFrom: '', role: null, interests: [], marketingOptIn: true,
  });
  const [billing, setBilling] = useState<{ enabled: boolean; currency: string; catalog: CatalogItem[] } | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const token = () => localStorage.getItem('token');

  /* Never show this to somebody who already finished or dismissed it —
   * including on a plain reload, which is how you see a flow twice. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/onboarding`, { headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (!cancelled && data?.done) { navigate('/overview', { replace: true }); return; }
      } catch {
        // An unreachable API is not a reason to trap someone on a survey.
      }
      if (!cancelled) setChecking(false);
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  /* Load plans up front, not on arrival at the plan step — a spinner where the
   * price should be is the worst possible moment to make somebody wait. */
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

  /** Persist progress. Fire-and-forget by default: a survey answer failing to
   *  save must never block somebody from moving on. */
  const save = async (patch: Record<string, unknown>, { wait = false } = {}) => {
    const req = fetch(`${API}/onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(patch),
    }).catch(() => undefined);
    if (wait) { setSaving(true); await req; setSaving(false); }
  };

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
      // Stripe is an EXTERNAL origin — a document navigation, never the router.
      if (data?.url) { window.location.assign(data.url); return; }
      setCheckingOut(null);
    } catch { setCheckingOut(null); }
  };

  const finish = async (product?: { slug: string; launchPath?: string; delivery: string }) => {
    await save({ ...answers, startingPoint: product?.slug, completed: true }, { wait: true });
    // The destination is not derivable from the slug: a `web` product runs
    // inside the site and carries its own launchPath, while a desktop one must
    // go to its product page to be downloaded.
    const to = product
      ? (product.delivery === 'web' && product.launchPath) || `/product/${product.slug}`
      : '/overview';
    navigate(to, { replace: true });
  };

  const skipAll = async () => {
    await save({ ...answers, skipped: true }, { wait: true });
    navigate('/overview', { replace: true });
  };

  const subscriptions = useMemo(
    () => (billing?.catalog || []).filter((i) => i.kind === 'subscription' && i.plan !== 'internal'),
    [billing],
  );

  const recommended = useMemo(() => {
    const rank = (s: string) => (s === 'shipping' ? 0 : s === 'beta' ? 1 : 2);
    const picked = answers.interests.length
      ? PRODUCTS.filter((p) => answers.interests.includes(p.category) && p.status !== 'coming-soon')
      : PRODUCTS.filter((p) => p.status === 'shipping');
    return [...picked].sort((a, b) => rank(a.status) - rank(b.status)).slice(0, 5);
  }, [answers.interests]);

  if (checking) {
    return (
      <div className="h-screen h-[100dvh] grid place-items-center" style={{ background: '#060606' }}>
        <Loader2 className="h-5 w-5 animate-spin text-white/25" />
      </div>
    );
  }

  const HEADINGS = [
    { eyebrow: 'Welcome',   title: "Let's set up your workspace", sub: 'Three short questions. All optional — skip any and nothing breaks.' },
    { eyebrow: 'About you', title: answers.displayName ? `Nice to meet you, ${answers.displayName}` : 'A bit about you', sub: 'Which of these fits best?' },
    { eyebrow: 'Interests', title: 'What do you want to do here?', sub: 'Pick any that apply — this decides what we put in front of you next.' },
    { eyebrow: 'Plan',      title: 'Choose your plan', sub: 'A plan unlocks everything you just picked.' },
    { eyebrow: 'Ready',     title: "Here's where to start", sub: answers.interests.length ? 'Based on what you picked.' : 'The products that are furthest along.' },
  ];
  const head = HEADINGS[step];

  return (
    <div
      className="h-screen h-[100dvh] overflow-hidden flex flex-col text-white"
      style={{ background: '#060606' }}
    >
      {/* Ambient wash. One soft ellipse behind the card so the ground is not a
          flat black rectangle — the homepage does the same thing under its
          hero. Pointer-events-none so it can never eat a click. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh]"
        style={{ background: 'radial-gradient(ellipse 70% 55% at 50% 0%, rgba(255,255,255,0.045), transparent 70%)' }}
      />

      <header className="relative z-10 flex shrink-0 items-center justify-between px-6 py-5">
        <Progress step={step} total={STEPS} />
        <AuthMark />
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center px-5 py-4">
          {/* `key={step}` remounts on every step change, which replays the
              entrance animation. Without it React reuses the subtree and the
              CSS animation — already finished — never runs again, so steps 2+
              would snap in with no motion at all. */}
          <div key={step} className="w-full max-w-[600px] xeno-scale-in">
            <Card className="p-6 sm:p-7">
              <div className="xeno-stagger space-y-5">

                <div className="space-y-1.5">
                  <Eyebrow>{head.eyebrow}</Eyebrow>
                  <h1 className="text-[24px] sm:text-[27px] font-semibold leading-[1.15] tracking-[-0.02em] text-balance">
                    {head.title}
                  </h1>
                  <p className="text-[13px] leading-relaxed text-white/40">{head.sub}</p>
                </div>

                {/* ── 0 · About you ───────────────────────────────────────── */}
                {step === 0 && (
                  <>
                    <Inset className="divide-y divide-white/[0.05]">
                      <FieldRow label="What should we call you?" optional>
                        <input
                          autoFocus
                          value={answers.displayName}
                          onChange={(e) => setAnswers((a) => ({ ...a, displayName: e.target.value }))}
                          placeholder="Emilian"
                          className={inputCls}
                        />
                      </FieldRow>
                      <FieldRow label="How did you hear about XENO?" optional>
                        <input
                          value={answers.heardFrom}
                          onChange={(e) => setAnswers((a) => ({ ...a, heardFrom: e.target.value }))}
                          placeholder="A podcast, a friend, X…"
                          className={inputCls}
                        />
                      </FieldRow>
                    </Inset>

                    {/* Unticked writes an opt-out; ticked writes nothing,
                        because subscribed is already the default state. */}
                    <label className="group flex cursor-pointer items-start gap-3">
                      <Checkbox
                        checked={answers.marketingOptIn}
                        onChange={(v) => setAnswers((a) => ({ ...a, marketingOptIn: v }))}
                      />
                      <span className="text-[12.5px] leading-relaxed text-white/40 transition-colors group-hover:text-white/60">
                        Send me product updates and release notes. You can unsubscribe from any
                        email, at any time.
                      </span>
                    </label>

                    <Nav onNext={() => { save(answers); setStep(1); }} onSkip={skipAll} nextLabel="Continue" />
                  </>
                )}

                {/* ── 1 · Role ────────────────────────────────────────────── */}
                {step === 1 && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ROLES.map((r, i) => (
                        <SelectTile
                          key={r.label}
                          icon={r.icon}
                          label={r.label}
                          selected={answers.role === r.label}
                          // Per-tile delay so the grid arrives as a wave. Tied
                          // to index, not to the parent stagger, because the
                          // grid is ONE stagger child and would otherwise
                          // animate as a single block.
                          style={{ animation: 'xenoRise 0.45s cubic-bezier(0.22,1,0.36,1) forwards', animationDelay: `${0.10 + i * 0.035}s`, opacity: 0 }}
                          onClick={() => {
                            const next = { ...answers, role: r.label };
                            setAnswers(next); save(next); setStep(2);
                          }}
                        />
                      ))}
                    </div>
                    <Nav onBack={() => setStep(0)} onSkip={() => setStep(2)} />
                  </>
                )}

                {/* ── 2 · Interests ───────────────────────────────────────── */}
                {step === 2 && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {categories.map(({ category, products }, i) => {
                        const on = answers.interests.includes(category);
                        return (
                          <SelectTile
                            key={category}
                            icon={CATEGORY_ICON[category] || <Boxes className="h-4 w-4" />}
                            label={category}
                            // The count is honest signal, not decoration: it
                            // says how much is actually behind the tile.
                            meta={`${products.length} ${products.length === 1 ? 'product' : 'products'}`}
                            selected={on}
                            style={{ animation: 'xenoRise 0.45s cubic-bezier(0.22,1,0.36,1) forwards', animationDelay: `${0.10 + i * 0.035}s`, opacity: 0 }}
                            onClick={() =>
                              setAnswers((a) => ({
                                ...a,
                                interests: on
                                  ? a.interests.filter((c) => c !== category)
                                  : [...a.interests, category],
                              }))
                            }
                          />
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
                  </>
                )}

                {/* ── 3 · Plan ────────────────────────────────────────────── */}
                {step === 3 && (
                  <>
                    <p className="-mt-2 text-[12.5px] leading-relaxed text-white/35">
                      Without one you can browse the workspace and read the docs, but generation,
                      agents and cloud projects stay locked.
                    </p>

                    {subscriptions.length > 0 ? (
                      <div className="space-y-2">
                        {subscriptions.map((item, i) => (
                          <Inset
                            key={item.id}
                            className="p-4"
                            // Same wave as the tile grids.
                          >
                            <div
                              style={{ animation: 'xenoRise 0.45s cubic-bezier(0.22,1,0.36,1) forwards', animationDelay: `${0.12 + i * 0.06}s`, opacity: 0 }}
                            >
                              <div className="flex items-baseline justify-between gap-3">
                                <span className="flex items-baseline gap-2">
                                  <span className="text-[14px] font-medium text-white/90">{item.label}</span>
                                  {item.badge && (
                                    <span className="rounded-[3px] border border-white/10 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-white/40">
                                      {item.badge}
                                    </span>
                                  )}
                                </span>
                                <span className="text-[16px] font-semibold tabular-nums text-white">
                                  {formatPrice(item.price, billing?.currency)}
                                  <span className="text-[11.5px] font-normal text-white/35">
                                    /{item.interval || 'month'}{item.perSeat ? ' · seat' : ''}
                                  </span>
                                </span>
                              </div>

                              <button
                                type="button"
                                disabled={!item.available || checkingOut !== null}
                                onClick={() => startCheckout(item.id)}
                                className="focus-self mt-3 w-full rounded-[6px] bg-white px-4 py-2.5 text-[13px] font-medium text-black
                                           transition-all duration-200 hover:bg-white/90 active:scale-[0.99]
                                           disabled:cursor-not-allowed disabled:opacity-25"
                              >
                                {checkingOut === item.id ? 'Opening checkout…'
                                  : item.available ? `Get ${item.label}`
                                  : 'Not yet available'}
                              </button>
                            </div>
                          </Inset>
                        ))}
                      </div>
                    ) : (
                      /* No sellable plan. Says so plainly rather than rendering
                       * a dead price card — a "Select plan" button that cannot
                       * charge is worse than an honest empty state. */
                      <Inset className="px-4 py-5">
                        <p className="text-[13px] text-white/70">Plans aren&rsquo;t open yet.</p>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-white/35">
                          Your account is ready. We&rsquo;ll email you the moment subscriptions go
                          live — nothing to do until then.
                        </p>
                      </Inset>
                    )}

                    <Nav onBack={() => setStep(2)} onNext={() => setStep(4)} onSkip={() => setStep(4)} nextLabel="Maybe later" />
                  </>
                )}

                {/* ── 4 · Where to start ──────────────────────────────────── */}
                {step === 4 && (
                  <>
                    <div className="space-y-2">
                      {recommended.map((p, i) => (
                        <button
                          key={p.slug}
                          type="button"
                          onClick={() => finish(p)}
                          disabled={saving}
                          style={{ animation: 'xenoRise 0.45s cubic-bezier(0.22,1,0.36,1) forwards', animationDelay: `${0.10 + i * 0.045}s`, opacity: 0 }}
                          className="focus-self group flex w-full items-center gap-3 rounded-[7px] border border-white/[0.07]
                                     bg-white/[0.02] px-4 py-3 text-left transition-all duration-200
                                     hover:border-white/[0.16] hover:bg-white/[0.05] active:scale-[0.99]
                                     disabled:opacity-50"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[5px] border border-white/[0.07] bg-white/[0.03] text-white/45 transition-colors group-hover:text-white/75">
                            {CATEGORY_ICON[p.category] || <Boxes className="h-4 w-4" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="text-[13.5px] font-medium text-white/90">{p.name}</span>
                              {/* Status shown, not hidden. Sending somebody to
                                  a beta without saying so is how a first
                                  impression becomes "it's broken". */}
                              {p.status === 'beta' && (
                                <span className="rounded-[3px] border border-white/10 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-white/35">
                                  Beta
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-white/35">{p.tagline}</span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-white/15 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-white/50" />
                        </button>
                      ))}
                    </div>
                    <Nav
                      onBack={() => setStep(3)}
                      onNext={() => finish()}
                      nextLabel={saving ? 'Saving…' : 'Go to my workspace'}
                    />
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>
      </main>

      <footer className="relative z-10 shrink-0 py-5 text-center">
        <span className="text-[11.5px] text-white/20">
          Step {step + 1} of {STEPS}
        </span>
      </footer>
    </div>
  );
};

/* ── small pieces ────────────────────────────────────────────────────────── */

/* `focus-self` opts out of the global :focus-visible ring — these fields paint
   their own focus state, and the global rule would draw a SECOND one floating
   2px outside the border. See index.css. */
const inputCls =
  'focus-self w-full bg-transparent px-4 py-3 text-[13.5px] text-white outline-none ' +
  'placeholder:text-white/20 transition-colors duration-150';

/** Label above, field below, inside an Inset row. */
const FieldRow: React.FC<{ label: string; optional?: boolean; children: React.ReactNode }> = ({
  label, optional, children,
}) => (
  <label className="group block px-4 pt-3 pb-1 transition-colors focus-within:bg-white/[0.02]">
    <span className="text-[11.5px] text-white/45">
      {label}{optional && <span className="text-white/20"> (optional)</span>}
    </span>
    <div className="-mx-4">{children}</div>
  </label>
);

/** Square, 2px radius — DESIGN_SYSTEM forbids circles and pills. */
const Checkbox: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
    <span
      aria-hidden
      className={cx(
        'mt-0.5 grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[3px] border',
        'transition-all duration-200 ease-out peer-focus-visible:ring-1 peer-focus-visible:ring-white/40',
        checked ? 'border-white bg-white' : 'border-white/20 bg-transparent',
      )}
    >
      <Check className={cx('h-3 w-3 text-black transition-transform duration-200', checked ? 'scale-100' : 'scale-0')} strokeWidth={3} />
    </span>
  </>
);

/** Back / Skip / Next. Skip is always plain text — a skip styled to compete
 *  with the primary action is a dark pattern in reverse. */
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
        className="focus-self rounded-[6px] bg-white px-5 py-2.5 text-[13px] font-medium text-black
                   transition-all duration-200 hover:bg-white/90 active:scale-[0.98]
                   disabled:cursor-not-allowed disabled:opacity-25"
      >
        {nextLabel || 'Continue'}
      </button>
    )}
    {onBack && (
      <button type="button" onClick={onBack}
        className="focus-self text-[12.5px] text-white/40 transition-colors hover:text-white/75">
        Back
      </button>
    )}
    {onSkip && (
      <button type="button" onClick={onSkip}
        className="focus-self ml-auto text-[12.5px] text-white/25 transition-colors hover:text-white/55">
        Skip
      </button>
    )}
  </div>
);

export default Onboarding;
