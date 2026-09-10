/**
 * Email Service
 *
 * HTML email templates with XENO branding.
 * Templates:
 * - welcome          — New user registration
 * - password_reset   — Password reset link
 * - receipt          — Purchase/credit receipt
 * - credits_low      — Low credits warning
 * - new_version      — New app version available
 *
 * Uses pluggable transport (console in dev, SMTP/SES in production).
 */

import { v4 as uuidv4 } from 'uuid';
import { isOptedOut, unsubscribeUrl } from './emailPreferences.js';
import bcrypt from 'bcryptjs';
import { activationUrl, mintCode } from './accountActivation.js';

/**
 * Templates that are SECURITY / ACCOUNT-RECOVERY mail and are therefore never
 * suppressed by the unsubscribe list.
 *
 * Someone who unsubscribes from onboarding mail has not asked to be locked out of
 * their own account. A password reset that silently does not arrive is an
 * account-recovery failure that presents to the user as a broken product, and to
 * support as an unreproducible ticket.
 */
/* 🔴 'dispute_opened' is ESSENTIAL. It is operator mail with a legal deadline
 * attached — Stripe gives 7–21 days to respond and a missed window is an
 * automatic loss of both the money and the fee. Honouring an unsubscribe on it
 * would mean one careless click permanently disables the only warning the
 * business gets. Nobody can opt out of being told they are being sued for a
 * chargeback. */
const ESSENTIAL_TEMPLATES = new Set(['password_reset', 'email_verification', 'dispute_opened']);

// --------------------------------------------------------------------------
// XENO branded email wrapper
//
// There used to be TWO shells here: this one, and a much better one written
// later for `welcome`. The comment on that one explained why it did not reuse
// this -- the welcome mail has a structure no other template has, and bending a
// shared layout to fit it would drag those decisions into password resets.
// That reasoning is right about the BODY and wrong about the CHROME, and the
// cost of the split was not cosmetic:
//
//   this shell put every rule in a <style> block, including `.btn`. Gmail
//   clips long messages and strips the head, and Outlook renders through
//   Word -- so in a large share of real inboxes the "Reset Password" button
//   arrived as an unstyled link, in the one email a locked-out person has to
//   be able to act on.
//
// So the shell is now shared and every rule that matters is inline; the bodies
// stay separate, which is what that comment was actually protecting.
// --------------------------------------------------------------------------

const SITE = 'https://xenostudio.ai';
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The one XENO email shell -- DESIGN_SYSTEM 3.1 plate anatomy, in the form
 * xeno-motion ships it: an outer #08080a plate holding a #1a1a1a header, a
 * #111111 body and a #1a1a1a footer, each 4px radius, separated by a 2px gap.
 *
 * The gap is what makes the header read as a TAB above its body rather than a
 * stripe inside a card. Email has no CSS gap, so the 2px is a spacer row.
 *
 * What a real mail client removes, and therefore what this cannot use: no
 * flexbox or grid (tables are the only layout primitive that works anywhere),
 * no SVG, no webfonts, and no hero image -- most clients block remote images by
 * default, so an identity that lives in a PNG is one a large share of readers
 * never see.
 */
