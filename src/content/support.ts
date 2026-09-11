/*
 * The support centre's CONTENT — one source, two renderers.
 *
 * `src/pages/Support.tsx` renders this in the SPA; `scripts/prerender-products.mjs`
 * compiles this same module with esbuild and emits static HTML from it into
 * dist/support/index.html. That is deliberate and it is the whole design:
 *
 * 🔴 The support page is the one page that MUST be real HTML. Every other
 * prerendered route here injects <head> metadata only — see the comment in
 * prerender-products.mjs, "the promise TEXT is still not in the HTML" — so a
 * reader without JavaScript gets a correct title over an empty shell. That is
 * survivable for /terms. It is not survivable here, because this URL is handed
 * to Stripe and to card-network partners, whose own guidance says "placeholder
 * or under-construction sites aren't supported". A page that renders only under
 * JavaScript is indistinguishable from an unfinished one to whatever fetches it.
 *
 * ⚠️ So never let the React page and the static HTML become two copies. They
 * drift silently — the ecosystem has paid for that lesson repeatedly (a
 * generator with its own idea of the shape, a doc restating a spec). Both read
 * THIS array. Add an answer here and both surfaces get it.
 *
 * 🔴 EVERY CLAIM ON THIS PAGE MUST BE TRUE AND SOURCED. It is consumer-facing
 * commercial copy attached to a payment flow, so an invented policy is a
 * misrepresentation, not a typo. Where a statement is statutory it is LINKED,
 * never restated — see the withdrawal note below.
 */

export interface SupportLink {
  label: string;
  href: string;
  /** External links open in a new tab and are marked up rel="noopener". */
  external?: boolean;
}

export interface SupportItem {
  /** The question, phrased the way somebody would actually ask it. */
  q: string;
  /** Paragraphs. Plain text — no markup, because two renderers consume it. */
  a: string[];
  links?: SupportLink[];
}

export interface SupportSection {
  /** Anchor id — stable, because these get linked to from receipts and email. */
  id: string;
  title: string;
  blurb: string;
  items: SupportItem[];
}

/* Shown on the card statement. These MUST match the live Stripe account's
 * settings.payments.statement_descriptor and the card_payments prefix — this page
 * exists so somebody staring at a bank statement can identify the charge, so a
 * stale string here is worse than no page at all.
 *
 * 🔴 CHANGING THE DESCRIPTOR IN STRIPE MEANS CHANGING IT HERE, IN THE SAME
 * BREATH. Set to XENOSYSTEM on 2026-09-11 when the account's descriptor moved
 * from XENOSTUDIO to the trading name; safe to switch cleanly because the
 * account had processed zero charges, so no historical statement shows the old
 * string. Re-derive with:
 *   stripe.accounts.retrieveCurrent() -> settings.payments.statement_descriptor
 */
export const STATEMENT_DESCRIPTOR = 'XENO';
export const STATEMENT_DESCRIPTOR_LONG = 'XENOSYSTEM';

export const SUPPORT_EMAIL = 'support@xenostudio.ai';
export const SECURITY_EMAIL = 'security@xenostudio.ai';
export const PRIVACY_EMAIL = 'privacy@xenostudio.ai';
export const BILLING_EMAIL = 'billing@xenostudio.ai';

/** The trader, per § 5 DDG. Kept here so the support page and the Impressum
 *  cannot disagree about who the customer is contracting with. */
export const TRADER = {
  legalName: 'Emilian-Vasile Cristea',
  tradingName: 'XENOsystem',
  street: 'Hauptstraße 112',
  postalCode: '97909',
  city: 'Stadtprozelten',
  country: 'Germany',
  vatId: 'DE463398455',
};

