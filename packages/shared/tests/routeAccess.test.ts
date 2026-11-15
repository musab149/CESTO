/**
 * The route guards, as a table.
 *
 * apps/web has no way to render a component in a test, so its guards were
 * only ever exercised by clicking — while every equivalent rule on the API
 * side had a suite. Three bugs came out of that gap in one week, and all three
 * were the same shape: a guard sending somebody to a screen its own rules then
 * sent them away from.
 *
 * The worst of them was a rep's FIRST LOGIN. A temporary password redirected
 * them to the rotate screen, which lived inside the same guard, which
 * redirected them to it again — forever. Nothing threw, so the error boundary
 * never fired and they got a white page. It is one line in the table below.
 *
 * The last check is the one that matters most: for every user shape and every
 * path, no decision may redirect a path to itself. That is the entire bug
 * class in one assertion, and it does not need anybody to think of the case.
 *
 *   npm run test:route-access --workspace=packages/shared
 */
import assert from 'assert';
import {
  salesRouteAccess, customerRouteAccess, homeGroceryRouteAccess, businessRouteAccess, isSalesPath,
  SALES_ROTATE_PATH, SALES_HOME_PATH, STAFF_MAY_OPEN, HOME_GROCERY_PATH, HOME_GROCERY_PROFILE_PATH,
  BUSINESS_HOME_PATH, BUSINESS_ROTATE_PATH, BUSINESS_MAY_OPEN,
  type RouteUser, type RouteDecision,
} from '../src/routeAccess';

const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

const REP: RouteUser = { is_sales_rep: true };
const REP_TEMP: RouteUser = { is_sales_rep: true, password_is_temp: true };
const SHOPPER: RouteUser = {};
const BIZ: RouteUser = { is_business: true };
const BIZ_TEMP: RouteUser = { is_business: true, password_is_temp: true };
const REP_BIZ: RouteUser = { is_sales_rep: true, is_business: true };

const sales = (user: RouteUser | null, pathname: string, hydrating = false) =>
  salesRouteAccess({
    hydrating,
    isAuthenticated: user !== null,
    user,
    pathname,
  });

// ─── /sales/* ──────────────────────────────────────────────

test('hydrating decides nothing', () => {
  assert.deepEqual(sales(REP, SALES_HOME_PATH, true), { kind: 'wait' });
  // Even for somebody who would be refused: deciding early is what bounced a
  // signed-in rep to /login for one frame on every refresh.
  assert.deepEqual(sales(null, SALES_HOME_PATH, true), { kind: 'wait' });
});

test('a signed-out visitor goes to /login, carrying where they were', () => {
  assert.deepEqual(sales(null, '/sales/orders'), { kind: 'redirect', to: '/login', carryFrom: true });
});

test('a shopper is sent to the storefront, not told they are not a rep', () => {
  assert.deepEqual(sales(SHOPPER, SALES_HOME_PATH), { kind: 'redirect', to: '/', carryFrom: false });
});

test('a rep renders', () => {
  assert.deepEqual(sales(REP, SALES_HOME_PATH), { kind: 'render' });
  assert.deepEqual(sales(REP, '/sales/orders/new'), { kind: 'render' });
});

test('a temporary password goes to the rotate screen', () => {
  assert.deepEqual(
    sales(REP_TEMP, '/sales/orders'),
    { kind: 'redirect', to: SALES_ROTATE_PATH, carryFrom: true },
  );
});

test('…and ON the rotate screen it RENDERS — the white-page bug', () => {
  // This is the whole of it. Without the exemption the guard answered
  // "redirect to SALES_ROTATE_PATH" here, from SALES_ROTATE_PATH, every
  // render, and the rep's first login never painted.
  assert.deepEqual(sales(REP_TEMP, SALES_ROTATE_PATH), { kind: 'render' });
});

test('the rotate screen still needs an authenticated, active rep', () => {
  // The exemption must not have turned it into an open door — it is inside
  // the guard precisely so these two still apply.
  assert.deepEqual(
    sales(null, SALES_ROTATE_PATH),
    { kind: 'redirect', to: '/login', carryFrom: true },
  );
  assert.deepEqual(
    sales(SHOPPER, SALES_ROTATE_PATH),
    { kind: 'redirect', to: '/', carryFrom: false },
  );
});

