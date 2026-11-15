/**
 * Who may open which screen — as data, so it can be tested.
 *
 * The route guards in apps/web were four `if`s and a `<Navigate>` each,
 * written inline in components that no test in this repo can render. The API
 * side has a suite for every equivalent rule; this side had clicking. Three
 * bugs came out of that gap in one week, all the same shape — a guard sending
 * somebody to a screen that its own rules then sent them away from:
 *
 *   · A rep with a temporary password was redirected to the rotate screen,
 *     which sat inside the same guard, which redirected them to it again.
 *     Their first ever login was a blank page.
 *   · A revoked rep was sent to the storefront, which sent reps to /sales,
 *     which sent revoked reps to the storefront.
 *   · A rep who was also a partner reached the same cycle by a longer route.
 *
 * None of those is hard to see in a table. All three were invisible in a
 * component. So the DECISION lives here as a pure function of (who, where),
 * the components do nothing but act on it, and routeAccess.test.ts holds the
 * table — including one check that no decision ever redirects a path to
 * itself, which is the whole bug class in a single assertion.
 *
 * Deliberately knows about paths and nothing about React. It is the same shape
 * as invoiceLock.ts: rules that several surfaces share, kept where they can be
 * read and exercised.
 */

/** Where a rep rotates the temporary password they were emailed. */
export const SALES_ROTATE_PATH = '/sales/change-password';

/** The rep surface's own front door, used when turning a rep away from the shop. */
export const SALES_HOME_PATH = '/sales';

/**
 * Does this path belong to the rep surface?
 *
 * Each guard uses it to recognise the OTHER one's territory and decline. That
 * is not politeness, it is the loop: the sales guard turns a shopper away to
 * `/`, so asked about `/` it answered "go to `/`"; the storefront turns a rep
 * away to `/sales`, so asked about `/sales` it answered "go to `/sales`".
 * Neither component is ever mounted there — but a guard that cannot be asked a
 * question safely is a guard that only works as long as the router stays
 * exactly as it is today.
 */
export function isSalesPath(pathname: string): boolean {
  return pathname === SALES_HOME_PATH || pathname.startsWith(`${SALES_HOME_PATH}/`);
}

export type RouteDecision =
  /** Auth has not resolved yet. Show a spinner; decide nothing. */
  | { kind: 'wait' }
  /** Let the route render. */
  | { kind: 'render' }
  /**
   * Send them elsewhere. `carryFrom` means the current location should ride
   * along in router state, so the destination can return them afterwards.
   */
  | { kind: 'redirect'; to: string; carryFrom: boolean };

const wait: RouteDecision = { kind: 'wait' };
const render: RouteDecision = { kind: 'render' };
const go = (to: string, carryFrom = false): RouteDecision => ({ kind: 'redirect', to, carryFrom });

/** The parts of a User these rules read. Nothing else is relevant. */
export interface RouteUser {
  is_sales_rep?: boolean;
  /** An approved business buyer — the business panel is their shop. */
  is_business?: boolean;
  password_is_temp?: boolean;
}

/**
 * /sales/* — the rep surface.
 *
 * Order matters and is the point of reading it as a list: hydration before
 * authentication, authentication before role, role before the temp password.
 * A rep who is not signed in must reach /login rather than be told they are
 * not a rep.
 */
export function salesRouteAccess(input: {
  hydrating: boolean;
  isAuthenticated: boolean;
  user: RouteUser | null | undefined;
  pathname: string;
}): RouteDecision {
  /**
   * Not the rep surface, so not this guard's question. A statement about the
   * path alone — the user is irrelevant, and so is hydration.
   *
   * Renders rather than refuses because the only way to get here is to mount
   * SalesProtectedRoute outside /sales, which is a mistake in the router and
   * visible there; the real boundary is /api/sales/*, which checks the role on
   * every request. A redirect would be the worse answer by far: it is how both
   * blank pages in the header above happened.
   */
  if (!isSalesPath(input.pathname)) return render;

  // A refresh re-hydrates from the API; deciding now would bounce a signed-in
  // rep to /login for one frame.
  if (input.hydrating) return wait;

  if (!input.isAuthenticated || !input.user) return go('/login', true);

  // Not a rep — including a rep whose role was revoked, since the API filters
  // on is_active and the flag is simply false afterwards.
  if (!input.user.is_sales_rep) return go('/');

  /**
   * THE EXEMPTION THAT IS LOAD-BEARING. The rotate screen lives inside this
   * guard, because opening it still requires an authenticated, active rep. So
   * the one path this rule must not redirect is the one it redirects TO.
   */
  if (input.user.password_is_temp && input.pathname !== SALES_ROTATE_PATH) {
    return go(SALES_ROTATE_PATH, true);
  }

  return render;
}

