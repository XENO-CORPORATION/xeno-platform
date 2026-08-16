import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Loader2, Sparkles, PenTool, Code2, Clapperboard,
  Megaphone, Building2, GraduationCap, MoreHorizontal,
  Palette, Layers, Boxes, Terminal, FileText, MessageSquare, Wand2, Library, Globe,
} from 'lucide-react';
import { PRODUCTS } from '../lib/productCatalog';
import AuthMark from '../components/auth/AuthMark';
import {
  StepHeading, SelectTile, Field, Checkbox, PrimaryButton, TextButton, Progress,
  INPUT_CLS, cx,
} from '../components/onboarding/OnboardingPieces';

/* ═══════════════════════════════════════════════════════════════════════════
 * ONBOARDING — five steps: about you → role → interests → plan → where to start
 *
 * ── HOW IT DIFFERS FROM THE REFERENCE FLOW ─────────────────────────────────
 *
 *  1. INTERESTS ARE CATEGORIES, NOT PRODUCTS. They choose between two
 *     platforms and ten features; the XENO catalog is 37 products across 9
 *     categories. A tile per product is a wall, and a wall is not a choice.
 *     Categories are derived from the catalog itself, so the flow cannot
 *     advertise a category with nothing behind it, and a product joins the day
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
const STEPS = 5;

/** Roles, each with a mark. Ordered most→least common rather than
 *  alphabetically: the list is scanned, and burying the likeliest answer taxes
 *  most users to spare a few. */
const ROLES: Array<{ label: string; icon: React.ReactNode }> = [
  { label: 'Personal use',     icon: <Sparkles className="h-[18px] w-[18px]" /> },
  { label: 'Designer',         icon: <PenTool className="h-[18px] w-[18px]" /> },
  { label: 'Developer',        icon: <Code2 className="h-[18px] w-[18px]" /> },
  { label: 'Creator',          icon: <Clapperboard className="h-[18px] w-[18px]" /> },
  { label: 'Marketer',         icon: <Megaphone className="h-[18px] w-[18px]" /> },
  { label: 'Studio or agency', icon: <Building2 className="h-[18px] w-[18px]" /> },
  { label: 'Education',        icon: <GraduationCap className="h-[18px] w-[18px]" /> },
  { label: 'Other',            icon: <MoreHorizontal className="h-[18px] w-[18px]" /> },
];

/** A mark per catalog category. Falls back rather than throwing: a category
 *  added to the catalog tomorrow gets a generic icon, never a hole in the grid. */
const CATEGORY_ICON: Record<string, React.ReactNode> = {
  Create:   <Palette className="h-[18px] w-[18px]" />,
  Design:   <Layers className="h-[18px] w-[18px]" />,
  Build:    <Boxes className="h-[18px] w-[18px]" />,
  Develop:  <Terminal className="h-[18px] w-[18px]" />,
  Office:   <FileText className="h-[18px] w-[18px]" />,
  Connect:  <MessageSquare className="h-[18px] w-[18px]" />,
  Generate: <Wand2 className="h-[18px] w-[18px]" />,
  Library:  <Library className="h-[18px] w-[18px]" />,
  Platform: <Globe className="h-[18px] w-[18px]" />,
};

/** Options for the interests step, derived from the catalog. `coming-soon` is
 *  filtered out: offering an interest we cannot act on produces a
 *  recommendation screen full of things you cannot open. */
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
  displayName: string; heardFrom: string; role: string | null;
  interests: string[]; marketingOptIn: boolean;
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
  } catch { return `${amount}`; }
}

/** Per-item entrance delay, so a grid arrives as a wave instead of a slab.
 *  Applied per tile because the grid is ONE child of the stagger container and
 *  would otherwise animate as a single block. */
