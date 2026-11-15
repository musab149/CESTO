import { useEffect, useLayoutEffect, useState } from 'react';
import { useSalesThemeStore, type SalesThemeChoice } from '@/stores/salesThemeStore';

/*
 * The rep panel's dark mode (2026-10-28, user: "implement the dark mode
 * reps... do it properly on each page carefully").
 *
 * The rep chooses light, dark or their device's (the default); the choice
 * resolves to light or dark, and while the panel is open that is set as
 * `data-sales-theme` on <html> — the one place every .sales-app sees it, the
 * layout and each dialog's portal alike. The colours themselves are tokens:
 * app.css repaints them under html[data-sales-theme="dark"] .sales-app.
 * Leaving the panel takes the attribute away, so the shop stays as it is.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';
/** The browser's own chrome on a phone — the address bar — matches the canvas. */
const CANVAS = { light: '#F1F4F9', dark: '#0B1220' } as const;

function deviceIsDark(): boolean {
  try { return window.matchMedia(DARK_QUERY).matches; } catch { return false; }
}

/** The rep's choice, and what it comes to now. */
export function useSalesTheme(): { choice: SalesThemeChoice; setChoice: (c: SalesThemeChoice) => void; resolved: 'light' | 'dark' } {
  const choice = useSalesThemeStore((s) => s.choice);
  const setChoice = useSalesThemeStore((s) => s.setChoice);
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
export function useApplySalesTheme(resolved: 'light' | 'dark') {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.salesTheme = resolved;
    // Never the shop's too: a rep sent here from a shop path before any shop
    // layout mounted still carries the one index.html set (lib/shopTheme).
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
