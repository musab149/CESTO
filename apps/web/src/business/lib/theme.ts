import { useEffect, useLayoutEffect, useState } from 'react';
import { useBusinessThemeStore, type BusinessThemeChoice } from '@/stores/businessThemeStore';

/*
 * The business panel's dark mode (2026-10-29) — the rep panel's, and its
 * palette: the panel is drawn in the rep panel's tokens (`.sales-app`), which
 * app.css repaints under html[data-sales-theme="dark"]. So this sets that
 * attribute, from the buyer's own choice. Leaving the panel takes it away.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';
/** The browser's own chrome on a phone — the address bar — matches the canvas. */
const CANVAS = { light: '#F1F4F9', dark: '#0B1220' } as const;

function deviceIsDark(): boolean {
  try { return window.matchMedia(DARK_QUERY).matches; } catch { return false; }
}

export function useBusinessTheme(): { choice: BusinessThemeChoice; setChoice: (c: BusinessThemeChoice) => void; resolved: 'light' | 'dark' } {
  const choice = useBusinessThemeStore((s) => s.choice);
  const setChoice = useBusinessThemeStore((s) => s.setChoice);
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

/** Puts the theme on <html> while the panel is mounted, and the phone's address bar in the canvas colour. */
export function useApplyBusinessTheme(resolved: 'light' | 'dark') {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.salesTheme = resolved;
    // Never the shop's too: index.html may have set it before any layout mounted.
    delete root.dataset.shopTheme;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const created = !meta;
    const before = meta?.content ?? null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = CANVAS[resolved];
    return () => {
      delete root.dataset.salesTheme;
      if (created) meta?.remove();
      else if (meta && before != null) meta.content = before;
    };
  }, [resolved]);
}
