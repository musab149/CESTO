import { useEffect, useLayoutEffect, useState } from 'react';
import { useShopThemeStore, type ShopThemeChoice } from '@/stores/shopThemeStore';

/*
 * The shop's dark mode (2026-10-28, user: "go for dark mode implementation of
 * cestoshop website... do it the way you did it for rep dashboard").
 *
 * The shopper chooses light, dark or their device's (the default); the choice
 * resolves to light or dark, and while a shop layout is open that is set as
 * `data-shop-theme` on <html>. The colours are tokens: app.css repaints them
 * under html[data-shop-theme="dark"]. Leaving the shop — for the rep or the
 * partner panel — takes the attribute away, so neither ever sees it.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';
/** The browser's own chrome on a phone matches the header bar. */
const BAR = { light: '#054EE8', dark: '#0F1D3D' } as const;

function deviceIsDark(): boolean {
  try { return window.matchMedia(DARK_QUERY).matches; } catch { return false; }
}

/** The shopper's choice, and what it comes to now. */
export function useShopTheme(): { choice: ShopThemeChoice; setChoice: (c: ShopThemeChoice) => void; resolved: 'light' | 'dark' } {
  const choice = useShopThemeStore((s) => s.choice);
  const setChoice = useShopThemeStore((s) => s.setChoice);
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

/** Puts the theme on <html> while a shop layout is mounted, and the phone's address bar in the header's colour. */
export function useApplyShopTheme(resolved: 'light' | 'dark') {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.shopTheme = resolved;
    delete root.dataset.salesTheme;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const created = !meta;
    const before = meta?.content ?? null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = BAR[resolved];
    return () => {
      delete root.dataset.shopTheme;
      if (created) meta?.remove();
      else if (meta && before != null) meta.content = before;
    };
  }, [resolved]);
}
