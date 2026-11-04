// GENERATED from xeno-company/packages/legal. Do not edit: change it there, then scripts/company-legal-vendor.mjs --sync --confirm.
// ../xeno-company-sole/packages/legal/src/types.ts
var ok = (normalised) => ({ code: "ok", normalised });
var fail = (code, message) => ({ code, message });

// ../xeno-company-sole/packages/legal/src/connector.ts
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
var ConnectorError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "ConnectorError";
  }
};

// ../xeno-company-sole/packages/legal/src/packs/ro.ts
function cuiChecksum(digits) {
  if (!/^\d{2,10}$/.test(digits)) return false;
  const KEY = "753217532";
  const control = Number(digits[digits.length - 1]);
  const body = digits.slice(0, -1);
  const key = KEY.slice(KEY.length - body.length);
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[i]) * Number(key[i]);
  const computed = sum * 10 % 11;
  return (computed === 10 ? 0 : computed) === control;
}
function bareCui(value) {
  return value.replace(/\s+/g, "").toUpperCase().replace(/^RO/, "");
}
var RO = {
  jurisdiction: "RO",
  displayName: "Romania",
  // ONRC-recognised forms. SRL dominates; the rest are included because the
  // founding form must not force a company to misdeclare itself.
  legalForms: ["SRL", "SA", "SCS", "SNC", "SCA", "PFA", "II", "IF"],
  /**
   * CUI — the fiscal code. Every registered entity has one, WHETHER OR NOT it is
   * VAT-registered. This is the identifier ONRC and ANAF key on.
   */
  validateNationalId(value) {
    const cui = bareCui(value);
    if (!/^\d{2,10}$/.test(cui)) {
      return fail("malformed", "A Romanian CUI is 2\u201310 digits, optionally prefixed RO");
    }
    if (!cuiChecksum(cui)) {
      return fail("checksum_failed", "CUI check digit does not match \u2014 likely a typo or transposition");
    }
    return ok(cui);
  },
  /**
   * The VAT id is `RO` + CUI, and it exists ONLY when the entity is registered for
   * VAT. A non-VAT-registered SRL has a CUI and no VAT number; emitting `RO<CUI>` as
   * a VAT id for such a company puts a false statement on an invoice.
   *
   * This function validates the FORM. Whether the registration is live is a
   * question for ANAF `PlatitorTvaRest` or VIES, and belongs to the connector.
   */
  validateVatId(value) {
    const raw = value.replace(/\s+/g, "").toUpperCase();
    if (!raw.startsWith("RO")) {
      return fail("malformed", "A Romanian VAT id must carry the RO prefix");
    }
    const cui = raw.slice(2);
    if (!/^\d{2,10}$/.test(cui)) return fail("malformed", "RO VAT id is RO followed by 2\u201310 digits");
    if (!cuiChecksum(cui)) return fail("checksum_failed", "VAT id check digit does not match");
    return ok(`RO${cui}`);
  },
  /**
   * The ONRC registration number. **TWO formats are live** — confirmed against ANAF
   * production 2026-08-03, which returned `J2002000372404` for CUI 14399840
   * (DANTE INTERNATIONAL SA / eMAG).
   *
   *   legacy  J40/372/2002        register · county · serial · year
   *   current J2002000372404      register · year(4) · serial(6) · county(2) · check(1)
   *
   * The two are the same registration: `J40/372/2002` decomposes exactly into
   * `J` + `2002` + `000372` + `40` + `4`.
   *
   * 🔴 This validator originally accepted ONLY the legacy shape and would have
   * REJECTED the number ANAF actually returns. Caught by running against production
   * rather than against fixtures — no amount of stub testing would have found it.
   *
   * ⚠️ The current-format decomposition is inferred from ONE live sample. The
   * acceptance rule is deliberately loose (J + 13 digits) so a wrong field-order
   * guess cannot reject a valid number; only the parts confirmed by that sample are
   * range-checked.
   */
  validateRegistryId(value) {
    const raw = value.replace(/[\s]/g, "").toUpperCase();
    const current = /^([JFC])(\d{13})$/.exec(raw);
    if (current) {
      const d = current[2];
      const year2 = Number(d.slice(0, 4));
      const county2 = Number(d.slice(10, 12));
      if (year2 < 1990 || year2 > 2100) {
        return fail("malformed", `Registration year ${year2} is implausible`);
      }
      if (county2 < 1 || county2 > 52) {
        return fail("malformed", `County code ${county2} is outside the range 1-52`);
      }
      return ok(raw);
    }
    const legacy = /^([JFC])(\d{1,2})\/(\d{1,7})\/(\d{4})$/.exec(raw);
    if (!legacy) {
      return fail(
        "malformed",
        "Expected J40/1234/2020 (legacy) or J2002000372404 (current ONRC format)"
      );
    }
    const county = Number(legacy[2]);
    if (county < 1 || county > 52) {
      return fail("malformed", `County code ${county} is outside the range 1-52`);
    }
    const year = Number(legacy[4]);
    if (year < 1990 || year > 2100) {
      return fail("malformed", `Registration year ${year} is implausible`);
    }
    return ok(`${legacy[1]}${county}/${Number(legacy[3])}/${year}`);
  },
  /**
   * RO e-Factura. Mandatory for B2B since 1 Jan 2024 and extended to B2C from
   * 1 Jan 2025 — which means a Romanian entity on this platform CANNOT be served by
   * a plain-PDF invoice feature. See the master reference §2.4.
   */
  eInvoicingMandatory: true,
  cius: "RO_CIUS (EN 16931 national narrowing)"
};