// ─── the storefront ────────────────────────────────────────

const shop = (user: RouteUser | null, pathname: string) =>
  customerRouteAccess({
    isAuthenticated: user !== null,
    user,
    pathname,
  });

test('the shop is open to everyone who is not a rep', () => {
  assert.deepEqual(shop(null, '/'), { kind: 'render' });
  assert.deepEqual(shop(SHOPPER, '/'), { kind: 'render' });
  assert.deepEqual(shop(SHOPPER, '/cart'), { kind: 'render' });
});

test('a rep is sent to their own surface', () => {
  assert.deepEqual(shop(REP, '/'), { kind: 'redirect', to: SALES_HOME_PATH, carryFrom: false });
  assert.deepEqual(shop(REP, '/cart'), { kind: 'redirect', to: SALES_HOME_PATH, carryFrom: false });
});

test('…their own customer pages too — a rep has no need of the shop (2026-10-26)', () => {
  assert.deepEqual(shop(REP, '/orders'), { kind: 'redirect', to: SALES_HOME_PATH, carryFrom: false });
  assert.deepEqual(shop(REP, '/profile'), { kind: 'redirect', to: SALES_HOME_PATH, carryFrom: false });
});

test('the legal and error pages stay open to staff', () => {
  for (const p of STAFF_MAY_OPEN) {
    assert.deepEqual(shop(REP, p), { kind: 'render' }, `${p} should be open`);
    // And their children: /help/x is not in the list, but /privacy/foo is a
    // child of one that is.
    assert.deepEqual(shop(REP, `${p}/anything`), { kind: 'render' }, `${p}/… should be open`);
  }
});

test('a path that merely starts with the same letters is NOT open', () => {
  // `startsWith` without the separator would have let /terms-and-conditions
  // through on the strength of /terms.
  assert.deepEqual(
    shop(REP, '/termsandconditions'),
    { kind: 'redirect', to: SALES_HOME_PATH, carryFrom: false },
  );
});

// ─── neither guard answers for the other ──────────────

test('the sales guard has no opinion about the storefront', () => {
  // It turns a shopper away to `/`. Asked about `/`, it used to answer "go to
  // `/`" — and the signed-out case did the same to /login.
  assert.deepEqual(sales(SHOPPER, '/'), { kind: 'render' });
  assert.deepEqual(sales(null, '/login'), { kind: 'render' });
  assert.deepEqual(sales(REP_TEMP, '/cart'), { kind: 'render' });
});

test('the storefront guard has no opinion about /sales', () => {
  // Including the rotate screen: the other guard sends reps there, and this
  // one would have sent them straight back out.
  assert.deepEqual(shop(REP, SALES_HOME_PATH), { kind: 'render' });
  assert.deepEqual(shop(REP_TEMP, SALES_ROTATE_PATH), { kind: 'render' });
  assert.deepEqual(shop(REP, '/sales/orders/new'), { kind: 'render' });
});

test('declining is by path segment, not by prefix', () => {
  // /salesmanship is a storefront path that happens to begin with the same
  // letters — the same mistake STAFF_MAY_OPEN avoids above.
  assert.deepEqual(isSalesPath('/sales'), true);
  assert.deepEqual(isSalesPath('/sales/orders'), true);
  assert.deepEqual(isSalesPath('/salesmanship'), false);
  assert.deepEqual(
    shop(REP, '/salesmanship'),
    { kind: 'redirect', to: SALES_HOME_PATH, carryFrom: false },
  );
});

// ─── Home Grocery ──────────────────────────────────────────

type HgWho = 'signed-out' | 'loading' | 'subscriber' | 'not-subscriber';
const hg = (who: HgWho, pathname = HOME_GROCERY_PATH, hydrating = false) =>
  homeGroceryRouteAccess({
    hydrating,
    isAuthenticated: who !== 'signed-out',
    statusLoading: who === 'loading',
    isSubscriber: who === 'subscriber',
    pathname,
  });

test('Home Grocery: a subscriber opening /rashan goes to its Home Grocery in its profile', () => {
  assert.deepEqual(hg('subscriber'), { kind: 'redirect', to: HOME_GROCERY_PROFILE_PATH, carryFrom: false });
  assert.deepEqual(hg('subscriber', `${HOME_GROCERY_PATH}/`), { kind: 'redirect', to: HOME_GROCERY_PROFILE_PATH, carryFrom: false });
});

