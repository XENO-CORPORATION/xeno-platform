import { useEffect, useMemo, useState } from 'react';

/**
 * What palette a chat surface should wear, and how to find out.
 *
 * There are not three themes. There is a BRIGHTNESS LINE with twenty-one stops, each owning a
 * complete semantic palette, and Dark / Dim / Light are the names of three of them — the stops at 0,
 * 50 and 100. Those three are CSS classes in `chat-theme.css` because they are fixed and worth
 * naming; the other eighteen have no class to be, and arrive as inline custom properties from
 * {@link buildChatThemeStyle}. A surface that themes itself by picking the nearest named class and
 * stopping there throws away everything the slider is for.
 *
 * So {@link useChatTheme} returns BOTH — a class and a style — and a caller applies both without
 * having to know which stop it landed on.
 *
 * This lives here rather than inside ChatWithLLM for the same reason the CSS does. ChatWithLLM owns
 * the theme SWITCHER — it writes these keys, it holds the slider and the live preview — but every
 * other chat surface is its own route and needs only to READ the answer. A component that owns a
 * setting is not thereby the only component allowed to know it.
 */
export type ChatTheme = 'system' | 'custom' | 'dark' | 'dim' | 'light';
export type ResolvedChatTheme = Exclude<ChatTheme, 'system' | 'custom'>;

/** The slider moves in five-percent steps, which is what makes the palette table twenty-one long. */
export const THEME_BRIGHTNESS_STEP = 5;

export const CHAT_THEME_STORAGE_KEY = 'xeno-chat-theme';
export const CHAT_THEME_BRIGHTNESS_STORAGE_KEY = 'xeno-chat-theme-brightness';

/**
 * The three stops on the line that have names, and where they sit on it. Used for the labels, for the
 * snap when the user picks a named theme, and — via {@link getClosestVisualTheme} — to pick the
 * BASE class under a custom position, whose exact colours then come from the inline style.
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

export interface ChatThemeDress {
  /** `chat-theme-dark` | `chat-theme-dim` | `chat-theme-light` — the base class. */
  readonly themeClass: string;
  /**
   * The custom stop's colours, or `undefined` at a named stop.
   *
   * Apply BOTH. The class is the floor — it defines every token, including the handful the inline
   * style does not carry — and the style overrides the ones that actually differ at this position.
   * Applying only the class rounds an eighteen-stop line down to three.
   */
  readonly themeStyle: Record<string, string> | undefined;
}

/**
 * The palette a read-only surface should wear, kept current.
 *
 * Two listeners, and both earn their place. `storage` fires when the preference changes in ANOTHER
 * tab, which is the ordinary case here — the chat and the search interface are separate routes, so a
 * user who changes the theme in one and comes back to the other would otherwise find it stale. The
 * media query matters only while the preference is `system`, and subscribing unconditionally is
 * cheaper than working out when to.
 *
 * First paint starts from the stored value, so a route that is not the chat gets no flash of the
 * wrong palette.
 */
export function useChatTheme(): ChatThemeDress {
  const [{ preference, brightness }, setState] = useState(() =>
    typeof window === 'undefined'
      ? { preference: 'system' as ChatTheme, brightness: 0 }
      : { preference: readStoredTheme(), brightness: readStoredBrightness() },
  );
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === 'undefined' ? true : prefersDark(),
  );

  useEffect(() => {
    const update = () => {
      setState({ preference: readStoredTheme(), brightness: readStoredBrightness() });
      setSystemDark(prefersDark());
    };
    update();
    window.addEventListener('storage', update);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', update);
    return () => {
      window.removeEventListener('storage', update);
      media?.removeEventListener('change', update);
    };
  }, []);

  return useMemo(() => {
    if (preference === 'custom') {
      return {
        themeClass: `chat-theme-${getClosestVisualTheme(brightness)}`,
        themeStyle: buildChatThemeStyle(brightness),
      };
    }
    const named: ResolvedChatTheme =
      preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
    return { themeClass: `chat-theme-${named}`, themeStyle: undefined };
  }, [preference, brightness, systemDark]);
}

export type ChatThemePreviewTokens = {
  canvas: string;
  surface: string;
  elevated: string;
  control: string;
  controlStrong: string;
  text: string;
  muted: string;
  border: string;
  hover: string;
  overlay: string;
};

export type ChatThemeRuntimeTokens = ChatThemePreviewTokens & {
  surfaceText: string;
  surfaceMuted: string;
};

export const createChatThemePalette = (
  canvas: string,
  surface: string,
  elevated: string,
  control: string,
  controlStrong: string,
  text: string,
  muted: string,
  border: string,
  hover: string,
  overlay: string,
): ChatThemePreviewTokens => ({
  canvas,
  surface,
  elevated,
  control,
  controlStrong,
  text,
  muted,
  border,
  hover,
  overlay,
});

