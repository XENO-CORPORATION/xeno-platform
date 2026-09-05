import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  buildChatThemeStyle,
  getClosestVisualTheme,
  getRelativeLuminance,
  getThemePreviewTokens,
  getVisualThemePosition,
  normalizeThemeBrightness,
  type ResolvedChatTheme,
} from './platformThemePalette';
import { userDataService } from '../services/userDataService';

/** The single authenticated appearance preference for every platform surface. */
export type PlatformThemePreference = 'system' | 'custom' | 'dark' | 'dim' | 'light';
export type ResolvedPlatformTheme = ResolvedChatTheme;

export const PLATFORM_THEME_STORAGE_KEY = 'xeno_platform_theme';
export const PLATFORM_THEME_BRIGHTNESS_STORAGE_KEY = 'xeno_platform_theme_brightness';
export const PLATFORM_THEME_EVENT = 'xeno_platform_theme_change';

// Read-only migration aliases. New code never writes these Chat-owned keys.
const LEGACY_CHAT_THEME_STORAGE_KEY = 'xeno-chat-theme';
const LEGACY_CHAT_THEME_BRIGHTNESS_STORAGE_KEY = 'xeno-chat-theme-brightness';

export const normalizePlatformTheme = (value: unknown): PlatformThemePreference | null =>
  value === 'system' || value === 'custom' || value === 'dark' || value === 'dim' || value === 'light'
    ? value
    : null;

export const normalizePlatformThemeBrightness = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return normalizeThemeBrightness(Number.isFinite(parsed) ? parsed : 0);
};

export const getPlatformThemePosition = (preference: PlatformThemePreference, currentBrightness = 0): number =>
  preference === 'system'
    ? getVisualThemePosition(readSystemTheme())
    : preference === 'custom'
    ? normalizePlatformThemeBrightness(currentBrightness)
    : getVisualThemePosition(preference);

const readStorage = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
};

const readStoredTheme = (): PlatformThemePreference =>
  normalizePlatformTheme(readStorage(PLATFORM_THEME_STORAGE_KEY))
  || normalizePlatformTheme(readStorage(LEGACY_CHAT_THEME_STORAGE_KEY))
  || 'system';

const readStoredBrightness = (): number => {
  const current = readStorage(PLATFORM_THEME_BRIGHTNESS_STORAGE_KEY);
  const legacy = readStorage(LEGACY_CHAT_THEME_BRIGHTNESS_STORAGE_KEY);
  return normalizePlatformThemeBrightness(current ?? legacy ?? 0);
};

const readSystemTheme = (): Extract<ResolvedPlatformTheme, 'light' | 'dark'> => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const announcePlatformTheme = (
  preference: PlatformThemePreference,
  brightness = preference === 'custom' ? readStoredBrightness() :
    preference === 'system' ? readStoredBrightness() : getVisualThemePosition(preference),
) => {
  if (typeof window === 'undefined') return;
  const normalizedBrightness = normalizePlatformThemeBrightness(brightness);
  try {
    window.localStorage.setItem(PLATFORM_THEME_STORAGE_KEY, preference);
    window.localStorage.setItem(PLATFORM_THEME_BRIGHTNESS_STORAGE_KEY, String(normalizedBrightness));
    window.localStorage.removeItem(LEGACY_CHAT_THEME_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_CHAT_THEME_BRIGHTNESS_STORAGE_KEY);
  } catch {
    // The server remains authoritative when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(PLATFORM_THEME_EVENT, {
    detail: { preference, brightness: normalizedBrightness },
  }));
};

/** Persist first, then announce the server-confirmed platform appearance. */
export const savePlatformTheme = async (
  preference: PlatformThemePreference,
  brightness: number,
) => {
  const normalizedBrightness = normalizePlatformThemeBrightness(brightness);
  const confirmed = await userDataService.updateSettingsBatch([
    { path: 'appearance.theme', value: preference },
    { path: 'appearance.themeBrightness', value: normalizedBrightness },
  ]);
  const confirmedPreference = normalizePlatformTheme(confirmed.appearance?.theme);
  if (!confirmedPreference) throw new Error('The server did not confirm the selected theme.');
  const confirmedBrightness = normalizePlatformThemeBrightness(confirmed.appearance?.themeBrightness);
  announcePlatformTheme(confirmedPreference, confirmedBrightness);
  return { preference: confirmedPreference, brightness: confirmedBrightness } as const;
};