test('Home Grocery: everybody else gets the front page', () => {
  assert.deepEqual(hg('signed-out'), { kind: 'render' });
  // Waiting on an answer, turned down, or the status read failed — the page
  // is where each of those is told what is happening.
  assert.deepEqual(hg('not-subscriber'), { kind: 'render' });
});

test('Home Grocery: nothing is decided before the status arrives', () => {
  // Deciding early would show a subscriber the pitch for a moment first.
  assert.deepEqual(hg('loading'), { kind: 'wait' });
  assert.deepEqual(hg('subscriber', HOME_GROCERY_PATH, true), { kind: 'wait' });
});

test('Home Grocery: the profile page is never redirected — it is where /rashan sends people', () => {
  for (const who of ['signed-out', 'loading', 'subscriber', 'not-subscriber'] as const) {
    assert.deepEqual(hg(who, HOME_GROCERY_PROFILE_PATH), { kind: 'render' }, who);
  }
});

// ─── /business/* — the business panel (2026-10-29) ────────

const biz = (user: RouteUser | null, pathname: string, hydrating = false) =>
  businessRouteAccess({ hydrating, isAuthenticated: user !== null, user, pathname });

test('the business panel: wait, sign in, who, then the temporary password', () => {
  assert.deepEqual(biz(BIZ, BUSINESS_HOME_PATH, true), { kind: 'wait' });
  assert.deepEqual(biz(null, '/business/orders'), { kind: 'redirect', to: '/login', carryFrom: true });
  assert.deepEqual(biz(SHOPPER, BUSINESS_HOME_PATH), { kind: 'redirect', to: '/', carryFrom: false });
  assert.deepEqual(biz(BIZ, BUSINESS_HOME_PATH), { kind: 'render' });
  assert.deepEqual(biz(BIZ, '/business/catalogue/brands/x'), { kind: 'render' });
  // Staff first.
  assert.deepEqual(biz(REP, BUSINESS_HOME_PATH), { kind: 'redirect', to: SALES_HOME_PATH, carryFrom: false });
  assert.deepEqual(biz(REP_BIZ, BUSINESS_HOME_PATH), { kind: 'redirect', to: SALES_HOME_PATH, carryFrom: false });
});

test('a business with a temporary password rotates it inside the panel — and the rotate screen renders', () => {
  assert.deepEqual(biz(BIZ_TEMP, '/business/orders'), { kind: 'redirect', to: BUSINESS_ROTATE_PATH, carryFrom: true });
  assert.deepEqual(biz(BIZ_TEMP, BUSINESS_ROTATE_PATH), { kind: 'render' });
});

test("the panel is not this guard's question anywhere else", () => {
  assert.deepEqual(biz(SHOPPER, '/'), { kind: 'render' });
  assert.deepEqual(biz(BIZ, '/sales'), { kind: 'render' });
});

test("a business buyer is sent from each shop page to the panel's own", () => {
  const to = (pathname: string) => {
    const d = shop(BIZ, pathname);
    return d.kind === 'redirect' ? d.to : d.kind;
  };
  assert.equal(to('/'), BUSINESS_HOME_PATH);
  assert.equal(to('/orders'), '/business/orders');
  assert.equal(to('/orders/abc'), '/business/orders/abc');
  assert.equal(to('/orders/abc/edit'), '/business/orders/abc/edit');
  assert.equal(to('/cart'), '/business/cart');
  assert.equal(to('/checkout'), '/business/cart');
  assert.equal(to('/products/p1'), '/business/products/p1');
  assert.equal(to('/categories/c1'), '/business/catalogue/categories/c1');
  assert.equal(to('/brands'), '/business/catalogue');
  assert.equal(to('/stores/some-shop'), '/business/catalogue');
  assert.equal(to('/addresses'), '/business/account/addresses');
  assert.equal(to('/profile'), '/business/account');
  assert.equal(to('/profile/change-password'), BUSINESS_ROTATE_PATH);
  // Home Grocery is not for businesses: the panel's front page.
  assert.equal(to(HOME_GROCERY_PATH), BUSINESS_HOME_PATH);
  assert.equal(to(HOME_GROCERY_PROFILE_PATH), '/business/account');
  assert.equal(to('/b2b-deals'), BUSINESS_HOME_PATH);
});