function wrapChrome(title, bodyContent, options = {}) {
  const preheader = options.preheader || '';
  const footerNote = options.footerNote || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background-color:#060608;">
  <!-- Preheader: the grey line an inbox shows after the subject. Left empty it
       fills with whatever text comes first, which is usually the wordmark. -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#060608;">
    <tr>
      <td align="center" style="padding:24px 14px 40px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px; max-width:600px; background-color:#08080a; border:1px solid rgba(255,255,255,0.05); border-radius:6px;">
          <tr><td style="padding:6px;">

            <!-- HEADER BAR -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#1a1a1a; border-radius:4px;">
              <tr>
                <td style="padding:9px 12px;" align="center">
                  <a href="${SITE}" style="font-family:${SANS}; font-size:11px; font-weight:700; letter-spacing:0.34em; color:#d8d8de; text-decoration:none;">XENO</a>
                </td>
              </tr>
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td height="2" style="height:2px; font-size:0; line-height:0;">&nbsp;</td></tr></table>

            <!-- BODY -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#111111; border-radius:4px;">
              <tr><td style="padding:26px 24px 24px;">
                ${bodyContent}
              </td></tr>
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td height="2" style="height:2px; font-size:0; line-height:0;">&nbsp;</td></tr></table>

            <!-- FOOTER BAR -- same species as the header, so the shell closes
                 the way it opened. -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#1a1a1a; border-radius:4px;">
              <tr>
                <td align="center" style="padding:10px 14px; font-family:${SANS}; font-size:10px; line-height:1.75; color:#5d5d63;">
                  <a href="${SITE}/impressum" style="color:#7f7f86; text-decoration:none;">Impressum</a>
                  &nbsp;<span style="color:#3a3a3f;">&middot;</span>&nbsp;
                  <a href="${SITE}/privacy" style="color:#7f7f86; text-decoration:none;">Privacy</a>
                  &nbsp;<span style="color:#3a3a3f;">&middot;</span>&nbsp;
                  <a href="${SITE}/terms" style="color:#7f7f86; text-decoration:none;">Terms</a>
                  <br>${footerNote}
                </td>
              </tr>
            </table>

          </td></tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Transactional shell. Same chrome as the welcome mail; different body rules. */
function wrapInLayout(title, bodyContent, preheader = '') {
  return wrapChrome(title, bodyContent, {
    preheader,
    footerNote: 'XENO Studio &middot; sent to the address on your XENO account',
  });
}

// -- Body pieces, inline-styled --------------------------------------------
// Every one of these is inline because a <style> block is the part of an email
// a client is most likely to throw away. Nothing here depends on a class.

function mailHeading(text) {
  return `<h1 style="margin:0 0 14px; font-family:${SANS}; font-size:19px; line-height:1.3; font-weight:600; color:#f2f2f5;">${text}</h1>`;
}

function mailText(html, options = {}) {
  const colour = options.muted ? '#7f7f86' : '#acacb4';
  const size = options.muted ? '11.5px' : '13.5px';
  const align = options.align || 'left';
  return `<p style="margin:0 0 12px; font-family:${SANS}; font-size:${size}; line-height:1.65; color:${colour}; text-align:${align};">${html}</p>`;
}

/**
 * A bulletproof button: a table cell with a background, not a styled anchor.
 *
 * The padding is on the CELL and repeated on the anchor, so the shape survives
 * whether or not the client honours padding on an inline element -- which
 * Outlook does not.
 */
function mailButton(href, label) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px;">
    <tr>
      <td align="center" style="background-color:#f2f2f5; border-radius:4px;">
        <a href="${escapeHtml(href)}" style="display:block; padding:11px 22px; font-family:${SANS}; font-size:12.5px; font-weight:600; color:#08080a; text-decoration:none;">${label}</a>
      </td>
    </tr>
  </table>`;
}

/**
 * The same destination as the button, spelled out.
 *
 * A button is an anchor with no visible URL, and the person reading a password
 * reset is exactly the person who should be able to see where it goes before
 * clicking. It is also the fallback when a client refuses to draw the button.
 */
function mailFallbackLink(href) {
  return `<p style="margin:0 0 4px; font-family:${SANS}; font-size:10.5px; line-height:1.6; color:#5d5d63; word-break:break-all;">Or paste this into your browser:<br><span style="color:#7f7f86;">${escapeHtml(href)}</span></p>`;
}

/**
 * The receipt currency.
 *
 * It said `$` and the platform charges EUR: BILLING_CURRENCY defaults to `eur`
 * and every Stripe price is `tax_behavior: inclusive` in euro (docs/TAX-POSTURE.md).
 * A receipt naming the wrong currency is not a typo -- it is the document the
 * customer keeps for their own books.
 */
const RECEIPT_CURRENCY = (process.env.BILLING_CURRENCY || 'eur').toUpperCase();
const CURRENCY_SYMBOL = { EUR: '€', USD: '$', GBP: '£' };

function formatMoney(amountMinorUnits) {
  const value = (Number(amountMinorUnits || 0) / 100).toFixed(2);
  const symbol = CURRENCY_SYMBOL[RECEIPT_CURRENCY];
  return escapeHtml(symbol ? `${symbol}${value}` : `${value} ${RECEIPT_CURRENCY}`);
}

/**
 * Why this receipt shows no VAT line.
 *
 * docs/TAX-POSTURE.md, LOCKED: the entity is Kleinunternehmer under sec. 19
 * Abs. 1 UStG and charges no VAT. That document also states the obligation this
 * line discharges -- "a seller who charges no VAT must say why: an invoice with
 * no VAT line and no explanation is indistinguishable from one where the VAT was
 * simply left off." The Impressum already carries it; the receipt is the
 * document a customer actually files, so it carries it too, in the same words.
 *
 * At crossover into Regelbesteuerung this line must go, on the same day the
 * Impressum notice goes. Both are named in the crossover checklist.
 */
const VAT_NOTICE = 'Als Kleinunternehmer im Sinne von &sect; 19 Abs. 1 Umsatzsteuergesetz wird keine '
  + 'Umsatzsteuer berechnet und daher auch nicht in Rechnungen ausgewiesen.';

/** A thread title as a link. Inline, so it survives a stripped style block. */
function mailThreadLink(url, title) {
  return `<a href="${escapeHtml(url)}" style="color:#e4e4e8; font-weight:600; text-decoration:none; border-bottom:1px solid rgba(255,255,255,0.18);">${escapeHtml(title)}</a>`;
}

function mailStats(rows) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:14px 0 6px; background-color:#1a1a1a; border-radius:4px;">
    ${rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 14px; font-family:${SANS}; font-size:11.5px; color:#7f7f86;">${label}</td>
      <td align="right" style="padding:10px 14px; font-family:${SANS}; font-size:12px; font-weight:600; color:#e4e4e8;">${value}</td>
    </tr>`).join('')}
  </table>`;
}



/**
 * The onboarding shell — a second layout, used only by `welcome`.
 *
 * Why not reuse wrapInLayout: the welcome mail is the one email whose job is a
 * first impression, and it carries a structure no other template has (a display
 * headline, a numbered sequence, two competing CTAs, a help block). Bending the
 * shared layout to fit it would drag those decisions into password resets.
 *
 * ── WHAT SURVIVES A REAL MAIL CLIENT ───────────────────────────────────────
 *
 * Outlook renders through WORD's HTML engine. That single fact removes most of
 * what a designer would reach for:
 *
 *   • NO flexbox, NO grid — tables are the only layout primitive that works
 *     everywhere. Not legacy styling; the only thing that renders.
 *   • NO SVG — Outlook will not draw it and Gmail strips it. The reference
 *     mock's circular diagram is therefore NOT reproduced as vector art.
 *   • NO webfonts — blocked, stripped, or silently substituted. The display
 *     face is GEORGIA, which ships on Windows, macOS, iOS and Android, with a
 *     Times fallback. It is a real high-contrast serif, so the editorial
 *     feeling survives without a single downloaded byte.
 *   • Style blocks are stripped by some clients (Gmail's clipping, older
 *     Outlook), so every rule that MATTERS is inline. The <style> block only
 *     carries progressive enhancement.
 *
 * ⚠️ And no hero IMAGE. Most clients block remote images by default, so an
 * identity that lives in a PNG is an identity a large share of readers never
 * see — they get an alt-text box where the brand should be. The wordmark is
 * letter-spaced type and the ornament is table borders; both always render.
 */
function wrapWelcome(title, bodyContent) {
  return wrapChrome(title, bodyContent, {
    preheader: 'Your account is ready \u2014 three steps to get moving.',
    footerNote: 'XENO Studio &middot; sent because you created an account at xenostudio.ai',
  });
}

/** A hairline rule. The diamond ornament is gone — Motion's chrome has no
 *  decorative glyphs, and a centred diamond is exactly the flourish a dense
 *  technical surface does not use. */
function hairline(top = 0, bottom = 0) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0;">
    <tr><td style="padding:${top}px 0 ${bottom}px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="border-top:1px solid rgba(255,255,255,0.06); font-size:0; line-height:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>`;
}

