# Tax posture — the settled facts, and what they bind

**Status: LOCKED 2026-08-24.** Read this before touching prices, checkout, invoices,
the Impressum, or anything in `billingService.js` that computes what a customer pays.

It exists because every one of these facts was rediscovered the hard way during the
Stripe build, and two of them were wrong in code at the time.

---

## The facts

| | |
|---|---|
| **Entity** | Einzelunternehmen (sole proprietor), Germany |
| **USt-IdNr** | **DE463398455** — assigned by BZSt 2026-07-02, **confirmed valid in the EU VIES register** |
| **Steuernummer (USt)** | 202/209/60855 |
| **VAT regime 2026** | **Kleinunternehmer § 19 Abs. 1 UStG** — charges **no VAT** |
| **Stripe tax registrations** | **zero**, deliberately — see below |
| **Expected crossover** | ~Oct–Nov 2026, into Regelbesteuerung, permanent |

⚠️ **The USt-IdNr arrived as a `W-IdNr-Mitteilung`.** A Wirtschafts-Identifikations-
nummer shares the `DE` + 9-digit format **without being a VAT id**. It was verified
against VIES (`isValid: true`) before being published, and that check is the only
reason we can put it on a legally required page. **Re-verify before quoting it
anywhere new** — one HTTP call:

```bash
curl -s "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/DE/vat/463398455"
```

---

## 🔴 Two thresholds. They are unrelated, and conflating them is the expensive mistake

| Threshold | What it governs | What counts toward it |
|---|---|---|
| **€25,000** | Kleinunternehmer § 19 — the real ceiling | **Total** Gesamtumsatz, first year |
| **€10,000** | Place-of-supply switch, § 3a Abs. 5 UStG | **Only** cross-border EU **B2C digital** sales |

The €10,000 is **not a revenue allowance**. It is the point at which a sale to a
consumer in another EU country stops being taxed at our rate and starts being taxed
at theirs.

🔴 **Kleinunternehmer does NOT protect you above it.** § 19 is a *national*
exemption. Cross the €10k and destination VAT is due in each country, OSS
registration or not. (An EU-wide small-business scheme exists since 2025, § 19a
UStG, with an "EX" identifier — it requires a separate application we have not
made.)

⚠️ **Neither threshold is EU-wide comfort.** The €10k rule is EU-only. The UK has
**no registration threshold** for non-established sellers of digital services to
consumers — the first sale counts. US sales-tax nexus, Switzerland and Norway have
their own rules. "We're small" is not a defence in several of them.

---

## What this binds in code

### Prices are `tax_behavior: inclusive`

Not a default — a decision, and **immutable once set**. Changing it means creating
new prices and repointing every `STRIPE_PRICE_*`.

Reasoning: **PAngV § 3** requires a German consumer to be shown the *final* price
including VAT. The site advertises "€24/month"; exclusive pricing would charge
€28.56 and make the advertised figure wrong.

### Stripe Tax is ENABLED with ZERO registrations, and that is correct

It reads like a contradiction and is not:

- zero registrations → Stripe computes **0 % on every sale**, which is exactly what
  § 19 requires
- enabled → Stripe **monitors threshold proximity and warns as we approach**

That monitoring is the only instrument that makes "stay small and watch" safe rather
than a silent liability. **Do not turn Stripe Tax off to "match" Kleinunternehmer
status** — off means no warning, and the first sign of trouble becomes a tax bill
for revenue already spent.

### The Impressum carries both statements

The USt-IdNr (§ 5 Abs. 1 Nr. 6 DDG, required once held) **and** the § 19 notice. A
seller who charges no VAT must say why: an invoice with no VAT line and no
explanation is indistinguishable from one where the VAT was simply left off.

Both are gated in `scripts/compliance-preflight.mjs`.

---

## What changes at crossover, and it is not one switch

When turnover crosses €25k — projected ~Oct–Nov 2026 — Regelbesteuerung applies
**automatically and permanently**. This is a coordinated change, not a flag:

1. **Remove the § 19 notice** from the Impressum. Leaving it up while charging VAT
   is a false statement, and the preflight will still report it green because it
   checks the notice is *present*, never whether § 19 still applies.
2. **Add Stripe Tax registrations** for Germany and any country where a threshold
   was crossed. Until a registration exists Stripe charges 0 %, so the day after
   crossover we would still be collecting nothing.
3. **Decide OSS** if cross-border B2C digital exceeded €10k.
4. **Verify the price `tax_behavior`** is still what the Steuerberater wants. This is
   the last cheap moment — after prices are used in live subscriptions, changing it
   means new prices and a migration.
5. **Monthly USt-Voranmeldungen** begin.

⚠️ **Vorsteuer is the counter-argument to waiting.** As Kleinunternehmer we cannot
reclaim input VAT — ~€1,355 already lost per the operator's own records. For an
infrastructure-heavy business, registration *returns* 19 % on servers, hardware and
tooling. "Wait until we have money" can be backwards; ask the Steuerberater to price
the remaining months rather than assuming simplicity is cheaper.

---

## Open, and genuinely the operator's

- **Steuerberater**: confirm `inclusive` is right for this entity before prices are
  used in live subscriptions; confirm the OSS position; price the Vorsteuer
  trade-off for the remaining Kleinunternehmer months.
- **Lawyer**: Terms, Privacy and the Widerrufsbelehrung wording.
- **`DISPUTE_ALERT_EMAIL`**: unset. Falls back to `billing@xenostudio.ai`. Stripe
  sets a deadline for dispute evidence and an unanswered dispute is lost by default,
  so this needs an address somebody reads.

## 🔴 Test mode is not live mode

Everything provisioned so far — 10 prices, tax settings, the webhook — exists **only
in Stripe's test ledger**. Nothing carries over. Going live means re-running
`stripe-create-prices` against the live key (it is idempotent and refuses to
duplicate) and re-creating the webhook, whose signing secret differs per endpoint.

---

## What would falsify this document

- `curl .../vies/rest-api/ms/DE/vat/463398455` not returning `isValid: true`
- Stripe reporting a non-zero number of tax registrations while the Impressum still
  carries the § 19 notice — those two cannot both be right
- `node scripts/compliance-preflight.mjs --env-from <snapshot>` reporting a blocker
