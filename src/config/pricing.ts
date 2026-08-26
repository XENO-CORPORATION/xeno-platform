// Canonical PUBLIC pricing — the single front-end source of truth for tiers + features.
//
// v2 model (LOCKED). The free/paid line is ENFORCEABILITY, not cosmetics:
//   • Free   — the account and web surface. Existing local installs keep working,
//              but a new desktop installer requires a paid plan. BYOK and hosted
//              in-house inference are not advertised until they are serveable.
//   • Everything — €24/mo founding, €39/mo list. The connected PLATFORM, for individuals.
//              Desktop installers PLUS
//              cloud sync + multi-device, cross-app workflows, agents/automation, private
//              cloud projects, managed-premium inference priority, and the commercial license.
//   • Team   — €40/seat/mo. Everything in Everything PLUS real-time collaboration,
//              a shared/pooled credit wallet, one consolidated invoice, spend budgets,
//              admin/governance, and workspace tenancy. Per-seat is ALWAYS >= individual Pro.
//   • Studio — €99/mo. The shipped higher-capacity tier; custom enterprise terms are
//              discussed separately and are not represented as shipped capabilities.
//
// CREDITS ARE ORTHOGONAL. Subscriptions gate FEATURES. Credits are a separate, OPTIONAL
// à-la-carte top-up that fuels ONLY managed-premium (frontier / 3rd-party) inference and
// the marketplace — BYOK and in-house xeno-rt open models never cost credits, and paid
// credits never expire. Credits are NOT the product and must never dominate the page.
//
// Prices here are the LOCKED values and mirror the server billing catalog
// (src/server/services/billingService.js), which in turn mirrors the Stripe Price objects.
// Components should PREFER the live price from GET /api/billing/config (getLivePriceMap,
// matched by `itemId`) and fall back to `price`/`credits` here — so the ADVERTISED price
// always equals the CHARGED price, even if Stripe is re-priced.
//
// Currency is EUR (EU entity + Impressum + Stripe VAT). Live plan keys: pro_monthly (€24),
// team_seat (€40/seat). Credit packs: credits_small/medium/large (€10/€50/€100).
//
// NOTE: features must be TRUE (enforced or real). No vaporware, no "remove watermark"
// (watermarking is retired), and no false "replaces X / exclusive models" claims — XENO
// aggregates API-accessible + open models (honest boundary).

export type TierId = 'free' | 'pro' | 'team' | 'studio';

export interface PricingTier {
  id: TierId;
  name: string;
  /** Billing-catalog item id for one-click Checkout (undefined = Free / contact-sales). */
  itemId?: string;
  /** Static fallback amount in `currency`; the live catalog price wins when available. */
  price: number | 'custom';
  currency: string;      // ISO code, lowercase ('eur')
  cadence?: string;      // '/mo', '/seat/mo'
  line: string;          // one-line positioning
  features: string[];    // must be true/enforced — no vaporware claims
  /** Small print under the card (founding price, seat minimum, annual note). */
  note?: string;
  cta: string;
  href: string;          // fallback link (Checkout is used when itemId is set + authed)
  featured?: boolean;
}

