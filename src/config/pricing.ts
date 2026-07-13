// Canonical PUBLIC pricing — the single front-end source of truth for tiers + features.
//
// Prices here are the LOCKED values and mirror the server billing catalog
// (src/server/services/billingService.js), which in turn mirrors the Stripe Price
// objects. Components should PREFER the live price from GET /api/billing/config
// (getBillingConfig → catalog, matched by `itemId`) and fall back to `price` here — so
// the ADVERTISED price always equals the CHARGED price, even if Stripe is re-priced.
//
// Currency is EUR (EU entity + Impressum + Stripe VAT). Tiers: Free €0 / Pro €24 /
// Team €40-per-seat / Enterprise custom. Credit top-up packs (€10/€50/€100) come from
// the live catalog only (they have no static tier here).
//
// NOTE: features must be TRUE (enforced or real). We do NOT advertise a "priority
// generation queue" (not implemented). "Priority support" is the human-support tier.

export type TierId = 'free' | 'pro' | 'team' | 'enterprise';

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
  cta: string;
  href: string;          // fallback link (Checkout is used when itemId is set + authed)
  featured?: boolean;
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

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'eur',
    line: 'Everything you need to start creating across the whole suite.',
    features: [
      'All apps: Pixel, Motion, Sound, Canvas & more',
      'Image, video & audio generation',
      'Monthly starter credit grant',
      'Watermarked, standard-resolution outputs',
      'Community support',
    ],
    cta: 'Start free',
    href: '/auth',
  },
  {
    id: 'pro',
    name: 'Pro',
    itemId: 'pro_monthly',
    price: 24,
    currency: 'eur',
    cadence: '/mo',
    line: 'For creators who ship every day — the whole suite, one balance.',
    features: [
      'Everything in Free, watermark-free',
      'Commercial usage rights',
      '4K & longer-form generations',
      'Full Marketplace access',
      'Higher monthly credit allotment',
      'Priority support',
    ],
    cta: 'Go Pro',
    href: '/auth',
    featured: true,
  },
  {
    id: 'team',
    name: 'Team',
    itemId: 'team_seat',
    price: 40,
    currency: 'eur',
    cadence: '/seat/mo',
    line: 'For teams creating together, billed per seat.',
    features: [
      'Everything in Pro, for every seat',
      'Shared workspace for your team',
      'Real-time multiplayer in Canvas',
      'Admin roles & member management',
      'Centralized, per-seat billing',
      'Shared asset & component libraries',
    ],
    cta: 'Start a team',
    href: '/auth',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'custom',
    currency: 'eur',
    line: 'For organizations at scale.',
    features: [
      'SSO & SCIM provisioning',
      'Dedicated capacity & private models',
      'SLA & uptime guarantees',
      'Security review & DPA',
      'Dedicated success manager',
    ],
    cta: 'Contact sales',
    href: '/contact',
  },
];