/**
 * The storefront — for shoppers, not staff.
 *
 * A rep is a User with a role, which is what makes one login work across both
 * surfaces; it also meant a rep landed on the homepage after signing in. They
 * are staff, so the shop is not their surface, at all: the way back in to
 * use it as themselves ("Mi cuenta de cliente") went on 2026-10-26 — a rep
 * has no need of it, the user said.
 *
 * NOT a security boundary, and the mirror of the note on salesRouteAccess: a
 * rep's token is an ordinary customer token and the API would accept it. This
 * separates the two jobs; it does not forbid one.
 */
export function customerRouteAccess(input: {
  isAuthenticated: boolean;
  user: RouteUser | null | undefined;
  pathname: string;
  /** Customer paths a rep may open regardless — see STAFF_MAY_OPEN. */
  alwaysOpen?: readonly string[];
}): RouteDecision {
  // The rep surface governs itself, and sends reps with a temporary password
  // to a screen inside it. Answering here would fight that. So does the
  // business panel.
  if (isSalesPath(input.pathname) || isBusinessPath(input.pathname)) return render;

  const isRep = input.isAuthenticated && !!input.user?.is_sales_rep;
  if (isRep) {
    const open = input.alwaysOpen ?? STAFF_MAY_OPEN;
    const allowed = open.some(
      (p) => input.pathname === p || input.pathname.startsWith(`${p}/`),
    );
    if (allowed) return render;
    return go(SALES_HOME_PATH);
  }

  // A business buyer shops in its own panel (user, 2026-10-29: "Panel only").
  // Each shop page sends them to the panel's own, so a link they followed —
  // to an order, a product, their cart — still lands somewhere that answers it.
  const isBusiness = input.isAuthenticated && !!input.user?.is_business;
  if (isBusiness) {
    const allowed = BUSINESS_MAY_OPEN.some(
      (p) => input.pathname === p || input.pathname.startsWith(`${p}/`),
    );
    if (allowed) return render;
    return go(businessPathFor(input.pathname));
  }

  return render;
}

/**
 * Customer paths a rep may open without leaving staff mode.
 *
 * Short on purpose, and every entry earns its place by being reachable FROM
 * the rep surface or by being somewhere a redirect would do harm:
 *   · /privacy, /terms — the cookie banner renders on /sales and links to
 *     /privacy. Bouncing it makes the banner's only link a dead end.
 *   · /offline, /500, /403 — error surfaces. Forwarding somebody out of an
 *     error into the app that just failed is how you get a second loop.
 */
export const STAFF_MAY_OPEN = ['/privacy', '/terms', '/offline', '/500', '/403'] as const;

// ─── The business panel ─────────────────────────────────────

/** The business panel's own front door. */
export const BUSINESS_HOME_PATH = '/business';

/** Where a business buyer rotates a temporary password (a rep may have opened their account). */
export const BUSINESS_ROTATE_PATH = '/business/change-password';

/** Does this path belong to the business panel? */
export function isBusinessPath(pathname: string): boolean {
  return pathname === BUSINESS_HOME_PATH || pathname.startsWith(`${BUSINESS_HOME_PATH}/`);
}

/**
 * Shop paths a business buyer may still open: the legal pages the cookie
 * banner and the panel link to, help (with no shop in it), and the error
 * surfaces — forwarding somebody out of an error into the app that just
 * failed is how a loop starts.
 */
export const BUSINESS_MAY_OPEN = ['/privacy', '/terms', '/help', '/faq', '/contact', '/offline', '/500', '/403'] as const;

