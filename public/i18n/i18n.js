/**
 * XENO i18n Framework
 *
 * Lightweight client-side internationalization for static product pages.
 * Loads translation JSON files from /i18n/{locale}.json.
 *
 * Usage:
 *   <span data-i18n="common.download">Download</span>
 *   <input data-i18n-placeholder="docs.searchDocs" placeholder="Search docs...">
 *
 * The language switcher component is auto-injected when xeno-i18n-switcher
 * element is present.
 */

(function() {
  'use strict';

  var SUPPORTED_LOCALES = ['en', 'de', 'es', 'ja'];
  var DEFAULT_LOCALE = 'en';
  var STORAGE_KEY = 'xeno-locale';
  var translations = {};
  var currentLocale = DEFAULT_LOCALE;

  // Detect initial locale: URL param > localStorage > browser language > default
  function detectLocale() {
    var params = new URLSearchParams(window.location.search);
    var urlLocale = params.get('lang');
    if (urlLocale && SUPPORTED_LOCALES.indexOf(urlLocale) !== -1) return urlLocale;

    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.indexOf(stored) !== -1) return stored;

    var browserLang = (navigator.language || '').split('-')[0];
    if (SUPPORTED_LOCALES.indexOf(browserLang) !== -1) return browserLang;

    return DEFAULT_LOCALE;
  }

  // Get nested property by dot-path
  function getByPath(obj, path) {
    return path.split('.').reduce(function(o, key) {
      return o && o[key] !== undefined ? o[key] : null;
    }, obj);
  }

  // Apply translations to DOM
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      var val = getByPath(translations, key);
      if (val) el.textContent = val;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-placeholder');
      var val = getByPath(translations, key);
      if (val) el.setAttribute('placeholder', val);
    });

    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-title');
      var val = getByPath(translations, key);
      if (val) el.setAttribute('title', val);
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-aria-label');
      var val = getByPath(translations, key);
      if (val) el.setAttribute('aria-label', val);
    });

    // Update html lang attribute
    document.documentElement.setAttribute('lang', currentLocale);
  }

  // Load translation file
  function loadLocale(locale) {
    return fetch('/i18n/' + locale + '.json')
      .then(function(res) {
        if (!res.ok) throw new Error('Failed to load ' + locale);
        return res.json();
      })
      .then(function(data) {
        translations = data;
        currentLocale = locale;
        localStorage.setItem(STORAGE_KEY, locale);
        applyTranslations();
        renderSwitcher();
      })
      .catch(function(err) {
        console.warn('[i18n] Failed to load locale:', locale, err);
        if (locale !== DEFAULT_LOCALE) return loadLocale(DEFAULT_LOCALE);
      });
  }

  // Render language switcher
  function renderSwitcher() {
    var container = document.getElementById('xeno-i18n-switcher');
    if (!container) return;

    var localeNames = { en: 'EN', de: 'DE', es: 'ES', ja: 'JA' };
    var html = '<div style="position:relative;display:inline-block">';
    html += '<button id="xeno-lang-btn" style="padding:4px 10px;font-size:12px;color:rgba(255,255,255,0.5);background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:4px;cursor:pointer;font-family:inherit">';
    html += localeNames[currentLocale] || currentLocale.toUpperCase();
    html += '</button>';
    html += '<div id="xeno-lang-dropdown" style="display:none;position:absolute;bottom:100%;left:0;margin-bottom:4px;background:#0b0b0d;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:4px;min-width:80px;z-index:100">';
    SUPPORTED_LOCALES.forEach(function(loc) {
      var active = loc === currentLocale;
      html += '<button data-locale="' + loc + '" style="display:block;width:100%;text-align:left;padding:6px 10px;font-size:12px;color:' + (active ? 'white' : 'rgba(255,255,255,0.5)') + ';background:' + (active ? 'rgba(255,255,255,0.06)' : 'none') + ';border:none;border-radius:3px;cursor:pointer;font-family:inherit">';
      html += localeNames[loc] || loc.toUpperCase();
      html += '</button>';
    });
    html += '</div></div>';
    container.innerHTML = html;

    // Toggle dropdown
    document.getElementById('xeno-lang-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      var dd = document.getElementById('xeno-lang-dropdown');
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });

    // Locale selection
    container.querySelectorAll('[data-locale]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        loadLocale(btn.getAttribute('data-locale'));
        document.getElementById('xeno-lang-dropdown').style.display = 'none';
      });
    });

    // Close on outside click
    document.addEventListener('click', function() {
      var dd = document.getElementById('xeno-lang-dropdown');
      if (dd) dd.style.display = 'none';
    });
  }

  // Public API
  window.xenoI18n = {
    t: function(key) { return getByPath(translations, key) || key; },
    locale: function() { return currentLocale; },
    setLocale: function(loc) { return loadLocale(loc); },
    supportedLocales: SUPPORTED_LOCALES,
  };

  // Initialize
  document.addEventListener('DOMContentLoaded', function() {
    loadLocale(detectLocale());
  });
})();
