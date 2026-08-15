import { useEffect, useState } from 'react';

/**
 * Which of the three palettes a chat surface should wear, and how to find out.
 *
 * The palettes themselves are in `chat-theme.css`, loaded once at the entry point. This is the other
 * half: the preference the user set, resolved to one of the three classes that file defines.
 *
 * It lives here rather than inside ChatWithLLM for the same reason the CSS does. ChatWithLLM owns the
 * theme SWITCHER — it writes these keys, and it holds the slider and the preview — but every other
 * chat surface is its own route and needs only to READ the answer. A component that owns a setting is
 * not thereby the only component allowed to know it.
 */
export type ChatTheme = 'system' | 'custom' | 'dark' | 'dim' | 'light';
export type ResolvedChatTheme = Exclude<ChatTheme, 'system' | 'custom'>;

export const CHAT_THEME_STORAGE_KEY = 'xeno-chat-theme';
export const CHAT_THEME_BRIGHTNESS_STORAGE_KEY = 'xeno-chat-theme-brightness';

/**
 * The three fixed palettes, laid out along the 0–100 brightness slider the customizer shows. The
 * positions are what make `custom` resolvable: a slider anywhere on that line snaps to whichever of
 * the three it is nearest, so a custom brightness still has a palette behind it.
 */
export const VISUAL_CHAT_THEME_OPTIONS = [
  { id: 'dark', label: 'Dark', position: 0 },
  { id: 'dim', label: 'Dim', position: 50 },
  { id: 'light', label: 'Light', position: 100 },
] as const satisfies readonly { id: ResolvedChatTheme; label: string; position: number }[];

export const getVisualThemePosition = (theme: ResolvedChatTheme): number =>
  VISUAL_CHAT_THEME_OPTIONS.find((option) => option.id === theme)?.position ?? 0;

export const getClosestVisualTheme = (position: number): ResolvedChatTheme =>
  VISUAL_CHAT_THEME_OPTIONS.reduce((closest, option) =>
    Math.abs(option.position - position) < Math.abs(closest.position - position) ? option : closest,
  ).id;

const readStoredTheme = (): ChatTheme => {
  try {
    const stored = localStorage.getItem(CHAT_THEME_STORAGE_KEY);
    if (stored === 'system' || stored === 'custom' || stored === 'dark' || stored === 'dim' || stored === 'light') {
      return stored;
    }
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The default is not an error.
  }
  return 'system';
};

const readStoredBrightness = (): number => {
  try {
    const stored = Number(localStorage.getItem(CHAT_THEME_BRIGHTNESS_STORAGE_KEY));
    if (Number.isFinite(stored)) return Math.min(100, Math.max(0, stored));
  } catch {
    // As above.
  }
  return 0;
};

const prefersDark = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const resolve = (): ResolvedChatTheme => {
  const preference = readStoredTheme();
  if (preference === 'system') return prefersDark() ? 'dark' : 'light';
  if (preference === 'custom') return getClosestVisualTheme(readStoredBrightness());
  return preference;
};

/**
 * The resolved palette for a read-only surface, kept current.
 *
 * Two listeners, and both earn their place. `storage` fires when the preference changes in ANOTHER
 * tab, which is the ordinary case here — the chat and the search interface are separate routes, so a
 * user who changes the theme in one and comes back to the other would otherwise find it stale. The
 * media query matters only while the preference is `system`, and subscribing unconditionally is
 * cheaper than working out when to.
 *
 * Server-side and first paint both start from the stored value, so there is no flash of the wrong
 * palette on a route that is not the chat.
 */
export function useResolvedChatTheme(): ResolvedChatTheme {
  const [theme, setTheme] = useState<ResolvedChatTheme>(() =>
    typeof window === 'undefined' ? 'dark' : resolve(),
  );

  useEffect(() => {
    const update = () => setTheme(resolve());
    update();
    window.addEventListener('storage', update);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', update);
    return () => {
      window.removeEventListener('storage', update);
      media?.removeEventListener('change', update);
    };
  }, []);

  return theme;
}
