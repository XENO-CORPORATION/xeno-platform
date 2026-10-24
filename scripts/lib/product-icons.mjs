// Put each product's real app icon on the /products index cards.
//
// The handoff design drew every card with a 12px colour square by the name and a
// faint colour circle in the top-right corner: placeholders for a mark the product
// did not yet have. The marks now exist (xeno-product-icons, vendored byte-identical
// at public/product-icons/svg/), so both placeholders become the product's app icon.
// A product with no icon in the pack keeps its placeholders rather than borrowing
// another product's mark or a generic one.
//
// Idempotent: a stamped card no longer contains either placeholder, so a second run
// changes nothing. scripts/import-products-v2.mjs runs this on every import.
import { existsSync } from 'node:fs';

// Design slug → icon id where the two names differ.
const ICON_ID = { polis: 'xenopolis' };

export function iconFor(slug, publicDir) {
  const id = `xeno-${ICON_ID[slug] || slug}`;
  return existsSync(`${publicDir}/product-icons/svg/${id}.svg`) ? `/product-icons/svg/${id}.svg` : null;
}

const CARD = /<a href="\/product\/([a-z0-9-]+)" style="position:relative;[^>]*>[\s\S]*?<\/a>/g;
const CIRCLE = /<span style="position:absolute; right:-28px; top:-28px; width:110px; height:110px; border-radius:50%; background:#[0-9A-Fa-f]{6}; opacity:\.14"><\/span>/;
const SQUARE = /<span style="width:12px; height:12px; border-radius:3px; background:#[0-9A-Fa-f]{6}"><\/span>/;
const NAME_ROW = '<span style="display:flex; align-items:center; gap:10px">';
const DESC = '<span style="font-size:15px; line-height:1.45; color:#5F5A52; text-wrap:pretty">';

/** Returns { html, stamped: [slugs], missing: [slugs] }. */
export function stampProductIcons(html, publicDir) {
  const stamped = [], missing = [];
  const out = html.replace(CARD, (card, slug) => {
    if (!CIRCLE.test(card) || !SQUARE.test(card)) return card; // already stamped, or not a product card
    const src = iconFor(slug, publicDir);
    if (!src) { missing.push(slug); return card; }
    stamped.push(slug);
    return card
      // The corner: the full tile, kept clear of the edge (the pack asks for 12.5% clear space).
      .replace(CIRCLE, `<img src="${src}" alt="" width="52" height="52" data-product-icon="corner" style="position:absolute; right:18px; top:18px; width:52px; height:52px; display:block">`)
      // By the name: the same mark at list size.
      .replace(SQUARE, `<img src="${src}" alt="" width="24" height="24" data-product-icon="name" style="width:24px; height:24px; display:block; flex:none">`)
      // Text keeps out from under the corner mark.
      .replace(NAME_ROW, '<span style="display:flex; align-items:center; gap:10px; padding-right:64px">')
      .replace(DESC, '<span style="font-size:15px; line-height:1.45; color:#5F5A52; text-wrap:pretty; padding-right:56px">');
  });
  return { html: out, stamped, missing };
}

// Cards for products whose page is designed in this repo (import-products-v2.mjs
// AUTHORED), so the handoff index never listed them. Inserted at the end of their
// section, written in the handoff's own card markup (placeholders included) so the
// icon stamp above treats them like every other card. Skipped when already present.
export function addProductCards(html, cards) {
  let out = html;
  const added = [];
  for (const c of cards) {
    if (out.includes(`<a href="/product/${c.slug}" style="position:relative;`)) continue;
    const head = `letter-spacing:-.01em">${c.section}</h2><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:#8C867C">`;
    const at = out.indexOf(head);
    if (at < 0) throw new Error(`/products has no "${c.section}" section for ${c.slug}`);
    const countEnd = out.indexOf('</span>', at + head.length);
    const count = Number(out.slice(at + head.length, countEnd));
    const gridEnd = out.indexOf('</div></div>', countEnd);
    const card = `<a href="/product/${c.slug}" style="position:relative; display:flex; flex-direction:column; gap:10px; min-height:160px; padding:20px; border-radius:14px; background:#FFFFFF; color:#1D1B18; box-shadow:0 0 0 1px rgba(29,27,24,.08); overflow:hidden; text-decoration:none" style-hover="box-shadow:0 0 0 2px ${c.color}, 0 20px 40px -24px rgba(29,27,24,.4)"><span style="position:absolute; right:-28px; top:-28px; width:110px; height:110px; border-radius:50%; background:${c.color}; opacity:.14"></span><span style="display:flex; align-items:center; gap:10px"><span style="width:12px; height:12px; border-radius:3px; background:${c.color}"></span><span style="font-size:21px; font-weight:700; letter-spacing:-.02em">${c.name}</span></span><span style="font-size:15px; line-height:1.45; color:#5F5A52; text-wrap:pretty">${c.desc}</span><span style="margin-top:auto; display:flex; justify-content:space-between; align-items:center"><span style="font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:#8C867C">${c.status}</span><span style="font-size:14px; font-weight:600">Open →</span></span></a>`;
    out = out.slice(0, at + head.length) + String(count + 1) + out.slice(countEnd, gridEnd) + card + out.slice(gridEnd);
    out = out.replace(/XENO products · (\d+)/, (_, n) => `XENO products · ${Number(n) + 1}`);
    added.push(c.slug);
  }
  return { html: out, added };
}
