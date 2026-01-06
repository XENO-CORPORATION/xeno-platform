import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import puppeteer from 'puppeteer-core';

const execAsync = promisify(exec);
const router = express.Router();

// Browser service configuration
const BROWSER_HOST = process.env.BROWSER_HOST || 'xenolabs-xeno-browser';
const BROWSER_PORT = process.env.BROWSER_PORT || '6901';
const BROWSER_PASSWORD = process.env.BROWSER_PASSWORD || 'xenobrowser123';

// Browserless configuration
const BROWSERLESS_URL = process.env.BROWSERLESS_URL || 'http://localhost:3003';
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || 'xeno_browser_token_2024';

// Google Custom Search API configuration (for real Google results)
// Get these from: https://programmablesearchengine.google.com/ and https://console.cloud.google.com/
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX || '';

/**
 * Fetch search results using Google Custom Search JSON API
 * Returns real Google results without CAPTCHA issues
 */
async function googleCustomSearch(query, start = 1) {
  if (!GOOGLE_API_KEY || !GOOGLE_SEARCH_CX) {
    console.log('[Browser Proxy] Google Custom Search API not configured');
    return null;
  }

  try {
    const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(query)}&start=${start}&num=10`;
    console.log(`[Browser Proxy] Calling Google Custom Search API for: ${query}`);

    const response = await fetch(apiUrl);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Browser Proxy] Google API error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[Browser Proxy] Google Custom Search error:', error.message);
    return null;
  }
}

/**
 * Render Google Custom Search results as HTML
 */
function renderGoogleSearchResults(query, results, proxyBase) {
  const items = results.items || [];
  const searchInfo = results.searchInformation || {};

  const resultsHtml = items.map(item => {
    const displayUrl = item.displayLink || new URL(item.link).hostname;
    const proxiedLink = `${proxyBase}${encodeURIComponent(item.link)}`;

    return `
      <div class="result">
        <div class="url-breadcrumb">
          <cite>${displayUrl}</cite>
        </div>
        <h3><a href="${proxiedLink}">${item.title}</a></h3>
        <p class="snippet">${item.snippet || ''}</p>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${query} - Google Search</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: arial, sans-serif;
      background: #202124;
      color: #bdc1c6;
      min-height: 100vh;
    }
    .header {
      background: #202124;
      padding: 20px;
      border-bottom: 1px solid #3c4043;
      position: sticky;
      top: 0;
    }
    .search-box {
      display: flex;
      align-items: center;
      max-width: 690px;
      margin: 0 auto;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      margin-right: 30px;
    }
    .logo span:nth-child(1) { color: #4285f4; }
    .logo span:nth-child(2) { color: #ea4335; }
    .logo span:nth-child(3) { color: #fbbc05; }
    .logo span:nth-child(4) { color: #4285f4; }
    .logo span:nth-child(5) { color: #34a853; }
    .logo span:nth-child(6) { color: #ea4335; }
    .search-input-container {
      flex: 1;
      position: relative;
    }
    .search-input {
      width: 100%;
      padding: 12px 50px 12px 20px;
      font-size: 16px;
      border: 1px solid #5f6368;
      border-radius: 24px;
      background: #303134;
      color: #e8eaed;
      outline: none;
    }
    .search-input:focus {
      border-color: #8ab4f8;
      background: #202124;
    }
    .search-btn {
      position: absolute;
      right: 15px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      color: #8ab4f8;
      font-size: 18px;
    }
    .results-container {
      max-width: 690px;
      margin: 0 auto;
      padding: 20px;
    }
    .search-info {
      color: #9aa0a6;
      font-size: 14px;
      margin-bottom: 20px;
    }
    .result {
      margin-bottom: 30px;
    }
    .url-breadcrumb {
      margin-bottom: 4px;
    }
    .url-breadcrumb cite {
      color: #bdc1c6;
      font-size: 14px;
      font-style: normal;
    }
    .result h3 {
      margin-bottom: 8px;
    }
    .result h3 a {
      color: #8ab4f8;
      text-decoration: none;
      font-size: 20px;
      font-weight: normal;
    }
    .result h3 a:hover {
      text-decoration: underline;
    }
    .snippet {
      color: #bdc1c6;
      font-size: 14px;
      line-height: 1.58;
    }
    .no-results {
      text-align: center;
      padding: 60px 20px;
      color: #9aa0a6;
    }
    .powered-by {
      text-align: center;
      padding: 20px;
      color: #5f6368;
      font-size: 12px;
      border-top: 1px solid #3c4043;
      margin-top: 40px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="search-box">
      <div class="logo">
        <span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span>
      </div>
      <div class="search-input-container">
        <form action="/api/browser/proxy" method="GET" id="searchForm">
          <input type="hidden" name="url" id="searchUrl" value="">
          <input type="text" class="search-input" id="searchQuery" value="${query.replace(/"/g, '&quot;')}" placeholder="Search Google">
          <button type="submit" class="search-btn">🔍</button>
        </form>
      </div>
    </div>
  </div>

  <div class="results-container">
    <div class="search-info">
      About ${searchInfo.formattedTotalResults || items.length} results (${searchInfo.formattedSearchTime || '0.5'} seconds)
    </div>

    ${items.length > 0 ? resultsHtml : '<div class="no-results"><h2>No results found</h2><p>Try different keywords</p></div>'}

    <div class="powered-by">
      Powered by Google Custom Search API
    </div>
  </div>

  <script>
    // Handle search form submission
    document.getElementById('searchForm').addEventListener('submit', function(e) {
      e.preventDefault();
      const query = document.getElementById('searchQuery').value.trim();
      if (query) {
        const googleUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
        document.getElementById('searchUrl').value = googleUrl;
        // Navigate through proxy
        window.location.href = '/api/browser/proxy?url=' + encodeURIComponent(googleUrl);
      }
    });

    // Notify parent of page load
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'xeno-browser-navigation',
        url: 'https://www.google.com/search?q=${encodeURIComponent(query)}',
        action: 'load',
        title: document.title
      }, '*');
    }
  </script>
</body>
</html>`;
}

/**
 * Get a Puppeteer browser instance connected to Browserless
 */
async function getBrowserlessConnection() {
  const browserWSEndpoint = `${BROWSERLESS_URL.replace('http', 'ws')}?token=${BROWSERLESS_TOKEN}`;
  return await puppeteer.connect({
    browserWSEndpoint,
    defaultViewport: { width: 1920, height: 1080 }
  });
}

/**
 * GET /api/browser/proxy
 * Proxy any URL and strip iframe-blocking headers
 * Rewrites all URLs to go through our proxy to avoid CORS issues
 */
router.get('/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL query parameter is required' });
  }

  // Fix malformed URLs where the target is itself a proxy URL with wrong origin
  // e.g., https://www.google.com/api/browser/proxy?url=https://www.google.com
  let actualUrl = url;
  if (url.includes('/api/browser/proxy')) {
    // Extract the actual target URL from the malformed proxy URL
    const match = url.match(/[?&]url=([^&]+)/);
    if (match) {
      actualUrl = decodeURIComponent(match[1]);
      console.log(`[Browser Proxy] Fixed malformed URL: ${url} -> ${actualUrl}`);
    }
  }

  // Handle Google/Bing redirect URLs - extract actual destination
  // e.g., https://www.google.com/url?q=https://actual-site.com&sa=...
  try {
    const parsedUrl = new URL(actualUrl);
    if (parsedUrl.pathname === '/url' && (parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('url'))) {
      const redirectTarget = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('url');
      if (redirectTarget && redirectTarget.startsWith('http')) {
        console.log(`[Browser Proxy] Extracted Google redirect: ${actualUrl} -> ${redirectTarget}`);
        actualUrl = redirectTarget;
      }
    }

    // Strip "I'm Feeling Lucky" parameter from Google search URLs to prevent auto-redirect
    if (parsedUrl.hostname.includes('google') && parsedUrl.pathname === '/search') {
      if (parsedUrl.searchParams.has('btnI')) {
        parsedUrl.searchParams.delete('btnI');
        parsedUrl.searchParams.delete('btnG');
        actualUrl = parsedUrl.toString();
        console.log(`[Browser Proxy] Stripped btnI parameter to show search results`);
      }
    }
  } catch (e) {
    // Ignore parse errors
  }

  // Validate URL
  let targetUrl;
  try {
    targetUrl = new URL(actualUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Skip tracking/analytics/logging endpoints - return empty success
  const urlLowerCheck = actualUrl.toLowerCase();
  if (urlLowerCheck.includes('/gen_204') ||
      urlLowerCheck.includes('$rpc') ||
      urlLowerCheck.includes('play.google.com/log') ||
      urlLowerCheck.includes('ogads-pa.clients6.google.com') ||
      urlLowerCheck.includes('clients6.google.com') ||
      urlLowerCheck.includes('/log?format=json')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(204).send('');
  }

  console.log(`[Browser Proxy] Fetching: ${actualUrl}`);

  // Get the proxy origin from the request (for use in injected script)
  // Check X-Forwarded-Proto header for reverse proxy setups, default to https in production
  const forwardedProto = req.get('X-Forwarded-Proto');
  const host = req.get('host') || req.headers.host || 'localhost:8080';
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
  const protocol = forwardedProto || (isLocalhost ? 'http' : 'https');
  const proxyOriginForScript = `${protocol}://${host}`;
  console.log(`[Browser Proxy] Proxy origin for script: ${proxyOriginForScript}`);

  try {
    // Build headers - add CONSENT cookie for Google to bypass consent page
    const isGoogle = targetUrl.hostname.includes('google');
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': targetUrl.origin,
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    // Add cookies for Google to bypass consent and get proper JS
    if (isGoogle || targetUrl.hostname.includes('gstatic')) {
      headers['Cookie'] = 'CONSENT=YES+cb; SOCS=CAISHAgBEhJnd3NfMjAyNDA4MjgtMF9SQzEaAmVuIAEaBgiA_LyYBg; NID=511=test';
      // Force English to avoid consent redirects
      if (actualUrl.includes('/search') && !actualUrl.includes('hl=')) {
        actualUrl = actualUrl + (actualUrl.includes('?') ? '&' : '?') + 'hl=en';
      }
      console.log(`[Browser Proxy] Google request with cookies, URL: ${actualUrl}`);
    }

    const response = await fetch(actualUrl, {
      headers,
      redirect: 'follow',
    });

    // Get content type
    const contentType = response.headers.get('content-type') || 'text/html';

    const baseOrigin = targetUrl.origin;
    const basePath = targetUrl.pathname.substring(0, targetUrl.pathname.lastIndexOf('/') + 1);
    const proxyBase = '/api/browser/proxy?url=';

    // Store response text for potential reuse
    let cachedResponseText = null;

    // Check if Google returned a challenge/captcha page
    if (isGoogle && contentType.includes('text/html') && actualUrl.includes('/search')) {
      cachedResponseText = await response.text();
      if (cachedResponseText.includes('solveSimpleChallenge') || cachedResponseText.includes('/httpservice/retry/enablejs')) {
        console.log('[Browser Proxy] Google challenge detected');
        // Extract search query
        const searchMatch = actualUrl.match(/[?&]q=([^&]+)/);
        if (searchMatch) {
          const query = decodeURIComponent(searchMatch[1].replace(/\+/g, ' '));

          // Try Google Custom Search API first (gives real Google results)
          const searchResults = await googleCustomSearch(query);
          if (searchResults && searchResults.items && searchResults.items.length > 0) {
            console.log(`[Browser Proxy] Returning ${searchResults.items.length} results from Google Custom Search API`);
            const resultsHtml = renderGoogleSearchResults(query, searchResults, proxyBase);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(resultsHtml);
          }

          // Fallback to DuckDuckGo (better than Startpage, no CSP issues)
          console.log('[Browser Proxy] Google API not configured, using DuckDuckGo fallback');
          const duckduckgoUrl = `https://duckduckgo.com/?q=${searchMatch[1]}`;
          const redirectUrl = `/api/browser/proxy?url=${encodeURIComponent(duckduckgoUrl)}`;
          res.setHeader('Location', redirectUrl);
          return res.status(302).send(`Redirecting to DuckDuckGo for search results...`);
        }
      }
    }

    // Helper to convert URL to proxied URL
    const proxyUrl = (href) => {
      if (!href || href.startsWith('data:') || href.startsWith('javascript:') || href.startsWith('#')) {
        return href;
      }
      try {
        let absoluteUrl;
        if (href.startsWith('//')) {
          absoluteUrl = targetUrl.protocol + href;
        } else if (href.startsWith('/')) {
          absoluteUrl = baseOrigin + href;
        } else if (href.startsWith('http://') || href.startsWith('https://')) {
          absoluteUrl = href;
        } else {
          absoluteUrl = baseOrigin + basePath + href;
        }
        return proxyBase + encodeURIComponent(absoluteUrl);
      } catch {
        return href;
      }
    };

    // For HTML content, rewrite URLs
    if (contentType.includes('text/html')) {
      // Use cached text if we already read it (for Google challenge detection)
      let html = cachedResponseText || await response.text();

      // Remove CSP meta tags that could block our injected script
      html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '<!-- CSP removed by proxy -->');
      html = html.replace(/<meta[^>]*content-security-policy[^>]*>/gi, '<!-- CSP removed by proxy -->');

      // Remove <base> tags that could change how URLs are resolved
      html = html.replace(/<base[^>]*>/gi, '<!-- base tag removed by proxy -->');

      // Remove nonce requirements from script tags (Google uses nonces)
      html = html.replace(/\s+nonce\s*=\s*["'][^"']*["']/gi, '');

      // Remove crossorigin attributes from images (they trigger CORS checks that fail through proxy)
      html = html.replace(/\s+crossorigin\s*=\s*["'][^"']*["']/gi, '');
      html = html.replace(/\s+crossorigin(?=[\s>])/gi, '');

      // Remove integrity attributes (hash checks fail when content is modified by proxy)
      html = html.replace(/\s+integrity\s*=\s*["'][^"']*["']/gi, '');

      // Rewrite src attributes (scripts, images, iframes)
      // Fixed regex to not require space before src (handles <script src="...">)
      html = html.replace(/(<(?:script|img|iframe|source|video|audio|embed)(?:\s[^>]*)?)(\s)src\s*=\s*["']([^"']+)["']/gi, (match, prefix, space, src) => {
        return `${prefix}${space}src="${proxyUrl(src)}"`;
      });
      // Also handle case where src is the first attribute (no space before it)
      html = html.replace(/(<(?:script|img|iframe|source|video|audio|embed))\s+src\s*=\s*["']([^"']+)["']/gi, (match, tag, src) => {
        return `${tag} src="${proxyUrl(src)}"`;
      });

      // Rewrite href attributes for links and stylesheets
      html = html.replace(/(<link(?:\s[^>]*)?)(\s)href\s*=\s*["']([^"']+)["']/gi, (match, prefix, space, href) => {
        return `${prefix}${space}href="${proxyUrl(href)}"`;
      });
      html = html.replace(/(<link)\s+href\s*=\s*["']([^"']+)["']/gi, (match, tag, href) => {
        return `${tag} href="${proxyUrl(href)}"`;
      });

      // Rewrite srcset attributes
      html = html.replace(/srcset\s*=\s*["']([^"']+)["']/gi, (match, srcset) => {
        const newSrcset = srcset.split(',').map(src => {
          const parts = src.trim().split(/\s+/);
          if (parts[0]) {
            parts[0] = proxyUrl(parts[0]);
          }
          return parts.join(' ');
        }).join(', ');
        return `srcset="${newSrcset}"`;
      });

      // Rewrite url() in inline styles
      html = html.replace(/url\s*\(\s*["']?([^)"']+)["']?\s*\)/gi, (match, urlValue) => {
        if (urlValue.startsWith('data:')) return match;
        return `url("${proxyUrl(urlValue)}")`;
      });

      // Inject script to handle dynamic content, forms, and link clicks
      const injectedScript = `
<script>
(function() {
  // Proxy origin is provided by the server to ensure correct URL construction
  const proxyOrigin = '${proxyOriginForScript}';
  const proxyBase = proxyOrigin + '/api/browser/proxy?url=';
  const baseOrigin = '${baseOrigin}';
  const currentRealUrl = '${actualUrl}';

  // Track last notified URL to prevent duplicate notifications
  let lastNotifiedUrl = '';
  let notifyTimeout = null;

  // Notify parent window of navigation (debounced to prevent flooding)
  function notifyParent(realUrl, action) {
    // Skip duplicate notifications for same URL (except for important actions)
    if (realUrl === lastNotifiedUrl && action !== 'click' && action !== 'form' && action !== 'search') {
      return;
    }
    // Skip notifications for proxy URLs (they're internal)
    if (realUrl && realUrl.includes('/api/browser/proxy')) {
      return;
    }
    lastNotifiedUrl = realUrl;

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'xeno-browser-navigation',
          url: realUrl,
          action: action,
          title: document.title || ''
        }, '*');
      }
    } catch(e) {
      // Silently ignore errors
    }
  }

  // Notify parent of initial page load
  window.addEventListener('DOMContentLoaded', function() {
    notifyParent(currentRealUrl, 'load');
  });

  // Also notify on full load (for title updates)
  window.addEventListener('load', function() {
    setTimeout(function() {
      notifyParent(currentRealUrl, 'load');
    }, 100);
  });

  function makeProxyUrl(url) {
    if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#')) {
      return url;
    }
    // Don't double-proxy URLs that are already proxy URLs
    if (url.includes('/api/browser/proxy')) {
      // If it's a proxy URL with wrong origin, fix it
      if (url.includes('://') && !url.startsWith(proxyOrigin)) {
        // Extract the actual target URL and re-proxy with correct origin
        const match = url.match(/[?&]url=([^&]+)/);
        if (match) {
          const targetUrl = decodeURIComponent(match[1]);
          return proxyBase + encodeURIComponent(targetUrl);
        }
      }
      return url;
    }
    try {
      const absoluteUrl = new URL(url, baseOrigin).href;
      // Also check if the absolute URL is a proxy URL (malformed)
      if (absoluteUrl.includes('/api/browser/proxy')) {
        // This means a relative /api/browser/proxy was resolved against wrong origin
        // Extract target and re-proxy correctly
        const match = absoluteUrl.match(/[?&]url=([^&]+)/);
        if (match) {
          const targetUrl = decodeURIComponent(match[1]);
          return proxyBase + encodeURIComponent(targetUrl);
        }
        return url;
      }
      return proxyBase + encodeURIComponent(absoluteUrl);
    } catch(e) {
      return url;
    }
  }

  function getRealUrl(url) {
    if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#')) {
      return url;
    }
    // If it's a proxy URL, extract the real URL from the url parameter
    if (url.includes('/api/browser/proxy')) {
      const match = url.match(/[?&]url=([^&]+)/);
      if (match) {
        try {
          return decodeURIComponent(match[1]);
        } catch(e) {
          // Fall through
        }
      }
      return url;
    }
    try {
      return new URL(url, baseOrigin).href;
    } catch(e) {
      return url;
    }
  }

  // Override fetch to proxy requests (handles both string URLs and Request objects)
  const originalFetch = window.fetch;
  window.fetch = function(input, options) {
    let url;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof Request) {
      url = input.url;
    } else if (input && input.toString) {
      url = input.toString();
    }

    if (url && typeof url === 'string' && !url.includes('/api/browser/proxy')) {
      const proxiedUrl = makeProxyUrl(url);
      if (typeof input === 'string') {
        return originalFetch.call(this, proxiedUrl, options);
      } else {
        // Create new request with proxied URL
        return originalFetch.call(this, proxiedUrl, options || {});
      }
    }
    return originalFetch.call(this, input, options);
  };

  // Override XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (typeof url === 'string' && !url.includes('/api/browser/proxy')) {
      url = makeProxyUrl(url);
    }
    return originalXHROpen.call(this, method, url, ...args);
  };

  // Override navigator.sendBeacon (used for tracking/analytics)
  if (navigator.sendBeacon) {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      if (typeof url === 'string' && !url.includes('/api/browser/proxy')) {
        url = makeProxyUrl(url);
      }
      return originalSendBeacon(url, data);
    };
  }

  // Disable Service Worker registration (doesn't work through proxy due to origin mismatch)
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = function() {
      console.log('[XenoBrowser] Service Worker registration blocked (proxy mode)');
      return Promise.reject(new Error('Service Workers disabled in proxy mode'));
    };
  }

  // Helper to rewrite URL attributes on an element
  function rewriteElementUrls(el) {
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();

    // Remove crossorigin attribute (triggers CORS checks that fail through proxy)
    if (el.hasAttribute && el.hasAttribute('crossorigin')) {
      el.removeAttribute('crossorigin');
    }

    // Remove integrity attribute (hash checks fail when proxied)
    if (el.hasAttribute && el.hasAttribute('integrity')) {
      el.removeAttribute('integrity');
    }

    // Rewrite src attribute
    if (el.src && typeof el.src === 'string' && !el.src.includes('/api/browser/proxy') && !el.src.startsWith('data:')) {
      const newSrc = makeProxyUrl(el.src);
      if (newSrc !== el.src) {
        el.setAttribute('src', newSrc);
      }
    }

    // Rewrite srcset attribute
    if (el.srcset && typeof el.srcset === 'string' && !el.srcset.includes('/api/browser/proxy')) {
      const newSrcset = el.srcset.split(',').map(src => {
        const parts = src.trim().split(/\s+/);
        if (parts[0] && !parts[0].startsWith('data:') && !parts[0].includes('/api/browser/proxy')) {
          parts[0] = makeProxyUrl(parts[0]);
        }
        return parts.join(' ');
      }).join(', ');
      if (newSrcset !== el.srcset) {
        el.setAttribute('srcset', newSrcset);
      }
    }

    // Rewrite href for link elements (stylesheets)
    if (tag === 'link' && el.href && !el.href.includes('/api/browser/proxy')) {
      const newHref = makeProxyUrl(el.href);
      if (newHref !== el.href) {
        el.setAttribute('href', newHref);
      }
    }

    // Rewrite poster attribute for video elements
    if (el.poster && !el.poster.includes('/api/browser/proxy') && !el.poster.startsWith('data:')) {
      el.setAttribute('poster', makeProxyUrl(el.poster));
    }

    // Rewrite background-image in inline styles
    if (el.style && el.style.backgroundImage) {
      const bg = el.style.backgroundImage;
      if (bg && bg.includes('url(') && !bg.includes('/api/browser/proxy') && !bg.includes('data:')) {
        const newBg = bg.replace(/url\s*\(\s*["']?([^)"']+)["']?\s*\)/gi, (match, urlValue) => {
          if (urlValue.startsWith('data:')) return match;
          return 'url("' + makeProxyUrl(urlValue) + '")';
        });
        if (newBg !== bg) {
          el.style.backgroundImage = newBg;
        }
      }
    }
  }

  // MutationObserver to catch dynamically added elements
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      // Handle added nodes
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) { // Element node
          rewriteElementUrls(node);
          // Also check children
          if (node.querySelectorAll) {
            node.querySelectorAll('img, script, iframe, source, video, audio, embed, link[rel="stylesheet"]').forEach(rewriteElementUrls);
          }
        }
      });

      // Handle attribute changes (for elements that change src dynamically)
      if (mutation.type === 'attributes') {
        const attr = mutation.attributeName;
        if (attr === 'src' || attr === 'srcset' || attr === 'href' || attr === 'poster') {
          rewriteElementUrls(mutation.target);
        }
      }
    });
  });

  // Start observing once DOM is ready
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'href', 'poster', 'style']
    });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'href', 'poster', 'style']
      });
    });
  }

  // Override Image constructor to proxy image URLs
  const OriginalImage = window.Image;
  window.Image = function(width, height) {
    const img = new OriginalImage(width, height);
    const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');

    // Override src setter for this instance
    Object.defineProperty(img, 'src', {
      get: function() {
        return originalSrcDescriptor.get.call(this);
      },
      set: function(value) {
        if (value && typeof value === 'string' && !value.includes('/api/browser/proxy') && !value.startsWith('data:')) {
          value = makeProxyUrl(value);
        }
        originalSrcDescriptor.set.call(this, value);
      },
      configurable: true
    });

    return img;
  };
  window.Image.prototype = OriginalImage.prototype;

  // Override HTMLImageElement.prototype.src setter globally
  const imgSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (imgSrcDescriptor && imgSrcDescriptor.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      get: imgSrcDescriptor.get,
      set: function(value) {
        if (value && typeof value === 'string' && !value.includes('/api/browser/proxy') && !value.startsWith('data:')) {
          value = makeProxyUrl(value);
        }
        imgSrcDescriptor.set.call(this, value);
      },
      configurable: true
    });
  }

  // Extract actual URL from Google/Bing redirect URLs
  function extractRedirectUrl(href) {
    try {
      const url = new URL(href, baseOrigin);
      // Google redirect: /url?q=https://actual-site.com or /url?url=https://...
      if (url.pathname === '/url' || url.pathname.endsWith('/url')) {
        const targetUrl = url.searchParams.get('q') || url.searchParams.get('url');
        if (targetUrl && targetUrl.startsWith('http')) {
          console.log('[XenoBrowser] Extracted redirect URL:', targetUrl);
          return targetUrl;
        }
      }
      // Bing redirect: /ck/a?...&u=a1...&...  (URL is base64-ish encoded)
      // For now, just handle Google-style redirects
    } catch(e) {
      console.log('[XenoBrowser] Could not parse redirect URL:', e);
    }
    return null;
  }

  // Intercept all link clicks
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a');
    if (link && link.href) {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        e.preventDefault();
        e.stopPropagation();

        // Check if this is a redirect URL (Google/Bing tracking)
        const extractedUrl = extractRedirectUrl(href);
        const targetUrl = extractedUrl || href;

        const realUrl = extractedUrl || getRealUrl(href);
        const newUrl = makeProxyUrl(targetUrl);
        notifyParent(realUrl, 'click');
        window.location.href = newUrl;
      }
    }
  }, true);

  // Intercept form submissions
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form && form.tagName === 'FORM') {
      e.preventDefault();
      e.stopPropagation();

      const formData = new FormData(form);
      const action = form.getAttribute('action') || window.location.href;
      const method = (form.getAttribute('method') || 'GET').toUpperCase();

      let targetUrl;
      try {
        targetUrl = new URL(action, baseOrigin);
      } catch(err) {
        targetUrl = new URL(baseOrigin + action);
      }

      if (method === 'GET') {
        // Append form data as query params
        for (const [key, value] of formData.entries()) {
          targetUrl.searchParams.set(key, value);
        }
        const realUrl = targetUrl.href;
        notifyParent(realUrl, 'form');
        window.location.href = makeProxyUrl(realUrl);
      } else {
        // For POST, we need to submit through proxy differently
        // For now, convert to GET (works for most search forms)
        for (const [key, value] of formData.entries()) {
          targetUrl.searchParams.set(key, value);
        }
        const realUrl = targetUrl.href;
        notifyParent(realUrl, 'form');
        window.location.href = makeProxyUrl(realUrl);
      }
    }
  }, true);

  // AGGRESSIVE: Intercept ALL keydown events at the capture phase for search
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      const target = e.target;
      console.log('[XenoBrowser] Enter pressed on:', target?.tagName, target?.name, target?.type);

      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        const type = target.type || 'text';
        const name = (target.name || '').toLowerCase();
        const id = (target.id || '').toLowerCase();
        const className = (target.className || '').toLowerCase();

        // Detect search inputs (Google uses name="q", others use various names)
        const isSearch = type === 'search' || type === 'text' ||
                        name === 'q' || name === 'query' || name === 'search' ||
                        id.includes('search') || className.includes('search');

        if (isSearch && target.value && target.value.trim()) {
          console.log('[XenoBrowser] Search detected, value:', target.value);

          // Try to find a form first
          const form = target.closest('form');

          // Stop ALL propagation immediately
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          // Build search URL
          let searchUrl;
          if (form) {
            const action = form.getAttribute('action') || '/search';
            try {
              searchUrl = new URL(action, baseOrigin);
            } catch(err) {
              searchUrl = new URL(baseOrigin + '/search');
            }
            // Get all form inputs AND textareas (Google uses textarea for search!)
            // BUT exclude btnI (I'm Feeling Lucky) which skips search results!
            const inputs = form.querySelectorAll('input[name], textarea[name]');
            const excludeParams = ['btni', 'btnk', 'btng']; // I'm Feeling Lucky, Search buttons
            inputs.forEach(inp => {
              const inputName = (inp.name || '').toLowerCase();
              // Skip button inputs and hidden lucky buttons
              if (inp.type === 'submit' || inp.type === 'button') return;
              if (excludeParams.includes(inputName)) return;
              if (inp.value) searchUrl.searchParams.set(inp.name, inp.value);
            });
            // Make sure the search query is included (the current input/textarea)
            if (target.name && target.value) {
              searchUrl.searchParams.set(target.name, target.value.trim());
            }
          } else {
            // No form, construct Google-style search URL
            searchUrl = new URL(baseOrigin + '/search');
            searchUrl.searchParams.set('q', target.value.trim());
          }

          // Ensure 'q' parameter exists for search
          if (!searchUrl.searchParams.get('q') && target.value) {
            searchUrl.searchParams.set('q', target.value.trim());
          }

          // Remove any "I'm Feeling Lucky" parameters that might have slipped through
          searchUrl.searchParams.delete('btnI');
          searchUrl.searchParams.delete('btnG');

          const realUrl = searchUrl.href;
          console.log('[XenoBrowser] Navigating to search:', realUrl);
          notifyParent(realUrl, 'search');

          // Navigate using proxy
          window.location.href = makeProxyUrl(realUrl);
          return false;
        }
      }
    }
  }, true); // capture phase

  // Override History API (used by SPAs and Google)
  const originalPushState = history.pushState;
  history.pushState = function(state, title, url) {
    if (url && typeof url === 'string') {
      const realUrl = getRealUrl(url);
      notifyParent(realUrl, 'pushState');
    }
    return originalPushState.call(this, state, title, url);
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    if (url && typeof url === 'string') {
      const realUrl = getRealUrl(url);
      notifyParent(realUrl, 'replaceState');
    }
    return originalReplaceState.call(this, state, title, url);
  };

  // Override window.open
  const originalOpen = window.open;
  window.open = function(url, ...args) {
    if (url && typeof url === 'string') {
      const realUrl = getRealUrl(url);
      notifyParent(realUrl, 'open');
      url = makeProxyUrl(url);
    }
    return originalOpen.call(this, url, ...args);
  };

  // Helper to find element by text or selector
  function findElement(selectorOrText) {
    if (!selectorOrText) return null;

    // Try as CSS selector first
    try {
      const el = document.querySelector(selectorOrText);
      if (el) return el;
    } catch (e) {
      // Not a valid selector, try text search
    }

    // Search by text content (buttons, links, etc.)
    const searchText = selectorOrText.toLowerCase().trim();
    const candidates = document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"], div[onclick], span[onclick]');

    for (const el of candidates) {
      const text = (el.innerText || el.value || el.textContent || '').toLowerCase().trim();
      if (text === searchText || text.includes(searchText)) {
        return el;
      }
    }

    // Try broader search - any element with matching text
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.children.length === 0 || el.tagName === 'BUTTON' || el.tagName === 'A') {
        const text = (el.innerText || el.textContent || '').toLowerCase().trim();
        if (text === searchText) {
          return el;
        }
      }
    }

    return null;
  }

  // Listen for agent commands from parent
  window.addEventListener('message', async function(e) {
    if (e.data && e.data.type === 'xeno-agent-command') {
      const { command, payload, commandId } = e.data;
      let result = { success: true, commandId };

      console.log('[XenoAgent] Received command:', command, payload);

      try {
        switch (command) {
          case 'locate':
            // Find element and return its position WITHOUT clicking
            // Used for cursor animation before actual click
            if (payload.selector) {
              const el = findElement(payload.selector);
              if (el) {
                const rect = el.getBoundingClientRect();
                result.cursor = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                result.elementInfo = {
                  tag: el.tagName.toLowerCase(),
                  text: (el.innerText || el.value || '').substring(0, 50).trim(),
                  width: rect.width,
                  height: rect.height
                };
                // Scroll element into view for visibility
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                result.message = 'Located: ' + (el.innerText || el.tagName).substring(0, 30);
                console.log('[XenoAgent] Located element:', el);
              } else {
                result.success = false;
                result.message = 'Element not found: ' + payload.selector;
              }
            }
            break;

          case 'click':
            if (payload.selector) {
              const el = findElement(payload.selector);
              if (el) {
                const rect = el.getBoundingClientRect();
                result.cursor = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

                // Scroll element into view if needed
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Small delay then click
                setTimeout(() => {
                  el.click();
                  // Also try dispatching mouse events for stubborn elements
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                }, 100);

                result.message = 'Clicked: ' + (el.innerText || el.tagName).substring(0, 30);
                console.log('[XenoAgent] Clicked element:', el);
              } else {
                result.success = false;
                result.message = 'Element not found: ' + payload.selector;
                console.log('[XenoAgent] Element not found:', payload.selector);
              }
            } else if (payload.x !== undefined && payload.y !== undefined) {
              const el = document.elementFromPoint(payload.x, payload.y);
              if (el) {
                el.click();
                result.cursor = { x: payload.x, y: payload.y };
                result.message = 'Clicked at coordinates';
              }
            }
            break;

          case 'type':
            if (payload.selector) {
              let el = findElement(payload.selector);

              // If not found, try to find any visible input/textarea
              if (!el) {
                el = document.querySelector('input:not([type="hidden"]):not([type="submit"]), textarea, [contenteditable="true"]');
              }

              if (el) {
                const rect = el.getBoundingClientRect();
                result.cursor = { x: rect.x + 10, y: rect.y + rect.height / 2 };
                el.focus();

                // Clear existing value and type new text
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                  el.value = payload.text || '';
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (el.isContentEditable) {
                  el.textContent = payload.text || '';
                }

                result.message = 'Typed: ' + (payload.text || '').substring(0, 20);
                console.log('[XenoAgent] Typed in element:', el);
              } else {
                result.success = false;
                result.message = 'Input element not found';
              }
            }
            break;

          case 'scroll':
            const scrollAmount = payload.amount || 400;
            const scrollDir = payload.direction === 'down' ? 1 : -1;

            // Try multiple scroll targets - some sites have custom scroll containers
            const scrollTargets = [
              document.scrollingElement,
              document.documentElement,
              document.body,
              document.querySelector('main'),
              document.querySelector('[role="main"]'),
              document.querySelector('.content'),
              document.querySelector('#content')
            ].filter(Boolean);

            let scrolled = false;
            let beforeScroll = window.scrollY || document.documentElement.scrollTop || 0;

            // First try window.scrollBy
            window.scrollBy({ top: scrollAmount * scrollDir, behavior: 'smooth' });

            // Wait a moment for smooth scroll
            await new Promise(r => setTimeout(r, 100));

            let afterScroll = window.scrollY || document.documentElement.scrollTop || 0;

            // If window scroll didn't work, try scrollable elements
            if (Math.abs(afterScroll - beforeScroll) < 10) {
              for (const target of scrollTargets) {
                if (target && target.scrollHeight > target.clientHeight) {
                  const before = target.scrollTop;
                  target.scrollTop += scrollAmount * scrollDir;
                  await new Promise(r => setTimeout(r, 50));
                  if (Math.abs(target.scrollTop - before) > 10) {
                    scrolled = true;
                    afterScroll = target.scrollTop;
                    break;
                  }
                }
              }
            } else {
              scrolled = true;
            }

            result.cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            result.scrollPosition = afterScroll;
            result.message = scrolled
              ? 'Scrolled ' + payload.direction + ' (pos: ' + Math.round(afterScroll) + 'px)'
              : 'Scroll attempted ' + payload.direction + ' (page may be at ' + (payload.direction === 'up' ? 'top' : 'bottom') + ')';
            break;

          case 'submit':
            // Try to submit a form or press enter
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
              const form = activeEl.closest('form');
              if (form) {
                form.submit();
                result.message = 'Form submitted';
              } else {
                // Simulate Enter key
                activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                activeEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
                activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
                result.message = 'Enter key pressed';
              }
            }
            break;

          case 'extract':
            // Get meaningful content from the page, prioritizing main content over navigation
            let extractedContent = '';

            // First, try to get main content areas (articles, main, content sections)
            const mainSelectors = [
              'main', 'article', '[role="main"]', '#content', '.content',
              '.article', '.post', '.entry', '.main-content', '.page-content'
            ];
            let mainArea = null;
            for (const sel of mainSelectors) {
              const el = document.querySelector(sel);
              if (el && el.innerText && el.innerText.length > 200) {
                mainArea = el;
                break;
              }
            }

            if (mainArea) {
              extractedContent = mainArea.innerText.substring(0, 6000);
            }

            // Also get navigation items (useful for knowing what can be clicked)
            const navItems = [];
            document.querySelectorAll('nav a, header a, [role="navigation"] a').forEach(a => {
              const text = (a.innerText || a.textContent || '').trim();
              if (text && text.length < 30 && !navItems.includes(text)) {
                navItems.push(text);
              }
            });

            // Combine navigation and main content
            const navSection = navItems.length > 0 ? 'NAVIGATION: ' + navItems.slice(0, 15).join(' | ') + '\\n\\n' : '';

            // If no main content found, fall back to body text but skip common nav patterns
            if (!extractedContent) {
              extractedContent = document.body.innerText
                .replace(/\\s+/g, ' ')
                .substring(0, 6000);
            }

            result.content = navSection + 'MAIN CONTENT:\\n' + extractedContent;
            result.title = document.title;
            result.url = currentRealUrl;
            result.message = 'Extracted ' + result.content.length + ' chars from ' + document.title;
            console.log('[XenoAgent] Extracted content from:', currentRealUrl, '- Length:', result.content.length);
            break;

          case 'getElements':
            // Get clickable elements for AI
            const clickable = [];
            document.querySelectorAll('a, button, input, [onclick], [role="button"]').forEach((el, i) => {
              if (i < 50) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0) {
                  clickable.push({
                    tag: el.tagName.toLowerCase(),
                    text: (el.innerText || el.value || el.placeholder || '').substring(0, 50).trim(),
                    type: el.type || '',
                    x: Math.round(rect.x + rect.width / 2),
                    y: Math.round(rect.y + rect.height / 2)
                  });
                }
              }
            });
            result.elements = clickable;
            result.message = 'Found ' + clickable.length + ' clickable elements';
            break;
        }
      } catch (err) {
        result.success = false;
        result.message = err.message;
        console.error('[XenoAgent] Error:', err);
      }

      // Send result back to parent
      window.parent.postMessage({
        type: 'xeno-agent-result',
        ...result
      }, '*');
    }
  });

})();
</script>`;

      // Insert script at the beginning of head
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${injectedScript}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>${injectedScript}`);
      } else {
        html = injectedScript + html;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      // Set cookie to track current proxy context (for ES module imports without Referer)
      res.cookie('xeno_proxy_origin', baseOrigin, {
        httpOnly: false,
        sameSite: 'lax',
        maxAge: 3600000 // 1 hour
      });
      return res.send(html);
    }

    // For CSS, rewrite url() references
    if (contentType.includes('text/css')) {
      let css = await response.text();
      css = css.replace(/url\s*\(\s*["']?([^)"']+)["']?\s*\)/gi, (match, urlValue) => {
        if (urlValue.startsWith('data:')) return match;
        return `url("${proxyUrl(urlValue)}")`;
      });
      // Also handle @import
      css = css.replace(/@import\s+["']([^"']+)["']/gi, (match, importUrl) => {
        return `@import "${proxyUrl(importUrl)}"`;
      });
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(css);
    }

    // For other content types, pipe through with CORS headers
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.send(Buffer.from(buffer));

  } catch (error) {
    console.error(`[Browser Proxy] Error fetching ${actualUrl}:`, error.message);

    // Detect expected content type from URL extension and patterns
    const urlLower = actualUrl.toLowerCase();
    // Google uses dynamic JS URLs like /xjs/_/js/k=... and m=sb_wiz,aa,... without .js extension
    const isScript = urlLower.endsWith('.js') ||
                     urlLower.includes('.js?') ||
                     urlLower.includes('/js/') ||
                     urlLower.includes('/_/js/') ||
                     urlLower.includes('/xjs/') ||
                     /[?&]m=[a-z0-9_,]+/i.test(urlLower) ||  // Google module loader pattern
                     urlLower.includes('gstatic.com') && urlLower.includes('/og/');
    const isCss = urlLower.endsWith('.css') || urlLower.includes('.css?');
    const isJson = urlLower.endsWith('.json') ||
                   urlLower.includes('.json?') ||
                   urlLower.includes('format=json') ||
                   urlLower.includes('/log?');  // Google logging endpoints
    const isImage = /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i.test(urlLower);
    const isFont = /\.(woff2?|ttf|eot|otf)(\?|$)/i.test(urlLower);
    // Google tracking/analytics endpoints - just return empty success
    const isTracking = urlLower.includes('/gen_204') ||
                       urlLower.includes('$rpc') ||
                       urlLower.includes('play.google.com/log');

    // Return appropriate error response based on expected content type
    // This prevents "Unexpected token '<'" errors for JS files
    if (isScript) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(`/* Proxy error loading: ${actualUrl} - ${error.message} */`);
    }
    if (isCss) {
      res.setHeader('Content-Type', 'text/css');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(`/* Proxy error loading: ${actualUrl} */`);
    }
    if (isJson) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(JSON.stringify({ error: error.message, url: actualUrl }));
    }
    if (isImage || isFont) {
      // Return 404 for binary resources
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(404).send('');
    }
    if (isTracking) {
      // Return empty success for tracking/analytics endpoints
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(204).send('');
    }

    // For HTML and other content, show error page
    const errorHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Error Loading Page</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .error-container {
      text-align: center;
      padding: 40px;
      background: #2a2a2d;
      border-radius: 12px;
      max-width: 500px;
    }
    h1 { color: #ff6b6b; margin-bottom: 16px; }
    p { color: #888; margin-bottom: 20px; }
    .url {
      background: #1a1a1a;
      padding: 12px;
      border-radius: 8px;
      word-break: break-all;
      color: #4ecdc4;
      font-size: 14px;
    }
    a { color: #4ecdc4; text-decoration: none; }
  </style>
</head>
<body>
  <div class="error-container">
    <h1>Unable to Load Page</h1>
    <p>${error.message}</p>
    <div class="url">${actualUrl}</div>
    <p style="margin-top: 20px;">
      <a href="${actualUrl}" target="_blank">Open in new tab →</a>
    </p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(errorHtml);
  }
});

/**
 * POST /api/browser/proxy
 * Proxy POST requests to handle AJAX/API calls from proxied pages
 */
router.post('/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL query parameter is required' });
  }

  let targetUrl;
  try {
    targetUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Skip tracking/analytics/logging endpoints - return empty success
  const urlLowerCheck = url.toLowerCase();
  if (urlLowerCheck.includes('/gen_204') ||
      urlLowerCheck.includes('$rpc') ||
      urlLowerCheck.includes('play.google.com/log') ||
      urlLowerCheck.includes('ogads-pa.clients6.google.com') ||
      urlLowerCheck.includes('clients6.google.com') ||
      urlLowerCheck.includes('/log?format=json')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(204).send('');
  }

  console.log(`[Browser Proxy POST] Forwarding to: ${url}`);

  try {
    // Get the body - with express.raw(), req.body is a Buffer
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      body = body.toString('utf-8');
    } else if (typeof body === 'object') {
      body = JSON.stringify(body);
    }

    // Build headers - add cookies for Google
    const isGoogle = targetUrl.hostname.includes('google') || targetUrl.hostname.includes('gstatic');
    const postHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': req.headers['content-type'] || 'text/plain',
      'Origin': targetUrl.origin,
      'Referer': targetUrl.origin,
    };

    if (isGoogle) {
      postHeaders['Cookie'] = 'CONSENT=YES+cb; SOCS=CAISHAgBEhJnd3NfMjAyNDA4MjgtMF9SQzEaAmVuIAEaBgiA_LyYBg; NID=511=test';
    }

    // Forward the POST request with body
    const response = await fetch(url, {
      method: 'POST',
      headers: postHeaders,
      body: body,
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || 'application/json';

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', contentType);

    // Forward response
    if (contentType.includes('application/json') || contentType.includes('text/')) {
      const text = await response.text();
      return res.status(response.status).send(text);
    } else {
      const buffer = await response.arrayBuffer();
      return res.status(response.status).send(Buffer.from(buffer));
    }
  } catch (error) {
    console.error('[Browser Proxy POST] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * OPTIONS /api/browser/proxy
 * Handle CORS preflight requests
 */
router.options('/proxy', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  return res.status(204).send();
});

/**
 * GET /api/browser/status
 * Check if the browser service is available
 */
router.get('/status', async (req, res) => {
  try {
    // In Docker network, check the internal service
    const internalUrl = `https://${BROWSER_HOST}:${BROWSER_PORT}`;

    // For now, return configuration - KasmVNC handles its own session
    res.json({
      available: true,
      url: internalUrl,
      externalPort: BROWSER_PORT,
      message: 'Browser service is configured'
    });
  } catch (error) {
    console.error('Browser status check error:', error);
    res.status(500).json({
      available: false,
      error: error.message
    });
  }
});