/**
 * The panel's page for a shop page, so a link a buyer followed still answers
 * them: an order is their order, a product its product, the cart theirs.
 * Anything without a counterpart — Home Grocery first of all, which is not
 * for businesses — goes to the panel's front page.
 */
export function businessPathFor(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  let m: RegExpMatchArray | null;
  if (p === '/orders') return `${BUSINESS_HOME_PATH}/orders`;
  if ((m = p.match(/^\/orders\/([^/]+)(\/edit)?$/))) return `${BUSINESS_HOME_PATH}/orders/${m[1]}${m[2] ?? ''}`;
  if (p === '/cart' || p === '/checkout') return `${BUSINESS_HOME_PATH}/cart`;
  if ((m = p.match(/^\/products\/([^/]+)$/))) return `${BUSINESS_HOME_PATH}/products/${m[1]}`;
  if ((m = p.match(/^\/categories\/([^/]+)$/))) return `${BUSINESS_HOME_PATH}/catalogue/categories/${m[1]}`;
  if (['/categories', '/brands', '/origins', '/stores', '/search', '/favorites'].includes(p) || p.startsWith('/stores/')) {
    return `${BUSINESS_HOME_PATH}/catalogue`;
  }
  if (p === '/profile/change-password') return BUSINESS_ROTATE_PATH;
  if (p === '/addresses') return `${BUSINESS_HOME_PATH}/account/addresses`;
  if (p === '/profile' || p.startsWith('/profile/')) return `${BUSINESS_HOME_PATH}/account`;
  return BUSINESS_HOME_PATH;
}

/**
 * /business/* — the business panel. The same order as the rep surface:
 * hydration, then signing in, then who they are, then the temporary password.
 */
export function businessRouteAccess(input: {
  hydrating: boolean;
  isAuthenticated: boolean;
  user: RouteUser | null | undefined;
  pathname: string;
}): RouteDecision {
  // Not the panel's question (see salesRouteAccess).
  if (!isBusinessPath(input.pathname)) return render;
  if (input.hydrating) return wait;
  if (!input.isAuthenticated || !input.user) return go('/login', true);
  // Staff first: a rep works from their own surface, even if their own
  // account were a business too.
  if (input.user.is_sales_rep) return go(SALES_HOME_PATH);
  // Not an approved business — or no longer one: the shop is theirs.
  if (!input.user.is_business) return go('/');
  // The rotate screen is inside this guard: never redirect it to itself.
  if (input.user.password_is_temp && input.pathname !== BUSINESS_ROTATE_PATH) {
    return go(BUSINESS_ROTATE_PATH, true);
  }
  return render;
}

/** Home Grocery's front page: what it is, the request, where a request stands. */
export const HOME_GROCERY_PATH = '/rashan';

/**
 * A household's Home Grocery, under its profile: its orders (the grocery
 * list, what is under way, everything before) and its delivery information
 * (2026-10-23 — there is no plan any more).
 */
export const HOME_GROCERY_PROFILE_PATH = '/profile/home-grocery';

/**
 * /rashan — Home Grocery's front page.
 *
 * Its job is to get a household to ask, and then to tell them where their
 * request stands. Once they are approved it has nothing left to say to them,
 * so a subscriber goes to its Home Grocery in its profile — including one
 * with no delivery information yet, because that is where it adds it.
 *
 * Only /rashan itself. The profile page never sends anybody here on its own
 * (a visitor who is not a subscriber gets a card with a LINK here), so the two
 * cannot bounce a household between them.
 */
export function homeGroceryRouteAccess(input: {
  hydrating: boolean;
  isAuthenticated: boolean;
  /** Their Home Grocery status is still on its way. */
  statusLoading: boolean;
  isSubscriber: boolean;
  pathname: string;
}): RouteDecision {
  if (input.pathname.replace(/\/+$/, '') !== HOME_GROCERY_PATH) return render;
  if (input.hydrating) return wait;
  // Signed out, there is no status to wait for: the page is the pitch.
  if (!input.isAuthenticated) return render;
  if (input.statusLoading) return wait;
  return input.isSubscriber ? go(HOME_GROCERY_PROFILE_PATH) : render;
}
