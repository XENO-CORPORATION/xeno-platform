import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Sparkles, PenTool, Code2, Clapperboard,
  Megaphone, Building2, GraduationCap, MoreHorizontal,
} from 'lucide-react';
import AuthMark from '../components/auth/AuthMark';
import WorkspaceChooser from '../components/onboarding/WorkspaceChooser';
import useStepTransition from '../components/onboarding/useStepTransition';
import { recommendedWorkspace } from '../lib/workspaceSuites';
import {
  StepHeading, SelectTile, PlanCard, Field, Checkbox, PrimaryButton, TextButton, Progress,
  INPUT_CLS, cx,
} from '../components/onboarding/OnboardingPieces';

/* ═══════════════════════════════════════════════════════════════════════════
 * ONBOARDING — workspace → about you → role → plan → where to start
 *
 * ── HOW IT DIFFERS FROM THE REFERENCE FLOW ─────────────────────────────────
 *
 *  1. STEP ONE IS A WORKSPACE, AND IT IS LOAD-BEARING. They pick between two
 *     platforms; we have 25 shipping products, so the equivalent question is
 *     which SUITE you live in — and unlike a survey answer, this one decides
 *     how the platform lays itself out. Suites map to catalog categories and
 *     resolve their products at render time, so a suite can never list
 *     something that does not exist and a new product joins the day it ships.
 *     Choosing everything is a first-class answer, not a fifth tile: the four
 *     cards physically collapse into one.
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
const STEPS = 4;

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

type Answers = {
  workspace: string | null;
  displayName: string; heardFrom: string; role: string | null;
  marketingOptIn: boolean;
};

/** A sellable item as `/api/billing/config` reports it. `available` is false
 *  when the item has no Stripe price id — the server's own fail-safe, which
 *  this UI respects rather than rendering a button that cannot charge. */
type Entitlements = {
  canUse?: boolean; commercial?: boolean; maxResolution?: string; priority?: boolean;
  inHouseDailyLimit?: number | null; privateProjects?: boolean; teamSeats?: number;
  cloudSync?: boolean; crossApp?: boolean; agents?: boolean; collaboration?: boolean;
};

type CatalogItem = {
  id: string; kind: string; label: string; price: number;
  interval?: string; credits?: number; badge?: string;
  available?: boolean; perSeat?: boolean; plan?: string;
  entitlements?: Entitlements;
};

/** Turn a plan's REAL entitlement set into readable lines.
 *
 *  Derived, never hand-written: the same table `requireEntitlement` reads is
 *  what produces these bullets, so a card cannot advertise a capability the
 *  server does not grant. A typed marketing list is how "Pro includes agents"
 *  outlives the code that made it true.
 *
 *  Order is deliberate — the things somebody is actually deciding between come
 *  first, and only entitlements that are GRANTED are listed. A pricing card is
 *  not the place to enumerate what you do not get. */
function allFeatures(e?: Entitlements): string[] {
  if (!e) return [];
  const out: string[] = [];
  if (e.inHouseDailyLimit === null) out.push('Unlimited in-house generation');
  else if (e.inHouseDailyLimit) out.push(`${e.inHouseDailyLimit} in-house generations/day`);
  if (e.agents) out.push('AI agents across every app');
  if (e.crossApp) out.push('Cross-app workflows');
  if (e.cloudSync) out.push('Cloud sync and multi-device');
  if (e.privateProjects) out.push('Private cloud projects');
  if (e.maxResolution === '4k') out.push('Up to 4K server-side output');
  if (e.commercial) out.push('Commercial-use licence');
  if (e.priority) out.push('Priority queue');
  if (e.collaboration) out.push('Real-time collaboration');
  if (e.teamSeats) out.push(`${e.teamSeats} team seats included`);
  return out;
}

/**
 * The lines a plan's card shows.
 *
 * Two problems with listing everything: the card becomes a wall of ten
 * near-identical ticks, and — worse — a higher tier's DIFFERENTIATORS sort to
 * the bottom, because they are the rarest entitlements. Team's whole argument
 * (collaboration, seats) ended up last, under eight lines it shares with Pro.
 *
 * So a tier that is a superset of a cheaper one leads with what is NEW, then
 * rolls the rest up into one "Everything in X" line. That is both shorter and
 * a truer description of the decision being made — nobody compares Team to
 * nothing, they compare it to Pro.
 */