/** An optional à-la-carte credit top-up pack (fuels managed-premium + marketplace only). */
export interface CreditPack {
  id: string;            // catalog item id (credits_small/medium/large) — used for Checkout
  label: string;
  credits: number;
  price: number;
  currency: string;
  badge?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = { eur: '€', usd: '$', gbp: '£' };

/** Currency symbol for an ISO code (defaults to €). */
export function currencySymbol(code?: string): string {
  return CURRENCY_SYMBOLS[(code || 'eur').toLowerCase()] || (code ? code.toUpperCase() + ' ' : '€');
}

/** Format an amount like "€24" (or "Custom"). */
export function formatPrice(amount: number | 'custom', code?: string): string {
  if (amount === 'custom') return 'Custom';
  return `${currencySymbol(code)}${amount}`;
}

/** Format a credit count like "1,000 credits". */
export function formatCredits(n: number): string {
  return `${n.toLocaleString('en-US')} credits`;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'eur',
    line: 'Your account and web workspace. New desktop installs require a plan.',
    features: [
      /* ⚠️ This list said "Every app: Pixel, Motion, Sound, Canvas & more" and
       * "Local editing & local files — works offline", above a CTA reading
       * "Download free" that pointed at /download.
       *
       * That is no longer true and it is NOT a claim being quietly retired:
       * the account owner MOVED the boundary on 2026-08-24 (see
       * PLAN_ENTITLEMENTS.free `canDownload` in billingService.js). An
       * installer now needs an active paid plan. A free account keeps the API
       * allowance below, and an app it already installed keeps working —
       * but it cannot obtain a new one, so this card must not offer one. */
      'Browse every product and every release note',
      'Clean, full-resolution exports from apps you already have',
      // BYOK was listed here and is NOT available: the `byok` inference path in
      // src/server/routes/aiRoutes.js returns `byok_unavailable`, because BYOK is
      // owned by the XENO API gateway and is not implemented there yet. This list
      // is rendered on the landing page, the pricing page and the welcome modal,
      // so it was promising a feature no user could use. The Pricing page prose
      // already says BYOK is "planned and not yet available" — keep the claim
      // there, in the roadmap voice, not here in the shipped-feature list.
      // Re-add only when the gateway actually serves it.
      '50/day in-house allowance when that service becomes available',
      'Community support',
    ],
    note: 'No card or expiry. Existing installs keep working; obtaining a new desktop installer requires a plan.',
    cta: 'Create account',
    href: '/signup',
  },
  {
    id: 'pro',
    name: 'Everything',
    itemId: 'pro_monthly',
    price: 24,
    currency: 'eur',
    cadence: '/mo',
    line: 'The connected platform, for individuals. The tools, wired together.',
    features: [
      'Every available XENO desktop installer',
      'Cloud sync & multi-device continuity',
      'Cross-app workflow layer (product integrations rolling out)',
      'Agent identities and access credentials',
      'Private cloud projects',
      'Managed-premium inference priority',
      'Commercial-use license',
    ],
    note: 'Founding price €24/mo or €228/year — locked while subscribed. List price is €39/mo or €348/year.',
    cta: 'Choose Everything',
    href: '/signup',
    featured: true,
  },
  {
    id: 'team',
    name: 'Team',
    itemId: 'team_seat',
    price: 40,
    currency: 'eur',
    cadence: '/seat/mo',
    line: 'Everything, with collaboration and workspace billing.',
    features: [
      'Everything, for every paid seat',
      'Real-time collaboration',
      'Shared, pooled credit wallet',
      'One consolidated invoice',
      'Spend budgets & controls',
      'Admin roles & governance',
      'Workspace tenancy',
    ],
    note: '€40 per seat monthly, or €384 per seat yearly (€32/month). Starts with one paid seat.',
    cta: 'Start a team',
    href: '/signup',
  },
  {
    id: 'studio',
    name: 'Studio',
    itemId: 'studio_monthly',
    price: 99,
    currency: 'eur',
    cadence: '/mo',
    line: 'The highest shipped plan for larger organizations.',
    features: [
      'Everything in Team',
      'Collaboration for larger workspaces',
      'Shared workspace billing',
      'Priority managed inference',
      'Commercial-use license',
    ],
    note: 'Custom deployment, compliance, and support terms are quoted separately.',
    cta: 'Choose Studio',
    href: '/signup',
  },
];

// Optional à-la-carte credit packs. These come from the LIVE catalog (getLivePriceMap
// overlays exact price by id); the values below are static fallbacks that mirror the
// server catalog (credits_small/medium/large). Paid credits never expire.
export const CREDIT_PACKS: CreditPack[] = [
  { id: 'credits_small',  label: 'Starter',  credits: 1000,  price: 10,  currency: 'eur' },
  { id: 'credits_medium', label: 'Plus',     credits: 5500,  price: 50,  currency: 'eur', badge: 'Best value' },
  { id: 'credits_large',  label: 'Pro pack', credits: 12000, price: 100, currency: 'eur' },
];
