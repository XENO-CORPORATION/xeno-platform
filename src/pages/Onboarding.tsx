import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Sparkles, PenTool, Code2, Clapperboard,
  Megaphone, Building2, GraduationCap, MoreHorizontal,
} from 'lucide-react';
import AuthMark from '../components/auth/AuthMark';
import WorkspaceChooser from '../components/onboarding/WorkspaceChooser';
import useStepTransition from '../components/onboarding/useStepTransition';
import RoleCard from '../components/onboarding/RoleCard';
import useRovingGrid from '../components/onboarding/useRovingGrid';
import {
  recommendedWorkspace, parseRoles, serializeRoles,
  SUITES, parseWorkspace, isEverything, availableForSuite,
} from '../lib/workspaceSuites';
import {
  StepHeading, PlanCard, Field, Checkbox, PrimaryButton, TextButton, FlowControls,
  INPUT_CLS, cx,
} from '../components/onboarding/OnboardingPieces';
import {
  AUTH_TOKEN_KEY, ONBOARDING_DONE_KEY, destinationAfterOnboarding,
  consumeOnboardingNext, isExternalOnboardingNext,
} from '../lib/onboardingHandoff.js';

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
  /** Annual items price the YEAR; this is the per-month figure to display. */
  perMonth?: number;
  /** The grandfathered early-adopter price. Exactly one of founding/list is offered. */
  founding?: boolean;
  /** What a founding price becomes for later customers. Quotable, never buyable —
   *  the server sends the amount without a `priceId`. */
  becomes?: { price: number; perMonth?: number | null };
  entitlements?: Entitlements;
};

/** What this deployment can actually serve, as opposed to what a plan is
 *  entitled to. The two are different questions and a card needs both. */
