#!/usr/bin/env node
/**
 * Generate documentation pages, keyboard shortcut pages, and i18n framework
 * for all XENO products.
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'public', 'products');

// ============================================================================
// Product Definitions
// ============================================================================
const products = [
  {
    slug: 'pixel', name: 'XENO Pixel', category: 'Creative Suite',
    desc: 'Professional image editor with AI-powered tools',
    sections: ['getting-started','layers','brushes','selections','filters','ai-generation','vector-tools','export'],
    shortcuts: [
      { category: 'File', items: [['Ctrl+N','New document'],['Ctrl+O','Open file'],['Ctrl+S','Save'],['Ctrl+Shift+S','Save as'],['Ctrl+E','Export'],['Ctrl+W','Close document']] },
      { category: 'Edit', items: [['Ctrl+Z','Undo'],['Ctrl+Shift+Z','Redo'],['Ctrl+X','Cut'],['Ctrl+C','Copy'],['Ctrl+V','Paste'],['Delete','Delete selection'],['Ctrl+A','Select all'],['Ctrl+D','Deselect']] },
      { category: 'View', items: [['Ctrl++','Zoom in'],['Ctrl+-','Zoom out'],['Ctrl+0','Fit to screen'],['Ctrl+1','Actual size'],['Space+Drag','Pan canvas'],['Tab','Toggle panels']] },
      { category: 'Tools', items: [['B','Brush'],['E','Eraser'],['G','Gradient'],['I','Eyedropper'],['M','Marquee select'],['L','Lasso select'],['W','Magic wand'],['V','Move tool'],['P','Pen tool'],['T','Text tool'],['U','Shape tool'],['S','Clone stamp']] },
      { category: 'Layers', items: [['Ctrl+Shift+N','New layer'],['Ctrl+J','Duplicate layer'],['Ctrl+Shift+E','Merge visible'],['Ctrl+G','Group layers'],['Ctrl+[','Move layer down'],['Ctrl+]','Move layer up']] },
      { category: 'AI', items: [['Ctrl+Shift+G','AI Generate'],['Ctrl+Shift+U','AI Upscale'],['Ctrl+Shift+R','AI Remove background']] },
    ],
  },
  {
    slug: 'motion', name: 'XENO Motion', category: 'Creative Suite',
    desc: 'Professional video editor and compositor',
    sections: ['getting-started','timeline','color-grading','effects','motion-graphics','audio','ai-editing','export'],
    shortcuts: [
      { category: 'Playback', items: [['Space','Play/Pause'],['J','Reverse play'],['K','Stop'],['L','Forward play'],['Left','Previous frame'],['Right','Next frame'],['Home','Go to start'],['End','Go to end']] },
      { category: 'Timeline', items: [['I','Set in point'],['O','Set out point'],['Ctrl+K','Split at playhead'],['Ctrl+Shift+D','Set default duration'],['S','Enable snapping'],['Shift+Drag','Slip edit'],['Alt+Drag','Slide edit']] },
      { category: 'Editing', items: [['Ctrl+Z','Undo'],['Ctrl+Shift+Z','Redo'],['Ctrl+C','Copy'],['Ctrl+V','Paste'],['Delete','Delete clip'],['Ctrl+D','Duplicate clip'],['R','Razor tool'],['V','Selection tool']] },
      { category: 'View', items: [['Ctrl++','Zoom in timeline'],['Ctrl+-','Zoom out timeline'],['\\','Fit timeline to view'],['Ctrl+Shift+F','Fullscreen preview'],['Tab','Toggle panels']] },
      { category: 'Export', items: [['Ctrl+M','Export media'],['Ctrl+Shift+E','Quick export'],['Ctrl+Enter','Add to render queue']] },
    ],
  },
  {
    slug: 'sound', name: 'XENO Sound', category: 'Creative Suite',
    desc: 'Digital audio workstation with AI audio tools',
    sections: ['getting-started','tracks','recording','mixing','effects','mastering','ai-audio','export'],
    shortcuts: [
      { category: 'Transport', items: [['Space','Play/Stop'],['R','Record'],['L','Loop toggle'],['Home','Go to start'],['End','Go to end'],['Left','Rewind'],['Right','Fast forward']] },
      { category: 'Editing', items: [['Ctrl+Z','Undo'],['Ctrl+Shift+Z','Redo'],['Ctrl+X','Cut'],['Ctrl+C','Copy'],['Ctrl+V','Paste'],['Ctrl+A','Select all'],['Delete','Delete selection'],['Ctrl+D','Duplicate']] },
      { category: 'Tracks', items: [['Ctrl+T','New audio track'],['Ctrl+Shift+T','New MIDI track'],['M','Mute track'],['S','Solo track'],['Ctrl+G','Group tracks']] },
      { category: 'Mixer', items: [['Ctrl+M','Toggle mixer'],['Ctrl+E','Toggle EQ'],['Ctrl+Shift+M','Master bus']] },
      { category: 'View', items: [['Ctrl++','Zoom in'],['Ctrl+-','Zoom out'],['Ctrl+0','Fit to window'],['Tab','Toggle panels'],['F11','Fullscreen']] },
    ],
  },
  {
    slug: 'hub', name: 'XENO Hub', category: 'Platform',
    desc: 'Desktop launcher and AI workspace',
    sections: ['getting-started','app-launcher','agents','models','credits','settings','workspaces','updates'],
    shortcuts: [
      { category: 'Navigation', items: [['Ctrl+1','Dashboard'],['Ctrl+2','Apps'],['Ctrl+3','Agent'],['Ctrl+4','Models'],['Ctrl+5','Settings'],['Ctrl+,','Preferences']] },
      { category: 'Agent', items: [['Enter','Send message'],['Shift+Enter','New line'],['Ctrl+L','Clear chat'],['Ctrl+N','New conversation'],['Escape','Cancel generation']] },
      { category: 'General', items: [['Ctrl+Q','Quit'],['Ctrl+R','Reload'],['Ctrl+Shift+I','Developer tools'],['F11','Fullscreen']] },
    ],
  },
  {
    slug: 'agent-cli', name: 'XENO Agent CLI', category: 'Platform',
    desc: 'Terminal AI agent for autonomous operations',
    sections: ['getting-started','installation','configuration','commands','tools','sessions','scripting','api'],
    shortcuts: [
      { category: 'CLI Commands', items: [['xeno','Start interactive session'],['xeno run','Execute single command'],['xeno chat','Start chat mode'],['xeno config','Configuration'],['xeno models','List models'],['xeno status','Show status']] },
      { category: 'Session', items: [['Ctrl+C','Cancel current operation'],['Ctrl+D','Exit session'],['Up/Down','Navigate history'],['Tab','Autocomplete']] },
    ],
  },
  {
    slug: 'form', name: 'XENO Form', category: 'Creative Suite',
    desc: 'AI-native 3D modeling, animation, and rendering',
    sections: ['getting-started','modeling','sculpting','uv-mapping','materials','animation','rendering','export'],
    shortcuts: [
      { category: 'Viewport', items: [['Middle Mouse','Orbit'],['Shift+Middle','Pan'],['Scroll','Zoom'],['Numpad 1','Front view'],['Numpad 3','Side view'],['Numpad 7','Top view'],['Numpad 5','Perspective/Ortho'],['Numpad 0','Camera view']] },
      { category: 'Modeling', items: [['Tab','Edit/Object mode'],['1','Vertex mode'],['2','Edge mode'],['3','Face mode'],['E','Extrude'],['S','Scale'],['R','Rotate'],['G','Grab/Move'],['Ctrl+R','Loop cut'],['I','Inset face'],['K','Knife tool']] },
      { category: 'General', items: [['Ctrl+Z','Undo'],['Ctrl+Shift+Z','Redo'],['X','Delete'],['Ctrl+J','Join objects'],['P','Separate'],['H','Hide'],['Alt+H','Unhide all']] },
    ],
  },
  {
    slug: 'architect', name: 'XENO Architect', category: 'Creative Suite',
    desc: 'AI-native architecture and CAD tool',
    sections: ['getting-started','bim','parametric','drafting-2d','viewport-3d','ai-plans','ifc','export'],
    shortcuts: [
      { category: 'Drawing', items: [['L','Line'],['C','Circle'],['R','Rectangle'],['A','Arc'],['W','Wall'],['D','Door'],['F','Window (Fenster)'],['Ctrl+Shift+D','Dimension']] },
      { category: 'Editing', items: [['Ctrl+Z','Undo'],['Ctrl+Shift+Z','Redo'],['M','Move'],['O','Offset'],['T','Trim'],['X','Extend'],['Ctrl+C','Copy'],['Ctrl+V','Paste']] },
      { category: 'View', items: [['Ctrl+1','2D Plan view'],['Ctrl+2','3D perspective'],['Ctrl+3','Section view'],['Ctrl+4','Elevation view'],['Scroll','Zoom'],['Middle Mouse','Pan']] },
    ],
  },
  {
    slug: 'engine', name: 'XENO Engine', category: 'Creative Suite',
    desc: 'AI-native game engine',
    sections: ['getting-started','ecs','rendering','physics','scripting','visual-scripting','multiplayer','export'],
    shortcuts: [
      { category: 'Editor', items: [['Ctrl+S','Save scene'],['Ctrl+Z','Undo'],['Ctrl+Shift+Z','Redo'],['Ctrl+D','Duplicate entity'],['Delete','Delete entity'],['F','Focus selected'],['Ctrl+P','Play/Stop']] },
      { category: 'Transform', items: [['W','Move tool'],['E','Rotate tool'],['R','Scale tool'],['Q','Select tool'],['Ctrl+Shift+L','Toggle local/global space']] },
      { category: 'View', items: [['Right Mouse+WASD','Fly through scene'],['Scroll','Zoom'],['Middle Mouse','Pan'],['Numpad 5','Perspective/Ortho'],['Alt+1-4','Viewport layouts']] },
      { category: 'Scripting', items: [['Ctrl+Shift+C','Open script editor'],['F5','Compile scripts'],['F9','Toggle breakpoint']] },
    ],
  },
  {
    slug: 'workflow', name: 'XENO Workflow', category: 'Creative Suite',
    desc: 'Visual workflow automation tool',
    sections: ['getting-started','nodes','pipelines','connections','triggers','templates','api','export'],
    shortcuts: [
      { category: 'Canvas', items: [['Space+Drag','Pan canvas'],['Scroll','Zoom'],['Ctrl+A','Select all nodes'],['Delete','Delete selected'],['Ctrl+Z','Undo'],['Ctrl+Shift+Z','Redo']] },
      { category: 'Nodes', items: [['Tab','Add node menu'],['Ctrl+D','Duplicate node'],['Ctrl+G','Group nodes'],['Ctrl+C','Copy nodes'],['Ctrl+V','Paste nodes'],['D','Disable/enable node']] },
      { category: 'Execution', items: [['Ctrl+Enter','Run pipeline'],['Ctrl+.','Stop execution'],['Ctrl+Shift+Enter','Run selected']] },
    ],
  },
  {
    slug: 'lib', name: 'XENO Lib', category: 'Platform',
    desc: 'AI model library with 17 integrated models for image generation, upscaling, segmentation, and more',
    sections: ['getting-started','installation','image-generation','upscaling','segmentation','depth','api-reference','model-formats'],
    shortcuts: null,
  },
];

// ============================================================================
// Generate docs/index.html
// ============================================================================
function titleCase(str) {
  return str.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function generateDocsPage(prod) {
  const sidebarLinks = prod.sections.map(s =>
    `            <a href="#${s}" class="doc-nav-link">${titleCase(s)}</a>`
  ).join('\n');

  const shortcutsLink = prod.slug !== 'lib'
    ? `\n            <a href="/products/${prod.slug}/docs/shortcuts/" class="doc-nav-link">Keyboard Shortcuts</a>`
    : '';

  const contentSections = prod.sections.map((s, i) => `
          <section id="${s}" class="doc-section"${i === 0 ? ' style="border-top:none;padding-top:0"' : ''}>
            <h2>${titleCase(s)}</h2>
            <p>Documentation for ${titleCase(s)} is being prepared. Check back soon or contribute on <a href="https://github.com/XENO-CORPORATION" style="color:rgba(255,255,255,0.6);text-decoration:underline">GitHub</a>.</p>
          </section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${prod.name} Documentation</title>
  <meta name="description" content="Official documentation for ${prod.name}. ${prod.desc}.">
  <meta name="robots" content="index, follow">
  <link rel="icon" type="image/svg+xml" href="/favicon-v2.svg">
  <link rel="canonical" href="https://xenostudio.ai/products/${prod.slug}/docs/">
  <meta property="og:title" content="${prod.name} Documentation">
  <meta property="og:description" content="Official documentation for ${prod.name}. ${prod.desc}.">
  <meta property="og:url" content="https://xenostudio.ai/products/${prod.slug}/docs/">
  <meta property="og:site_name" content="XENO Studio">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://xenostudio.ai/xeno-logo.svg">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:site" content="@xenostudioai">
  <meta name="twitter:title" content="${prod.name} Documentation">
  <meta name="twitter:description" content="Official documentation for ${prod.name}. ${prod.desc}.">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "name": "${prod.name} Documentation",
    "description": "${prod.desc}",
    "url": "https://xenostudio.ai/products/${prod.slug}/docs/",
    "publisher": {
      "@type": "Organization",
      "name": "XENO Corporation",
      "url": "https://xenostudio.ai"
    }
  }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #08080a; color: rgba(255,255,255,0.85); font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }
    code { font-family: 'JetBrains Mono', monospace; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 3px; font-size: 13px; }
    pre { background: #0b0b0d; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 16px; overflow-x: auto; margin: 16px 0; }
    pre code { background: none; padding: 0; }
    .doc-layout { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
    .doc-sidebar { position: fixed; top: 0; left: 0; width: 240px; height: 100vh; overflow-y: auto; border-right: 1px solid rgba(255,255,255,0.06); padding: 20px 0; background: #08080a; z-index: 40; }
    .doc-sidebar-header { padding: 0 20px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
    .doc-sidebar-header img { width: 20px; height: 20px; border-radius: 4px; filter: invert(1); }
    .doc-sidebar-header span { font-size: 14px; font-weight: 600; }
    .doc-nav-group { padding: 0 12px; margin-bottom: 16px; }
    .doc-nav-label { font-size: 11px; color: rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 1.5px; padding: 8px; margin-bottom: 4px; }
    .doc-nav-link { display: block; padding: 6px 8px; font-size: 13px; color: rgba(255,255,255,0.5); border-radius: 4px; transition: all 0.15s; }
    .doc-nav-link:hover { color: rgba(255,255,255,0.8); background: rgba(255,255,255,0.03); }
    .doc-nav-link.active { color: white; background: rgba(255,255,255,0.06); }
    .doc-content { grid-column: 2; padding: 40px 60px 120px; max-width: 860px; }
    .doc-breadcrumb { font-size: 13px; color: rgba(255,255,255,0.3); margin-bottom: 32px; }
    .doc-breadcrumb a { color: rgba(255,255,255,0.4); }
    .doc-breadcrumb a:hover { color: rgba(255,255,255,0.7); }
    .doc-content h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 12px; }
    .doc-content .subtitle { font-size: 16px; color: rgba(255,255,255,0.45); line-height: 1.6; margin-bottom: 40px; }
    .doc-section { margin-bottom: 48px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.06); }
    .doc-section h2 { font-size: 22px; font-weight: 600; margin-bottom: 12px; }
    .doc-section p { font-size: 15px; color: rgba(255,255,255,0.5); line-height: 1.7; margin-bottom: 16px; }
    .doc-search { margin: 0 12px 16px; }
    .doc-search input { width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: white; font-size: 13px; outline: none; }
    .doc-search input::placeholder { color: rgba(255,255,255,0.25); }
    .doc-search input:focus { border-color: rgba(255,255,255,0.15); }
    @media (max-width: 768px) {
      .doc-layout { grid-template-columns: 1fr; }
      .doc-sidebar { display: none; }
      .doc-content { padding: 24px 20px 80px; }
    }
  </style>
</head>
<body>
  <div class="doc-layout">
    <aside class="doc-sidebar">
      <div class="doc-sidebar-header">
        <a href="/"><img src="/xeno-logo.svg" alt="XENO"></a>
        <a href="/products/${prod.slug}/"><span>${prod.name}</span></a>
      </div>
      <div class="doc-search">
        <input type="text" placeholder="Search docs..." id="doc-search">
      </div>
      <nav class="doc-nav-group">
        <div class="doc-nav-label">Documentation</div>
${sidebarLinks}${shortcutsLink}
      </nav>
      <nav class="doc-nav-group">
        <div class="doc-nav-label">Resources</div>
        <a href="/products/${prod.slug}/" class="doc-nav-link">Product Page</a>
        <a href="/products/${prod.slug}/release-notes/" class="doc-nav-link">Release Notes</a>
        <a href="/api/docs/" class="doc-nav-link">API Reference</a>
        <a href="https://github.com/XENO-CORPORATION" class="doc-nav-link">GitHub</a>
        <a href="https://discord.gg/xenostudio" class="doc-nav-link">Community</a>
      </nav>
    </aside>

    <main class="doc-content">
      <div class="doc-breadcrumb">
        <a href="/">XENO</a> / <a href="/products/">Products</a> / <a href="/products/${prod.slug}/">${prod.name}</a> / Docs
      </div>
      <h1>${prod.name} Documentation</h1>
      <p class="subtitle">${prod.desc}. Learn how to get started, explore features, and build your workflow.</p>
${contentSections}
    </main>
  </div>

  <script>
    var sections = document.querySelectorAll('.doc-section');
    var links = document.querySelectorAll('.doc-nav-link');
    function updateActive() {
      var scrollPos = window.scrollY + 100;
      sections.forEach(function(section) {
        if (section.offsetTop <= scrollPos && section.offsetTop + section.offsetHeight > scrollPos) {
          links.forEach(function(link) { link.classList.remove('active'); });
          var activeLink = document.querySelector('.doc-nav-link[href="#' + section.id + '"]');
          if (activeLink) activeLink.classList.add('active');
        }
      });
    }
    window.addEventListener('scroll', updateActive);
    updateActive();
    document.getElementById('doc-search').addEventListener('input', function(e) {
      var query = e.target.value.toLowerCase();
      sections.forEach(function(section) {
        section.style.display = !query || section.textContent.toLowerCase().includes(query) ? 'block' : 'none';
      });
    });
  </script>
</body>
</html>`;
}

// ============================================================================
// Generate keyboard shortcuts pages
// ============================================================================
function generateShortcutsPage(prod) {
  if (!prod.shortcuts) return null;

  const shortcutSections = prod.shortcuts.map(cat => {
    const rows = cat.items.map(([key, action]) => {
      const keys = key.split('+').map(k => `<kbd>${k}</kbd>`).join(' + ');
      return `              <tr><td class="shortcut-keys">${keys}</td><td class="shortcut-action">${action}</td></tr>`;
    }).join('\n');
    return `
          <div class="shortcut-group">
            <h2>${cat.category}</h2>
            <table class="shortcut-table">
              <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
              <tbody>
${rows}
              </tbody>
            </table>
          </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${prod.name} Keyboard Shortcuts</title>
  <meta name="description" content="Complete keyboard shortcut reference for ${prod.name}. Learn all hotkeys and key bindings.">
  <meta name="robots" content="index, follow">
  <link rel="icon" type="image/svg+xml" href="/favicon-v2.svg">
  <link rel="canonical" href="https://xenostudio.ai/products/${prod.slug}/docs/shortcuts/">
  <meta property="og:title" content="${prod.name} Keyboard Shortcuts">
  <meta property="og:description" content="Complete keyboard shortcut reference for ${prod.name}.">
  <meta property="og:url" content="https://xenostudio.ai/products/${prod.slug}/docs/shortcuts/">
  <meta property="og:site_name" content="XENO Studio">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:site" content="@xenostudioai">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "name": "${prod.name} Keyboard Shortcuts",
    "description": "Complete keyboard shortcut reference for ${prod.name}",
    "url": "https://xenostudio.ai/products/${prod.slug}/docs/shortcuts/"
  }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #08080a; color: rgba(255,255,255,0.85); font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }
    .container { max-width: 900px; margin: 0 auto; padding: 0 24px; }
    header { position: fixed; top: 0; left: 0; right: 0; z-index: 50; background: rgba(255,255,255,0.02); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.08); }
    header > div { display: flex; align-items: center; justify-content: space-between; padding: 4px 24px; }
    header img { width: 24px; height: 24px; border-radius: 6px; filter: invert(1); }
    header nav { display: flex; gap: 4px; position: absolute; left: 50%; transform: translateX(-50%); }
    header nav a { padding: 8px 14px; font-size: 13px; color: rgba(255,255,255,0.5); }
    .breadcrumb { font-size: 13px; color: rgba(255,255,255,0.3); margin-bottom: 32px; padding-top: 100px; }
    .breadcrumb a { color: rgba(255,255,255,0.4); }
    .breadcrumb a:hover { color: rgba(255,255,255,0.7); }
    h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 8px; }
    .subtitle { font-size: 15px; color: rgba(255,255,255,0.45); margin-bottom: 40px; }
    .search-bar { margin-bottom: 32px; }
    .search-bar input { width: 100%; max-width: 400px; padding: 10px 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: white; font-size: 14px; outline: none; }
    .search-bar input::placeholder { color: rgba(255,255,255,0.25); }
    .search-bar input:focus { border-color: rgba(255,255,255,0.15); }
    .shortcut-group { margin-bottom: 40px; }
    .shortcut-group h2 { font-size: 18px; font-weight: 600; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .shortcut-table { width: 100%; border-collapse: collapse; }
    .shortcut-table th { text-align: left; font-size: 12px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; }
    .shortcut-table td { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .shortcut-keys { width: 200px; }
    .shortcut-action { font-size: 14px; color: rgba(255,255,255,0.55); }
    kbd { display: inline-block; padding: 3px 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10); border-radius: 4px; color: rgba(255,255,255,0.8); min-width: 24px; text-align: center; }
    .back-link { display: inline-block; margin-top: 40px; padding: 10px 20px; font-size: 14px; color: rgba(255,255,255,0.5); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; }
    .back-link:hover { color: rgba(255,255,255,0.8); border-color: rgba(255,255,255,0.2); }
    @media (max-width: 768px) {
      .container { padding: 0 16px; }
      .shortcut-keys { width: 140px; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <a href="/"><img src="/xeno-logo.svg" alt="Xeno"></a>
      <nav>
        <a href="/products/${prod.slug}/">${prod.name}</a>
        <a href="/products/${prod.slug}/docs/">Docs</a>
        <a href="/products/${prod.slug}/release-notes/">Release Notes</a>
        <a href="/products/">All Products</a>
      </nav>
      <div style="display:flex;gap:8px">
        <a href="/login" style="padding:8px 14px;font-size:13px;color:rgba(255,255,255,0.6)">SIGN IN</a>
        <a href="/download" style="padding:8px 16px;background:white;color:#08080a;font-size:13px;font-weight:600;border-radius:6px">DOWNLOAD</a>
      </div>
    </div>
  </header>

  <main style="padding-bottom:120px">
    <div class="container">
      <div class="breadcrumb">
        <a href="/">XENO</a> / <a href="/products/">Products</a> / <a href="/products/${prod.slug}/">${prod.name}</a> / <a href="/products/${prod.slug}/docs/">Docs</a> / Shortcuts
      </div>
      <h1>Keyboard Shortcuts</h1>
      <p class="subtitle">Complete keyboard shortcut reference for ${prod.name}.</p>

      <div class="search-bar">
        <input type="text" placeholder="Search shortcuts..." id="shortcut-search">
      </div>
${shortcutSections}
      <a href="/products/${prod.slug}/docs/" class="back-link">Back to Documentation</a>
    </div>
  </main>

  <script>
    document.getElementById('shortcut-search').addEventListener('input', function(e) {
      var query = e.target.value.toLowerCase();
      document.querySelectorAll('.shortcut-table tbody tr').forEach(function(row) {
        var text = row.textContent.toLowerCase();
        row.style.display = !query || text.includes(query) ? '' : 'none';
      });
      document.querySelectorAll('.shortcut-group').forEach(function(group) {
        var visibleRows = group.querySelectorAll('tbody tr:not([style*="display: none"])');
        group.style.display = !query || visibleRows.length > 0 ? '' : 'none';
      });
    });
  </script>
</body>
</html>`;
}

// ============================================================================
// Write all files
// ============================================================================
products.forEach(prod => {
  // Docs page
  const docsDir = path.join(BASE, prod.slug, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'index.html'), generateDocsPage(prod));
  console.log(`Created: ${prod.slug}/docs/index.html`);

  // Shortcuts page
  if (prod.shortcuts) {
    const shortcutsDir = path.join(docsDir, 'shortcuts');
    fs.mkdirSync(shortcutsDir, { recursive: true });
    fs.writeFileSync(path.join(shortcutsDir, 'index.html'), generateShortcutsPage(prod));
    console.log(`Created: ${prod.slug}/docs/shortcuts/index.html`);
  }
});

console.log('\nAll documentation and shortcut pages generated.');
