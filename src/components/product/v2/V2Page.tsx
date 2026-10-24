import React, { useEffect, useMemo } from 'react';
import { V2_ACCENTS, V2_HEADER_CSS, V2_HEADER_HTML, V2_HEADER_JS, V2_PRODUCT_TOKEN } from '../../../generated/v2Chrome';

/* The v2 product-page chrome for React routes that live under a design page:
 * /product/<slug>/download, /releases and /releases/<version>.
 *
 * A visitor arrives here FROM the design (its Download button lands on /download),
 * so the page must read as the same document: same header, paper, type and the
 * product's own accent. The header markup and the accents are generated from the
 * designs (scripts/generate-v2-chrome.mjs), and the header's behaviour is the same
 * /site/marketing-header.js, which listens on the document, so it drives this
 * React-rendered copy exactly as it drives the static ones. */

export const INK = '#1D1B18';
export const PAPER = '#F6F4F0';
export const MUTED = '#5F5A52';
export const FAINT = '#8C867C';
export const LINE = '#E2DDD5';
export const MONO = "'IBM Plex Mono',ui-monospace,monospace";
const SANS = "'Schibsted Grotesk',system-ui,sans-serif";
const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap';

function once(id: string, make: () => HTMLElement) {
  if (!document.getElementById(id)) { const el = make(); el.id = id; document.head.append(el); }
}

/** A design's accent is chosen for its own hero, often a dark one. On paper a pale
 *  accent is unreadable as text, so text uses a shade pulled toward ink until it is. */
function readable(hex: string): string {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  const lum = (v: number[]) => v.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
    .reduce((a, s, i) => a + s * [0.2126, 0.7152, 0.0722][i], 0);
  const ink = [0x1d, 0x1b, 0x18];
  for (let t = 0; t <= 1; t += 0.05) {
    const mix = c.map((x, i) => Math.round(x * (1 - t) + ink[i] * t));
    // ≥ 4.5:1 against paper (#F6F4F0, luminance ≈ 0.905)
    if ((0.905 + 0.05) / (lum(mix) + 0.05) >= 4.5) return '#' + mix.map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  return INK;
}

export function useAccent(slug: string) {
  return useMemo(() => {
    const raw = V2_ACCENTS[slug] || '#C2410C';
    return { raw, text: readable(raw) };
  }, [slug]);
}

/** 2026-10-23 → 23 October 2026 (the designs write dates out). */
export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(+d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const FOOTER: [string, [string, string][]][] = [
  ['Product', [['Pricing', '/pricing'], ['Download', '/download'], ['What’s new', '/blog'], ['Roadmap', '/roadmap']]],
  ['Resources', [['Documentation', '/docs'], ['Tutorials', '/learn'], ['API', '/api-reference'], ['Forum', '/forum']]],
  ['Company', [['About', '/about'], ['Careers', '/careers'], ['Press', '/press'], ['Contact', '/contact']]],
  ['Legal', [['Impressum', '/impressum'], ['Privacy', '/privacy'], ['Terms', '/terms'], ['Security', '/security']]],
];

export const V2Page: React.FC<{ product: string; children: React.ReactNode }> = ({ product, children }) => {
  useEffect(() => {
    once('v2-fonts', () => Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONTS }));
    once('v2-header-css', () => Object.assign(document.createElement('link'), { rel: 'stylesheet', href: V2_HEADER_CSS }));
    once('v2-header-js', () => Object.assign(document.createElement('script'), { src: V2_HEADER_JS, defer: true }));
    const prev = document.body.style.background;
    document.body.style.background = PAPER;
    return () => { document.body.style.background = prev; };
  }, []);
  const word = product.replace(/^XENO\s+/i, '');
  const header = useMemo(() => V2_HEADER_HTML.replace(V2_PRODUCT_TOKEN, escapeHtml(word)), [word]);

  return (
    // A column at least the window's height, with <main> taking the slack: on a short
    // page (one release) in a tall window the footer must still reach the bottom edge.
    // Without it the paper showed as a light strip under the footer, and the fixed
    // report launcher sat on that strip in colours meant for a dark ground.
    <div style={{ fontFamily: SANS, background: PAPER, color: INK, minHeight: '100vh', display: 'flex', flexDirection: 'column', overflowX: 'clip', WebkitFontSmoothing: 'antialiased' }}>
      {/* Trusted, build-generated markup (scripts/lib/marketing-header.mjs); the only
          runtime input is the product word, escaped above. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 60 }} dangerouslySetInnerHTML={{ __html: header }} />
      <main style={{ flex: '1 0 auto' }}>{children}</main>
      <footer style={{ background: INK, color: '#E8E4DC', padding: '64px 24px 32px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px 48px' }}>
            <div style={{ flex: '2 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src="/products-v2/assets/xeno-mark.svg" alt="" style={{ width: 20, height: 20, filter: 'invert(1)' }} />
                <span style={{ fontSize: 15, color: '#F3F0EA' }}><b style={{ letterSpacing: '.04em' }}>XENO</b>system</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#A9A398', maxWidth: 320 }}>The complete AI workspace for creation, code, media, workflows and intelligent agents.</p>
            </div>
            {FOOTER.map(([title, links]) => (
              <div key={title} style={{ flex: '1 1 130px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F3F0EA' }}>{title}</div>
                {links.map(([label, href]) => <a key={label} href={href} style={{ color: '#A9A398', fontSize: 13.5, textDecoration: 'none' }}>{label}</a>)}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid #33312D', fontSize: 13, color: '#A9A398' }}>© 2026 XENO Corporation. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

/** The mono, uppercase label above a heading — the designs' section voice. */
export const Eyebrow: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color }}>{children}</div>
);

export const H1: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1 style={{ margin: '12px 0 0', fontSize: 'clamp(42px,6vw,88px)', lineHeight: 0.96, letterSpacing: '-.05em', fontWeight: 700, textWrap: 'balance' as never }}>{children}</h1>
);