// ../xeno-company-sole/packages/legal/src/connectors/anaf.ts
var TVA_URL = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva";
var REGISTRU_URL = "https://webservicesp.anaf.ro/api/registruroefactura/v1/interogare";
var ANAF_BATCH_LIMIT = 100;
var AnafConnector = class {
  jurisdiction = "RO";
  registerName = "ONRC";
  requiresCredentials = false;
  #fetch;
  #now;
  constructor(opts = {}) {
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = opts.now ?? (() => /* @__PURE__ */ new Date());
  }
  #evidence(asOf, source) {
    return { checkedAt: this.#now().toISOString(), asOf, source };
  }
  #today() {
    return this.#now().toISOString().slice(0, 10);
  }
  /**
   * Validates the request BEFORE it is sent. Both checks exist because ANAF will not
   * complain: a bad CUI returns 404 (indistinguishable from "not registered") and a
   * bad date returns confident nonsense.
   */
  #prepare(nationalId, asOf, source) {
    const date = asOf ?? this.#today();
    if (!isIsoDate(date)) {
      throw new ConnectorError(
        "invalid_request",
        `Date must be YYYY-MM-DD. ANAF accepts other formats and misparses them silently.`
      );
    }
    const v3 = RO.validateNationalId(nationalId);
    if (v3.code !== "ok") {
      throw new ConnectorError("invalid_request", v3.message ?? "Invalid CUI");
    }
    return { cui: Number(v3.normalised), date, evidence: this.#evidence(date, source) };
  }
  async lookupEntity(nationalId, asOf) {
    const { cui, date, evidence } = this.#prepare(nationalId, asOf, TVA_URL);
    const res = await this.#post(TVA_URL, [{ cui, data: date }]);
    if (res.status === "unavailable") {
      return { status: "unavailable", evidence, ...res.message ? { message: res.message } : {} };
    }
    const record = res.body?.found?.[0];
    if (!record) return { status: "not_found", evidence };
    const g = record.date_generale ?? {};
    return {
      status: "found",
      evidence,
      entity: {
        legalName: g.denumire?.trim() ?? "",
        // LANDMINE 3: blank for some real companies (DEDEMAN, when probed). Omitted
        // rather than emitted as '' so a consumer cannot mistake it for a value.
        ...g.nrRegCom?.trim() ? { registryId: g.nrRegCom.trim() } : {},
        vatRegistered: record.inregistrare_scop_Tva?.scpTVA === true,
        eInvoiceRegistered: g.statusRO_e_Factura === true,
        active: record.stare_inactiv?.statusInactivi !== true,
        ...addressOf(record) ? { address: addressOf(record) } : {},
        raw: record
      }
    };
  }
  /**
   * The `registruroefactura` endpoint. Cheaper and more direct than reading
   * `statusRO_e_Factura` off the TVA response, and it is the endpoint whose answer
   * ANAF considers authoritative for enrolment.
   */
  async checkEInvoiceRegistration(nationalId, asOf) {
    const { cui, date, evidence } = this.#prepare(nationalId, asOf, REGISTRU_URL);
    const res = await this.#post(REGISTRU_URL, [{ cui, data: date }]);
    if (res.status === "unavailable") {
      return { status: "unavailable", evidence, ...res.message ? { message: res.message } : {} };
    }
    const found = res.body?.found ?? [];
    const notFound = res.body?.notFound ?? [];
    if (found.length === 0 && notFound.length === 0) return { status: "not_found", evidence };
    return {
      status: "found",
      evidence,
      entity: {
        legalName: "",
        vatRegistered: false,
        eInvoiceRegistered: found.length > 0,
        active: true,
        raw: res.body
      }
    };
  }
  async #post(url, body) {
    let res;
    try {
      res = await this.#fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body)
      });
    } catch (e) {
      return { status: "unavailable", message: e instanceof Error ? e.message : "network error" };
    }
    if (res.status === 404) {
      const parsed2 = await safeJson(res);
      return { status: "ok", body: parsed2 ?? { found: [], notFound: [] } };
    }
    if (res.status >= 500 || res.status === 429) {
      return { status: "unavailable", message: `ANAF returned ${res.status}` };
    }
    const parsed = await safeJson(res);
    if (!parsed) return { status: "unavailable", message: "ANAF returned a non-JSON body" };
    return { status: "ok", body: parsed };
  }
};
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
function addressOf(r) {
  const a = r.adresa_sediu_social;
  if (!a) return void 0;
  const line1 = [a.sdenumire_Strada, a.snumar_Strada].filter(Boolean).join(" ").trim();
  const city = (a.sdenumire_Localitate ?? "").trim();
  if (!line1 && !city) return void 0;
  return {
    line1: line1 || city,
    city: city || line1,
    ...a.sdenumire_Judet?.trim() ? { region: a.sdenumire_Judet.trim() } : {},
    postalCode: (a.scod_Postal ?? "").trim(),
    country: "RO"
  };
}