// Every selectable five-percent step owns a complete semantic palette. The
// surfaces therefore change independently instead of receiving one shared
// brightness curve. The first and last entries remain the ElevenLabs endpoints.
export const CHAT_THEME_SURFACE_PALETTES: readonly ChatThemePreviewTokens[] = [
  createChatThemePalette('#0a0a0a', '#171717', '#262626', '#262626', '#404040', '#fafafa', '#a3a3a3', '#242424', '#404040', '#171717'),
  createChatThemePalette('#0c0c0d', '#19191a', '#282829', '#29292a', '#424244', '#fafafa', '#a4a4a4', '#272728', '#424244', '#19191a'),
  createChatThemePalette('#0e0e0f', '#1b1b1c', '#2a2a2b', '#2c2c2d', '#444446', '#fafafa', '#a6a6a6', '#2a2a2b', '#444446', '#1b1b1c'),
  createChatThemePalette('#101011', '#1d1d1e', '#2c2c2d', '#2f2f30', '#464648', '#fafafa', '#a8a8a8', '#2d2d2e', '#464648', '#1d1d1e'),
  createChatThemePalette('#121213', '#1f1f20', '#2e2e2f', '#323233', '#48484a', '#fafafa', '#aaaaaa', '#303031', '#48484a', '#1f1f20'),
  createChatThemePalette('#141415', '#212122', '#303031', '#353536', '#4a4a4c', '#fafafa', '#acacac', '#333334', '#4a4a4c', '#212122'),
  createChatThemePalette('#161617', '#232324', '#323233', '#383839', '#4c4c4e', '#fafafa', '#aeaeae', '#363637', '#4c4c4e', '#232324'),
  createChatThemePalette('#181819', '#252526', '#343435', '#3b3b3c', '#4e4e50', '#fafafa', '#b0b0b0', '#39393a', '#4e4e50', '#252526'),
  createChatThemePalette('#1a1a1b', '#272728', '#363637', '#3e3e3f', '#505052', '#f8f8f8', '#b2b2b2', '#3c3c3d', '#505052', '#272728'),
  createChatThemePalette('#1c1c1d', '#29292a', '#383839', '#414142', '#525254', '#f7f7f7', '#b4b4b4', '#3f3f40', '#525254', '#29292a'),
  createChatThemePalette('#181a1e', '#24272c', '#30343a', '#383c43', '#4b5059', '#f4f5f7', '#aeb2b8', '#3c4047', '#4b5059', '#24272c'),
  createChatThemePalette('#1b1d22', '#272a30', '#34383f', '#3c4149', '#505660', '#f4f5f7', '#b2b6bd', '#41464e', '#505660', '#272a30'),
  createChatThemePalette('#1e2126', '#2b2e35', '#383c44', '#41464f', '#565d67', '#f5f6f8', '#b6bbc2', '#464b53', '#565d67', '#2b2e35'),
  createChatThemePalette('#21242a', '#2f333a', '#3c4149', '#464b54', '#5c636e', '#f5f6f8', '#bbc0c7', '#4b5059', '#5c636e', '#2f333a'),
  createChatThemePalette('#25282e', '#33373f', '#41464f', '#4b515b', '#626a75', '#f6f7f8', '#c0c5cc', '#505660', '#626a75', '#33373f'),
  createChatThemePalette('#282b31', '#383c44', '#464b55', '#505661', '#69717c', '#f7f8fa', '#c5cad0', '#565d67', '#69717c', '#383c44'),
  createChatThemePalette('#30343b', '#41464d', '#505661', '#5b626d', '#757d88', '#f8f9fa', '#d0d4d9', '#626a74', '#757d88', '#41464d'),
  createChatThemePalette('#3b4048', '#4b515b', '#5d6470', '#686f7b', '#858c96', '#fafafa', '#e0e2e6', '#707782', '#858c96', '#4b515b'),
  createChatThemePalette('#414956', '#4d5562', '#59616f', '#656e7c', '#7a8492', '#fafafa', '#d5dae2', '#59616f', '#656e7c', '#4d5562'),
  createChatThemePalette('#d7d9dd', '#e1e3e6', '#eceef0', '#f1f2f3', '#f6f7f8', '#0a0a0a', '#55585d', '#dfe1e4', '#f6f7f8', '#e1e3e6'),
  createChatThemePalette('#ffffff', '#fafafa', '#ffffff', '#f5f5f5', '#e5e5e5', '#0a0a0a', '#737373', '#e5e5e5', '#f5f5f5', '#fafafa'),
];