/**
 * GET /api/browser/config
 * Get browser embedding configuration
 */
router.get('/config', (req, res) => {
  // Return the configuration needed for frontend embedding
  // The frontend uses the external port to connect via the host
  res.json({
    port: BROWSER_PORT,
    password: BROWSER_PASSWORD,
    protocol: 'https',
    autoResize: true,
    viewOnly: false
  });
});

/**
 * POST /api/browser/navigate
 * Navigate the browser to a URL by opening Chrome in the xeno-browser container
 */
router.post('/navigate', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL
  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  console.log(`[Browser] Navigation requested: ${url}`);

  try {
    // Execute command in the xeno-browser container to open URL in Chrome
    // Using DISPLAY=:1 for the VNC display
    const escapedUrl = url.replace(/"/g, '\\"');
    const command = `docker exec ${BROWSER_HOST} bash -c "DISPLAY=:1 google-chrome --new-window '${escapedUrl}' 2>/dev/null &"`;

    await execAsync(command);

    console.log(`[Browser] Successfully opened: ${url}`);

    res.json({
      success: true,
      url: url,
      message: 'Browser navigated to URL'
    });
  } catch (error) {
    console.error(`[Browser] Navigation error:`, error.message);

    // Even if command fails, return success as the URL might still open
    res.json({
      success: true,
      url: url,
      message: 'Navigation command sent'
    });
  }
});

