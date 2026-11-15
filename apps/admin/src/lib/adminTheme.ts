import { useEffect, useLayoutEffect, useState } from 'react';
import { useAdminThemeStore, type AdminThemeChoice } from '@/stores/adminThemeStore';

/*
 * The admin panel's dark mode (2026-10-28, user: "go for dark mode
 * implementation of cestoshop website... And admin panel... do it the way you
 * did it for rep dashboard").
 *
 * The admin chooses light, dark or their device's (the default); the choice
 * resolves to light or dark and is set as `data-admin-theme` on <html> for the
 * whole app — the login page and every screen. The colours are tokens: app.css
 * repaints them under html[data-admin-theme="dark"].
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';
/** The browser's own chrome on a phone matches the page. */
const CANVAS = { light: '#FFFFFF', dark: '#0B1220' } as const;

function deviceIsDark(): boolean {
  try { return window.matchMedia(DARK_QUERY).matches; } catch { return false; }
}

/** The admin's choice, and what it comes to now. */
export function useAdminTheme(): { choice: AdminThemeChoice; setChoice: (c: AdminThemeChoice) => void; resolved: 'light' | 'dark' } {
  const choice = useAdminThemeStore((s) => s.choice);
  const setChoice = useAdminThemeStore((s) => s.setChoice);
  const [systemDark, setSystemDark] = useState(deviceIsDark);
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(DARK_QUERY); } catch { return undefined; }
    const follow = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  }, []);
  return { choice, setChoice, resolved: choice === 'system' ? (systemDark ? 'dark' : 'light') : choice };
}

/** Puts the theme on <html>, and the phone's address bar in the page's colour. */
export function useApplyAdminTheme(resolved: 'light' | 'dark') {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.adminTheme = resolved;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = CANVAS[resolved];
  }, [resolved]);
}