/**
 * One numbered step.
 *
 * The number is the visual anchor rather than an icon, because icons in email
 * mean images, and images are blocked by default in most clients — the mock's
 * three line-icons would be three empty boxes for a large share of readers.
 * The numeral carries the same weight and always renders.
 *
 * And numbering is not decoration here: these three are a genuine SEQUENCE —
 * confirm the address, try it with nothing installed, then install. Numbering a
 * set that had no order would be the templated tic this avoids.
 */
/**
 * The activation CODE, rendered as the primary call to action.
 *
 * A code rather than only a link because mail-security appliances pre-fetch
 * every URL in an inbound message — so a link that commits on GET gets
 * "clicked" by a scanner, manufacturing the exact proof of intent this whole
 * mechanism exists to require. A scanner cannot type six digits.
 *
 * Large, letter-spaced and selectable: people copy it or read it off a phone
 * while typing on a laptop, and both need it legible at a glance. Monospace so
 * 0/O and 1/l cannot be confused.
 */
function codeBlock(code, href) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px; background-color:#1a1a1a; border-radius:4px;">
    <tr><td align="center" style="padding:18px 14px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:10px; font-weight:600; letter-spacing:0.2em; text-transform:uppercase; color:#7f7f86;">Your confirmation code</div>
      <div style="font-family:ui-monospace,'Cascadia Mono',Consolas,monospace; font-size:30px; font-weight:600; letter-spacing:0.28em; color:#ffffff; margin:10px 0 4px; padding-left:0.28em;">${escapeHtml(code)}</div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; color:#5d5d63;">Enter it on the page that is waiting for you. Expires in 15 minutes.</div>
      ${href ? `<div style="margin-top:12px;"><a href="${escapeHtml(href)}" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; color:#acacb4; text-decoration:none; border-bottom:1px solid rgba(255,255,255,0.15);">or confirm from this device instead &rarr;</a></div>` : ''}
    </td></tr>
  </table>`;
}

function stepRow(n, title, body, href, cta) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 4px; background-color:#1a1a1a; border-radius:4px;">
    <tr>
      <td width="46" align="center" valign="top" style="padding:12px 0 12px 12px;">
        <!-- 3px on the numeral chip: DESIGN_SYSTEM's small radius is for the
             element, medium is for outermost containers only. A step marker is
             about as small as an element gets. -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="28" style="width:28px; height:28px; background-color:#2b2b2b; border-radius:3px;">
          <tr>
            <td align="center" valign="middle" style="height:28px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; color:#acacb4;">${n}</td>
          </tr>
        </table>
      </td>
      <td valign="top" style="padding:12px 14px 12px 10px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <div style="font-size:12.5px; font-weight:600; color:#d8d8de; letter-spacing:0.01em;">${escapeHtml(title)}</div>
        <div style="font-size:11.5px; line-height:1.55; color:#7f7f86; margin-top:3px;">${escapeHtml(body)}</div>
        <a href="${escapeHtml(href)}" style="display:inline-block; margin-top:7px; font-size:10.5px; font-weight:500; color:#acacb4; text-decoration:none; border-bottom:1px solid rgba(255,255,255,0.15); padding-bottom:1px;">${escapeHtml(cta)} &rarr;</a>
      </td>
    </tr>
  </table>`;
}

/**
 * One checklist row.
 *
 * Built from a <table>, not flexbox or grid, because Outlook renders email through
 * Word's HTML engine, which supports neither. Table-based layout is not legacy
 * styling here — it is the only layout primitive that works everywhere.
 */
