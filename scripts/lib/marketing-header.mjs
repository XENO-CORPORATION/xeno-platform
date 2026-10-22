import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const chevron = '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

// The homepage's existing product menu data also drives every imported product
// header. Evaluate only the bounded array literal, never the prototype runtime.
function products(source) {
  const literal = source.match(/const MENU = (\[[\s\S]*?\n\]);/);
  if (!literal) throw new Error('Homepage MENU data is missing');
  return runInNewContext(literal[1], {}, { timeout: 100 });
}

export function marketingAssets() {
  const version = extension => createHash('sha256').update(readFileSync(new URL(`../../public/site/marketing-header.${extension}`, import.meta.url))).digest('hex').slice(0, 16);
  return `<link rel="stylesheet" href="/site/marketing-header.css?v=${version('css')}">\n<script src="/site/marketing-header.js?v=${version('js')}" defer></script>`;
}

export function marketingHeader({ source, product = '', home = false, brand = '', theme = '' } = {}) {
  source ||= readFileSync(new URL('../../public/home-v21/index.html', import.meta.url), 'utf8');
  const groups = products(source);
  const productGroups = groups.map(([label, entries]) => `<div class="home-products-category"><span>${escape(label)}</span>${entries.map(([name, subtitle]) => {
    const word = name.replace(/^XENO\s+/i, '');
    const slug = name === 'XENO 3D Gen' ? '3d' : name === 'XENO 3D' ? 'form' : word.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<a class="home-product-row" href="/product/${slug}"><span><span class="home-product-prefix">XENO </span>${escape(word)}<span class="home-product-arrow" aria-hidden="true">↗</span></span><span>${escape(subtitle)}</span></a>`;
  }).join('')}</div>`).join('');
  const menu = (id, label, content, productMenu = false) => `<div id="home-${id}-menu" data-nav-menu="${id}"${productMenu ? ' data-product-menu="1"' : ''} inert aria-label="${label}"><div class="home-products-card">${content}</div></div>`;
  const trigger = (id, label, productTrigger = false) => `<button type="button" data-nav-trigger="${id}"${productTrigger ? ' data-product-trigger="1"' : ''} aria-controls="home-${id}-menu" aria-expanded="false">${label}${chevron}</button>`;
  const resourceRows = rows => rows.map(([label, href, subtitle]) => `<a class="home-product-row" href="${escape(href)}"><span>${label}<span class="home-product-arrow" aria-hidden="true">↗</span></span><span>${subtitle}</span></a>`).join('');
  const market = '<div class="home-resource-list">'+resourceRows([
    ['Browse Marketplace','/marketplace','Discover apps, models and agents'],
    ['Apps','/marketplace?kind=app-native','Native and sandboxed apps'],
    ['Panels','/marketplace?kind=panel','Composable UI panels'],
    ['Plugins &amp; MCP','/marketplace?kind=plugin','Extend agents and apps'],
    ['Models','/marketplace?kind=model','GGUF and ONNX models'],
    ['Minds &amp; Swarms','/marketplace?kind=mind','Buy, subscribe or rent agents'],
    ['Become a creator','/marketplace?tab=sell','Publish and earn'],
  ])+'</div>';
  // The prior Solutions menu's destinations were all '#'. Link to the real
  // homepage use-case section instead of inventing nonexistent route pages.
  const solutions = '<div class="home-resource-list">'+resourceRows([
    ['Explore solutions','/#uses','Find tools for the work you do'],
    ['Marketing &amp; content','/#uses','Campaigns, video and creative work'],
    ['Design &amp; architecture','/#uses','Products, spaces and 3D'],
    ['Game development','/product/gamedev','Build interactive worlds'],
    ['Developers','/product/developers','Build with the SDK and CLI'],
    ['Business &amp; teams','/#uses','Work together across the suite'],
  ])+'</div>';
  const brandMarkup = brand || `<a class="marketing-brand" href="/" aria-label="XENOsystem home"><img src="/products-v2/assets/xeno-mark.svg" alt=""><span><b>XENO</b>${escape(product || 'system')}</span></a>`;
  return `<header class="marketing-header" data-home-header="1" data-marketing-header="1"${home ? ' data-intro="header"' : ''}>
    <div class="marketing-topbar">${brandMarkup}<nav aria-label="Main navigation">${trigger('products','Products',true)}${trigger('marketplace','Marketplace')}${trigger('solutions','Solutions')}<a href="/docs">Docs</a><a href="/pricing">Pricing</a><a href="/blog">Blog</a><a href="/forum">Forum</a></nav><div class="marketing-actions">${theme}<a class="marketing-workspace" href="/auth">Open workspace</a><a class="marketing-download" href="/download">Download ↓</a><button type="button" class="marketing-mobile-toggle" data-nav-trigger="mobile" aria-controls="home-mobile-menu" aria-expanded="false" aria-label="Open navigation">Menu ${chevron}</button></div></div>
    ${menu('products','Products',`<div class="home-products-list"><div class="home-products-highlight" aria-hidden="true"></div>${productGroups}</div><div class="home-products-featured"><a href="/product/hub"><img src="/products-v2/assets/xeno-mark.svg" alt=""><span><strong>XENO Hub <small>ALL-IN-ONE</small></strong><span>The desktop app that brings every XENO tool together</span></span><b>Explore Hub ↗</b></a></div><div class="home-products-footer"><a href="/products">View all products ↗</a><span>Explore the tools. Find your next workspace.</span></div>`,true)}
    ${menu('marketplace','Marketplace',market)}${menu('solutions','Solutions',solutions)}
    ${menu('mobile','Navigation',`<div class="home-resource-list">${resourceRows([['Products','/products','Explore every app'],['Marketplace','/marketplace','Apps, models and agents'],['Solutions','/#uses','Find your workflow'],['Docs','/docs','Guides and reference'],['Pricing','/pricing','Compare plans'],['Blog','/blog','News and articles'],['Forum','/forum','Join the community'],['Open workspace','/auth','Sign in to your workspace']])}</div>`)}
  </header>`;
}