// ../xeno-company-sole/packages/legal/src/connectors/vies.ts
var BASE = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";
var RETRYABLE = /* @__PURE__ */ new Set([
  "MS_UNAVAILABLE",
  "MS_MAX_CONCURRENT_REQ",
  "TIMEOUT",
  "SERVICE_UNAVAILABLE",
  "SERVER_BUSY"
]);
var ViesValidator = class {
  #fetch;
  #now;
  #requester;
  constructor(opts = {}) {
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = opts.now ?? (() => /* @__PURE__ */ new Date());
    this.#requester = opts.requester;
  }
  /** True when this validator can obtain evidence that supports zero-rating. */
  get issuesEvidence() {
    return this.#requester !== void 0;
  }
  async validate(countryCode, vatNumber) {
    const cc = countryCode.trim().toUpperCase();
    const vat = vatNumber.replace(/\s+/g, "").toUpperCase().replace(new RegExp(`^${cc}`), "");
    if (!/^[A-Z]{2}$/.test(cc) || vat.length === 0) {
      throw new ConnectorError("invalid_request", "Expected a 2-letter country code and a VAT number");
    }
    const asOf = this.#now().toISOString().slice(0, 10);
    const query = this.#requester ? `?requesterMemberStateCode=${encodeURIComponent(this.#requester.countryCode.toUpperCase())}&requesterNumber=${encodeURIComponent(
      this.#requester.vatNumber.replace(/\s+/g, "").toUpperCase().replace(new RegExp(`^${this.#requester.countryCode.toUpperCase()}`), "")
    )}` : "";
    const url = `${BASE}/${encodeURIComponent(cc)}/vat/${encodeURIComponent(vat)}${query}`;
    const evidence = { checkedAt: this.#now().toISOString(), asOf, source: url };
    let res;
    try {
      res = await this.#fetch(url, { headers: { accept: "application/json" } });
    } catch (e) {
      return {
        status: "unavailable",
        valid: false,
        evidence,
        ...e instanceof Error ? {} : {}
      };
    }
    if (res.status >= 500 || res.status === 429) {
      return { status: "unavailable", valid: false, evidence };
    }
    let body;
    try {
      body = await res.json();
    } catch {
      return { status: "unavailable", valid: false, evidence };
    }
    if (body.userError && RETRYABLE.has(body.userError)) {
      return { status: "unavailable", valid: false, evidence };
    }
    if (body.isValid === true) {
      return {
        status: "found",
        valid: true,
        // The consultation number — store it with the invoice, permanently.
        // An empty string is what an anonymous query returns — it is NOT evidence,
        // and storing it would look like proof that does not exist.
        evidence: { ...evidence, ...body.requestIdentifier?.trim() ? { reference: body.requestIdentifier } : {} },
        ...body.name ? { name: body.name } : {},
        ...body.address ? { address: body.address } : {}
      };
    }
    return {
      status: "found",
      valid: false,
      evidence: { ...evidence, ...body.requestIdentifier?.trim() ? { reference: body.requestIdentifier } : {} }
    };
  }
};

// ../xeno-company-sole/packages/legal/src/invoice/money.ts
var minor = (n) => {
  if (!Number.isInteger(n)) throw new RangeError(`Minor units must be an integer, got ${n}`);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Amount ${n} exceeds safe integer range`);
  return n;
};
function parseAmount(value, decimals = 2) {
  const s = typeof value === "number" ? String(value) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new RangeError(`Not a decimal amount: ${value}`);
  const neg = s.startsWith("-");
  const [whole = "0", frac = ""] = (neg ? s.slice(1) : s).split(".");
  if (frac.length > decimals) {
    throw new RangeError(`${value} has more than ${decimals} decimal places`);
  }
  const padded = frac.padEnd(decimals, "0");
  const n = Number(whole) * 10 ** decimals + Number(padded || "0");
  return minor(neg ? -n : n);
}
var currencyCodes = () => Intl.supportedValuesOf("currency");
var isCurrency = (code) => typeof code === "string" && currencyCodes().includes(code);
function currencyDecimals(code) {
  return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
}
function formatAmount(m, decimals = 2) {
  const neg = m < 0;
  const s = String(Math.abs(m)).padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals > 0 ? `.${s.slice(s.length - decimals)}` : "";
  return `${neg ? "-" : ""}${whole}${frac}`;
}
var add = (...xs) => minor(xs.reduce((a, b) => a + b, 0));
var sub = (a, b) => minor(a - b);
function percentOf(base, ratePercent) {
  if (!Number.isFinite(ratePercent)) throw new RangeError(`Bad rate ${ratePercent}`);
  const exact = base * ratePercent / 100;
  const rounded = Math.sign(exact) * Math.round(Math.abs(exact) + Number.EPSILON);
  return minor(rounded === 0 ? 0 : rounded);
}
function lineAmount(quantity, unitPriceMinor, decimals = 2) {
  if (!Number.isFinite(quantity)) throw new RangeError(`Bad quantity ${quantity}`);
  const exact = quantity * unitPriceMinor;
  if (!Number.isFinite(exact)) throw new RangeError("Line amount overflow");
  const rounded = Math.sign(exact) * Math.round(Math.abs(exact) + Number.EPSILON);
  void decimals;
  return minor(rounded === 0 ? 0 : rounded);
}

// ../xeno-company-sole/packages/legal/src/invoice/model.ts
function toPostalAddress(address) {
  const { region, ...rest } = address;
  return { ...rest, ...region ? { countrySubdivision: region } : {} };
}
var NO_VAT_CATEGORIES = ["E", "AE", "K", "G", "O"];
var ZERO_RATE_CATEGORIES = ["Z", "E", "AE", "K", "G", "O"];