test('a business buyer may still open the legal, help and error pages', () => {
  for (const p of BUSINESS_MAY_OPEN) {
    assert.deepEqual(shop(BIZ, p), { kind: 'render' }, p);
  }
  assert.deepEqual(shop(BIZ, '/help/some-article'), { kind: 'render' });
});

test('a rep who is also a business stays a rep in the shop', () => {
  assert.deepEqual(shop(REP_BIZ, '/'), { kind: 'redirect', to: SALES_HOME_PATH, carryFrom: false });
});

test('the panel is left to its own guard', () => {
  assert.deepEqual(shop(BIZ, BUSINESS_HOME_PATH), { kind: 'render' });
  assert.deepEqual(shop(SHOPPER, '/business/orders'), { kind: 'render' });
});

// ─── the invariant that kills the bug class ────────────────

test('NO decision ever redirects a path to itself', () => {
  /**
   * Every guard, every user shape, every path either guard can send anybody
   * to — plus the ordinary screens. A self-redirect is an infinite loop and a
   * blank page, and this catches one without anybody having to think of the
   * case that produces it.
   */
  const paths = [
    '/', '/cart', '/orders', '/login', '/privacy', '/terms', '/offline', '/500', '/403',
    SALES_HOME_PATH, SALES_ROTATE_PATH, '/sales/orders', '/sales/clients',
    HOME_GROCERY_PATH, `${HOME_GROCERY_PATH}/`, HOME_GROCERY_PROFILE_PATH,
    BUSINESS_HOME_PATH, BUSINESS_ROTATE_PATH, '/business/orders', '/business/orders/x', '/business/cart',
    '/business/account', '/business/account/addresses', '/business/products/p', '/business/catalogue',
    '/orders/x', '/checkout', '/products/p', '/profile', '/profile/change-password', '/addresses', '/help',
  ];
  const users: Array<RouteUser | null> = [null, SHOPPER, REP, REP_TEMP, BIZ, BIZ_TEMP, REP_BIZ];

  const loops: string[] = [];
  const checkOne = (label: string, d: RouteDecision, pathname: string) => {
    if (d.kind === 'redirect' && d.to === pathname) loops.push(`${label} @ ${pathname}`);
  };

  for (const pathname of paths) {
    for (const user of users) {
      checkOne('sales', sales(user, pathname), pathname);
      checkOne('customer', shop(user, pathname), pathname);
      checkOne('business', biz(user, pathname), pathname);
    }
    for (const who of ['signed-out', 'loading', 'subscriber', 'not-subscriber'] as const) {
      checkOne(`home grocery (${who})`, hg(who, pathname), pathname);
    }
  }
  assert.deepEqual(loops, [], 'these redirect a path to itself, which never terminates');
});

test('the two guards cannot bounce a rep between each other', () => {
  /**
   * The second bug: the storefront sent reps to /sales, and /sales sent
   * anybody who was not a rep back to the storefront. Any user who is refused
   * by BOTH has nowhere to land.
   *
   * Walked rather than reasoned about, because that is what a browser does.
   */
  const users: Array<RouteUser | null> = [null, SHOPPER, REP, REP_TEMP, BIZ, BIZ_TEMP, REP_BIZ];
  for (const user of users) for (const start of ['/', '/orders/x', '/business', '/sales', '/profile/change-password']) {
    let pathname = start;
    const seen = new Set<string>();
    for (let hop = 0; hop < 12; hop++) {
      const d = pathname.startsWith('/sales')
        ? sales(user, pathname)
        : pathname.startsWith('/business') ? biz(user, pathname) : shop(user, pathname);
      if (d.kind !== 'redirect') break;
      assert.ok(
        !seen.has(d.to),
        `revisits ${d.to} for ${JSON.stringify(user)} — the two guards are bouncing it`,
      );
      seen.add(d.to);
      pathname = d.to;
    }
    // Landing on /login is a terminus: it is outside both guards.
    assert.ok(
      pathname === '/login' || !seen.has(pathname) || seen.size < 12,
      `never settled for ${JSON.stringify(user)}`,
    );
  }
});

let failures = 0;
for (const { name, run } of cases) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.error(`  FAIL ${name}\n      ${msg.replace(/\n/g, '\n      ')}`);
  }
}
console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) process.exit(1);
