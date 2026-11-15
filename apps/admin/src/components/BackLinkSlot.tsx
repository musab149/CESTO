import {
  createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode,
} from 'react';

export interface BackTarget {
  label: string;
  onClick: () => void;
  /**
   * The page's own title, drawn next to the back link in the bar.
   *
   * A focus route has no page chrome of its own to put a heading in — that is
   * the point of it — and giving the page a second bar to hold one leaves two
   * stacked bars saying different things. So the title rides with the back
   * target and the one bar carries both.
   */
  title?: string;
}

interface BackLinkSlotValue {
  target: BackTarget | null;
  /** Claim the slot. `owner` identifies the BackLink instance. */
  claim: (owner: symbol, t: BackTarget) => void;
  /** Release it, but only if `owner` still holds it — see the provider. */
  release: (owner: symbol) => void;
}

const Ctx = createContext<BackLinkSlotValue>({
  target: null, claim: () => {}, release: () => {},
});

/**
 * Lets the page tell the layout where "back" goes.
 *
 * On a phone the back link belongs in the page, above the title, because the
 * top bar is already carrying a hamburger, a language toggle, a bell and an
 * avatar across 360px. On a desktop that bar has room to spare and the page
 * does not — a link floating above a heading is a line of chrome in the
 * reading column.
 *
 * So the same `<BackLink>` renders in both places and shows in exactly one:
 * it registers here (the layout draws it in the bar from lg up) and renders
 * itself inline below lg. One call site per page, no page knows about the
 * breakpoint.
 */
export function BackLinkSlotProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<BackTarget | null>(null);
  // Who the current target belongs to. On a route change React can run the
  // OUTGOING page's cleanup after the incoming page's effect, so an
  // unconditional clear would blank a slot the new page had just filled.
  const owner = useRef<symbol | null>(null);

  const claim = useCallback((o: symbol, t: BackTarget) => {
    owner.current = o;
    setTarget(t);
  }, []);

  const release = useCallback((o: symbol) => {
    if (owner.current !== o) return;
    owner.current = null;
    setTarget(null);
  }, []);

  const value = useMemo(() => ({ target, claim, release }), [target, claim, release]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBackLinkSlot() {
  return useContext(Ctx);
}