// ../xeno-company-sole/packages/legal/src/invoice/rules.ts
var v = (rule, message, term) => term === void 0 ? { rule, message } : { rule, term, message };
var ZERO = 0;
function mismatch(actual, expected) {
  return `is ${formatAmount(actual)} but should be ${formatAmount(expected)} (off by ${formatAmount(sub(actual, expected))})`;
}
function validateInvoice(inv) {
  const out = [];
  if (!inv.specificationId?.trim()) {
    out.push(v("BR-1", "Specification identifier is missing \u2014 the document does not declare which rules it follows", "BT-24"));
  }
  if (!inv.id?.trim()) out.push(v("BR-2", "Invoice number is missing", "BT-1"));
  if (!inv.issueDate?.trim()) out.push(v("BR-3", "Issue date is missing", "BT-2"));
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.issueDate)) {
    out.push(v("BR-3", `Issue date "${inv.issueDate}" is not an ISO date`, "BT-2"));
  }
  if (!inv.typeCode) out.push(v("BR-4", "Invoice type code is missing", "BT-3"));
  if (!inv.currency?.trim()) out.push(v("BR-5", "Currency code is missing", "BT-5"));
  else if (!/^[A-Z]{3}$/.test(inv.currency)) {
    out.push(v("BR-5", `Currency "${inv.currency}" is not an ISO 4217 code`, "BT-5"));
  }
  if (!inv.seller?.name?.trim()) out.push(v("BR-6", "Seller name is missing", "BT-27"));
  if (!inv.buyer?.name?.trim()) out.push(v("BR-7", "Buyer name is missing", "BT-44"));
  if (!inv.seller?.address) out.push(v("BR-8", "Seller postal address is missing", "BG-5"));
  else if (!inv.seller.address.country) {
    out.push(v("BR-9", "Seller country code is missing", "BT-40"));
  }
  if (!inv.buyer?.address) out.push(v("BR-10", "Buyer postal address is missing", "BG-8"));
  else if (!inv.buyer.address.country) {
    out.push(v("BR-11", "Buyer country code is missing", "BT-55"));
  }
  if (!inv.lines?.length) out.push(v("BR-16", "An invoice must have at least one line", "BG-25"));
  const seen = /* @__PURE__ */ new Set();
  for (const [i, line] of (inv.lines ?? []).entries()) {
    const at = `line ${line.id || i + 1}`;
    if (!line.id?.trim()) out.push(v("BR-21", `${at}: line identifier is missing`, "BT-126"));
    else if (seen.has(line.id)) out.push(v("BR-21", `Duplicate line identifier "${line.id}"`, "BT-126"));
    else seen.add(line.id);
    if (!line.itemName?.trim()) out.push(v("BR-25", `${at}: item name is missing`, "BT-153"));
    if (!Number.isFinite(line.quantity)) out.push(v("BR-22", `${at}: quantity is missing`, "BT-129"));
    if (!line.unitCode?.trim()) out.push(v("BR-23", `${at}: unit of measure is missing`, "BT-130"));
    if (!line.vatCategory) out.push(v("BR-CO-4", `${at}: VAT category is missing`, "BT-151"));
  }
  if (inv.totals && inv.lines?.length) {
    const t = inv.totals;
    const lineSum = add(...inv.lines.map((l) => l.netAmount));
    if (t.lineNetTotal !== lineSum) {
      out.push(v("BR-CO-10", `Sum of line net amounts ${mismatch(t.lineNetTotal, lineSum)}`, "BT-106"));
    }
    const expectedExcl = add(t.lineNetTotal, t.chargeTotal ?? ZERO, -(t.allowanceTotal ?? ZERO));
    if (t.taxExclusiveAmount !== expectedExcl) {
      out.push(v("BR-CO-13", `Total without VAT ${mismatch(t.taxExclusiveAmount, expectedExcl)}`, "BT-109"));
    }
    const vatSum = add(...(inv.vatBreakdown ?? []).map((b) => b.taxAmount));
    if (t.taxAmount !== vatSum) {
      out.push(v("BR-CO-14", `Total VAT ${mismatch(t.taxAmount, vatSum)}`, "BT-110"));
    }
    const expectedIncl = add(t.taxExclusiveAmount, t.taxAmount);
    if (t.taxInclusiveAmount !== expectedIncl) {
      out.push(v("BR-CO-15", `Total with VAT ${mismatch(t.taxInclusiveAmount, expectedIncl)}`, "BT-112"));
    }
    const expectedDue = add(
      t.taxInclusiveAmount,
      t.roundingAmount ?? ZERO,
      -(t.paidAmount ?? ZERO)
    );
    if (t.payableAmount !== expectedDue) {
      out.push(v("BR-CO-16", `Amount due ${mismatch(t.payableAmount, expectedDue)}`, "BT-115"));
    }
  }
  if (!inv.vatBreakdown?.length) {
    out.push(v("BR-CO-18", "An invoice must have at least one VAT breakdown group", "BG-23"));
  } else {
    const keys = /* @__PURE__ */ new Set();
    for (const b of inv.vatBreakdown) {
      const key = `${b.category}@${b.rate ?? ""}`;
      if (keys.has(key)) {
        out.push(v("BR-CO-18", `Duplicate VAT breakdown for category ${b.category} at ${b.rate ?? 0}%`, "BG-23"));
      }
      keys.add(key);
      out.push(...categoryRules(b, inv));
    }
    for (const line of inv.lines ?? []) {
      const match = inv.vatBreakdown.find(
        (b) => b.category === line.vatCategory && (b.rate ?? 0) === (line.vatRate ?? 0)
      );
      if (!match) {
        out.push(v(
          "BR-CO-18",
          `Line ${line.id} uses category ${line.vatCategory} at ${line.vatRate ?? 0}% but there is no matching VAT breakdown`,
          "BG-23"
        ));
      }
    }
    for (const b of inv.vatBreakdown) {
      const lines = (inv.lines ?? []).filter(
        (l) => l.vatCategory === b.category && (l.vatRate ?? 0) === (b.rate ?? 0)
      );
      if (!lines.length) continue;
      const expected = add(...lines.map((l) => l.netAmount));
      if (b.taxableAmount !== expected) {
        out.push(v(
          `BR-${b.category}-08`,
          `Taxable amount for ${b.category} at ${b.rate ?? 0}% ${mismatch(b.taxableAmount, expected)}`,
          "BT-116"
        ));
      }
    }
  }
  return { valid: out.length === 0, violations: out };
}
function categoryRules(b, inv) {
  const out = [];
  const cat = b.category;
  const expected = percentOf(b.taxableAmount, b.rate ?? 0);
  if (b.taxAmount !== expected) {
    out.push(v(
      `BR-${cat}-09`,
      `VAT amount for ${cat} at ${b.rate ?? 0}% ${mismatch(b.taxAmount, expected)}`,
      "BT-117"
    ));
  }
  if (cat === "S") {
    if (!b.rate || b.rate <= 0) {
      out.push(v("BR-S-05", "Standard-rate VAT must have a rate greater than zero", "BT-119"));
    }
  }
  if (ZERO_RATE_CATEGORIES.includes(cat) && (b.rate ?? 0) !== 0) {
    out.push(v(`BR-${cat}-05`, `Category ${cat} must have a zero rate, found ${b.rate}`, "BT-119"));
  }
  if (NO_VAT_CATEGORIES.includes(cat) && !b.exemptionReason?.trim() && !b.exemptionReasonCode?.trim()) {
    out.push(v(
      `BR-${cat}-10`,
      `Category ${cat} charges no VAT and must state an exemption reason`,
      "BT-120"
    ));
  }
  if (cat === "AE") {
    if (!inv.seller?.vatId?.trim() && !inv.seller?.legalRegistrationId?.trim()) {
      out.push(v("BR-AE-02", "Reverse charge requires a seller VAT or tax registration identifier", "BT-31"));
    }
    if (!inv.buyer?.vatId?.trim()) {
      out.push(v("BR-AE-03", "Reverse charge requires the buyer VAT identifier", "BT-48"));
    }
    if (b.taxAmount !== 0) {
      out.push(v("BR-AE-09", "Reverse-charge VAT amount must be zero", "BT-117"));
    }
  }
  return out;
}

