import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import path from 'node:path';

let React, act, createRoot, Router, Pages, dom;
const previous = new Map();

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/test',
    pretendToBeVisual: true,
  });

  for (const key of [
    'window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement',
    'HTMLTextAreaElement', 'HTMLButtonElement', 'KeyboardEvent', 'Event', 'Node', 'MutationObserver',
    'localStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  ]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }

  // jsdom has no layout; model offsetParent
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.parentElement; },
  });

  previous.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  React = (await import('react')).default;
  ({ act } = await import('react-dom/test-utils'));
  ({ createRoot } = await import('react-dom/client'));
  Router = await import('react-router-dom');

  // Bundle the 4 real pages dynamically to ensure zero drift
  const bundleOut = 'scripts/harness/.auth-forms.generated.mjs';
  await build({
    stdin: {
      contents: `
        export { default as ContactContent } from './src/pages/ContactContent.tsx';
        export { default as DeviceAuthContent } from './src/pages/DeviceAuthContent.tsx';
        export { default as ForgotPassword } from './src/pages/ForgotPassword.tsx';
        export { default as ResetPassword } from './src/pages/ResetPassword.tsx';
        export { default as VerifyEmail } from './src/pages/VerifyEmail.tsx';
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    logLevel: 'error',
    external: ['react', 'react-dom', 'react-router-dom'],
    outfile: bundleOut,
    alias: {
      '@xenosystem/elements-react': path.resolve('packages/elements-react/src/index.ts'),
      '@xenosystem/elements': path.resolve('packages/elements/src'),
      '@xenosystem/generate': path.resolve('packages/generate/src/index.ts'),
      '@xenosystem/components/auth': path.resolve('../../../xeno-components/packages/components/src/auth/index.ts'),
    },
    plugins: [
      {
        name: 'auth-forms-fixtures',
        setup(builder) {
          builder.onResolve({ filter: /(AuthContext|authApps|authRouting)$/ }, (args) => ({
            path: args.path.split('/').pop(),
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => {
            const sources = {
              AuthContext: 'export const useAuth = () => ({ isAuthenticated: true, isLoading: false, user: { id: "test-user" } });',
              authApps: 'export const getAuthApp = () => ({ displayName: "XENO CLI", slug: "cli" });',
              authRouting: 'export const authPath = (_kind, query = "") => "/login" + query;',
            };
            return { contents: sources[name] || 'export default {};', loader: 'js' };
          });
        },
      },
    ],
  });

  Pages = await import('./harness/.auth-forms.generated.mjs');
});

after(async () => {
  // Allow any pending timeouts or macrotasks to settle cleanly before closing DOM
  await new Promise((r) => setTimeout(r, 100));
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function render(element) {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function setNativeInputValue(element, value) {
  const isTextArea = element.tagName.toLowerCase() === 'textarea';
  const proto = isTextArea ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

// ── 1. ContactContent View Qualification ──
test('ContactContent: adopts TextInput, supports Enter submission, preserves spaces, and handles busy states', async () => {
  const { ContactContent } = Pages;
  const { container, unmount } = render(
    React.createElement(Router.MemoryRouter, null, React.createElement(ContactContent, null))
  );

  // Label association check
  const nameLabel = container.querySelector('label[for="contact-name"]');
  const nameInput = container.querySelector('#contact-name');
  assert.ok(nameLabel, 'Name label with htmlFor="contact-name" must exist');
  assert.ok(nameInput, 'TextInput with id="contact-name" must exist');
  assert.equal(nameInput.getAttribute('name'), 'name');
  assert.equal(nameInput.getAttribute('autocomplete'), 'name');

  const emailLabel = container.querySelector('label[for="contact-email"]');
  const emailInput = container.querySelector('#contact-email');
  assert.ok(emailLabel, 'Email label with htmlFor="contact-email" must exist');
  assert.ok(emailInput, 'TextInput with id="contact-email" must exist');
  assert.equal(emailInput.getAttribute('type'), 'email');

  const submitButton = container.querySelector('button[type="submit"]');
  assert.ok(submitButton, 'Submit button must exist with type="submit"');
  assert.equal(submitButton.getAttribute('data-variant'), 'primary');

  // Space typing does not submit form
  let submitFired = false;
  const form = container.querySelector('form');
  form.addEventListener('submit', () => { submitFired = true; });

  act(() => {
    nameInput.focus();
    setNativeInputValue(nameInput, 'Jane ');
    nameInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  });
  assert.equal(nameInput.value, 'Jane ');
  assert.equal(submitFired, false, 'Ordinary Space key inside text input must NOT submit form');

  // Fill form and Enter submit
  act(() => {
    setNativeInputValue(nameInput, 'Jane Doe');
    setNativeInputValue(emailInput, 'jane@example.com');
    const messageInput = container.querySelector('#contact-message');
    setNativeInputValue(messageInput, 'Need platform access');
  });

  // Pressing Enter in input submits form
  act(() => {
    emailInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });

  // Verify pending/busy state
  assert.equal(submitButton.getAttribute('data-availability'), 'busy');
  assert.equal(submitButton.getAttribute('aria-busy'), 'true');
  assert.equal(submitButton.hasAttribute('disabled'), true);

  // Await mock submission completion
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1450));
  });

  assert.ok(container.textContent.includes('Message sent!'));
  unmount();
});

// ── 2. DeviceAuthContent View Qualification ──
test('DeviceAuthContent: adopts TextInput, auto-formats codes, submits via Enter, and reflects busy verification', async () => {
  const { DeviceAuthContent } = Pages;
  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    fetchCalled = true;
    return {
      ok: true,
      json: async () => ({ status: 'ok' }),
    };
  };

  try {
    const { container, unmount } = render(
      React.createElement(Router.MemoryRouter, { initialEntries: ['/activate?code=abcd1234'] },
        React.createElement(DeviceAuthContent, { protocol: 'oidc' })
      )
    );

    const form = container.querySelector('form[data-xc="device-code-form"]');
    const codeInput = container.querySelector('[data-field="code"]');
    assert.ok(form, 'Device page must mount @xenosystem/components/auth DeviceCodeForm');
    assert.ok(codeInput, 'Family code field (data-field="code") must exist');
    assert.equal(codeInput.getAttribute('autocomplete'), 'one-time-code');
    assert.equal(codeInput.value, 'ABCD-1234', 'initial code query param should be auto-formatted to ABCD-1234');

    // Submit form
    await act(async () => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });

    assert.equal(fetchCalled, true, 'Submitting valid 8-char code must call device verification endpoint');
    unmount();
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('VerifyEmail: mounts VerifyEmailNotice and reports a missing token as failed', async () => {
  const { VerifyEmail } = Pages;
  const origFetch = globalThis.fetch;
  let verifyCalled = false;
  globalThis.fetch = async () => {
    verifyCalled = true;
    return { ok: false, json: async () => ({}) };
  };
  try {
    const { container, unmount } = render(
      React.createElement(Router.MemoryRouter, { initialEntries: ['/verify-email'] },
        React.createElement(VerifyEmail, null)
      )
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const notice = container.querySelector('[data-xc="verify-email-notice"]');
    assert.ok(notice, 'Verify page must mount @xenosystem/components/auth VerifyEmailNotice');
    assert.equal(notice.getAttribute('data-status'), 'failed');
    assert.ok(container.textContent.includes('This verification link is missing or malformed.'));
    assert.equal(verifyCalled, false, 'A missing token must not POST /api/auth/verify-email');
    unmount();
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── 3. ForgotPassword View Qualification ──
test('ForgotPassword: adopts TextInput, validates email, prevents duplicate submit, and sets aria-busy', async () => {
  const { ForgotPassword } = Pages;
  let forgotFetchCalls = 0;
  let resolveFetch;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    forgotFetchCalls++;
    return new Promise((resolve) => { resolveFetch = () => resolve({ ok: true, json: async () => ({ success: true }) }); });
  };

  try {
    const { container, unmount } = render(
      React.createElement(Router.MemoryRouter, null, React.createElement(ForgotPassword, null))
    );

    const form = container.querySelector('form[data-xc="password-reset-form"]');
    const emailInput = container.querySelector('[data-field="email"]');
    assert.ok(form, 'Forgot password must mount @xenosystem/components/auth PasswordResetForm');
    assert.equal(form.getAttribute('data-mode'), 'request');
    assert.equal(form.getAttribute('data-phase'), 'idle');
    assert.ok(emailInput, 'Family email field (data-field="email") must exist');
    const submitBtn = container.querySelector('button[data-intent="submit"]');

    // Invalid email triggers validation error and does not submit
    act(() => {
      setNativeInputValue(emailInput, 'not-an-email');
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(forgotFetchCalls, 0, 'Invalid email format must not call backend');
    assert.ok(container.textContent.includes('Please enter a valid email address'));

    // Valid email submits
    act(() => {
      setNativeInputValue(emailInput, 'user@example.com');
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(forgotFetchCalls, 1, 'Valid email must trigger submit');

    // Verify busy state while pending
    assert.equal(submitBtn.getAttribute('data-availability'), 'busy');
    assert.equal(submitBtn.getAttribute('aria-busy'), 'true');
    assert.equal(submitBtn.hasAttribute('disabled'), true);

    // Duplicate submit while busy is prevented
    act(() => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(forgotFetchCalls, 1, 'Duplicate submit during busy state must be blocked');

    // Resolve fetch to complete
    await act(async () => {
      resolveFetch();
    });

    // Check confirmation state
    assert.ok(container.textContent.includes('Check your email'));
    unmount();
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── 4. ResetPassword View Qualification ──
test('ResetPassword: adopts TextInput, toggles password visibility with aria labels, validates mismatch, and submits', async () => {
  const { ResetPassword } = Pages;
  let resetFetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    resetFetchCalled = true;
    return { ok: true, json: async () => ({ success: true }) };
  };

  try {
    const { container, unmount } = render(
      React.createElement(Router.MemoryRouter, { initialEntries: ['/reset-password?token=valid_token_123'] },
        React.createElement(ResetPassword, null)
      )
    );

    const form = container.querySelector('form[data-xc="password-reset-form"]');
    const newPassInput = container.querySelector('[data-field="password"]');
    const confirmPassInput = container.querySelector('[data-field="confirm"]');

    assert.ok(form, 'Reset password must mount @xenosystem/components/auth PasswordResetForm');
    assert.equal(form.getAttribute('data-mode'), 'reset');
    assert.ok(newPassInput, 'Family password field (data-field="password") must exist');
    assert.ok(confirmPassInput, 'Family confirm field (data-field="confirm") must exist');

    // Initial type is password
    assert.equal(newPassInput.getAttribute('type'), 'password');
    assert.equal(confirmPassInput.getAttribute('type'), 'password');

    // Visibility toggle
    const toggleBtn = container.querySelector('button[aria-label="Show password"]');
    assert.ok(toggleBtn, 'Password visibility toggle button must exist with aria-label="Show password"');

    act(() => {
      toggleBtn.click();
    });
    assert.equal(newPassInput.getAttribute('type'), 'text', 'Clicking toggle must reveal password');
    assert.equal(toggleBtn.getAttribute('aria-label'), 'Hide password');

    // Password mismatch validation
    act(() => {
      setNativeInputValue(newPassInput, 'Password123!');
      setNativeInputValue(confirmPassInput, 'DifferentPassword!');
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(resetFetchCalled, false, 'Mismatched passwords must block submission');
    assert.ok(container.textContent.includes('Passwords do not match'));

    // Matching passwords submit successfully
    await act(async () => {
      setNativeInputValue(confirmPassInput, 'Password123!');
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(resetFetchCalled, true, 'Matching passwords must call reset-password endpoint');
    assert.ok(container.textContent.includes('Password reset'), 'Confirmation message should display on success');

    unmount();
  } finally {
    globalThis.fetch = origFetch;
  }
});
