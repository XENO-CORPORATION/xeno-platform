/* Homepage-only progressive enhancements. No inference or account access. */
(() => {
  'use strict';
  const examples = {
    chat: ['AI Chat', 'Plan a product launch', '1. Define the audience and launch goal.\n2. Draft the landing page and three launch posts.\n3. Create the campaign visuals.\n4. Review everything with your team.\n5. Schedule the launch and measure the response.'],
    code: ['Code / CLI', 'Add a dark mode toggle', '1. Read the settings and theme components.\n2. Propose a toggle that remembers your choice.\n3. Ask permission before changing files.\n4. Run the relevant checks.\n\nExample only — no files have been read or changed.'],
    workflow: ['Visual Workflow', 'Launch a new coffee blend', 'Brief → Draft copy → Create artwork → Review → Schedule\n\nHeadline: A brighter start to your morning.\nCaption: Meet our new coffee blend. Crafted for slow mornings and bold ideas.\n\nThe review step waits for your approval before publishing.'],
    image: ['Image Generation', 'Mountain range at dawn', 'Wide mountain landscape at first light, soft mist between the ridges, warm dawn light against cool shadows, cinematic composition, natural detail, 35mm lens.\n\nA prepared prompt-enhancement example.'],
    video: ['Video Generation', 'A six-second coffee launch film', '0–2s · Slow push toward a steaming cup.\n2–4s · Close-up of freshly roasted beans.\n4–6s · Reveal the packaging in warm morning light.\n\nA prepared shot plan — no video has been generated.'],
    comms: ['Comms', 'Coordinate a launch with your team', 'You: Can you draft the launch checklist?\nLaunch Agent: Draft ready: copy, visuals, review and scheduling.\nYou: Hold publishing until the team approves.\nLaunch Agent: Waiting for approval.\n\nA prepared conversation — no message has been sent.'],
    sdk: ['SDK / API', 'Send a request from your application', '{\n  "example": true,\n  "output": "Your application receives the model response here."\n}\n\nA prepared response shape — no API request has been made.'],
    shell: ['Shell', 'Ask your terminal assistant', '$ ask how do I inspect my working changes?\nUse git status to list changed files, then git diff to review the changes.\n\nA prepared answer — no command has been run.'],
  };
  window.xenoHomePreview = (feature = 'chat') => {
    const existing = document.querySelector('.home-preview-dialog');
    if (existing) { existing.focus(); return; }
    const [name, prompt, output] = examples[feature] || examples.chat;
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'home-preview-dialog';
    dialog.setAttribute('aria-labelledby', 'home-preview-title');
    dialog.setAttribute('aria-describedby', 'home-preview-disclosure');
    const label = document.createElement('span');
    label.textContent = 'PREPARED EXAMPLE';
    const heading = document.createElement('h2');
    heading.id = 'home-preview-title';
    heading.textContent = name;
    const disclosure = document.createElement('p');
    disclosure.id = 'home-preview-disclosure';
    disclosure.textContent = 'Explore an example of this tool. Your prompt has not been sent to a model. Create a free account to work with your own prompts.';
    const brief = document.createElement('p');
    brief.textContent = 'Example: ' + prompt;
    const result = document.createElement('pre');
    result.textContent = output;
    const actions = document.createElement('div');
    actions.className = 'home-preview-actions';
    const signup = document.createElement('a');
    signup.href = '/auth';
    signup.textContent = 'Create your free account ↗';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Keep exploring';
    close.addEventListener('click', () => dialog.close());
    actions.append(signup, close);
    dialog.append(label, heading, disclosure, brief, result, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  };

  // The design runtime mounts its DOM after this script. Delegation also
  // survives re-renders without observers or a second React root.
  let closeTimer;
  function setMenu(open) {
    clearTimeout(closeTimer);
    const trigger = document.querySelector('[data-product-trigger]');
    const menu = document.querySelector('[data-product-menu]');
    if (!trigger || !menu) return;
    trigger.setAttribute('aria-expanded', String(open));
    menu.toggleAttribute('data-open', open);
    menu.inert = !open;
  }
  function isInside(node) {
    return node instanceof Element && !!node.closest('[data-product-trigger],[data-product-menu]');
  }
  function scheduleClose() {
    // Exactly one timer: pointerout and pointerover can describe the same exit.
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      const menu = document.querySelector('[data-product-menu]');
      const trigger = document.querySelector('[data-product-trigger]');
      if (menu?.matches(':hover') || trigger?.matches(':hover') || menu?.contains(document.activeElement)) return;
      setMenu(false);
    }, 240);
  }
  function highlightRow(row) {
    const list = row?.closest('.home-products-list');
    const highlight = list?.querySelector('.home-products-highlight');
    if (!highlight) return;
    const r = row.getBoundingClientRect(), container = list.getBoundingClientRect();
    Object.assign(highlight.style, { left: `${r.left - container.left}px`, top: `${r.top - container.top}px`, width: `${r.width}px`, height: `${r.height}px`, opacity: '1' });
  }
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    if (isInside(event.target)) {
      setMenu(true);
      highlightRow(event.target.closest('.home-product-row'));
    }
  });
  document.addEventListener('pointerout', (event) => {
    if (isInside(event.target) && !isInside(event.relatedTarget)) {
      scheduleClose();
    }
    if (event.target.closest('.home-products-list') && !event.relatedTarget?.closest?.('.home-products-list')) {
      const highlight = document.querySelector('.home-products-highlight');
      if (highlight) highlight.style.opacity = '0';
    }
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-product-trigger]')) {
      const trigger = document.querySelector('[data-product-trigger]');
      // A mouse click after hover must leave the menu open; touch toggles it.
      setMenu(event.detail > 0 && event.pointerType === 'mouse' ? true : trigger.getAttribute('aria-expanded') !== 'true');
    } else if (!isInside(event.target) || event.target.closest('[data-product-menu] a')) setMenu(false);
  });
  document.addEventListener('focusin', (event) => {
    if (!isInside(event.target)) setMenu(false);
    else {
      clearTimeout(closeTimer);
      highlightRow(event.target.closest('.home-product-row'));
    }
  });
  document.addEventListener('keydown', (event) => {
    const trigger = document.querySelector('[data-product-trigger]');
    if (!trigger) return;
    if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      trigger.focus();
    } else if (event.key === 'ArrowDown' && event.target === trigger) {
      event.preventDefault();
      setMenu(true);
      document.querySelector('[data-product-menu] a')?.focus();
    }
  });
})();