// ../xeno-company-sole/packages/legal/src/invoice/ubl.ts
var NS = {
  inv: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
};
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
var el = (tag, value, attrs = "") => value === void 0 || value === "" ? "" : `<${tag}${attrs}>${esc(value)}</${tag}>`;
var amt = (tag, minorValue, currency) => `<${tag} currencyID="${esc(currency)}">${formatAmount(minorValue, currencyDecimals(currency))}</${tag}>`;
function addressXml(p) {
  const a = p.address;
  return [
    "<cac:PostalAddress>",
    el("cbc:StreetName", a.line1),
    el("cbc:AdditionalStreetName", a.line2),
    el("cbc:CityName", a.city),
    el("cbc:PostalZone", a.postalCode),
    el("cbc:CountrySubentity", a.countrySubdivision),
    `<cac:Country>${el("cbc:IdentificationCode", a.country)}</cac:Country>`,
    "</cac:PostalAddress>"
  ].join("");
}
function partyXml(tag, p) {
  return [
    `<${tag}><cac:Party>`,
    p.electronicAddress ? el("cbc:EndpointID", p.electronicAddress.value, ` schemeID="${esc(p.electronicAddress.schemeId)}"`) : "",
    p.tradingName ? `<cac:PartyName>${el("cbc:Name", p.tradingName)}</cac:PartyName>` : "",
    addressXml(p),
    // The VAT identifier and the legal registration identifier are DIFFERENT
    // namespaces and go in different UBL elements. Putting a CUI where a VAT id
    // belongs states that a company is VAT-registered when it may not be.
    p.vatId ? `<cac:PartyTaxScheme>${el("cbc:CompanyID", p.vatId)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
    p.taxRegistrationId ? `<cac:PartyTaxScheme>${el("cbc:CompanyID", p.taxRegistrationId)}<cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "",
    "<cac:PartyLegalEntity>",
    el("cbc:RegistrationName", p.name),
    p.legalRegistrationId ? el(
      "cbc:CompanyID",
      p.legalRegistrationId,
      p.legalRegistrationScheme ? ` schemeID="${esc(p.legalRegistrationScheme)}"` : ""
    ) : "",
    "</cac:PartyLegalEntity>",
    `</cac:Party></${tag}>`
  ].join("");
}
function taxSubtotalXml(b, currency) {
  return [
    "<cac:TaxSubtotal>",
    amt("cbc:TaxableAmount", b.taxableAmount, currency),
    amt("cbc:TaxAmount", b.taxAmount, currency),
    "<cac:TaxCategory>",
    el("cbc:ID", b.category),
    b.rate !== void 0 ? `<cbc:Percent>${b.rate}</cbc:Percent>` : "",
    el("cbc:TaxExemptionReasonCode", b.exemptionReasonCode),
    el("cbc:TaxExemptionReason", b.exemptionReason),
    "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
    "</cac:TaxCategory>",
    "</cac:TaxSubtotal>"
  ].join("");
}
function lineXml(l, currency) {
  return [
    "<cac:InvoiceLine>",
    el("cbc:ID", l.id),
    `<cbc:InvoicedQuantity unitCode="${esc(l.unitCode)}">${l.quantity}</cbc:InvoicedQuantity>`,
    amt("cbc:LineExtensionAmount", l.netAmount, currency),
    "<cac:Item>",
    el("cbc:Description", l.itemDescription),
    el("cbc:Name", l.itemName),
    "<cac:ClassifiedTaxCategory>",
    el("cbc:ID", l.vatCategory),
    l.vatRate !== void 0 ? `<cbc:Percent>${l.vatRate}</cbc:Percent>` : "",
    "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
    "</cac:ClassifiedTaxCategory>",
    "</cac:Item>",
    `<cac:Price>${amt("cbc:PriceAmount", l.unitPrice, currency)}</cac:Price>`,
    "</cac:InvoiceLine>"
  ].join("");
}
function toUbl(inv) {
  const c = inv.currency;
  const t = inv.totals;
  const body = [
    el("cbc:CustomizationID", inv.specificationId),
    el("cbc:ProfileID", inv.businessProcessId),
    el("cbc:ID", inv.id),
    el("cbc:IssueDate", inv.issueDate),
    el("cbc:DueDate", inv.dueDate),
    el("cbc:InvoiceTypeCode", inv.typeCode),
    el("cbc:Note", inv.note),
    el("cbc:DocumentCurrencyCode", c),
    el("cbc:BuyerReference", inv.buyerReference),
    inv.orderReference ? `<cac:OrderReference>${el("cbc:ID", inv.orderReference)}</cac:OrderReference>` : "",
    inv.precedingInvoice ? "<cac:BillingReference><cac:InvoiceDocumentReference>" + el("cbc:ID", inv.precedingInvoice.id) + el("cbc:IssueDate", inv.precedingInvoice.issueDate) + "</cac:InvoiceDocumentReference></cac:BillingReference>" : "",
    partyXml("cac:AccountingSupplierParty", inv.seller),
    partyXml("cac:AccountingCustomerParty", inv.buyer),
    inv.paymentTerms ? `<cac:PaymentTerms>${el("cbc:Note", inv.paymentTerms)}</cac:PaymentTerms>` : "",
    `<cac:TaxTotal>${amt("cbc:TaxAmount", t.taxAmount, c)}` + inv.vatBreakdown.map((b) => taxSubtotalXml(b, c)).join("") + "</cac:TaxTotal>",
    "<cac:LegalMonetaryTotal>",
    amt("cbc:LineExtensionAmount", t.lineNetTotal, c),
    amt("cbc:TaxExclusiveAmount", t.taxExclusiveAmount, c),
    amt("cbc:TaxInclusiveAmount", t.taxInclusiveAmount, c),
    t.allowanceTotal !== void 0 ? amt("cbc:AllowanceTotalAmount", t.allowanceTotal, c) : "",
    t.chargeTotal !== void 0 ? amt("cbc:ChargeTotalAmount", t.chargeTotal, c) : "",
    t.paidAmount !== void 0 ? amt("cbc:PrepaidAmount", t.paidAmount, c) : "",
    t.roundingAmount !== void 0 ? amt("cbc:PayableRoundingAmount", t.roundingAmount, c) : "",
    amt("cbc:PayableAmount", t.payableAmount, c),
    "</cac:LegalMonetaryTotal>",
    inv.lines.map((l) => lineXml(l, c)).join("")
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="${NS.inv}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}">` + body + "</Invoice>";
}

// ../xeno-company-sole/packages/legal/src/invoice/build.ts
var InvoiceBuildError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InvoiceBuildError";
  }
};
function breakdown(lines, reasons) {
  const groups = /* @__PURE__ */ new Map();
  for (const l of lines) {
    const rate = l.vatRate ?? 0;
    const key = `${l.vatCategory}@${rate}`;
    const g = groups.get(key) ?? { cat: l.vatCategory, rate, amounts: [] };
    g.amounts.push(l.netAmount);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const taxableAmount = add(...g.amounts);
    const reason = reasons.get(`${g.cat}@${g.rate}`);
    return {
      taxableAmount,
      // Computed from the base, never carried in from the caller — this is the
      // number BR-S-09 checks and the one most often wrong by a cent.
      taxAmount: percentOf(taxableAmount, g.rate),
      category: g.cat,
      rate: g.rate,
      ...reason ? { exemptionReason: reason } : {}
    };
  });
}
function buildInvoice(draft) {
  if (!draft.lines.length) {
    throw new InvoiceBuildError("An invoice needs at least one line (BR-16)");
  }
  if (!isCurrency(draft.currency)) {
    throw new InvoiceBuildError(`"${draft.currency}" is not a currency (BR-5)`);
  }
  const reasons = /* @__PURE__ */ new Map();
  const lines = draft.lines.map((d, i) => {
    const rate = d.vatRate ?? 0;
    if (NO_VAT_CATEGORIES.includes(d.vatCategory) && !d.exemptionReason?.trim()) {
      throw new InvoiceBuildError(
        `Line ${d.id ?? i + 1}: category ${d.vatCategory} charges no VAT and needs an exemption reason (BT-120)`
      );
    }
    if (ZERO_RATE_CATEGORIES.includes(d.vatCategory) && rate !== 0) {
      throw new InvoiceBuildError(
        `Line ${d.id ?? i + 1}: category ${d.vatCategory} must have a zero rate, got ${rate}`
      );
    }
    if (d.vatCategory === "S" && rate <= 0) {
      throw new InvoiceBuildError(
        `Line ${d.id ?? i + 1}: standard rate must be greater than zero \u2014 did you mean category Z or E?`
      );
    }
    if (d.exemptionReason) reasons.set(`${d.vatCategory}@${rate}`, d.exemptionReason);
    return {
      id: d.id ?? String(i + 1),
      quantity: d.quantity,
      unitCode: d.unitCode ?? "C62",
      // Rounded ONCE, from quantity × unit price. A caller computing this themselves
      // is the commonest source of a line that does not match its own price.
      netAmount: lineAmount(d.quantity, d.unitPrice),
      unitPrice: d.unitPrice,
      itemName: d.itemName,
      ...d.itemDescription ? { itemDescription: d.itemDescription } : {},
      vatCategory: d.vatCategory,
      vatRate: d.vatRate ?? 0
    };
  });
  const ids = new Set(lines.map((l) => l.id));
  if (ids.size !== lines.length) throw new InvoiceBuildError("Duplicate line identifiers (BR-21)");
  const vatBreakdown = breakdown(lines, reasons);
  const lineNetTotal = add(...lines.map((l) => l.netAmount));
  const taxAmount = add(...vatBreakdown.map((b) => b.taxAmount));
  const taxInclusiveAmount = add(lineNetTotal, taxAmount);
  const paid = draft.paidAmount ?? 0;
  const totals = {
    lineNetTotal,
    taxExclusiveAmount: lineNetTotal,
    taxAmount,
    taxInclusiveAmount,
    ...draft.paidAmount !== void 0 ? { paidAmount: draft.paidAmount } : {},
    payableAmount: add(taxInclusiveAmount, -paid)
  };
  const typeCode = draft.typeCode ?? "380";
  if ((typeCode === "381" || typeCode === "384") && !draft.precedingInvoice) {
    throw new InvoiceBuildError(
      `Type ${typeCode} corrects an earlier invoice and must reference it (BT-25)`
    );
  }
  return {
    specificationId: draft.specificationId,
    id: draft.id,
    issueDate: draft.issueDate,
    typeCode,
    currency: draft.currency,
    ...draft.dueDate ? { dueDate: draft.dueDate } : {},
    ...draft.buyerReference ? { buyerReference: draft.buyerReference } : {},
    ...draft.orderReference ? { orderReference: draft.orderReference } : {},
    ...draft.precedingInvoice ? { precedingInvoice: draft.precedingInvoice } : {},
    seller: draft.seller,
    buyer: draft.buyer,
    lines,
    vatBreakdown,
    totals,
    ...draft.paymentTerms ? { paymentTerms: draft.paymentTerms } : {},
    ...draft.note ? { note: draft.note } : {}
  };
}
function buildCreditNote(original, opts) {
  return buildInvoice({
    specificationId: original.specificationId,
    id: opts.id,
    issueDate: opts.issueDate,
    currency: original.currency,
    typeCode: "381",
    precedingInvoice: { id: original.id, issueDate: original.issueDate },
    seller: original.seller,
    buyer: original.buyer,
    ...opts.reason ? { note: opts.reason } : {},
    lines: original.lines.map((l) => ({
      id: l.id,
      quantity: -l.quantity,
      unitCode: l.unitCode,
      unitPrice: l.unitPrice,
      itemName: l.itemName,
      ...l.itemDescription ? { itemDescription: l.itemDescription } : {},
      vatCategory: l.vatCategory,
      ...l.vatRate !== void 0 ? { vatRate: l.vatRate } : {},
      ...original.vatBreakdown.find(
        (b) => b.category === l.vatCategory && (b.rate ?? 0) === (l.vatRate ?? 0)
      )?.exemptionReason ? {
        exemptionReason: original.vatBreakdown.find(
          (b) => b.category === l.vatCategory && (b.rate ?? 0) === (l.vatRate ?? 0)
        ).exemptionReason
      } : {}
    }))
  });
}
var InvoiceSeries = class {
  constructor(prefix, startAt = 1) {
    this.prefix = prefix;
    if (!Number.isInteger(startAt) || startAt < 1) {
      throw new RangeError("A series starts at 1 or later");
    }
    this.#next = startAt;
  }
  #next;
  /** The number that would be issued next, without consuming it. */
  peek(pad = 4) {
    return `${this.prefix}-${String(this.#next).padStart(pad, "0")}`;
  }
  /** Consumes and returns the next number. */
  issue(pad = 4) {
    const n = this.peek(pad);
    this.#next++;
    return n;
  }
  get nextNumber() {
    return this.#next;
  }
};

// ../xeno-company-sole/packages/legal/src/invoice/cius-ro.ts
var CIUS_RO_ID = "urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1";
var v2 = (rule, message, term) => term === void 0 ? { rule, message } : { rule, term, message };
function validateRoInvoice(inv) {
  const base = validateInvoice(inv);
  const out = [...base.violations];
  if (inv.specificationId && !inv.specificationId.includes("CIUS-RO")) {
    out.push(v2(
      "RO-BR-1",
      `Specification identifier must declare the RO CIUS; found "${inv.specificationId}"`,
      "BT-24"
    ));
  }
  if (inv.seller?.address?.country === "RO") {
    if (inv.seller.vatId) {
      const r = RO.validateVatId(inv.seller.vatId);
      if (r.code !== "ok") {
        out.push(v2("RO-BR-SELLER-VAT", `Seller VAT id: ${r.message}`, "BT-31"));
      }
    }
    if (inv.seller.legalRegistrationId) {
      const r = RO.validateRegistryId(inv.seller.legalRegistrationId);
      if (r.code !== "ok") {
        out.push(v2("RO-BR-SELLER-REG", `Seller registration id: ${r.message}`, "BT-32"));
      }
    }
    if (!inv.seller.vatId?.trim() && !inv.seller.legalRegistrationId?.trim()) {
      out.push(v2(
        "RO-BR-SELLER-ID",
        "A Romanian seller must carry a VAT identifier or a legal registration identifier",
        "BT-31"
      ));
    }
  }
  if (inv.buyer?.address?.country === "RO" && inv.buyer.vatId) {
    const r = RO.validateVatId(inv.buyer.vatId);
    if (r.code !== "ok") out.push(v2("RO-BR-BUYER-VAT", `Buyer VAT id: ${r.message}`, "BT-48"));
  }
  for (const [who, party, term] of [
    ["Seller", inv.seller, "BT-39"],
    ["Buyer", inv.buyer, "BT-54"]
  ]) {
    if (party?.address?.country === "RO" && !party.address.countrySubdivision?.trim()) {
      out.push(v2(
        "RO-BR-SUBDIVISION",
        `${who} address in Romania must state the county (jude\u0163)`,
        term
      ));
    }
  }
  for (const b of inv.vatBreakdown ?? []) {
    if (b.category === "S" && b.rate !== void 0 && !RO_VAT_RATES.includes(b.rate)) {
      out.push(v2(
        "RO-BR-VAT-RATE",
        `${b.rate}% is not a current Romanian VAT rate (${RO_VAT_RATES.join(", ")}%) \u2014 check whether the rate changed or a foreign rate was used`,
        "BT-119"
      ));
    }
  }
  return { valid: out.length === 0, violations: out };
}
var RO_VAT_RATES = [21, 19, 11, 9, 5];

// ../xeno-company-sole/packages/legal/src/invoice/profile.ts
var EN16931_ID = "urn:cen.eu:en16931:2017";
var CORE = { specificationId: EN16931_ID, validate: validateInvoice, localRules: null };
var ADD_ONS = /* @__PURE__ */ new Map([
  ["RO", { specificationId: CIUS_RO_ID, validate: validateRoInvoice, localRules: "RO" }]
]);
var invoiceProfileFor = (jurisdiction) => ADD_ONS.get(jurisdiction) ?? CORE;

// ../xeno-company-sole/packages/legal/src/countries.ts
var COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
var KNOWN = new Set(COUNTRY_CODES);
var isCountryCode = (v3) => typeof v3 === "string" && KNOWN.has(v3);
var isJurisdiction = (v3) => typeof v3 === "string" && /^[A-Z]{2}(-[A-Z0-9]{1,6})?$/.test(v3) && KNOWN.has(v3.slice(0, 2));
var countryOf = (jurisdiction) => jurisdiction.slice(0, 2);
function countryName(code, locale = "en") {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(countryOf(code)) ?? code;
  } catch {
    return code;
  }
}

// ../xeno-company-sole/packages/legal/src/registration.ts
var text = (v3, max) => {
  const s = typeof v3 === "string" ? v3.trim() : "";
  return s.length <= max ? s : "";
};
var no = (code, message) => ({ ok: false, code, message });
function checkRegistration(r, packFor2) {
  const jurisdiction = r?.jurisdiction;
  if (!isJurisdiction(jurisdiction)) return no("invalid_jurisdiction", "Choose a country.");
  const pack = packFor2(jurisdiction);
  let nationalId = text(r?.nationalId, 60);
  if (pack) {
    const v3 = pack.validateNationalId(String(r?.nationalId ?? ""));
    if (v3.code !== "ok") return no("invalid_national_id", v3.message ?? "That tax number isn\u2019t valid.");
    nationalId = v3.normalised ?? nationalId;
  } else if (!nationalId) return no("invalid_national_id", "Give the company\u2019s tax or company number.");
  const legalForm = text(r?.legalForm, 120);
  if (!legalForm) return no("invalid_legal_form", "Give the legal form.");
  if (pack && !pack.legalForms.includes(legalForm)) {
    return no("invalid_legal_form", `\u201C${legalForm}\u201D isn\u2019t a ${pack.displayName} legal form (${pack.legalForms.join(", ")}).`);
  }
  const out = { jurisdiction, legalForm, nationalId };
  const legalName = text(r?.legalName, 300);
  if (legalName) out.legalName = legalName;
  const register = text(r?.register, 200);
  if (register) out.register = register;
  const registry = text(r?.registryNumber, 60);
  if (registry) {
    const v3 = pack?.validateRegistryId(registry);
    if (v3 && v3.code !== "ok") return no("invalid_registry_number", v3.message ?? "That registration number isn\u2019t valid.");
    out.registryNumber = v3?.normalised ?? registry;
  }
  const vat = text(r?.vatId, 40).replace(/\s/g, "");
  if (vat) {
    const v3 = pack?.validateVatId(vat);
    if (v3 && v3.code !== "ok") return no("invalid_vat_id", v3.message ?? "That VAT number isn\u2019t valid.");
    out.vatId = v3?.normalised ?? vat;
  }
  if (r?.registeredOffice != null) {
    const a = r.registeredOffice;
    const line1 = text(a.line1, 200), city = text(a.city, 120), country = a.country ?? countryOf(jurisdiction);
    if (!line1 || !city) return no("invalid_address", "The registered office needs a street and a city.");
    if (!isCountryCode(country)) return no("invalid_address", "The registered office needs a country.");
    const line2 = text(a.line2, 200), region = text(a.region, 120);
    out.registeredOffice = { line1, ...line2 ? { line2 } : {}, city, ...region ? { region } : {}, postalCode: text(a.postalCode, 20), country };
  }
  return { ok: true, ...out };
}
function invoiceBlocker(registration) {
  if (!registration) return "Only a registered company can issue an invoice: add its legal registration first.";
  const o = registration.registeredOffice;
  if (!o.line1.trim() || !o.city.trim() || !isCountryCode(o.country)) return "Add the company\u2019s registered office first: it goes on every invoice.";
  return null;
}
function sellerParty(org) {
  const reg = org.registration;
  const legalName = org.registrationEvidence?.verifiedName ?? reg.legalName ?? org.name;
  const vat = reg.identifiers.find((i) => i.kind === "vat")?.value;
  const registry = reg.identifiers.find((i) => i.kind === "registry")?.value;
  const taxNumber = reg.identifiers.find((i) => i.kind === "national")?.value;
  return {
    name: legalName,
    ...legalName !== org.name ? { tradingName: org.name } : {},
    ...vat ? { vatId: vat } : {},
    ...!vat && taxNumber ? { taxRegistrationId: taxNumber } : {},
    ...registry ? { legalRegistrationId: registry, ...reg.register ? { legalRegistrationScheme: reg.register } : {} } : {},
    address: toPostalAddress(reg.registeredOffice)
  };
}

// ../xeno-company-sole/packages/legal/src/index.ts
var PACKS = { RO };
var packFor = (j) => Object.hasOwn(PACKS, j) ? PACKS[j] : void 0;
var checkRegistration2 = (r) => checkRegistration(r, packFor);
export {
  ANAF_BATCH_LIMIT,
  AnafConnector,
  CIUS_RO_ID,
  COUNTRY_CODES,
  ConnectorError,
  EN16931_ID,
  InvoiceBuildError,
  InvoiceSeries,
  NO_VAT_CATEGORIES,
  PACKS,
  RO,
  RO_VAT_RATES,
  ViesValidator,
  ZERO_RATE_CATEGORIES,
  add,
  buildCreditNote,
  buildInvoice,
  checkRegistration2 as checkRegistration,
  checkRegistration as checkRegistrationWith,
  countryName,
  countryOf,
  cuiChecksum,
  currencyCodes,
  currencyDecimals,
  fail,
  formatAmount,
  invoiceBlocker,
  invoiceProfileFor,
  isCountryCode,
  isCurrency,
  isIsoDate,
  isJurisdiction,
  lineAmount,
  minor,
  ok,
  packFor,
  parseAmount,
  percentOf,
  sellerParty,
  sub,
  toPostalAddress,
  toUbl,
  validateInvoice,
  validateRoInvoice
};
