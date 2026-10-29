/**
 * XENO Tools' header — after XENO Workshop's (xeno-workshop app/src/shell/Header.tsx): 44px on the toolbar surface,
 * the XENO mark and the product name, a pill switch in the middle, then the inbox, Search · Ctrl K, the theme toggle
 * and the account. Shared by the picker and every opened tool. Styles: tools.css.
 */
import React, { useEffect, useState } from 'react';
import { signInUrl, siteUrl, toolsHome } from './where';

const THEME_KEY = 'xeno-tools-theme';
export function initialTheme(): 'dark' | 'light' {
  try { const v = localStorage.getItem(THEME_KEY); if (v === 'light' || v === 'dark') return v; } catch { /* private window */ }
  return 'dark';
}
export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private window */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const;
}

export interface Me { name: string }
/** The signed-in person, or null when signed out (the header then offers Sign in). */
export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { const u = j && j.user; setMe(u ? { name: String(u.display_name || u.username || u.email || '?') } : null); })
      .catch(() => setMe(null));
  }, []);
  return me;
}

export const XenoMark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 1082 1082" aria-hidden="true" style={{ flex: 'none' }}>
    <path fill="currentColor" d="M489.1 219.763L323.457 39.7072L101.649 30.4597C51.6926 28.3769 39.5494 67.5718 39.7224 87.4296L30.4124 310.735L347.816 655.757L475.833 537.987L241.73 283.514C207.644 246.462 222.019 240.156 233.467 241.634L455.275 250.881L489.1 219.763Z" />
    <path fill="currentColor" d="M861.765 489.52L1041.69 323.704L1050.94 101.684C1053.03 51.6793 1013.87 39.5273 994.024 39.7019L770.9 30.3995L426.135 348.133L543.8 476.263L798.083 241.917C835.108 207.796 841.408 222.184 839.931 233.644L830.674 455.664L861.765 489.52Z" />
    <path fill="currentColor" d="M592.871 862.143L758.514 1042.2L980.322 1051.45C1030.28 1053.53 1042.42 1014.33 1042.25 994.477L1051.56 771.171L734.155 426.15L606.138 543.919L840.241 798.392C874.327 835.444 859.952 841.751 848.504 840.272L626.696 831.025L592.871 862.143Z" />
    <path fill="currentColor" d="M220.763 592.907L40.7063 758.55L31.4588 980.358C29.3761 1030.31 68.5709 1042.46 88.4287 1042.28L311.735 1051.59L656.756 734.191L538.986 606.174L284.514 840.277C247.462 874.363 241.155 859.988 242.633 848.54L251.881 626.733L220.763 592.907Z" />
  </svg>
);

export const Plus = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" /></svg>;
export const Arrow = ({ className }: { className?: string }) => <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 7h9M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" /></svg>;

export interface HeaderProps {
  /** On the picker: which tab is showing. On an opened tool: its name, shown after the product. */
  tab?: 'all' | 'mine';
  onTab?: (t: 'all' | 'mine') => void;
  toolName?: string;
  onSearch?: () => void;
}

export function Header({ tab, onTab, toolName, onSearch }: HeaderProps) {
  const [, flip] = useTheme();
  const me = useMe();
  const search = onSearch || (() => { location.href = toolsHome; });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); search(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [search]);
  return (
    <header className="xt-head" data-tools-header>
      <a className="xt-hb xt-home" href={toolsHome} title="XENO Tools home" data-tools-back><XenoMark /><b>Tools</b></a>
      {toolName && <><span className="xt-crumb">/</span><span className="xt-crumb-name">{toolName}</span></>}
      <div style={{ flex: 1 }} />
      {onTab && (
        <div className="xt-tabs" role="tablist" aria-label="Tools">
          <button type="button" role="tab" className="xt-tab" aria-selected={tab === 'all'} onClick={() => onTab('all')} data-tools-tab="all">All tools</button>
          <button type="button" role="tab" className="xt-tab" aria-selected={tab === 'mine'} onClick={() => onTab('mine')} data-tools-tab="mine">My tools</button>
        </div>
      )}
      <div style={{ flex: 1 }} />
      {me && (
        <a className="xt-hb xt-hi" href={siteUrl('/workspace/inbox')} aria-label="Inbox">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z M10 21h4" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /></svg>
        </a>
      )}
      <button type="button" className="xt-search" title="Search · Ctrl K" onClick={search}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1.5 1.5h6v6h-6zM7.5 7.5l3 3" stroke="currentColor" strokeWidth="1.5" /></svg>
        <span className="xt-wide">Search</span><span className="xt-mono" style={{ fontSize: 10 }}>Ctrl K</span>
      </button>
      <button type="button" className="xt-hb xt-hi" aria-label="Toggle theme" onClick={flip} data-tools-theme>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 2h10v10H2z" stroke="currentColor" strokeWidth="1.4" /><path d="M7 2h5v10H7z" fill="currentColor" /></svg>
      </button>
      {me === null && <a className="xt-signin" href={signInUrl(location.pathname + location.search)} data-tools-signin>Sign in</a>}
      {me && <a className="xt-avatar" href={siteUrl('/workspace/settings')} aria-label={`Account: ${me.name}`} title={me.name}>{me.name.trim().charAt(0).toUpperCase() || '?'}</a>}
    </header>
  );
}