type Serves = { inHouse?: boolean };

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
function allFeatures(e?: Entitlements, serves?: Serves): string[] {
  if (!e) return [];
  const out: string[] = [];
  /* 🔴 Entitled is not the same as SERVEABLE, and only one of them belongs on a
   * card. `inHouseDailyLimit` is a real, enforced quota — and the route behind
   * it answers 400 `inhouse_unavailable` when this deployment has no xeno-rt,
   * so deriving the line straight from the entitlement advertises an allowance
   * against an error. Omitted unless the server says it can serve it, which is
   * the same fail-safe as `available` for a price: never offer what we cannot
   * honour. Undefined counts as cannot — silence is not a yes. */
  if (serves?.inHouse) {
    if (e.inHouseDailyLimit === null) out.push('Unlimited in-house generation');
    else if (e.inHouseDailyLimit) out.push(`${e.inHouseDailyLimit} in-house generations/day`);
  }
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
function featuresFor(
  e?: Entitlements,
  baseline?: { label: string; entitlements?: Entitlements },
  serves?: Serves,
): string[] {
  const mine = allFeatures(e, serves);
  if (!baseline?.entitlements) return mine.slice(0, 6);

  const base = new Set(allFeatures(baseline.entitlements, serves));
  const added = mine.filter((f) => !base.has(f));
  // Only roll up when this tier genuinely contains the cheaper one. If it does
  // not, "Everything in Pro" would be a lie and the full list is correct.
  const isSuperset = mine.length > 0 && [...base].every((f) => mine.includes(f));
  if (!isSuperset || added.length === 0) return mine.slice(0, 6);

  return [`Everything in ${baseline.label}`, ...added].slice(0, 6);
}

/**
 * What a cheaper tier does NOT grant, relative to a better one.
 *
 * Derived by subtraction from the same entitlement table `requireEntitlement`
 * reads, never written by hand. The day free gains a small generation
 * allowance, this list loses that line by itself — where a typed one would
 * keep selling against a product we had stopped shipping.
 *
 * Capped, and capped at the TOP: these are ordered with the things people
 * actually decide on first, so a truncated list keeps the strongest argument.
 */
function lockedFor(mine?: Entitlements, better?: Entitlements, serves?: Serves): string[] {
  if (!better) return [];
  const have = new Set(allFeatures(mine, serves));
  return allFeatures(better, serves).filter((f) => !have.has(f)).slice(0, 6);
}

/**
 * The line under the price. It has to carry whatever is true and awkward.
 *
 * Three facts compete for one line, and leaving any of them out is the kind of
 * omission a customer discovers at checkout: that an annual plan charges a
 * year up front, that Team multiplies by seats, and that a founding price is
 * grandfathered rather than introductory. The last one matters most - "EUR 24"
 * beside "EUR 39" reads as a discount that will expire unless we say plainly
 * that it will not.
 */
function noteFor(item: CatalogItem, currency?: string): string {
  const parts: string[] = [];
  if (item.interval === 'year') parts.push(`Billed annually at ${formatPrice(item.price, currency)}`);
  else parts.push('Billed monthly');
  if (item.perSeat) parts.push('per seat');
  parts.push('cancel any time');
  return `${parts.join(' · ')}.`;
}

/**
 * The founding-price promise: what it becomes, and that you keep this one.
 *
 * Both halves or neither. "EUR 24, locked forever" without the successor is a
 * claim with nothing to compare against; "EUR 24, later EUR 39" without the lock
 * reads as an introductory rate that expires — the bait-and-switch this
 * ecosystem's own pricing standard exists to rule out. Together they are an
 * honest deadline: the price rises for new customers and never for you.
 *
 * The successor comes from the server, matched on plan AND interval, so the
 * yearly card quotes the yearly number. A literal here would be a promise about
 * money maintained in the one place that cannot see what Stripe will charge.
 */
function foundingNote(item: CatalogItem, currency?: string): string | undefined {
  if (!item.founding || !item.becomes) return undefined;
  const then = item.becomes.perMonth ?? item.becomes.price;
  const unit = item.becomes.perMonth != null || item.interval !== 'year' ? '/mo' : '';
  return `${formatPrice(then, currency)}${unit} for everyone who joins later. You keep this price for as long as you stay.`;
}

/**
 * What switching to annual actually saves — the SMALLEST saving on offer.
 *
 * One toggle switches every card, so any single percentage it states has to hold
 * for all of them. A hand-typed "save 26%" sat here and was true only of the
 * LIST prices; while founding pricing is open the plans actually on sale save
 * 21% (Pro) and 20% (Team), so the control overstated the discount on both.
 *
 * Hence the minimum rather than the best case, and `floor` rather than `round`:
 * rounding 20.8 up to 21 advertises a discount the customer does not receive.
 * Understating is safe — every annual card also carries its own per-month
 * figure, so the exact number is one glance away.
 *
 * ⚠️ It compares the two ANNUAL TOTALS, not the per-month figures. That is the
 * quantity the customer actually parts with, and it avoids a real defect: Team
 * saves exactly 20%, but `1 - 32/40` is 19.999999999999996 in binary, which
 * floors to 19 — a full point given away to floating point. `(480 - 384)/480`
 * is exact.
 *
 * Exported because it is a claim about money: it is gated against the real
 * catalog in scripts/pricing.test.mjs, in both pricing regimes.
 */
export function annualSavingFrom(catalog?: CatalogItem[]): number | null {
  const subs = (catalog || []).filter((i) => i.kind === 'subscription');
  const savings = subs
    .filter((y) => y.interval === 'year')
    .map((y) => {
      const monthly = subs.find((m) => m.plan === y.plan && (m.interval || 'month') === 'month');
      if (!monthly?.price || !y.price) return null;
      const yearOfMonths = monthly.price * 12;
      return ((yearOfMonths - y.price) * 100) / yearOfMonths;
    })
    .filter((n): n is number => typeof n === 'number' && n > 0);
  if (!savings.length) return null;
  const pct = Math.floor(Math.min(...savings));
  return pct > 0 ? pct : null;
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
  const [billing, setBilling] = useState<{
    enabled: boolean; currency: string; catalog: CatalogItem[];
    /* The free tier, served from the same entitlement table the gate reads.
     * The pricing step argues from the DIFFERENCE between free and paid, and a
     * difference needs both sides — see the note on getConfig(). */
    freePlan?: { plan: string; label: string; price: number; entitlements?: Entitlements };
    /* Absent means "assume nothing is serveable" — see allFeatures. */
    serves?: Serves;
  } | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  /* Raised by the workspace step's everything-bar. The nav drops away while it
   * is hovered, so the bar has the screen to itself for the moment somebody is
   * considering it. */
  const [everythingHover, setEverythingHover] = useState(false);

  /* Holds the outgoing step in the DOM long enough to animate it out. Without
   * it `key={step}` only ever animates the INCOMING subtree — React has already
   * unmounted the old one — so every change was a hard cut. */
  const t = useStepTransition(step);

  const token = () => localStorage.getItem(AUTH_TOKEN_KEY);

  /* Never show this to somebody who already finished or dismissed it —
   * including on a plain reload, which is how you see a flow twice. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/onboarding`, { headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (!cancelled && data?.done) {
          sessionStorage.setItem(ONBOARDING_DONE_KEY, '1');
          const to = destinationAfterOnboarding('/overview');
          if (isExternalOnboardingNext(to)) { window.location.replace(to); return; }
          navigate(to, { replace: true });
          return;
        }
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
          setBilling({
            enabled: Boolean(d.enabled), currency: d.currency || 'usd',
            catalog: d.catalog || [], freePlan: d.freePlan, serves: d.serves,
          });
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

  const leaveTo = (fallbackPath: string) => {
    sessionStorage.setItem(ONBOARDING_DONE_KEY, '1');
    const next = consumeOnboardingNext();
    // A portal return wins over a product tile — they came here to finish
    // the account, not to be stranded on a marketing page.
    const to = (next && isExternalOnboardingNext(next)) ? next : fallbackPath;
    if (isExternalOnboardingNext(to)) { window.location.replace(to); return; }
    navigate(to, { replace: true });
  };

  const finish = async (product?: { slug: string; launchPath?: string; delivery: string }) => {
    await save({ ...answers, startingPoint: product?.slug, completed: true }, { wait: true });
    // The destination is not derivable from the slug: a `web` product runs
    // inside the site and carries its own launchPath, while a desktop one must
    // go to its product page to be downloaded.
    const productPath = product
      ? (product.delivery === 'web' && product.launchPath) || `/product/${product.slug}`
      : '/overview';
    leaveTo(productPath);
  };

  /**
   * Go BACK, clearing the answer of the step being returned to.
   *
   * ── WHY BACK INVALIDATES, RATHER THAN PRESERVING ──────────────────────────
   *
   * Pressing Back means "that answer was wrong", so landing on the step with
   * the wrong answer still highlighted is the one thing it cannot do. Worse,
   * it hid a real bug: the workspace is PRE-SELECTED from the role, and that
   * pre-selection deliberately only applies when nothing is chosen yet — so
   * going back and picking a DIFFERENT role kept the old recommendation. The
   * flow silently stopped listening at the exact moment the user was changing
   * their mind.
   *
   * Clearing the role therefore clears the workspace too. It is derived from
   * the role; leaving it behind would leave a recommendation with nothing
   * recommending it.
   *
   * ── SELECTIONS RESET, TYPED TEXT DOES NOT ────────────────────────────────
   *
   * Step 0 keeps its name and heard-from. Re-picking a tile costs one click;
   * re-typing a name you already gave is a punishment for navigating, and the
   * request was that a step not arrive with a stale SELECTION — which text
   * fields do not have.
   */
  const back = (to: number) => {
    // Computed OUTSIDE the state updater. React may invoke an updater twice
    // (StrictMode does, deliberately), and a network call inside one is
    // therefore a double POST — a side effect belongs in the event handler,
    // never in the reducer.
    const next = { ...answers };
    if (to <= 1) { next.role = null; next.workspace = null; }
    if (to <= 2) { next.workspace = null; }

    setAnswers(next);
    // Persisted so a cleared answer does not survive a reload — the route
    // distinguishes an absent key from an explicit null for exactly this.
    save(next);
    setStep(to);
  };

  /**
   * The primary action for the current step, or null if it has none.
   *
   * Declared as data rather than wired into the Enter handler directly, so the
   * keyboard and the Continue button invoke the SAME thing. Two code paths for
   * one action is how a keyboard route quietly stops matching the button it is
   * meant to mirror.
   *
   * Steps 1 and 3 return null on purpose. The role step has no Continue —
   * choosing IS advancing — and on the plan step the forward actions are
   * finishing WITHOUT a plan and starting a CHECKOUT. Binding Enter to either
   * would be a keystroke that either leaves the paywall behind or opens a
   * payment flow, and neither is something to do by accident.
   */
  const primaryAction = (): (() => void) | null => {
    if (step === 0) return () => { save(answers); setStep(1); };
    if (step === 1) return parseRoles(answers.role).length ? () => setStep(2) : null;
    if (step === 2) return answers.workspace ? () => setStep(3) : null;
    return null;
  };

  /* Enter advances. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* Esc goes back a step.
       *
       * Paired with Enter deliberately: forward and back on the two keys every
       * dialog in every OS already uses, so the flow needs no learning. It goes
       * through the same `back()` as the button, which also clears the step it
       * returns to — a shortcut that skipped that would leave a stale answer
       * highlighted only when you used the keyboard. */
      if (e.key === 'Escape') {
        if (step === 0) return; // nothing behind the first step
        e.preventDefault();
        back(step - 1);
        return;
      }
      if (e.key !== 'Enter') return;
      // Plain Enter only. Ctrl/Cmd+Enter is a submit-everything convention
      // elsewhere and Shift+Enter is a newline; neither should mean "next".
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      // An IME composition ends with Enter. Advancing on it would eat the
      // keystroke that was confirming a character.
      if (e.isComposing) return;

      /* Never steal Enter from something that already handles it.
       *
       * Every card and tile here is a <button>, and Enter on a focused button
       * activates it natively. Hijacking that would make the keyboard route
       * do the WRONG thing precisely when someone is navigating by keyboard —
       * they would tab to a suite card, press Enter, and skip the step instead
       * of selecting it. */
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (el?.isContentEditable) return;

      const act = primaryAction();
      if (!act) return;
      e.preventDefault();
      act();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // No dependency array, deliberately: the handler closes over `step` and
    // `answers`, and re-registering each render is what keeps that closure
    // current. A dep list here would be one more thing to keep in sync with
    // whatever primaryAction happens to read, and getting it wrong means Enter
    // silently acts on a stale answer.
  });

  /** Toggle a role. Multi-select: people are more than one thing. */
  const chooseRole = (label: string) => {
    const current = parseRoles(answers.role);
    const nextRoles = current.includes(label)
      ? current.filter((r) => r !== label)
      : [...current, label];
    const role = serializeRoles(nextRoles);

    /* The recommendation is RE-DERIVED on every change, not applied once.
     *
     * With one role, applying it only when the workspace was empty was right —
     * it protected a deliberate choice. With several, that same guard freezes
     * the recommendation at whatever the FIRST role suggested, so adding
     * "Developer" to "Designer" would silently not widen it. Re-deriving keeps
     * the suggestion honest; the workspace step is where it can be overridden,
     * and stepping Back clears it anyway. */
    const next = { ...answers, role, workspace: recommendedWorkspace(role) };
    setAnswers(next);
    save(next);
  };

  /* ── ONE grid for the whole step, not one per question ────────────────────
   *
   * It is mounted on the wrapper that holds the step's content AND its Back /
   * Continue, so everything on screen is reachable with the arrows. That was
   * impossible while the grid lived on the card row: Back and Continue are
   * siblings of that row, so no handler on it could ever see them.
   *
   * Enter still means "continue" wherever the highlight happens to be. The
   * last step ends the flow rather than advancing it, so it supplies its own
   * action — `primaryAction` is null there by design, and without this Enter
   * would quietly do nothing on the one screen people most want to leave.
   *
   * `step` is the reset key: each step opens with the highlight on its first
   * item rather than wherever the previous one left it. */
  const stepGrid = useRovingGrid(
    () => (step === STEPS - 1 ? finish() : primaryAction()?.()),
    step,
  );


  /* Monthly or annual. Defaults to MONTHLY.
   *
   * Annual is the better deal and defaulting to it would show a smaller
   * number — which is exactly why it is not the default. Someone comparing
   * prices should see the one they will be charged next month, not a figure
   * that requires a year's commitment to be true. The saving is stated on the
   * toggle instead, where it reads as an offer rather than a sleight. */
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');

  const subscriptions = useMemo(
    () => (billing?.catalog || [])
      .filter((i) => i.kind === 'subscription' && i.plan !== 'internal')
      // Studio is an enterprise conversation, not a card on a signup flow.
      // It stays in the catalog; it is not offered here.
      .filter((i) => i.plan !== 'studio')
      .filter((i) => (i.interval || 'month') === billingInterval),
    [billing, billingInterval],
  );

  /* Is an annual price offered at all? The toggle must not exist otherwise -
   * a control that switches to an empty list is worse than no control. */
  const hasAnnual = useMemo(
    () => (billing?.catalog || []).some((i) => i.kind === 'subscription' && i.interval === 'year'),
    [billing],
  );

  const annualSaving = useMemo(() => annualSavingFrom(billing?.catalog), [billing]);

  /* The tier free is measured against: the CHEAPEST sellable one.
   *
   * Not `plan === 'pro'`. What a free user is deciding is whether to pay at
   * all, so the honest comparison is against the least they could pay — and
   * naming a plan here would quietly become wrong the day the ladder gains a
   * rung below it, in a list whose whole job is to be accurate about what is
   * withheld. Pro still carries the visual emphasis; that is a separate
   * decision, and it is allowed to be an opinion. */
  const anchor = useMemo(
    () => [...subscriptions].sort((a, b) => a.price - b.price)[0],
    [subscriptions],
  );

  /* How many apps their workspace actually contains, MEASURED.
   *
   * `availableForSuite` filters through the release probe rather than the
   * catalog's `status`, so this counts what a person can genuinely open today
   * — three products were marked `coming-soon` while shipping, and this is the
   * single number on the payment card that could embarrass us if it were
   * guessed. Deduped by slug: a product reachable from two suites is one app.
   *
   * The count is what makes the price concrete. "Cross-app workflows" is a
   * phrase; "all 12, fully running" is the thing they built two steps ago,
   * with a number they can go and check. */
  const workspaceApps = useMemo(() => {
    const picked = parseWorkspace(answers.workspace);
    const chosen = isEverything(picked) || !picked.length
      ? SUITES
      : SUITES.filter((s) => picked.includes(s.id));
    return new Set(chosen.flatMap((s) => availableForSuite(s).map((p) => p.slug))).size;
  }, [answers.workspace]);

  /* What they chose, said back to them.
   *
   * The pitch lands harder against something concrete: someone who picked
   * Creative and Office should read those words, not "your workspace". It is
   * also the only thing connecting this step to the one before it — without
   * it the flow asks three questions and then changes the subject to money. */
  const workspaceSummary = useMemo(() => {
    const picked = parseWorkspace(answers.workspace);
    if (!picked.length) return '';
    if (isEverything(picked)) return 'The full XENO workspace';
    const names = SUITES.filter((s) => picked.includes(s.id)).map((s) => s.name);
    if (!names.length) return '';
    if (names.length === 1) return `Your ${names[0]} workspace`;
    return `Your ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} workspace`;
  }, [answers.workspace]);

  /* Recommendations follow the WORKSPACE they chose. That is a far stronger
   * signal than a category multi-select, and it is the choice they actually
   * made — so the last screen is visibly a consequence of the first. */
  /* The keys THIS step actually responds to.
   *
   * Per step, not fixed: a legend that advertises Space on a form with nothing
   * to select, or "Enter to continue" where Continue is disabled, is a hint
   * that lies — and once one line is wrong the reader stops trusting the rest.
   * Enter only appears when primaryAction returns something. */
  const stepKeys = (() => {
    const canContinue = Boolean(primaryAction());
    // Every step past the intro is a card step: cards, then Back and
    // Continue, all in one arrow-navigable run. The intro is two text fields,
    // where arrows belong to the caret.
    const grid = step > 0;
    return [
      ...(grid ? [{ key: '←→', label: 'Move' }, { key: 'Space', label: 'Select' }] : []),
      ...(canContinue ? [{ key: 'Enter', label: 'Continue' }] : []),
      // Nothing is behind the first step, so Esc is not offered there.
      ...(step > 0 ? [{ key: 'Esc', label: 'Back' }] : []),
    ];
  })();

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
            {...stepGrid.containerProps}
            className={cx(
              'w-full space-y-8',
              // Only stagger on the way IN. Running the entrance while the
              // container is sliding out fights itself and reads as a stutter.
              t.phase === 'in' && 'xeno-stagger',
              /* Width follows the step: the workspace grid is four tall cards and
                 needs the full row; the role grid is four short ones and wants
                 less; the forms stay a readable measure. One width for all
                 three would have to be wrong for two of them. */
              t.rendered === 2 ? 'max-w-[1240px]' : t.rendered === 1 ? 'max-w-[980px]' : 'max-w-[620px]',
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

                <Nav onNext={() => primaryAction()?.()} nextLabel="Continue" />
              </>
            )}

            {/* ── 1 · Role — what do you do ────────────────────────────────── */}
            {t.rendered === 1 && (
              <>
                <StepHeading
                  title={answers.displayName ? `Nice to meet you, ${answers.displayName}` : 'A bit about you'}
                  sub="Pick as many as apply — it decides what we set up for you."
                />

                {/* Four across on a wide screen, two on a laptop. The cards
                    carry a header and a body now, so at two columns eight of
                    them run past the fold — and a step that scrolls hides the
                    Back and Continue a user is most likely to want here. */}
                {/* One tab stop, arrows within. Without a roving tabindex,
                    crossing this question costs eight Tab presses — a cost a
                    keyboard user pays on every visit while a mouse user pays
                    nothing.

                    `radiogroup` because the options are mutually exclusive and
                    exactly one can hold. The keydown sits on the container, so
                    the handler exists once rather than on all eight children. */}
                <div
                  role="group"
                  aria-label="Which of these describe you?"
                  className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
                >
                  {ROLES.map((r, i) => (
                    <RoleCard
                      key={r.label}
                      icon={r.icon}
                      label={r.label}
                      selected={parseRoles(answers.role).includes(r.label)}
                      style={wave(i, 0.06, 0.045)}
                      onClick={() => chooseRole(r.label)}
                    />
                  ))}
                </div>

                <Nav
                  onBack={() => back(0)}
                  onNext={() => primaryAction()?.()}
                  nextLabel="Continue"
                  nextDisabled={parseRoles(answers.role).length === 0}
                />
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
                  onBack={() => back(1)}
                  onNext={() => primaryAction()?.()}
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
                  title="Everything&rsquo;s ready. Choose how you run it."
                  /* Names what they picked, then draws the one line that
                     matters: the apps genuinely open on free, and the compute
                     is what costs. Both halves are true, which is why it can be
                     said this plainly - `requireEntitlement('canUse')` gates
                     the spending routes and nothing else. */
                  sub={workspaceSummary
                    ? `${workspaceSummary} installs and opens for free. Running it — generation, agents, cloud projects — is what a plan is for.`
                    : 'Browsing stays free. Generation, agents and cloud projects need a plan.'}
                />

                {/* ── Billing interval ─────────────────────────────────────
                    Rendered only when an annual price actually exists. A
                    toggle that switches to an empty grid is worse than no
                    toggle, and the catalog is the only thing that knows. */}
                {hasAnnual && (
                  <div className="flex justify-center">
                    <div
                      role="group"
                      aria-label="Billing interval"
                      className="inline-flex gap-[2px] rounded-[9px] border border-white/[0.08] p-1"
                      style={{ background: '#08080a' }}
                    >
                      {([
                        { id: 'month' as const, label: 'Monthly' },
                        {
                          id: 'year' as const,
                          label: 'Yearly',
                          hint: annualSaving ? `save ${annualSaving}%` : undefined,
                        },
                      ]).map((opt) => {
                        const on = billingInterval === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            data-roving="action"
                            aria-pressed={on}
                            onClick={() => setBillingInterval(opt.id)}
                            className={cx(
                              'rounded-[6px] px-4 py-2 text-[12.5px] font-medium transition-all duration-200',
                              on ? 'text-white' : 'text-white/40 hover:text-white/70',
                            )}
                            // Selection is a lighter PLATE, not a colour - the
                            // same monochrome rule the cards follow.
                            style={on ? { background: '#242424' } : undefined}
                          >
                            {opt.label}
                            {opt.hint && (
                              <span className={cx('ml-2 text-[10.5px]', on ? 'text-white/45' : 'text-white/25')}>
                                {opt.hint}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {subscriptions.length > 0 ? (
                  /* THREE tiers, side by side, free included.
                   *
                   * Free was not on this screen before, and its absence was the
                   * whole problem: "Pro, €24" sitting alone answers "how much"
                   * and never answers "instead of what". The decision being made
                   * here is not which paid plan — it is whether to pay at all,
                   * and that comparison cannot be drawn with one side missing.
                   *
                   * It is also the honest way to show `canUse: false`. Free is
                   * not a crippled trial we are hiding; it is a real tier that
                   * genuinely opens every app, and the one thing it will not do
                   * is spend compute. Said plainly it is a fair offer. Left off
                   * the page it looks like something being concealed. */
                  <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                    {billing?.freePlan && (
                      <PlanCard
                        key="free"
                        label={billing.freePlan.label}
                        price={formatPrice(billing.freePlan.price, billing.currency)}
                        interval=""
                        note="No card, no expiry."
                        /* Free DOES grant something now — the local tier of the
                           pricing standard — so this list fills itself from the
                           same table, and the locked list still carries the
                           argument by subtraction. Neither is typed. */
                        features={featuresFor(billing.freePlan.entitlements, undefined, billing.serves)}
                        locked={lockedFor(billing.freePlan.entitlements, anchor?.entitlements, billing.serves)}
                        /* The same number, twice, differing only in what
                           CONNECTS it. That is the paywall in the pricing
                           standard: the apps are Layer 1 and free, and what
                           costs money is our servers joining them up.
                           ⚠️ This line used to read "None of them run", which
                           was not true and — worse — not enforceable: the apps
                           are local Electron installers and `canUse` gates our
                           API, so a free user disproves it by opening one
                           offline. A claim a customer can falsify in ten
                           minutes discredits every other claim on the page. */
                        unlock={workspaceApps
                          ? { count: workspaceApps, verdict: `All ${workspaceApps}, running on this machine.` }
                          : undefined}
                        current
                        style={wave(0, 0.10, 0.07)}
                      />
                    )}

                    {subscriptions.map((item, i) => (
                      <PlanCard
                        key={item.id}
                        label={item.label}
                        /* Annual prices the YEAR; the card shows the per-month
                           figure because that is the number people compare,
                           and the note states the real charge so the smaller
                           number is never the whole claim. */
                        price={formatPrice(item.perMonth ?? item.price, billing?.currency)}
                        interval="month"
                        note={noteFor(item, billing?.currency)}
                        promise={foundingNote(item, billing?.currency)}
                        // Compare against the cheapest OTHER subscription, so
                        // the rollup names a real plan rather than a hardcoded
                        // one — reordering or renaming the catalog cannot make
                        // this reference stale.
                        features={featuresFor(
                          item.entitlements,
                          subscriptions.find((o) => o.id !== item.id && o.price < item.price),
                          billing?.serves,
                        )}
                        // Pro is the anchor tier in the locked pricing strategy,
                        // so it carries the emphasis. Derived from the plan, not
                        // from position, so reordering the catalog cannot move
                        // the highlight onto the wrong card.
                        unlock={workspaceApps
                          ? { count: workspaceApps, verdict: `All ${workspaceApps}, connected to each other.` }
                          : undefined}
                        highlighted={item.plan === 'pro'}
                        badge={item.plan === 'pro' ? 'Most popular' : item.badge}
                        available={Boolean(item.available)}
                        busy={checkingOut === item.id}
                        onSelect={() => startCheckout(item.id)}
                        style={wave(i + 1, 0.10, 0.07)}
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

                {/* No Skip anywhere — but the flow still has to END somewhere.
                    Continue leads into the workspace WITHOUT a plan, and that
                    is not a hole in the paywall: the gate is server-side on
                    `canUse`, so an unpaid account can look and cannot run.
                    Trapping people on this screen would strand every single
                    one of them today, because no plan is purchasable until
                    Stripe is configured. */}
                <Nav onBack={() => back(2)} onNext={() => finish()} nextLabel="Continue" />
              </>
            )}

          </div>
        </div>
      </main>

      <footer className="relative z-10 shrink-0 pb-8 pt-4">
        <FlowControls step={step} total={STEPS} keys={stepKeys} />
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
 * distance between Continue and Back, so the two are hard to confuse at speed
 * — they sat side by side before, which is a misclick waiting to happen on the
 * one screen where a wrong click costs somebody their whole answer.
 *
 * There is deliberately no Skip. Continue is the ONLY way forward, so there is
 * never a second control racing it. Removed by request; the gate in
 * scripts/keyboard-flow.test.mjs keeps it removed.
 */
const Nav: React.FC<{
  onBack?: () => void; onNext?: () => void;
  nextLabel?: string; nextDisabled?: boolean;
  /** Drops the whole row away — used while the everything-bar is hovered. */
  hidden?: boolean;
}> = ({ onBack, onNext, nextLabel, nextDisabled, hidden }) => (
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