/**
 * POST /api/browser/screenshot
 * Capture a screenshot of the current browser view (for AI vision)
 */
router.post('/screenshot', async (req, res) => {
  try {
    const timestamp = Date.now();
    const screenshotPath = `/tmp/screenshot_${timestamp}.png`;

    // Take screenshot using scrot or import command in the container
    const command = `docker exec ${BROWSER_HOST} bash -c "DISPLAY=:1 scrot ${screenshotPath} 2>/dev/null || DISPLAY=:1 import -window root ${screenshotPath}"`;

    await execAsync(command);

    // Read the screenshot and return as base64
    const readCommand = `docker exec ${BROWSER_HOST} cat ${screenshotPath} | base64`;
    const { stdout } = await execAsync(readCommand);

    // Clean up
    await execAsync(`docker exec ${BROWSER_HOST} rm -f ${screenshotPath}`).catch(() => {});

    res.json({
      success: true,
      screenshot: stdout.trim(),
      timestamp: timestamp
    });
  } catch (error) {
    console.error('[Browser] Screenshot error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to capture screenshot'
    });
  }
});

/**
 * GET /api/browser/content
 * Get the current page content (for AI to read)
 * Pass URL as query param: /api/browser/content?url=https://example.com
 */
router.get('/content', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL query parameter is required'
    });
  }

  try {
    // Fetch the page content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: ${response.status}`);
    }

    const html = await response.text();

    // Use cheerio to extract content
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);

    // Remove scripts, styles, and other non-content elements
    $('script, style, nav, footer, header, aside, iframe, noscript').remove();

    // Extract title
    const title = $('title').text().trim();

    // Extract main content
    let mainContent = '';

    // Try common content containers
    const contentSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.post', '.article'];
    for (const selector of contentSelectors) {
      const content = $(selector).text();
      if (content && content.trim().length > mainContent.length) {
        mainContent = content.trim();
      }
    }

    // Fallback to body if no main content found
    if (!mainContent || mainContent.length < 100) {
      mainContent = $('body').text().trim();
    }

    // Clean up whitespace
    mainContent = mainContent.replace(/\s+/g, ' ').trim();

    // Extract links
    const links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({ text, href });
      }
    });

    // Extract headings
    const headings = [];
    $('h1, h2, h3').each((i, el) => {
      const text = $(el).text().trim();
      if (text) {
        headings.push({ level: el.tagName.toLowerCase(), text });
      }
    });

    res.json({
      success: true,
      url: url,
      title: title,
      content: mainContent.substring(0, 10000), // Limit content size
      headings: headings.slice(0, 20),
      links: links.slice(0, 50),
      contentLength: mainContent.length
    });
  } catch (error) {
    console.error('[Browser] Content extraction error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// BROWSERLESS-POWERED ENDPOINTS (Full Browser Automation)
// ============================================================================

/**
 * POST /api/browser/render
 * Render a page using Browserless (handles JavaScript, bot protection)
 * Returns the fully rendered HTML content
 */
router.post('/render', async (req, res) => {
  const { url, waitFor = 'networkidle0', timeout = 30000 } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`[Browserless] Rendering: ${url}`);
  let browser;

  try {
    browser = await getBrowserlessConnection();
    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate and wait for content
    await page.goto(url, {
      waitUntil: waitFor,
      timeout: timeout
    });

    // Get the rendered HTML
    const html = await page.content();

    // Extract text content
    const textContent = await page.evaluate(() => {
      // Remove scripts, styles, etc.
      const elementsToRemove = document.querySelectorAll('script, style, noscript, iframe');
      elementsToRemove.forEach(el => el.remove());
      return document.body.innerText;
    });

    // Get title
    const title = await page.title();

    // Get current URL (in case of redirects)
    const finalUrl = page.url();

    await page.close();

    console.log(`[Browserless] Successfully rendered: ${url}`);

    res.json({
      success: true,
      url: finalUrl,
      title,
      html: html.substring(0, 500000), // Limit size
      textContent: textContent.substring(0, 50000),
      contentLength: html.length
    });

  } catch (error) {
    console.error(`[Browserless] Render error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (browser) {
      browser.disconnect();
    }
  }
});

/**
 * POST /api/browser/action
 * Execute browser actions (click, scroll, type, etc.)
 * Supports multiple actions in sequence
 */
router.post('/action', async (req, res) => {
  const { url, actions = [], screenshot = false } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`[Browserless] Executing ${actions.length} actions on: ${url}`);
  let browser;

  try {
    browser = await getBrowserlessConnection();
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to URL
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    const results = [];

    // Execute each action
    for (const action of actions) {
      try {
        let result = { action: action.type, success: true };

        switch (action.type) {
          case 'click':
            if (action.selector) {
              await page.waitForSelector(action.selector, { timeout: 5000 });
              // Get element position for cursor visualization
              const clickBox = await page.$eval(action.selector, el => {
                const rect = el.getBoundingClientRect();
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              });
              await page.click(action.selector);
              result.message = `Clicked: ${action.selector}`;
              result.cursor = clickBox;
            } else if (action.x !== undefined && action.y !== undefined) {
              await page.mouse.click(action.x, action.y);
              result.message = `Clicked at: (${action.x}, ${action.y})`;
              result.cursor = { x: action.x, y: action.y };
            }
            break;

          case 'type':
            if (action.selector) {
              await page.waitForSelector(action.selector, { timeout: 5000 });
              // Get element position for cursor visualization
              const typeBox = await page.$eval(action.selector, el => {
                const rect = el.getBoundingClientRect();
                return { x: rect.x + 10, y: rect.y + rect.height / 2 };
              });
              await page.type(action.selector, action.text || '', { delay: action.delay || 50 });
              result.message = `Typed in: ${action.selector}`;
              result.cursor = typeBox;
            }
            break;

          case 'scroll':
            if (action.direction === 'down') {
              await page.evaluate((amount) => window.scrollBy(0, amount), action.amount || 500);
              result.cursor = { x: 640, y: 400, scrollDirection: 'down' };
            } else if (action.direction === 'up') {
              await page.evaluate((amount) => window.scrollBy(0, -amount), action.amount || 500);
              result.cursor = { x: 640, y: 400, scrollDirection: 'up' };
            } else if (action.selector) {
              await page.evaluate((sel) => {
                document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth' });
              }, action.selector);
            }
            result.message = `Scrolled ${action.direction || 'to element'}`;
            break;

          case 'wait':
            if (action.selector) {
              await page.waitForSelector(action.selector, { timeout: action.timeout || 10000 });
              result.message = `Waited for: ${action.selector}`;
            } else if (action.time) {
              await new Promise(r => setTimeout(r, action.time));
              result.message = `Waited: ${action.time}ms`;
            }
            break;

          case 'evaluate':
            // Execute JavaScript in the page context
            const evalResult = await page.evaluate(action.script);
            result.message = 'Script executed';
            result.data = evalResult;
            break;

          case 'select':
            if (action.selector && action.value) {
              await page.select(action.selector, action.value);
              result.message = `Selected: ${action.value} in ${action.selector}`;
            }
            break;

          case 'hover':
            if (action.selector) {
              await page.hover(action.selector);
              result.message = `Hovered: ${action.selector}`;
            }
            break;

          case 'press':
            await page.keyboard.press(action.key);
            result.message = `Pressed key: ${action.key}`;
            break;

          default:
            result.success = false;
            result.message = `Unknown action type: ${action.type}`;
        }

        results.push(result);

        // Small delay between actions
        await new Promise(r => setTimeout(r, 100));

      } catch (actionError) {
        results.push({
          action: action.type,
          success: false,
          error: actionError.message
        });
      }
    }

    // Get final page state
    const finalUrl = page.url();
    const title = await page.title();
    const textContent = await page.evaluate(() => document.body.innerText);

    // Take screenshot if requested
    let screenshotBase64 = null;
    if (screenshot) {
      screenshotBase64 = await page.screenshot({ type: 'png', fullPage: false, encoding: 'base64' });
    }

    await page.close();

    res.json({
      success: true,
      url: finalUrl,
      title,
      textContent: textContent.substring(0, 50000),
      actions: results,
      screenshot: screenshotBase64
    });

  } catch (error) {
    console.error(`[Browserless] Action error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (browser) {
      browser.disconnect();
    }
  }
});

/**
 * POST /api/browser/screenshot-url
 * Take a screenshot of any URL using Browserless
 */
router.post('/screenshot-url', async (req, res) => {
  const { url, fullPage = false, width = 1920, height = 1080 } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`[Browserless] Screenshot: ${url}`);
  let browser;

  try {
    browser = await getBrowserlessConnection();
    const page = await browser.newPage();

    await page.setViewport({ width, height });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    const screenshotData = await page.screenshot({
      type: 'png',
      fullPage: fullPage,
      encoding: 'base64'
    });

    await page.close();

    res.json({
      success: true,
      url: page.url(),
      screenshot: screenshotData,
      width,
      height
    });

  } catch (error) {
    console.error(`[Browserless] Screenshot error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (browser) {
      browser.disconnect();
    }
  }
});

/**
 * POST /api/browser/extract
 * Extract structured data from a page using Browserless
 */
router.post('/extract', async (req, res) => {
  const { url, selectors = {} } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`[Browserless] Extracting data from: ${url}`);
  let browser;

  try {
    browser = await getBrowserlessConnection();
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // Extract data using provided selectors or defaults
    const data = await page.evaluate((customSelectors) => {
      const result = {
        title: document.title,
        url: window.location.href,
        meta: {},
        content: {},
        links: [],
        images: []
      };

      // Extract meta tags
      document.querySelectorAll('meta').forEach(meta => {
        const name = meta.getAttribute('name') || meta.getAttribute('property');
        const content = meta.getAttribute('content');
        if (name && content) {
          result.meta[name] = content;
        }
      });

      // Extract main content
      const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.post'];
      for (const sel of mainSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          result.content.main = el.innerText.substring(0, 30000);
          break;
        }
      }
      if (!result.content.main) {
        result.content.main = document.body.innerText.substring(0, 30000);
      }

      // Extract headings
      result.content.headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => ({
        level: h.tagName.toLowerCase(),
        text: h.innerText.trim()
      })).slice(0, 30);

      // Extract links
      result.links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
        text: a.innerText.trim(),
        href: a.href
      })).filter(l => l.text && l.href).slice(0, 100);

      // Extract images
      result.images = Array.from(document.querySelectorAll('img[src]')).map(img => ({
        src: img.src,
        alt: img.alt || ''
      })).slice(0, 50);

      // Custom selectors
      for (const [key, selector] of Object.entries(customSelectors)) {
        const el = document.querySelector(selector);
        if (el) {
          result.content[key] = el.innerText || el.textContent;
        }
      }

      return result;
    }, selectors);

    await page.close();

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error(`[Browserless] Extract error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (browser) {
      browser.disconnect();
    }
  }
});

/**
 * GET /api/browser/browserless-status
 * Check if Browserless service is available
 */
router.get('/browserless-status', async (req, res) => {
  try {
    const response = await fetch(`${BROWSERLESS_URL}/config?token=${BROWSERLESS_TOKEN}`);
    const available = response.ok;

    res.json({
      available,
      url: BROWSERLESS_URL,
      status: available ? 'connected' : 'unavailable'
    });
  } catch (error) {
    res.json({
      available: false,
      url: BROWSERLESS_URL,
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Catch-all route for relative URLs from proxied pages
 * When a Nuxt/Vue app tries to load ./chunk.js and the browser resolves it to /api/browser/chunk.js,
 * this route catches it and redirects to the correct proxied URL using the original script's directory
 */
router.get('/*', async (req, res) => {
  const referer = req.get('Referer') || '';
  const requestedPath = req.path;

  // Skip if this is already a proxy request (has url param)
  if (req.query.url) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Check if request came from a proxied page/script
  if (referer.includes('/api/browser/proxy?url=')) {
    try {
      const refererUrl = new URL(referer);
      const originalUrlParam = refererUrl.searchParams.get('url');

      if (originalUrlParam) {
        const originalUrl = new URL(decodeURIComponent(originalUrlParam));
        const originalOrigin = originalUrl.origin;
        // Get the directory path of the original URL (for relative resolution)
        const originalPath = originalUrl.pathname;
        const originalDir = originalPath.substring(0, originalPath.lastIndexOf('/') + 1) || '/';

        // ALL paths hitting this catch-all are from relative imports/requests
        // that the browser resolved against /api/browser/
        // We need to resolve them against the original script's directory instead
        // Remove leading slash (it's from Express path handling, not a true absolute path)
        const cleanPath = requestedPath.startsWith('/') ? requestedPath.slice(1) : requestedPath;

        // Combine with the original directory to get the correct path
        const targetUrl = originalOrigin + originalDir + cleanPath;

        console.log(`[Browser Proxy Catchall] ${requestedPath} -> ${targetUrl} (dir: ${originalDir})`);

        // Redirect to the proxy with the correct URL
        const proxyUrl = `/api/browser/proxy?url=${encodeURIComponent(targetUrl)}`;
        return res.redirect(302, proxyUrl);
      }
    } catch (e) {
      console.error('[Browser Proxy Catchall] Error:', e.message);
    }
  }

  res.status(404).json({ error: 'Not found' });
});

export default router;