function featuresFor(e?: Entitlements, baseline?: { label: string; entitlements?: Entitlements }): string[] {
  const mine = allFeatures(e);
  if (!baseline?.entitlements) return mine.slice(0, 6);

  const base = new Set(allFeatures(baseline.entitlements));
  const added = mine.filter((f) => !base.has(f));
  // Only roll up when this tier genuinely contains the cheaper one. If it does
  // not, "Everything in Pro" would be a lie and the full list is correct.
  const isSuperset = mine.length > 0 && [...base].every((f) => mine.includes(f));
  if (!isSuperset || added.length === 0) return mine.slice(0, 6);

  return [`Everything in ${baseline.label}`, ...added].slice(0, 6);
}

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

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(true);
  const [answers, setAnswers] = useState<Answers>({
    workspace: null, displayName: '', heardFrom: '', role: null, marketingOptIn: true,
  });
  const [billing, setBilling] = useState<{ enabled: boolean; currency: string; catalog: CatalogItem[] } | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  /* Raised by the workspace step's everything-bar. The nav drops away while it
   * is hovered, so the bar has the screen to itself for the moment somebody is
   * considering it. */
  const [everythingHover, setEverythingHover] = useState(false);

  /* Holds the outgoing step in the DOM long enough to animate it out. Without
   * it `key={step}` only ever animates the INCOMING subtree — React has already
   * unmounted the old one — so every change was a hard cut. */
  const t = useStepTransition(step);

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

  /* Recommendations follow the WORKSPACE they chose. That is a far stronger
   * signal than a category multi-select, and it is the choice they actually
   * made — so the last screen is visibly a consequence of the first. */
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
          {/* Width follows the step. The workspace grid is four cards side by
              side and needs the full row; every other step is a form or a list,
              where a wide measure hurts readability. One column width for all
              of them would have to be wrong for one of the two. */}
          <div
            key={t.rendered}
            style={t.style}
            className={cx(
              'w-full space-y-8',
              // Only stagger on the way IN. Running the entrance while the
              // container is sliding out fights itself and reads as a stutter.
              t.phase === 'in' && 'xeno-stagger',
              t.rendered === 2 ? 'max-w-[1240px]' : 'max-w-[620px]',
            )}
          >

            {/* ── 0 · About you — who are you ─────────────────────────────── */}
            {t.rendered === 0 && (
              <>
                <StepHeading
                  title="Let's get to know you"
                  sub="Two short questions, so the rest of this is about you rather than about us."
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

                <Nav
                  onNext={() => { save(answers); setStep(1); }}
                  onSkip={skipAll}
                  nextLabel="Continue"
                />
              </>
            )}

            {/* ── 1 · Role — what do you do ────────────────────────────────── */}
            {t.rendered === 1 && (
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
                        /* Pre-select the workspace this role suggests — but
                         * only if nothing has been chosen yet. Overwriting an
                         * existing answer would undo a deliberate choice every
                         * time somebody stepped Back and changed their role,
                         * which is the one moment they are most likely to have
                         * already picked. */
                        const rec = recommendedWorkspace(r.label);
                        const next = {
                          ...answers,
                          role: r.label,
                          workspace: answers.workspace ?? rec,
                        };
                        setAnswers(next); save(next); setStep(2);
                      }}
                    />
                  ))}
                </div>

                <Nav onBack={() => setStep(0)} onSkip={() => setStep(2)} />
              </>
            )}

            {/* ── 2 · Workspace — now we can RECOMMEND one ─────────────────── */}
            {t.rendered === 2 && (
              <>
                <StepHeading
                  title={recommendedWorkspace(answers.role)
                    ? 'Here’s the workspace we’d start you in'
                    : 'Choose your workspace'}
                  sub={recommendedWorkspace(answers.role)
                    ? 'Based on what you told us. Change it, add to it, or take everything.'
                    : 'This decides how XENO is laid out for you. You can change it any time.'}
                />

                <WorkspaceChooser
                  role={answers.role}
                  onEverythingHover={setEverythingHover}
                  value={answers.workspace}
                  onChange={(id) => {
                    const next = { ...answers, workspace: id };
                    setAnswers(next);
                    save(next);
                  }}
                />

                <Nav
                  onBack={() => setStep(1)}
                  onNext={() => setStep(3)}
                  onSkip={() => setStep(3)}
                  nextLabel="Continue"
                  nextDisabled={!answers.workspace}
                  hidden={everythingHover}
                />
              </>
            )}

            {/* ── 3 · Plan — the last step ─────────────────────────────────── */}
            {t.rendered === 3 && (
              <>
                <StepHeading
                  title="Do more with XENO"
                  sub="Browsing stays free. Generation, agents and cloud projects need a plan."
                />

                {subscriptions.length > 0 ? (
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    {subscriptions.map((item, i) => (
                      <PlanCard
                        key={item.id}
                        label={item.label}
                        price={formatPrice(item.price, billing?.currency)}
                        interval={`${item.interval || 'month'}${item.perSeat ? ' · seat' : ''}`}
                        // Compare against the cheapest OTHER subscription, so
                        // the rollup names a real plan rather than a hardcoded
                        // one — reordering or renaming the catalog cannot make
                        // this reference stale.
                        features={featuresFor(
                          item.entitlements,
                          subscriptions.find((o) => o.id !== item.id && o.price < item.price),
                        )}
                        // Pro is the anchor tier in the locked pricing strategy,
                        // so it carries the emphasis. Derived from the plan, not
                        // from position, so reordering the catalog cannot move
                        // the highlight onto the wrong card.
                        highlighted={item.plan === 'pro'}
                        badge={item.plan === 'pro' ? 'Most popular' : item.badge}
                        available={Boolean(item.available)}
                        busy={checkingOut === item.id}
                        onSelect={() => startCheckout(item.id)}
                        style={wave(i, 0.10, 0.07)}
                      />
                    ))}
                  </div>
                ) : (
                  /* No sellable plan. Says so plainly rather than rendering a
                   * dead price card — a "Select plan" button that cannot charge
                   * is worse than an honest empty state. */
                  <div className="rounded-[12px] border border-white/[0.10] px-5 py-6"
                       style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))' }}>
                    <p className="text-[14px] text-white/75">Plans aren&rsquo;t open yet.</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-white/35">
                      Your account is ready. We&rsquo;ll email you the moment subscriptions go live —
                      nothing to do until then.
                    </p>
                  </div>
                )}

                <Nav onBack={() => setStep(2)} onSkip={() => finish()} skipLabel="Skip for now" />
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

