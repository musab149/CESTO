import { useEffect, type RefObject } from 'react';

/**
 * Keeps the active tab of a `.tab-strip` in sight on a phone (2026-11-05).
 *
 * Below sm a tab row scrolls sideways (app.css `.tab-strip`), so a page
 * opened on a later tab — /users?tab=riders, a link to a book of orders —
 * showed the first three tabs and none of them selected. The active tab
 * carries `data-active="true"`; this scrolls the strip (only the strip,
 * never the page) to centre it. Does nothing where the row is not
 * scrolling, i.e. from sm up.
 */
export function useActiveTabInView(strip: RefObject<HTMLElement | null>, activeKey: unknown) {
  useEffect(() => {
    const el = strip.current;
    const tab = el?.querySelector<HTMLElement>('[data-active="true"]');
    if (!el || !tab || el.scrollWidth <= el.clientWidth) return;
    const offset = tab.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    el.scrollTo({ left: Math.max(0, offset - (el.clientWidth - tab.offsetWidth) / 2) });
  }, [strip, activeKey]);
}