export const buildPlatformThemeStyle = (position: number): CSSProperties => {
  const normalizedPosition = normalizePlatformThemeBrightness(position);
  const tokens = getThemePreviewTokens(normalizedPosition);
  const chatTokens = buildChatThemeStyle(normalizedPosition);
  const isLight = getRelativeLuminance(tokens.canvas) > 0.45;
  return {
    ...chatTokens,
    '--xeno-theme-canvas': tokens.canvas,
    '--xeno-theme-surface': tokens.surface,
    '--xeno-theme-surface-raised': tokens.elevated,
    '--xeno-theme-surface-subtle': tokens.surface,
    '--xeno-theme-surface-muted': tokens.control,
    '--xeno-theme-hover': tokens.hover,
    '--xeno-theme-active': tokens.controlStrong,
    '--xeno-theme-nav-hover': `color-mix(in srgb, ${tokens.text} ${isLight ? 5 : 6}%, transparent)`,
    '--xeno-theme-nav-active': `color-mix(in srgb, ${tokens.text} ${isLight ? 9 : 10}%, transparent)`,
    '--xeno-theme-row-hover': `color-mix(in srgb, ${tokens.text} ${isLight ? 4 : 5}%, transparent)`,
    '--xeno-theme-control-hover': tokens.hover,
    '--xeno-theme-text-hover': `color-mix(in srgb, ${tokens.text} 72%, ${tokens.muted})`,
    '--xeno-theme-focus-ring': `color-mix(in srgb, ${tokens.text} ${isLight ? 42 : 52}%, transparent)`,
    '--xeno-theme-border': tokens.border,
    '--xeno-theme-border-strong': isLight ? 'rgba(0, 0, 0, 0.20)' : 'rgba(255, 255, 255, 0.16)',
    '--xeno-theme-text': tokens.text,
    '--xeno-theme-text-muted': tokens.muted,
    '--xeno-theme-text-soft': tokens.muted,
    '--xeno-theme-inverse': tokens.text,
    '--xeno-theme-inverse-text': tokens.canvas,
    '--xeno-theme-overlay': tokens.overlay,
    '--xeno-theme-shadow': isLight ? 'rgba(19, 23, 31, 0.12)' : 'rgba(0, 0, 0, 0.46)',
  } as CSSProperties;
};

export const usePlatformTheme = () => {
  const [preference, setPreference] = useState<PlatformThemePreference>(readStoredTheme);
  const [brightness, setBrightness] = useState<number>(readStoredBrightness);
  const [systemTheme, setSystemTheme] = useState<Extract<ResolvedPlatformTheme, 'light' | 'dark'>>(readSystemTheme);

  useEffect(() => {
    let active = true;
    userDataService.getSettings()
      .then((settings) => {
        const confirmedPreference = normalizePlatformTheme(settings.appearance?.theme);
        if (!active || !confirmedPreference) return;
        const confirmedBrightness = normalizePlatformThemeBrightness(settings.appearance?.themeBrightness);
        announcePlatformTheme(confirmedPreference, confirmedBrightness);
      })
      .catch(() => {
        // Last-known local rendering remains available; Settings reports server errors explicitly.
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemTheme = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'dark' : 'light');
    const onPreference = (event: Event) => {
      const detail = (event as CustomEvent<{ preference?: unknown; brightness?: unknown }>).detail;
      const nextPreference = normalizePlatformTheme(detail?.preference);
      if (nextPreference) setPreference(nextPreference);
      if (detail?.brightness !== undefined) setBrightness(normalizePlatformThemeBrightness(detail.brightness));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PLATFORM_THEME_STORAGE_KEY && event.key !== PLATFORM_THEME_BRIGHTNESS_STORAGE_KEY) return;
      setPreference(readStoredTheme());
      setBrightness(readStoredBrightness());
    };
    media.addEventListener('change', onSystemTheme);
    window.addEventListener(PLATFORM_THEME_EVENT, onPreference);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystemTheme);
      window.removeEventListener(PLATFORM_THEME_EVENT, onPreference);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const resolvedTheme: ResolvedPlatformTheme = preference === 'system'
    ? systemTheme
    : preference === 'custom'
      ? getClosestVisualTheme(brightness)
      : preference;
  const resolvedPosition = preference === 'system'
    ? getVisualThemePosition(systemTheme)
    : preference === 'custom'
      ? brightness
      : getVisualThemePosition(preference);
  const themeStyle = useMemo(() => buildPlatformThemeStyle(resolvedPosition), [resolvedPosition]);

  return { preference, brightness, resolvedTheme, resolvedPosition, themeStyle } as const;
};
