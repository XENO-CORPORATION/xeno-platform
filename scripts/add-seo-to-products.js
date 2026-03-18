#!/usr/bin/env node
/**
 * Add SEO meta tags, Open Graph, Twitter Cards, structured data,
 * canonical URLs, and i18n/language switcher to all product pages.
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'public', 'products');

const seoData = {
  'pixel': {
    title: 'XENO Pixel — Professional Image Editor',
    description: 'XENO Pixel is a professional image editor with layers, brushes, masks, filters, AI generation, and vector tools. Free and open source.',
    keywords: 'image editor, photo editor, pixel editor, AI image editor, free photoshop alternative, layer editor, brush engine, digital art, open source image editor',
    type: 'SoftwareApplication',
    category: 'MultimediaApplication',
    os: 'Windows 10+',
    price: '0',
  },
  'motion': {
    title: 'XENO Motion — Professional Video Editor',
    description: 'XENO Motion is a professional video editor with timeline editing, effects, color grading, motion graphics, and AI-powered tools.',
    keywords: 'video editor, free video editor, AI video editor, timeline editor, color grading, motion graphics, premiere alternative, open source video editor',
    type: 'SoftwareApplication',
    category: 'MultimediaApplication',
    os: 'Windows 10+',
    price: '0',
  },
  'sound': {
    title: 'XENO Sound — Digital Audio Workstation',
    description: 'XENO Sound is a professional DAW with multi-track recording, mixing, mastering, effects, and AI audio tools.',
    keywords: 'DAW, digital audio workstation, music production, audio editor, free DAW, AI audio, mixing, mastering, recording software, open source DAW',
    type: 'SoftwareApplication',
    category: 'MultimediaApplication',
    os: 'Windows 10+',
    price: '0',
  },
  'hub': {
    title: 'XENO Hub — Desktop Launcher & AI Workspace',
    description: 'XENO Hub is the desktop launcher for the XENO ecosystem. Manage apps, agents, models, credits, and settings.',
    keywords: 'XENO Hub, desktop launcher, AI workspace, creative suite launcher, app manager, AI agent, model manager',
    type: 'SoftwareApplication',
    category: 'UtilitiesApplication',
    os: 'Windows 10+',
    price: '0',
  },
  'agent-cli': {
    title: 'XENO Agent CLI — Terminal AI Agent',
    description: 'XENO Agent CLI is an autonomous terminal AI agent for coding, file management, and system operations.',
    keywords: 'AI agent, terminal agent, CLI agent, autonomous coding, AI coding assistant, command line AI, Claude Code alternative',
    type: 'SoftwareApplication',
    category: 'DeveloperApplication',
    os: 'Windows, macOS, Linux',
    price: '0',
  },
  '3d': {
    title: 'XENO 3D — AI-Native 3D Modeling, Animation & Rendering',
    description: 'XENO 3D is an AI-native 3D suite with polygon modeling, sculpting, UV mapping, PBR materials, animation, path tracing, and procedural generation.',
    keywords: '3D modeling, 3D animation, 3D rendering, sculpting, PBR materials, path tracing, blender alternative, free 3D software, AI 3D',
    type: 'SoftwareApplication',
    category: 'MultimediaApplication',
    os: 'Windows 10+',
    price: '0',
  },
  'architect': {
    title: 'XENO Architect — AI-Native Architecture & CAD',
    description: 'XENO Architect is an AI-native architecture and CAD tool with BIM, parametric design, 2D drafting, 3D viewport, AI floor plans, and IFC support.',
    keywords: 'architecture software, CAD software, BIM, parametric design, floor plans, IFC, 2D drafting, AI architecture, free CAD',
    type: 'SoftwareApplication',
    category: 'BusinessApplication',
    os: 'Windows 10+',
    price: '0',
  },
  'engine': {
    title: 'XENO Engine — AI-Native Game Engine',
    description: 'XENO Engine is an AI-native game engine with ECS architecture, real-time PBR rendering, physics, TypeScript scripting, multiplayer, and cross-platform export.',
    keywords: 'game engine, ECS, PBR rendering, physics engine, game development, visual scripting, multiplayer, free game engine, AI game engine',
    type: 'SoftwareApplication',
    category: 'DeveloperApplication',
    os: 'Windows 10+',
    price: '0',
  },
  'workflow': {
    title: 'XENO Workflow — Visual Workflow Automation',
    description: 'XENO Workflow is an AI-native visual workflow automation tool. Build pipelines connecting all XENO apps and external services with a node-based editor.',
    keywords: 'workflow automation, node editor, visual programming, pipeline automation, AI workflows, integration tool, automation platform',
    type: 'SoftwareApplication',
    category: 'BusinessApplication',
    os: 'Windows 10+',
    price: '0',
  },
  'lib': {
    title: 'XENO Lib — AI Model Library',
    description: 'XENO Lib provides 17 AI models for image generation, upscaling, segmentation, depth estimation, and more. Built in Rust with ONNX and CUDA.',
    keywords: 'AI models, ONNX, CUDA, image generation, upscaling, segmentation, depth estimation, Rust AI, machine learning library',
    type: 'SoftwareSourceCode',
    category: 'DeveloperApplication',
    os: 'Windows, Linux',
    price: '0',
  },
};

// Also update the products index page
const productIndexSeo = `  <link rel="canonical" href="https://xenostudio.ai/products/">
  <meta name="keywords" content="XENO, creative suite, AI tools, image editor, video editor, DAW, game engine, 3D modeling, architecture, workflow automation">
  <meta property="og:title" content="All Products — XENO Studio">
  <meta property="og:description" content="The complete XENO creative suite. Professional tools for image editing, video production, audio engineering, and AI-powered workflows.">
  <meta property="og:url" content="https://xenostudio.ai/products/">
  <meta property="og:site_name" content="XENO Studio">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://xenostudio.ai/xeno-logo.svg">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:site" content="@xenostudioai">
  <meta name="twitter:title" content="All Products — XENO Studio">
  <meta name="twitter:description" content="The complete XENO creative suite. Professional tools for image editing, video production, audio engineering, and AI-powered workflows.">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "XENO Products",
    "description": "The complete XENO creative suite",
    "url": "https://xenostudio.ai/products/",
    "publisher": {
      "@type": "Organization",
      "name": "XENO Corporation",
      "url": "https://xenostudio.ai",
      "logo": "https://xenostudio.ai/xeno-logo.svg"
    }
  }
  </script>`;

Object.entries(seoData).forEach(([slug, seo]) => {
  const filePath = path.join(BASE, slug, 'index.html');
  let html = fs.readFileSync(filePath, 'utf-8');

  // Build the SEO meta block to insert after existing meta description
  const seoBlock = `  <link rel="canonical" href="https://xenostudio.ai/products/${slug}/">
  <meta name="keywords" content="${seo.keywords}">
  <meta property="og:title" content="${seo.title}">
  <meta property="og:description" content="${seo.description}">
  <meta property="og:url" content="https://xenostudio.ai/products/${slug}/">
  <meta property="og:site_name" content="XENO Studio">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://xenostudio.ai/xeno-logo.svg">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:site" content="@xenostudioai">
  <meta name="twitter:title" content="${seo.title}">
  <meta name="twitter:description" content="${seo.description}">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "${seo.type}",
    "name": "${seo.title.split(' — ')[0]}",
    "description": "${seo.description}",
    "url": "https://xenostudio.ai/products/${slug}/",
    "applicationCategory": "${seo.category}",
    "operatingSystem": "${seo.os}",
    "offers": {
      "@type": "Offer",
      "price": "${seo.price}",
      "priceCurrency": "USD"
    },
    "publisher": {
      "@type": "Organization",
      "name": "XENO Corporation",
      "url": "https://xenostudio.ai"
    }
  }
  </script>`;

  // Insert after the <link rel="icon"...> line
  const iconLine = '<link rel="icon" type="image/svg+xml" href="/favicon-v2.svg">';
  if (html.includes(iconLine) && !html.includes('og:title')) {
    html = html.replace(iconLine, iconLine + '\n' + seoBlock);

    // Also add a docs link in the nav area and i18n switcher + script in the footer area
    // Add docs link to nav
    const productsLink = `<a href="/products/" style="padding:8px 14px;font-size:13px;color:rgba(255,255,255,0.9)">Products</a>`;
    if (html.includes(productsLink)) {
      html = html.replace(productsLink,
        `<a href="/products/${slug}/docs/" style="padding:8px 14px;font-size:13px;color:rgba(255,255,255,0.5)">Docs</a>\n        ` + productsLink);
    }

    // Add i18n switcher before the footer copyright line
    const copyrightLine = `<p style="font-size:12px;color:rgba(255,255,255,0.15)">All systems operational</p>`;
    if (html.includes(copyrightLine)) {
      html = html.replace(copyrightLine,
        `<span id="xeno-i18n-switcher"></span>\n        ` + copyrightLine);
    }

    // Add i18n script before closing </body>
    html = html.replace('</body>', '  <script src="/i18n/i18n.js"></script>\n</body>');

    fs.writeFileSync(filePath, html);
    console.log(`Updated SEO for: ${slug}`);
  } else if (html.includes('og:title')) {
    console.log(`Skipped (already has OG tags): ${slug}`);
  } else {
    console.log(`WARNING: Could not find icon line in: ${slug}`);
  }
});

// Update products index page
const indexPath = path.join(BASE, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf-8');
const iconLine = '<link rel="icon" type="image/svg+xml" href="/favicon-v2.svg">';
if (indexHtml.includes(iconLine) && !indexHtml.includes('og:title')) {
  indexHtml = indexHtml.replace(iconLine, iconLine + '\n' + productIndexSeo);

  // Add i18n switcher
  const copyrightLine = `<p style="font-size:12px;color:rgba(255,255,255,0.15)">All systems operational</p>`;
  if (indexHtml.includes(copyrightLine)) {
    indexHtml = indexHtml.replace(copyrightLine,
      `<span id="xeno-i18n-switcher"></span>\n        ` + copyrightLine);
  }
  indexHtml = indexHtml.replace('</body>', '  <script src="/i18n/i18n.js"></script>\n</body>');

  fs.writeFileSync(indexPath, indexHtml);
  console.log('Updated SEO for: products/index.html');
}

console.log('\nSEO updates complete.');
