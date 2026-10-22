/* Shared navigation for the homepage and imported product documents. */
(() => {
  'use strict';
  const triggerSelector = '[data-nav-trigger]';
  const menuSelector = '[data-nav-menu]';
  let closeTimer;
  let openId = null;
  const triggerFor = id => [...document.querySelectorAll(triggerSelector)].find(el => el.dataset.navTrigger === id);
  const menuFor = id => [...document.querySelectorAll(menuSelector)].find(el => el.dataset.navMenu === id);
  function setMenu(id) {
    clearTimeout(closeTimer);
    openId = id;
    document.querySelectorAll(triggerSelector).forEach(el => el.setAttribute('aria-expanded', String(el.dataset.navTrigger === id)));
    document.querySelectorAll(menuSelector).forEach(el => {
      const open = el.dataset.navMenu === id;
      el.toggleAttribute('data-open', open);
      el.inert = !open;
    });
  }
  function region(node) {
    if (!(node instanceof Element)) return null;
    const el = node.closest(`${triggerSelector},${menuSelector}`);
    return el?.dataset.navTrigger || el?.dataset.navMenu || null;
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      const menu = menuFor(openId), trigger = triggerFor(openId);
      if (menu?.matches(':hover') || trigger?.matches(':hover') || menu?.contains(document.activeElement)) return;
      setMenu(null);
    }, 240);
  }
  function highlightRow(row) {
    const list = row?.closest('.home-products-list');
    const highlight = list?.querySelector('.home-products-highlight');
    if (!highlight) return;
    const r = row.getBoundingClientRect(), container = list.getBoundingClientRect();
    Object.assign(highlight.style, { left: `${r.left - container.left}px`, top: `${r.top - container.top}px`, width: `${r.width}px`, height: `${r.height}px`, opacity: '1' });
  }
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const id = region(event.target);
    if (id && id !== 'mobile') {
      setMenu(id);
      highlightRow(event.target.closest('.home-product-row'));
    }
  });
  document.addEventListener('pointerout', event => {
    if (event.pointerType === 'touch') return;
    if (region(event.target) && !region(event.relatedTarget)) scheduleClose();
    if (event.target.closest('.home-products-list') && !event.relatedTarget?.closest?.('.home-products-list')) {
      const highlight = document.querySelector('.home-products-highlight');
      if (highlight) highlight.style.opacity = '0';
    }
  });
  document.addEventListener('click', event => {
    const trigger = event.target.closest(triggerSelector);
    if (trigger) {
      const id = trigger.dataset.navTrigger;
      setMenu(event.detail > 0 && event.pointerType === 'mouse' && id !== 'mobile' ? id : openId === id ? null : id);
    } else if (!region(event.target) || event.target.closest(`${menuSelector} a`)) setMenu(null);
  });
  document.addEventListener('focusin', event => {
    if (!region(event.target)) setMenu(null);
    else { clearTimeout(closeTimer); highlightRow(event.target.closest('.home-product-row')); }
  });
  document.addEventListener('keydown', event => {
    const trigger = event.target.closest(triggerSelector);
    if (event.key === 'Escape' && openId) {
      const previousTrigger = triggerFor(openId);
      setMenu(null);
      previousTrigger?.focus();
    } else if (event.key === 'ArrowDown' && trigger) {
      event.preventDefault();
      const id = trigger.dataset.navTrigger;
      setMenu(id);
      menuFor(id)?.querySelector('a')?.focus();
    }
  });
  window.addEventListener('resize', () => setMenu(null));
})();
