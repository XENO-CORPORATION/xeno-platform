import React from 'react';
import { Toaster, toast } from 'sonner';
import { usePlatformTheme } from '../../platform/platformTheme';

/**
 * The XENO notification surface, and the replacement for `alert()`.
 *
 * 🔴 `sonner` was already a dependency and `Pricing.tsx` already called
 * `toast.error('Could not start checkout')` — and **no `<Toaster />` was mounted
 * anywhere in the app**, so that call rendered nothing. A customer whose checkout
 * failed to start got silence. Built, wired, unreachable, on the payment path.
 *
 * Mounting it here fixes that, and gives the 65 remaining `alert()` calls
 * somewhere to go that is not a browser dialog.
 *
 * ── WHY NOT components/ui/sonner.tsx ──────────────────────────────────────
 *
 * That wrapper reads the theme from `next-themes`, which is a Next.js library in
 * a Vite application. It resolves 'system' rather than the platform's own theme,
 * so it would drift from every other surface the moment someone changes the XENO
 * theme. `usePlatformTheme` is the one the rest of the platform uses.
 */
export function PlatformNotifications() {
  const { resolvedTheme, themeStyle } = usePlatformTheme();
  return (
    <div className="xeno chat-themed" data-theme={resolvedTheme} data-style="industrial" style={themeStyle}>
      <Toaster
        position="bottom-right"
        theme={resolvedTheme === 'light' ? 'light' : 'dark'}
        closeButton
        // Long enough to read a sentence, and dismissible. An error that vanishes
        // before it is read is the same as no error.
        duration={6000}
        toastOptions={{
          style: {
            background: 'var(--xeno-surface-2, #111111)',
            border: '1px solid var(--xeno-border, rgba(255,255,255,0.08))',
            color: 'var(--xeno-text-1, #e4e4e8)',
            borderRadius: '4px',
          },
        }}
      />
    </div>
  );
}

/**
 * What a failed operation says to the person who attempted it.
 *
 * Deliberately a small surface: `alert()` was used for exactly two things in this
 * codebase — "that failed" and, rarely, "that worked" — so this offers those and
 * nothing more. A notification API with ten options grows ten inconsistent uses.
 *
 * A DECISION is not a notification: anything the user has to answer belongs in
 * ActionDialog, which blocks, focuses and can be cancelled. Toasts are for things
 * that have already happened.
 */
export const notify = {
  error: (message: string) => toast.error(message),
  success: (message: string) => toast.success(message),
  info: (message: string) => toast(message),
};

export default PlatformNotifications;