const wave = (i: number, base = 0.10, step = 0.035): React.CSSProperties => ({
  animation: 'xenoRise 0.5s cubic-bezier(0.22,1,0.36,1) forwards',
  animationDelay: `${base + i * step}s`,
  opacity: 0,
});

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

  return (
    <div
      className="relative flex h-screen h-[100dvh] flex-col overflow-hidden text-white"
      style={{ background: '#060606' }}
    >
      {/* Ambient wash so the ground is not a flat black rectangle. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh]"
        style={{ background: 'radial-gradient(ellipse 65% 50% at 50% 0%, rgba(255,255,255,0.04), transparent 70%)' }}
      />

      <header className="relative z-10 flex shrink-0 items-center justify-end px-7 py-6">
        <AuthMark />
      </header>

      {/* No page card. Content sits directly on the ground in ONE left-aligned
          column, centred in the viewport — a wrapper card adds two borders and
          a padding well between the user and the task, and steals the width
          that makes the whole thing breathe. */}
      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center px-6 py-6">
          {/* `key={step}` remounts on step change, replaying the entrance
              animation. Without it React reuses the subtree and the finished
              CSS animation never runs again, so steps 2+ snap in with no
              motion at all. */}
          <div key={step} className="w-full max-w-[620px] xeno-stagger space-y-8">

            {/* ── 0 · About you ───────────────────────────────────────────── */}
            {step === 0 && (
              <>
                <StepHeading
                  title="Let's set up your workspace"
                  sub="Three short questions. All optional — skip any and nothing breaks."
                />

                <div className="space-y-5">
                  <Field label="What should we call you?" optional style={wave(0)}>
                    <input
                      autoFocus
                      value={answers.displayName}
                      onChange={(e) => setAnswers((a) => ({ ...a, displayName: e.target.value }))}
                      placeholder="Emilian"
                      className={INPUT_CLS}
                    />
                  </Field>

                  <Field label="How did you hear about XENO?" optional style={wave(1)}>
                    <input
                      value={answers.heardFrom}
                      onChange={(e) => setAnswers((a) => ({ ...a, heardFrom: e.target.value }))}
                      placeholder="A podcast, a friend, X…"
                      className={INPUT_CLS}
                    />
                  </Field>

                  {/* Unticked writes an opt-out; ticked writes nothing, because
                      subscribed is already the default state. */}
                  <label className="group flex cursor-pointer items-start gap-3 pt-1" style={wave(2)}>
                    <Checkbox
                      checked={answers.marketingOptIn}
                      onChange={(v) => setAnswers((a) => ({ ...a, marketingOptIn: v }))}
                    />
                    <span className="text-[13px] leading-relaxed text-white/40 transition-colors group-hover:text-white/65">
                      Send me product updates and release notes. You can unsubscribe from any
                      email, at any time.
                    </span>
                  </label>
                </div>

                <Nav onNext={() => { save(answers); setStep(1); }} onSkip={skipAll} nextLabel="Continue" />
              </>
            )}

            {/* ── 1 · Role ────────────────────────────────────────────────── */}
            {step === 1 && (
              <>
                <StepHeading
                  title={answers.displayName ? `Nice to meet you, ${answers.displayName}` : 'A bit about you'}
                  sub="Which one describes you best?"
                />

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {ROLES.map((r, i) => (
                    <SelectTile
                      key={r.label}
                      icon={r.icon}
                      label={r.label}
                      selected={answers.role === r.label}
                      style={wave(i)}
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

            {/* ── 2 · Interests ───────────────────────────────────────────── */}
            {step === 2 && (
              <>
                <StepHeading
                  title="What do you want to do here?"
                  sub="Select all that apply — this decides what we put in front of you next."
                />

                <div className="grid gap-2.5 sm:grid-cols-3">
                  {categories.map(({ category, products }, i) => {
                    const on = answers.interests.includes(category);
                    return (
                      <SelectTile
                        key={category}
                        icon={CATEGORY_ICON[category] || <Boxes className="h-[18px] w-[18px]" />}
                        label={category}
                        // The count is honest signal, not decoration: it says
                        // how much is actually behind the tile.
                        meta={`${products.length} ${products.length === 1 ? 'product' : 'products'}`}
                        selected={on}
                        style={wave(i)}
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

            {/* ── 3 · Plan ────────────────────────────────────────────────── */}
            {step === 3 && (
              <>
                <StepHeading
                  title="Do more with XENO"
                  sub="Browsing stays free. Generation, agents and cloud projects need a plan."
                />

                {subscriptions.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {subscriptions.map((item, i) => (
                      <div
                        key={item.id}
                        style={wave(i, 0.10, 0.06)}
                        className="flex flex-col rounded-[10px] border border-white/[0.09] bg-white/[0.015] p-5
                                   transition-colors duration-200 hover:border-white/20"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[15px] font-medium text-white">{item.label}</span>
                          {item.badge && (
                            <span className="rounded-[4px] border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/45">
                              {item.badge}
                            </span>
                          )}
                        </div>

                        <div className="mt-3 flex items-baseline gap-1">
                          <span className="text-[28px] font-semibold leading-none tabular-nums text-white">
                            {formatPrice(item.price, billing?.currency)}
                          </span>
                          <span className="text-[13px] text-white/35">
                            /{item.interval || 'month'}{item.perSeat ? ' · seat' : ''}
                          </span>
                        </div>

                        <button
                          type="button"
                          disabled={!item.available || checkingOut !== null}
                          onClick={() => startCheckout(item.id)}
                          className="focus-self mt-5 w-full rounded-[8px] border border-white/20 bg-transparent px-4 py-2.5
                                     text-[13.5px] font-medium text-white transition-all duration-200
                                     hover:border-white/40 hover:bg-white/[0.06] active:scale-[0.99]
                                     disabled:cursor-not-allowed disabled:opacity-20"
                        >
                          {checkingOut === item.id ? 'Opening checkout…'
                            : item.available ? 'Select plan'
                            : 'Not yet available'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* No sellable plan. Says so plainly rather than rendering a
                   * dead price card — a "Select plan" button that cannot charge
                   * is worse than an honest empty state. */
                  <div className="rounded-[10px] border border-white/[0.09] bg-white/[0.015] px-5 py-6">
                    <p className="text-[14px] text-white/75">Plans aren&rsquo;t open yet.</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-white/35">
                      Your account is ready. We&rsquo;ll email you the moment subscriptions go live —
                      nothing to do until then.
                    </p>
                  </div>
                )}

                <Nav onBack={() => setStep(2)} onSkip={() => setStep(4)} skipLabel="Skip for now" />
              </>
            )}

            {/* ── 4 · Where to start ──────────────────────────────────────── */}
            {step === 4 && (
              <>
                <StepHeading
                  title="Here's where to start"
                  sub={answers.interests.length
                    ? 'Based on what you picked. Everything else stays in your workspace.'
                    : 'The products that are furthest along. Everything else is in your workspace.'}
                />

                <div className="space-y-2.5">
                  {recommended.map((p, i) => (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => finish(p)}
                      disabled={saving}
                      style={wave(i, 0.10, 0.045)}
                      className="focus-self group flex w-full items-center gap-3.5 rounded-[10px] border border-white/[0.09]
                                 bg-white/[0.015] px-4 py-3.5 text-left transition-all duration-200
                                 hover:border-white/25 hover:bg-white/[0.04] active:scale-[0.99] disabled:opacity-50"
                    >
                      <span className="shrink-0 text-white/40 transition-colors group-hover:text-white/80">
                        {CATEGORY_ICON[p.category] || <Boxes className="h-[18px] w-[18px]" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-white">{p.name}</span>
                          {/* Status shown, not hidden. Sending somebody to a
                              beta without saying so is how a first impression
                              becomes "it's broken". */}
                          {p.status === 'beta' && (
                            <span className="rounded-[4px] border border-white/12 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/35">
                              Beta
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block truncate text-[12.5px] text-white/35">{p.tagline}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-white/15 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-white/60" />
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
        </div>
      </main>

      <footer className="relative z-10 shrink-0 pb-9 pt-4">
        <Progress step={step} total={STEPS} />
      </footer>
    </div>
  );
};

/** Back / Skip / Next, laid out like the reference: the primary action first,
 *  then quiet text links beside it. */
const Nav: React.FC<{
  onBack?: () => void; onNext?: () => void; onSkip?: () => void;
  nextLabel?: string; skipLabel?: string; nextDisabled?: boolean;
}> = ({ onBack, onNext, onSkip, nextLabel, skipLabel, nextDisabled }) => (
  <div className={cx('flex items-center gap-5', onNext ? 'pt-1' : 'pt-2')}>
    {onNext && (
      <PrimaryButton onClick={onNext} disabled={nextDisabled}>
        {nextLabel || 'Continue'}
      </PrimaryButton>
    )}
    {onBack && <TextButton onClick={onBack}>Back</TextButton>}
    {onSkip && <TextButton onClick={onSkip}>{skipLabel || 'Skip'}</TextButton>}
  </div>
);

export default Onboarding;
