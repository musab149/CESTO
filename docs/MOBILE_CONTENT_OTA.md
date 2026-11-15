# Changing the mobile app without shipping a build

**Started:** 2026-09-23 · **Why:** every copy fix currently costs a Play build,
an upload and a review wait. Two of them this week were pure text.

This file is the record: what was found, what was decided, what is done, and
what is deliberately not being done.

---

## Audit — 2026-09-23

### Already admin-managed, and mobile already reads it

More than expected. None of these need a build:

| Surface | Edited in | Mobile reads it |
| --- | --- | --- |
| Home promo grid, ads banner, top brands, shop-by-origin, top shops, stores hero | Home Sections | ✅ all six (`usePromoGrid`, `useAdsBanner`, `useTopBrands`, `useShopByOrigin`, `useTopShops`, `useStoresHero`) |
| Promo banners | Banners | ✅ `useBanners` |
| Help centre categories + articles | Help Center | ✅ `help.tsx`, `help/[slug].tsx` |
| Privacy policy, Terms | Settings → Legal | ✅ |
| Contact email / phone / WhatsApp | Settings | ✅ (since 2026-09-23) |
| Delivery fee, free-delivery threshold, minimum order | Settings | ✅ (since 2026-09-23) |
| Maintenance mode | Settings | ✅ `MaintenanceBanner` |
| Catalogue, categories, brands, origins, rashan packs | their own pages | ✅ |
| Push notifications | Notifications | ✅ |

An earlier note in this session claimed mobile ignored Home Sections. That was
wrong — mobile consumes *more* of them than web does.

### Still inside the binary

| Screen | What is baked in |
| --- | --- |
| `app/onboarding.tsx` | three slides: headlines, body, illustrations |
| `app/faq.tsx` | 9 Q&As — while an admin-managed Help Centre already exists |
| `app/about.tsx` | the whole page; no API call at all |
| `app/(tabs)/rashan.tsx` | hero, "how it works" steps, its own FAQ |
| `app/(tabs)/index.tsx` | 3 of the 4 value-ribbon tiles |
| `app/product/[id].tsx` | trust strip, fulfilment lines |

---

## Decisions

### 1. EAS Update (`expo-updates`) — the structural fix · **CONFIGURED, NEEDS BUILD 5**

Not installed today. With it, **any JavaScript or asset change ships over the
air**: copy, layout, most logic and bug fixes. A store build is then needed
only for native changes — permissions, an SDK upgrade, a new native module, or
native config in `app.json`.

This makes the whole "what can admin edit?" question much smaller, because a
developer-side copy fix stops costing a release.

- Google permits it: the bundle changes, the app's purpose does not.
- Adopting it costs **one** build, because the native module has to be
  installed. versionCode 5 was needed anyway for the copy fixes, so it rides
  along.
- `runtimeVersion` uses the `appVersion` policy: an OTA update only reaches
  builds with a matching `version`. Bumping `1.0.0` deliberately cuts older
  binaries off from new JS, which is the safe default.

### 2. FAQ screen reads the Help Centre · **DONE**

The API (`/api/help-center`), the admin editor (Help Center pages) and the
mobile rendering (`help.tsx`, `help/[slug].tsx`) all exist. `faq.tsx` simply
did not use them. Pointing it at the Help Centre hands the client an editor for
it and deletes a screenful of hardcoded copy.

The curated answers stay as an **offline fallback**, so an empty help centre or
a dead network never produces a blank support screen.

### 3. An `app-content` blob for what is left · **DONE**

Onboarding slides, About, rashan marketing, ribbon tiles. Bilingual JSON in
`AppSetting`, an admin editor modelled on Home Sections, current text kept as
the fallback. Worth doing for the client's sake — they can edit marketing copy
without a developer — but lower priority once EAS Update lands, because the
developer-side cost of changing this copy drops to a publish.

### 4. `minAppVersion` gate · **NOT STARTED**

For when a native build genuinely is required. Mobile compares its own version
against a settings value and shows an update prompt. `orderStatus.ts` already
notes that "the store build cannot be force-updated" — this is the mitigation.

---

## Deliberately staying in the binary

Buttons, labels, validation messages, error and empty states, and order-status
text. Remote-editable copy on a correctness-critical path is a liability, not a
feature: an admin typo should not be able to mislabel an order's state.

---

## Progress log

- **2026-09-23** — audit above.
- **2026-09-23** — item 2 done. `faq.tsx` lists Help Centre articles and opens
  `/help/[slug]`; the curated answers remain as the offline fallback.
- **2026-09-23** — item 3, server + admin half, committed on `staging`
  (`a727b13`). `AppSetting` key `app_content`, so **no migration**.
  `GET /api/app-content` is public and never 404s or returns a partial object;
  `PUT` and reset sit behind admin auth, reset being super_admin. Admin →
  **App content** has four tabs — Onboarding, About, Rashan, Home ribbon —
  with Spanish and English side by side in every field, because a missing
  translation renders as an empty line rather than failing loudly.
  `npm run test:app-content` (6 checks) covers the likeliest failure: that the
  shipped defaults pass their own validator, so opening the page and pressing
  Save cannot fail.

  Writing those defaults turned up more untrue copy, corrected there: About
  claimed "same-day delivery across Madrid" with a "2-hour delivery window";
  the Rashan FAQ said customers "are charged the day before delivery" (nothing
  is ever charged in the app) and that out-of-stock items are "swapped for an
  equivalent" (the terms promise the opposite).

- **2026-09-23** — item 3, mobile half. `onboarding.tsx`, `about.tsx`,
  `(tabs)/rashan.tsx` (steps + FAQ) and the home ribbon now read
  `useAppContent()`. Every one keeps its bundled copy as the offline fallback,
  so a first launch with no network shows the shipped text rather than a gap.
  Icons, gradients and illustrations stay in code: admin edits words, not
  artwork. An edited list reuses icons in order, so a fifth value or step gets
  the first icon back instead of an empty square. Headlines split on `/?
/`
  rather than `
`, because a textarea on Windows submits CRLF and a stray
  `` would render as a blank second line.

  `packages/shared/src/appContent.ts` was copied over from `staging` by file,
  not merged, so the mobile branch still carries only mobile work.

- **2026-09-23** — item 1 configured: `expo-updates@29.0.20` installed,
  `app.json` gained `updates.url` (the EAS project's `u.expo.dev` endpoint) and
  `runtimeVersion: { policy: appVersion }`, and every `eas.json` profile now
  names a channel (`production`, `preview`, `development`). `cli.appVersionSource`
  set to `local`, since versionCode lives in `app.json` and is committed.
  Verified through `expo config --type introspect`: the native manifest carries
  `expo.modules.updates.ENABLED=true`, `CHECK_ON_LAUNCH=ALWAYS`,
  `LAUNCH_WAIT_MS=0` and the update URL.

  **Not live until versionCode 5 is built and installed.** `expo-updates` is a
  native module: OTA only starts working from a build that contains it. Until
  then `eas update` publishes to a channel nothing is listening on.

## How to ship a JS change, once build 5 is out

```
eas update --branch production --message "what changed"
```

Devices pick it up on next launch (downloaded in the background, applied on the
launch after). A store build is still required for: permissions, SDK or native
dependency changes, anything under `android`/`ios` in `app.json`, and any
version bump — `appVersion` runtime policy means `1.0.1` builds will not accept
`1.0.0` updates.