export const SUPPORT_SECTIONS: SupportSection[] = [
  {
    id: 'charges',
    title: 'Billing and charges',
    blurb:
      'Start here if you are looking at a payment on your statement and want to know what it is.',
    items: [
      {
        q: 'What is this charge on my bank statement?',
        a: [
          `Payments for this service appear as ${STATEMENT_DESCRIPTOR} or ${STATEMENT_DESCRIPTOR_LONG} on your card or bank statement, sometimes followed by a short description of what was bought.`,
          `The seller is ${TRADER.legalName}, trading as ${TRADER.tradingName}, ${TRADER.street}, ${TRADER.postalCode} ${TRADER.city}, ${TRADER.country}. Card payments are processed by Stripe on our behalf.`,
          'If you do not recognise a charge, email us with the date, the amount and the last four digits of the card and we will identify it for you. If it turns out not to be yours, tell us and we will refund it — you do not need to open a dispute with your bank first.',
        ],
        links: [{ label: 'Email us about a charge', href: `mailto:${SUPPORT_EMAIL}` }],
      },
      {
        q: 'Where do I find my invoice or receipt?',
        a: [
          'A receipt is emailed to the address on the account each time a payment succeeds. Invoices for subscriptions and for one-off purchases are kept in the billing portal, where you can download them at any time.',
          'If a receipt has not arrived, check the address on your account first, then email us and we will resend it.',
        ],
        links: [{ label: 'Open billing in your account', href: '/overview/billing' }],
      },
      {
        q: 'How do I cancel my subscription?',
        a: [
          'Open the billing portal from your account and cancel there. Cancellation takes effect at the end of the period you have already paid for, so you keep access until then and are not charged again.',
          'You do not need to ask us to cancel, and we do not require a reason or a notice period.',
        ],
        links: [{ label: 'Open billing in your account', href: '/overview/billing' }],
      },
      {
        q: 'Can I get a refund?',
        a: [
          'Consumers in the EU have a statutory 14-day right of withdrawal. Because this is digital content delivered immediately, that right ends once delivery has begun and you have confirmed you want it to — which is what the checkbox at checkout is asking you to acknowledge.',
          'The exact statutory instruction, including the model withdrawal form and where to send it, is on the withdrawal page. We do not paraphrase it here on purpose: the wording is prescribed by law and reproducing it accurately is what makes it binding.',
          'Separately from the statutory right: if something was charged in error, charged twice, or plainly did not work, write to us and we will sort it out.',
        ],
        links: [
          { label: 'Right of withdrawal (Widerrufsbelehrung)', href: '/withdrawal' },
          { label: 'Email us', href: `mailto:${BILLING_EMAIL}` },
        ],
      },
      {
        q: 'Why is there no VAT on my invoice?',
        a: [
          'No VAT is charged. The seller is a small business under § 19 UStG (Kleinunternehmerregelung), which means VAT is not levied and therefore cannot be shown or reclaimed.',
          `A VAT identification number (USt-IdNr. ${TRADER.vatId}) exists and is stated in the Impressum, as required once it is held. Holding one does not by itself mean VAT is charged.`,
        ],
        links: [{ label: 'Impressum', href: '/impressum' }],
      },
      {
        q: 'How do I change the card on file?',
        a: [
          'Update the payment method in the billing portal. The change applies to the next renewal; it does not re-run a payment that has already failed.',
        ],
        links: [{ label: 'Open billing in your account', href: '/overview/billing' }],
      },
      {
        q: 'What are credits, and do they expire?',
        a: [
          'Credits are prepaid balance used to run AI work — generating or editing an image, video, audio or text. They are bought in packs, separately from any subscription, and are drawn down as you use the tools.',
          'Your current balance and the history of what consumed it are shown in your account.',
        ],
        links: [{ label: 'Open billing in your account', href: '/overview/billing' }],
      },
    ],
  },
  {
    id: 'account',
    title: 'Account and sign-in',
    blurb: 'Getting in, getting back in, and getting your data out.',
    items: [
      {
        q: 'I cannot sign in',
        a: [
          'Use the password reset link on the sign-in page. The reset email is sent to the address on the account; if it does not arrive, check spam and confirm you are using the address you signed up with.',
          'If you originally signed up with Google, there may be no password on the account yet. Use the reset flow to set one, then you can sign in either way.',
        ],
        links: [{ label: 'Sign in', href: '/login' }],
      },
      {
        q: 'How do I delete my account?',
        a: [
          'You can request deletion from your account settings. Deletion removes your personal data; records we are legally required to retain, such as invoices and accounting records, are kept for the statutory period and nothing more.',
        ],
        links: [{ label: 'Privacy policy', href: '/privacy' }, { label: 'Email privacy', href: `mailto:${PRIVACY_EMAIL}` }],
      },
      {
        q: 'How do I get a copy of my data?',
        a: [
          'Ask, and we will provide it. Email the privacy address from the account address so we can identify you without asking for further documents.',
        ],
        links: [{ label: 'Email privacy', href: `mailto:${PRIVACY_EMAIL}` }],
      },
    ],
  },
  {
    id: 'downloads',
    title: 'Downloads and installation',
    blurb: 'Installing the desktop apps, and the security warning you should expect.',
    items: [
      {
        q: 'Windows says the publisher is unknown, or SmartScreen blocks the installer',
        a: [
          'That is expected right now, and we would rather tell you than have you discover it. The desktop builds are currently released unsigned while code-signing certification is pending, so Windows SmartScreen shows a warning for them.',
          'If you choose to continue: select "More info", then "Run anyway". Only do this for an installer you downloaded from our own download pages — the warning exists for good reasons and we are not asking you to ignore it generally.',
          'Every page that offers an affected download says so before you download it.',
        ],
        links: [{ label: 'Downloads', href: '/products' }],
      },
      {
        q: 'Which operating systems are supported?',
        a: [
          'Support differs per product, and each product page states exactly which builds exist rather than promising a platform we have not shipped. Check the product page for the app you want.',
        ],
        links: [{ label: 'All products', href: '/products' }],
      },
      {
        q: 'How do updates work?',
        a: [
          'The desktop apps check for updates themselves and will offer one when it is available. You can also download the current version from the product page at any time.',
        ],
        links: [{ label: 'All products', href: '/products' }],
      },
    ],
  },
  {
    id: 'products',
    title: 'Using the products',
    blurb: 'Per-product documentation, guides and reference.',
    items: [
      {
        q: 'Where is the documentation?',
        a: [
          'Each product has its own documentation, covering what it does, how to get started and its reference material. Start at the docs home and pick the product.',
        ],
        links: [{ label: 'Documentation', href: '/docs' }],
      },
      {
        q: 'Can I ask other people, or see if my question is already answered?',
        a: [
          'Yes. The forum is a public, permanent record of questions and answers, readable without an account. If your question is already answered there you get an answer immediately; if it is not, asking there means the next person finds it too.',
        ],
        links: [{ label: 'Forum', href: '/forum' }],
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy and security',
    blurb: 'What we do with your work, and how to report a vulnerability.',
    items: [
      {
        q: 'Do you train AI models on my content?',
        a: [
          'Not without your explicit consent. This is stated in the privacy policy and it is a commitment, not a default setting we can quietly change.',
        ],
        links: [{ label: 'Privacy policy', href: '/privacy' }],
      },
      {
        q: 'I found a security vulnerability',
        a: [
          'Please report it to the security address rather than posting it publicly, and give us a reasonable chance to fix it before disclosure. Include the steps to reproduce it and what you were able to access.',
          'We will confirm receipt and tell you what we are doing about it.',
        ],
        links: [{ label: 'Email security', href: `mailto:${SECURITY_EMAIL}` }],
      },
    ],
  },
];

/** Every answer flattened — the search index the SPA filters over, and the
 *  thing a test can count to prove the page did not silently lose a section. */
export const SUPPORT_ITEM_COUNT = SUPPORT_SECTIONS.reduce((n, s) => n + s.items.length, 0);