function checklistRow(title, subtitle, href) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.10); border-radius: 6px;">
      <tr>
        <td style="padding: 14px 16px;">
          <a href="${escapeHtml(href)}" style="color: rgba(255,255,255,0.90); font-size: 14px; font-weight: 600; text-decoration: none;">${escapeHtml(title)}</a>
          <div style="color: rgba(255,255,255,0.45); font-size: 13px; line-height: 1.5; margin-top: 4px;">${escapeHtml(subtitle)}</div>
        </td>
      </tr>
    </table>`;
}

/**
 * The quoted answer, with its author identified by KIND.
 *
 * The excerpt is capped here rather than at the call site because a post body
 * can be 60 000 characters and no call site should have to remember that. A
 * mail that carries a whole essay is a mail nobody reads and some clients clip
 * outright (Gmail truncates around 102 KB and hides the rest behind "View
 * entire message" — losing the unsubscribe link at the bottom, which is a
 * compliance problem, not a cosmetic one).
 *
 * Bodies are user-authored markdown. They are escaped, never rendered: the
 * Forum's own web view is safe because it uses ReactMarkdown without
 * rehype-raw, and interpolating the same text into an email as HTML would
 * reintroduce exactly the injection the web view avoids — in a surface with no
 * CSP, delivered to someone's inbox.
 */
function answerBlock(authorName, authorKind, authorOwner, excerpt) {
  const isAgent = authorKind === 'agent';
  const body = String(excerpt || '').trim();
  const clipped = body.length > 420 ? `${body.slice(0, 420).trimEnd()}…` : body;

  // An agent with no visible owner must not render as a bare name — the owner
  // is who is accountable (§4.4). Falling back to "operated by an unnamed
  // owner" is deliberately awkward: it should look wrong, because it is.
  const attribution = isAgent
    ? `<span style="display: inline-block; border: 1px solid rgba(255,255,255,0.20); border-radius: 3px; padding: 1px 5px; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; color: rgba(255,255,255,0.65); margin-left: 6px;">AGENT</span>
       <div style="color: rgba(255,255,255,0.35); font-size: 12px; margin-top: 3px;">operated by ${escapeHtml(authorOwner || 'an unnamed owner')}</div>`
    : '';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0; border: 1px solid rgba(255,255,255,0.10); border-radius: 6px; background-color: #060608;">
      <tr>
        <td style="padding: 16px 18px;">
          <div style="color: rgba(255,255,255,0.90); font-size: 13px; font-weight: 600;">
            ${escapeHtml(authorName || 'Someone')}${attribution}
          </div>
          <div style="color: rgba(255,255,255,0.55); font-size: 14px; line-height: 1.6; margin-top: 10px; white-space: pre-wrap;">${escapeHtml(clipped)}</div>
        </td>
      </tr>
    </table>`;
}

/**
 * Forum footer.
 *
 * The unsubscribe is category-scoped (`category=forum`) so switching off forum
 * mail does not switch off password resets. `emailPreferences.isOptedOut()`
 * already takes a category; this is the reader-facing half of that.
 */
function forumFooter(unsubUrl) {
  return `
      ${hairline(14, 12)}
      ${mailText(`You are getting this because you took part in this thread.${unsubUrl
        ? ` <a href="${escapeHtml(unsubUrl)}" style="color:#acacb4;">Turn off Forum email</a>. Security email like password resets will still reach you.`
        : ''}`, { muted: true })}
      ${mailText(`<a href="${SITE}/forum" style="color:#7f7f86;">XENO Forum</a> &middot; <a href="${SITE}/privacy" style="color:#7f7f86;">Privacy</a>`, { muted: true })}`;
}