export const getRelativeLuminance = (hex: string): number => {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

export const getContrastRatio = (first: string, second: string): number => {
  const [lighter, darker] = [getRelativeLuminance(first), getRelativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

export const getAccessibleTextTokens = (
  canvas: string,
  preferredText?: string,
  preferredMuted?: string,
): Pick<ChatThemePreviewTokens, 'text' | 'muted'> => {
  const lightText = '#fafafa';
  const darkText = '#0a0a0a';
  const fallbackText = getContrastRatio(lightText, canvas) >= getContrastRatio(darkText, canvas) ? lightText : darkText;
  const text = preferredText && getContrastRatio(preferredText, canvas) >= 4.5 ? preferredText : fallbackText;
  const muted = preferredMuted && getContrastRatio(preferredMuted, canvas) >= 4.5
    ? preferredMuted
    : text;

  return { text, muted };
};

export const getThemePreviewTokens = (position: number): ChatThemeRuntimeTokens => {
  const clampedPosition = Math.min(100, Math.max(0, position));
  const paletteIndex = Math.min(
    CHAT_THEME_SURFACE_PALETTES.length - 1,
    Math.round(clampedPosition / THEME_BRIGHTNESS_STEP),
  );
  const paletteTokens = CHAT_THEME_SURFACE_PALETTES[paletteIndex];

  return {
    ...paletteTokens,
    ...getAccessibleTextTokens(paletteTokens.canvas, paletteTokens.text, paletteTokens.muted),
    surfaceText: getAccessibleTextTokens(
      paletteTokens.controlStrong,
      paletteTokens.text,
      paletteTokens.muted,
    ).text,
    surfaceMuted: getAccessibleTextTokens(
      paletteTokens.controlStrong,
      paletteTokens.text,
      paletteTokens.muted,
    ).muted,
  };
};

export const normalizeThemeBrightness = (position: number): number =>
  Math.round(Math.min(100, Math.max(0, position)) / THEME_BRIGHTNESS_STEP) * THEME_BRIGHTNESS_STEP;

/**
 * The CSS custom properties for one point on the brightness line.
 *
 * The three named palettes are classes in `chat-theme.css` because they are fixed. Everything BETWEEN
 * them is not: the slider has twenty-one stops, each with its own complete semantic palette, and a
 * position that is not 0, 50 or 100 has no class to be. It arrives as inline custom properties
 * instead — which is why a surface cannot theme itself by picking the nearest of three and stopping
 * there. Snap a 30% slider to `dark` and the user's chosen greys are simply gone.
 *
 * Derived rather than tabulated wherever a value follows from the palette: the danger red, the
 * composer fill, the rail stroke and the sunk top-bar fill all key off whether the canvas or the rail
 * came out light, so a new stop in the table needs no new entries here.
 */
export function buildChatThemeStyle(position: number): Record<string, string> {
  const tokens = getThemePreviewTokens(position);
  const railIsLight = getRelativeLuminance(tokens.elevated) > 0.45;
  const canvasIsLight = getRelativeLuminance(tokens.canvas) > 0.45;
  return {
    '--chat-canvas': tokens.canvas,
    '--chat-surface': tokens.surface,
    '--chat-elevated': tokens.elevated,
    '--chat-control': tokens.control,
    '--chat-control-strong': tokens.controlStrong,
    '--chat-text': tokens.text,
    '--chat-muted': tokens.muted,
    '--chat-surface-text': tokens.surfaceText,
    '--chat-surface-muted': tokens.surfaceMuted,
    '--chat-border': tokens.border,
    '--chat-hover': tokens.hover,
    // Dark themes: fade must stay near-canvas (tokens.hover is often too light).
    '--chat-project-preview-fade': canvasIsLight
      ? tokens.hover
      : `color-mix(in srgb, ${tokens.canvas} 82%, ${tokens.elevated} 18%)`,
    '--chat-overlay': tokens.overlay,
    '--chat-accent': tokens.text,
    '--chat-accent-soft': canvasIsLight
      ? `color-mix(in srgb, ${tokens.text} 14%, transparent)`
      : `color-mix(in srgb, ${tokens.text} 20%, transparent)`,
    '--chat-on-accent': tokens.canvas,
    '--chat-danger': canvasIsLight ? '#dc2626' : '#ef4444',
    '--chat-danger-hover': canvasIsLight ? '#b91c1c' : '#f87171',
    '--chat-composer-fill': canvasIsLight
      ? tokens.elevated
      : `color-mix(in srgb, ${tokens.canvas} 70%, ${tokens.elevated} 30%)`,
    '--chat-composer-border': canvasIsLight
      ? 'rgba(0, 0, 0, 0.14)'
      : 'rgba(255, 255, 255, 0.12)',
    // No drop shadow on the composer: it would paint a hard edge straight across the
    // liquid neck the gooey reveal grows out of the box. The stroke carries the shape.
    '--chat-composer-shadow': 'none',
    '--chat-tool-rail-stroke': railIsLight ? 'rgba(24, 24, 27, 0.72)' : 'rgba(245, 245, 245, 0.78)',
    '--chat-top-bar-btn-active': canvasIsLight
      ? tokens.control
      : `color-mix(in srgb, ${tokens.canvas} 55%, black)`,
    '--chat-tool-rail-stroke-soft': railIsLight ? 'rgba(24, 24, 27, 0.48)' : 'rgba(245, 245, 245, 0.58)',
    // History sidebar tracks the interpolated surface at every custom brightness;
    // the fixed Light theme keeps its warm cream via the CSS fallback.
    '--chat-history-fill': tokens.surface,
    '--chat-history-border': tokens.border,
    '--chat-history-shadow': canvasIsLight ? '0 4px 18px rgba(0, 0, 0, 0.06)' : 'none',
  };
}