/**
 * Step navigation.
 *
 * The primary action is anchored FAR RIGHT and the quiet ones sit left. That
 * is the direction of travel in a left-to-right flow: forward belongs on the
 * leading edge, and "leave" belongs where you came from. It also puts real
 * distance between Continue and Skip, so the two are hard to confuse at speed
 * — they sat side by side before, which is a misclick waiting to happen on the
 * one screen where a wrong click costs somebody their whole answer.
 *
 * Skip stays plain text. A skip styled to compete with the primary action is a
 * dark pattern in reverse.
 */
const Nav: React.FC<{
  onBack?: () => void; onNext?: () => void; onSkip?: () => void;
  nextLabel?: string; skipLabel?: string; nextDisabled?: boolean;
  /** Drops the whole row away — used while the everything-bar is hovered. */
  hidden?: boolean;
}> = ({ onBack, onNext, onSkip, nextLabel, skipLabel, nextDisabled, hidden }) => (
  /* Falls DOWN and out rather than fading. A row that merely fades is still
     occupying its space and still reads as present-but-greyed; falling out of
     the frame reads as making way. `pointer-events-none` while gone, so a
     Continue that is visually absent cannot still be clicked. */
  <div
    style={{ transitionDuration: '260ms' }}
    className={`flex items-center gap-5 pt-1 transition-all ease-out
                ${hidden ? 'pointer-events-none translate-y-3 opacity-0' : 'translate-y-0 opacity-100'}`}
  >
    {onBack && <TextButton onClick={onBack}>Back</TextButton>}
    {onSkip && <TextButton onClick={onSkip}>{skipLabel || 'Skip'}</TextButton>}

    {/* Pushes the primary action to the far edge whether or not the left-hand
        links are present — `justify-between` would collapse it to the left on
        a step that has neither. */}
    {onNext && (
      <div className="ml-auto">
        <PrimaryButton onClick={onNext} disabled={nextDisabled}>
          {nextLabel || 'Continue'}
        </PrimaryButton>
      </div>
    )}
  </div>
);

export default Onboarding;