// --------------------------------------------------------------------------
// Templates
// --------------------------------------------------------------------------
const templates = {
  /**
   * The onboarding email. Structure follows the pattern every good product welcome
   * uses (a short promise, then a CHECKLIST of concrete first actions, then help
   * resources) because "welcome, your account is created" gives the reader nothing
   * to do, and a welcome email's only job is the first action.
   *
   * Every claim here must be something XENO actually ships today. Do not add a
   * checklist row for a product that is not downloadable — an onboarding email that
   * sends people to a dead end is worse than no onboarding email.
   */
  welcome: ({ displayName, loginUrl, activateUrl, activationCode, unsubscribeUrl: unsubUrl }) => ({
    // The subject promises the shape of the mail, not a greeting. "Welcome to
    // XENO" alone tells the reader nothing they did not already know from
    // having just signed up.
    subject: 'Welcome to XENO — three steps to get moving',
    html: wrapWelcome('Welcome to XENO', `

      <!-- CENTRED, and the name sits on the SAME LINE, to the right of the
           greeting — one phrase read left to right, not a stacked display
           block. Georgia keeps the editorial weight; at 28px it can sit in a
           dense panel without shouting over it. -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td align="center" style="padding:0 0 0;">
          <div style="font-family:Georgia,'Times New Roman',serif; font-size:28px; line-height:1.2; color:#e8e8ee; letter-spacing:-0.01em;">
            Welcome${displayName ? `, ${escapeHtml(displayName)}` : ''}
          </div>
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.62; color:#7f7f86; margin-top:9px; max-width:420px;">
            Your account's ready. The agent-native workspace for creation, code, media
            and automation &mdash; you bring the intent, agents do the work.
          </div>
        </td></tr>
      </table>

      ${hairline(20, 14)}

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding:0 0 8px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:9.5px; font-weight:600; letter-spacing:0.2em; text-transform:uppercase; color:#5d5d63;">
          Start here
        </td></tr>
      </table>

      ${activationCode ? codeBlock(activationCode, activateUrl) : stepRow('01', 'Confirm your email',
        'One click, and it is what unlocks the workspace.',
        activateUrl || `${SITE}/verify-email`, 'Confirm')}

      ${stepRow('02', 'Open the workspace',
        'Nothing to install. Start a conversation with a model in the browser and work from there.',
        `${SITE}/overview`, 'Open it')}

      ${stepRow('03', 'Install XENO Hub',
        'One launcher for every app, with updates built in. Windows and Linux today.',
        `${SITE}/product/hub/download`, 'Download')}

      <!-- Two CTAs, deliberately unequal. The primary is the one that produces
           VALUE; confirming an address is hygiene, and making hygiene the loud
           button trains people to treat the loud button as a chore.
           4px radius and #2b2b2b on the secondary — Motion's control species. -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding:12px 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="50%" style="padding-right:2px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#e8e8ee; border-radius:4px;">
                  <tr><td align="center">
                    <a href="${escapeHtml(loginUrl || `${SITE}/overview`)}" style="display:block; padding:10px 14px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11.5px; font-weight:600; color:#111111; text-decoration:none;">Open the workspace</a>
                  </td></tr>
                </table>
              </td>
              <td width="50%" style="padding-left:2px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#2b2b2b; border-radius:4px;">
                  <tr><td align="center">
                    <a href="${escapeHtml(activateUrl || `${SITE}/verify-email`)}" style="display:block; padding:10px 14px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11.5px; font-weight:500; color:#d8d8de; text-decoration:none;">Confirm email</a>
                  </td></tr>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>

      ${hairline(18, 12)}

      <!-- Help + the closer. The one-person line is the boilerplate's own
           "screenshot-able proof" (voice rule 5) and it is literally true, so
           it earns the space a generic "built to help teams do more" — which
           describes every product ever shipped — would waste. -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#1a1a1a; border-radius:4px;">
        <tr>
          <td style="padding:12px 14px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <div style="font-size:11.5px; font-weight:600; color:#d8d8de;">Stuck on any of it?</div>
            <div style="font-size:11px; line-height:1.6; color:#7f7f86; margin-top:3px;">
              The <a href="${SITE}/docs" style="color:#acacb4; text-decoration:none; border-bottom:1px solid rgba(255,255,255,0.15);">docs</a>
              cover every app and the agent tooling, and you can
              <a href="${SITE}/contact" style="color:#acacb4; text-decoration:none; border-bottom:1px solid rgba(255,255,255,0.15);">write to us</a>
              directly. Real reply, not a ticket number.
            </div>
          </td>
        </tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding:12px 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:10.5px; line-height:1.65; color:#5d5d63;">
          Built by one person working alongside AI agents &mdash; using the same tools you're about to.
          <br><br>
          Didn't create this account? Ignore this email &mdash; nothing else happens.${unsubUrl ? `
          Don't want product email? <a href="${escapeHtml(unsubUrl)}" style="color:#7f7f86;">Unsubscribe</a>; security email still reaches you.` : ''}
        </td></tr>
      </table>
    `),
  }),

  /*
   * One template, two situations.
   *
   * `settingFirstPassword` is true for an account created through Google, which
   * has never had a password. Telling that person to "reset your password" is
   * confusing in the one email that has to be understood on the first read — and
   * it hides the thing they most need to know, which is that adding a password
   * does not take Google away from them.
   *
   * Only the words change. Same endpoint, same single-use token, same expiry.
   */
  password_reset: ({ displayName, resetUrl, expiresIn, settingFirstPassword }) => ({
    subject: settingFirstPassword ? 'Set a password for your XENO account' : 'Reset your XENO password',
    html: wrapInLayout(settingFirstPassword ? 'Set a password' : 'Password Reset', `
      ${mailHeading(settingFirstPassword ? 'Set a password for your account' : 'Reset your password')}
      ${mailText(settingFirstPassword
        ? `Hi ${escapeHtml(displayName)}, your XENO account signs in with Google today and has no password yet. This link adds one.`
        : `Hi ${escapeHtml(displayName)}, we received a request to set a new password on your XENO account.`)}
      ${settingFirstPassword ? mailText('You keep both. Afterwards you can sign in with Google <em>or</em> with your email and password — it is the same account either way.') : ''}
      ${mailButton(resetUrl, settingFirstPassword ? 'Set a password' : 'Choose a new password')}
      ${mailFallbackLink(resetUrl)}
      ${hairline(14, 12)}
      ${mailText(`This link works once and expires in ${escapeHtml(String(expiresIn || '1 hour'))}. Anyone who has it can set your password, so treat it like the password itself.`, { muted: true })}
      ${mailText(settingFirstPassword
        ? 'If you did not ask for this, nothing has changed and you can ignore this email. Your account still signs in with Google exactly as before.'
        : 'If you did not ask for this, nothing has changed and you can ignore this email. Your current password still works.', { muted: true })}
    `, settingFirstPassword ? 'Add a password to your XENO account — Google keeps working.' : 'Set a new password on your XENO account.'),
  }),

  email_verification: ({ displayName, verifyUrl, expiresIn }) => ({
    subject: 'Verify your XENO email',
    html: wrapInLayout('Verify your email', `
      ${mailHeading('Confirm your email address')}
      ${mailText(`Hi ${escapeHtml(displayName)}, confirming this address secures your XENO account and is what makes password recovery possible later.`)}
      ${mailButton(verifyUrl, 'Confirm this address')}
      ${mailFallbackLink(verifyUrl)}
      ${hairline(14, 12)}
      ${mailText(`This link expires in ${escapeHtml(String(expiresIn || '24 hours'))}. If you did not create a XENO account, you can safely ignore this email.`, { muted: true })}
    `, 'Confirm your address to secure your XENO account.'),
  }),

  receipt: ({ displayName, amount, credits, transactionId, date }) => ({
    subject: `XENO receipt — ${credits} credits`,
    html: wrapInLayout('Purchase Receipt', `
      ${mailHeading('Your receipt')}
      ${mailText(`Hi ${escapeHtml(displayName)}, thank you for your purchase.`)}
      ${mailStats([
        ['Credits purchased', escapeHtml(String(credits))],
        ['Amount', formatMoney(amount)],
        ['Transaction', `<span style="font-family:ui-monospace,'Cascadia Mono',Consolas,monospace; font-size:11px;">${escapeHtml(String(transactionId))}</span>`],
        ['Date', escapeHtml(String(date || new Date().toISOString().slice(0, 10)))],
      ])}
      ${hairline(14, 12)}
      ${mailText(VAT_NOTICE, { muted: true })}
      ${mailText('Keep this for your records. Questions? <a href="mailto:billing@xenostudio.ai" style="color:#acacb4;">billing@xenostudio.ai</a>', { muted: true })}
    `, 'Your XENO receipt.'),
  }),

  credits_low: ({ displayName, currentCredits, threshold }) => ({
    subject: 'XENO — Your credits are running low',
    html: wrapInLayout('Low Credits', `
      ${mailHeading('Your credits are running low')}
      ${mailText(`Hi ${escapeHtml(displayName)}, you have <strong style="color:#e4e4e8;">${escapeHtml(String(currentCredits))} credits</strong> left \u2014 below the ${escapeHtml(String(threshold))} you asked to be warned at.`)}
      ${mailText('Generation, editing and video all draw on the same balance, so a long render is the usual way the last of it goes.')}
      ${mailButton(`${SITE}/settings`, 'Top up')}
    `, 'Your XENO credit balance is running low.'),
  }),

  new_version: ({ displayName, appName, version, releaseNotes, downloadUrl }) => ({
    subject: `${appName} ${version} is now available`,
    html: wrapInLayout(`${appName} Update`, `
      ${mailHeading(`${escapeHtml(appName)} ${escapeHtml(version)}`)}
      ${mailText(`Hi ${escapeHtml(displayName)}, a new version of ${escapeHtml(appName)} is available.`)}
      ${releaseNotes ? `${hairline(4, 12)}
      <p style="margin:0 0 8px; font-family:${SANS}; font-size:10px; font-weight:600; letter-spacing:0.2em; text-transform:uppercase; color:#7f7f86;">What&rsquo;s new</p>
      ${mailText(escapeHtml(releaseNotes))}` : ''}
      ${mailButton(downloadUrl || `${SITE}/download`, 'Download the update')}
    `, `${escapeHtml(appName)} ${escapeHtml(version)} is available.`),
  }),

  // ------------------------------------------------------------------------
  // Forum notifications (WP1)
  //
  // A forum where nobody learns they were answered has no loop, and every
  // other piece of the Forum depends on that loop closing. These are the
  // emails that close it.
  //
  // Three rules shape all of them:
  //
  //   1. CARRY THE ANSWER, don't advertise it. "You have a new reply — click
  //      to view" spends the reader's attention to tell them attention is
  //      required. The answer is usually short enough to read right here, and
  //      a reader who got what they needed without a round trip is exactly the
  //      outcome — time-to-resolution, not time-on-site (§5.4). The click is
  //      for accepting, replying, or reading the rest.
  //
  //   2. SAY WHETHER A MACHINE WROTE IT. XENO Forum is one corpus for humans
  //      and agents (§4), so "answered by @pixel-dev, an agent operated by
  //      Maria" is information the reader is owed before they trust the
  //      answer. No other forum's notification has to do this. The owner is
  //      shown because the owner is who is accountable (§4.4).
  //
  //   3. NEVER A SCORE. No reputation integer, no "you earned 15 points", no
  //      streak (D4). The reward for being answered is the answer.
  // ------------------------------------------------------------------------

  /**
   * The whole loop in one email: your question got an answer.
   *
   * `authorKind` is 'human' | 'agent'. `authorOwner` is only meaningful for an
   * agent and is REQUIRED when authorKind is 'agent' — an agent with no visible
   * owner is exactly the accountability gap §4.4 exists to close.
   */
  forum_answer: ({ displayName, threadTitle, threadUrl, authorName, authorKind, authorOwner, excerpt, unsubscribeUrl: unsubUrl }) => ({
    // The question in the subject, because that is what the reader recognises.
    // "New reply on the XENO Forum" is a subject about us; this one is about them.
    subject: `Answered: ${threadTitle}`,
    html: wrapInLayout('You have an answer', `
      ${mailHeading('Your question was answered')}
      ${mailText(`Hi ${escapeHtml(displayName)}, someone answered ${mailThreadLink(threadUrl, threadTitle)}.`)}

      ${answerBlock(authorName, authorKind, authorOwner, excerpt)}

      ${mailButton(threadUrl, 'Read the full answer')}
      ${mailText('If it solved your problem, accept it \u2014 that is what makes the next person&rsquo;s search find it instead of asking again.', { muted: true })}
      ${forumFooter(unsubUrl)}
    `, `${authorName || 'Someone'} answered your question.`),
  }),

  /** Your answer was accepted. The only "reward" the Forum hands out, and it is not a number. */
  forum_accepted: ({ displayName, threadTitle, threadUrl, askerName, unsubscribeUrl: unsubUrl }) => ({
    subject: `Your answer was accepted: ${threadTitle}`,
    html: wrapInLayout('Answer accepted', `
      ${mailHeading('Your answer was accepted')}
      ${mailText(`Hi ${escapeHtml(displayName)}, ${escapeHtml(askerName || 'the person who asked')} accepted your answer on ${mailThreadLink(threadUrl, threadTitle)}.`)}
      ${mailText('It is now the answer anyone \u2014 or any agent \u2014 searching this problem will find first. That is the entire point of writing it down.')}
      ${mailButton(threadUrl, 'View the thread')}
      ${forumFooter(unsubUrl)}
    `, 'It is now the first thing anyone searching this problem will find.'),
  }),

  /** Someone replied to you in a thread you are part of. Lower-stakes than an answer. */
  forum_reply: ({ displayName, threadTitle, threadUrl, authorName, authorKind, authorOwner, excerpt, unsubscribeUrl: unsubUrl }) => ({
    subject: `New reply: ${threadTitle}`,
    html: wrapInLayout('New reply', `
      ${mailHeading('New reply')}
      ${mailText(`Hi ${escapeHtml(displayName)}, there is a new reply on ${mailThreadLink(threadUrl, threadTitle)}.`)}

      ${answerBlock(authorName, authorKind, authorOwner, excerpt)}

      ${mailButton(threadUrl, 'Open the thread')}
      ${forumFooter(unsubUrl)}
    `, `${authorName || 'Someone'} replied in a thread you are part of.`),
  }),

  /**
   * Someone named you.
   *
   * The subject says WHO, because that is the whole reason this mail is
   * different from a reply: you were asked for personally, and the decision to
   * open it depends on who did the asking. "You were mentioned" tells the reader
   * nothing they can act on.
   */
  /**
   * A card dispute has been opened. OPERATOR mail, not customer mail.
   *
   * ⚠️ Deliberately plain and deliberately alarming. Stripe's response window is
   * 7–21 days and it starts NOW; a message that reads like a notification gets
   * triaged like one. Everything needed to act is in the body, because the
   * person reading it on a phone must not have to go looking for the amount, the
   * deadline or the link.
   */
  dispute_opened: (d) => ({
    subject: `⚠️ Card dispute opened — ${d.amount || 'unknown amount'} — respond by ${d.dueBy || 'ASAP'}`,
    html: wrapInLayout('Card dispute opened', `
      ${mailHeading('A customer disputed a payment')}
      ${mailText('Stripe has opened a dispute. <strong style="color:#e4e4e8;">You must respond before the deadline or the dispute is lost automatically</strong>, including the fee.')}
      ${mailStats([
        ['Amount', `<strong>${escapeHtml(String(d.amount || '\u2014'))}</strong>`],
        ['Reason', escapeHtml(String(d.reason || '\u2014'))],
        ['Respond by', `<strong>${escapeHtml(String(d.dueBy || 'see Stripe'))}</strong>`],
        ['Customer', escapeHtml(String(d.customerEmail || 'unknown'))],
        ['Dispute', `<span style="font-family:ui-monospace,'Cascadia Mono',Consolas,monospace; font-size:11px;">${escapeHtml(String(d.disputeId || '\u2014'))}</span>`],
      ])}
      ${mailText('The customer&rsquo;s credit account has been frozen automatically.')}
      ${mailButton(d.url || 'https://dashboard.stripe.com/disputes', 'Open in Stripe')}
    `, `Respond by ${d.dueBy || 'the Stripe deadline'} or the dispute is lost automatically.`),
  }),

  forum_mention: ({ displayName, threadTitle, threadUrl, authorName, authorKind, authorOwner, excerpt, unsubscribeUrl: unsubUrl }) => ({
    subject: `${authorName} mentioned you: ${threadTitle}`,
    html: wrapInLayout('You were mentioned', `
      ${mailHeading('You were mentioned')}
      ${mailText(`Hi ${escapeHtml(displayName)}, ${escapeHtml(authorName || 'someone')} named you in ${mailThreadLink(threadUrl, threadTitle)}.`)}

      ${answerBlock(authorName, authorKind, authorOwner, excerpt)}

      ${mailButton(threadUrl, 'Open the thread')}
      ${forumFooter(unsubUrl)}
    `, `${authorName || 'Someone'} named you in a thread.`),
  }),
};

// --------------------------------------------------------------------------
// Email sending
// --------------------------------------------------------------------------

/**
 * Send an email using a template
 * @param {object} db - Database pool
 * @param {string} template - Template name
 * @param {string} toEmail - Recipient email
 * @param {object} data - Template data
 * @param {string} [userId] - User ID for logging
 */
export async function sendEmail(db, template, toEmail, data, userId = null) {
  const templateFn = templates[template];
  if (!templateFn) {
    throw new Error(`Unknown email template: ${template}`);
  }

  // Honour the unsubscribe list — but NEVER for security/recovery mail.
  const essential = ESSENTIAL_TEMPLATES.has(template);
  if (!essential && await isOptedOut(db, toEmail)) {
    console.log(`[Email] suppressed (opted out) — template: ${template}, to: ${toEmail}`);
    return { success: false, suppressed: true, reason: 'opted_out' };
  }

  // Non-essential mail carries a working one-click unsubscribe. It is computed here
  // rather than passed by each caller so a new template cannot ship without one.
  const { subject, html } = templateFn(
    essential ? data : { ...data, unsubscribeUrl: data?.unsubscribeUrl || unsubscribeUrl(toEmail) },
  );
  const emailId = uuidv4();

  // Log to database
  if (db) {
    await db.query(
      `INSERT INTO email_logs (id, user_id, to_email, template, subject, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [emailId, userId, toEmail, template, subject]
    );
  }

  try {
    // Production: send via Resend API
    if (process.env.RESEND_API_KEY) {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'XENO <noreply@xenostudio.ai>',
          to: [toEmail],
          subject,
          html,
        }),
      });

      if (!resendResponse.ok) {
        const errBody = await resendResponse.text();
        throw new Error(`Resend API error ${resendResponse.status}: ${errBody}`);
      }

      const resendData = await resendResponse.json();
      console.log(`[Email] Sent via Resend to ${toEmail}: ${subject} (id: ${resendData.id})`);
    } else if (process.env.SENDGRID_API_KEY) {
      // Fallback: SendGrid
      const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: toEmail }] }],
          from: { email: process.env.SENDGRID_FROM || 'noreply@xenostudio.ai', name: 'XENO' },
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
      });

      if (!sgResponse.ok) {
        const errBody = await sgResponse.text();
        throw new Error(`SendGrid API error ${sgResponse.status}: ${errBody}`);
      }

      console.log(`[Email] Sent via SendGrid to ${toEmail}: ${subject}`);
    } else {
      // No provider configured — the message goes to the console and NOWHERE ELSE.
      //
      // This branch used to fall through to `status = 'sent'`, so `email_logs` recorded
      // a successful delivery for a message that was never transmitted. Production had
      // exactly one row in that table, reading 'sent', for an email nobody received —
      // an operator checking whether email worked would have concluded that it did.
      // A no-op must never report success.
      console.log(`[Email] NOT CONFIGURED — no RESEND_API_KEY/SENDGRID_API_KEY. Template: ${template}, To: ${toEmail}, Subject: ${subject}`);
      if (db) {
        await db.query(
          'UPDATE email_logs SET status = $1, error = $2 WHERE id = $3',
          ['skipped', 'no email provider configured', emailId]
        );
      }
      return { success: false, skipped: true, reason: 'no_provider', emailId };
    }

    // Mark as sent
    if (db) {
      await db.query(
        'UPDATE email_logs SET status = $1, sent_at = NOW() WHERE id = $2',
        ['sent', emailId]
      );
    }

    return { success: true, emailId };
  } catch (error) {
    // Mark as failed
    if (db) {
      await db.query(
        'UPDATE email_logs SET status = $1, error = $2 WHERE id = $3',
        ['failed', error.message, emailId]
      );
    }

    console.error(`[Email] Failed to send ${template} to ${toEmail}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send the onboarding email for a newly created account.
 *
 * FIRE AND FORGET, DELIBERATELY. Signup must never fail because an email provider is
 * slow, misconfigured or down — a person who successfully created an account and then
 * saw a 500 would reasonably conclude they have no account, and try again. The send
 * is awaited by nobody and every failure is swallowed to a log line.
 *
 * Called from all THREE account-creation paths in routes/authRoutes.js: /register,
 * /register-with-handle, and findOrCreateOAuthUser. The OAuth one matters most —
 * 160 of the platform's 221 accounts were created that way, so wiring only the
 * password path would have missed nearly three quarters of new users.
 */
export function sendWelcomeEmail(db, user) {
  if (!user?.email) return;
  const displayName = user.display_name || user.displayName || user.username || '';

  // DETACHED on purpose — a signup must never fail because mail is down. But
  // detached also meant "lost on the first transient error", with a console
  // line as the only trace. A welcome email is sent exactly once in a user's
  // life and there is no second natural trigger, so a dropped one is gone for
  // good. `email_logs` had TWO rows against 223 accounts when this was written;
  // whatever the cause, nothing here would have told us.
  //
  // Three attempts with backoff. A 4xx is NOT retried — Resend rejecting a
  // payload on content will reject it identically twice more, which only delays
  // the log line that explains why.
  // Mint the code ONCE, outside the retry. A retry must resend the SAME code —
  // minting per attempt would invalidate the code carried by the message that
  // did arrive, so a transient failure would silently break a working email.
  const codePromise = mintCode(db, user.id, bcrypt).catch((e) => {
    // A code we could not mint must not stop the mail: the link still works,
    // and an email with one route in beats no email at all.
    console.error(`[Email] could not mint an activation code for ${user.email}:`, e?.message || e);
    return null;
  });

  const attempt = async (n) => sendEmail(db, 'welcome', user.email, {
    activationCode: await codePromise,
    displayName,
    // /overview, not the marketing home. The template's primary CTA reads
    // "Open the workspace"; pointing it at the landing page makes it a lie.
    loginUrl: `${SITE}/overview`,
    // 🔴 The activation link is the ONLY way into the platform for a new
    // account, so this mail stopped being a courtesy the moment the gate went
    // in — it is now load-bearing. That is precisely why the retry below
    // exists: a welcome silently lost to one transient Resend error used to
    // cost a nicety, and now costs the user their account.
    activateUrl: activationUrl(user.id),
  }, user.id || null).catch((err) => {
    const status = err?.status || err?.statusCode;
    const retriable = !(status >= 400 && status < 500);
    if (n >= 3 || !retriable) {
      console.error(`[Email] welcome PERMANENTLY failed for ${user.email} after ${n} attempt(s):`, err?.message || err);
      return { success: false, failed: true };
    }
    const wait = 2000 * n;
    console.warn(`[Email] welcome attempt ${n} failed for ${user.email}, retrying in ${wait}ms:`, err?.message || err);
    return new Promise((r) => setTimeout(r, wait)).then(() => attempt(n + 1));
  });

  Promise.resolve().then(() => attempt(1));
}

/**
 * Get email sending stats
 */
export async function getEmailStats(db, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { rows } = await db.query(
    `SELECT template, status, COUNT(*) as count
     FROM email_logs
     WHERE created_at > $1
     GROUP BY template, status
     ORDER BY template, status`,
    [since]
  );

  return rows;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default { sendEmail, getEmailStats, templates };
