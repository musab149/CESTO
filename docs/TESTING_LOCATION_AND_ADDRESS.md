# Testing: ordering from anywhere, and store publication

Manual test plan for what replaced delivery zones. Written against **staging**.

Supersedes the previous version of this file, which tested a coverage system
(`MV_STOREFRONT`, browse postcode, per-zone fees, out-of-area cart items). None
of that exists any more — see **What changed** below before reporting a bug
against it.

---

## The model being tested

**Nothing restricts where a customer can browse or order.** Every live store
sells to every Spanish address.

| | Before | Now |
|---|---|---|
| Who can see a store | only if its zones covered your postcode | everyone |
| Who can order from it | only if its zones covered your delivery address | everyone |
| Delivery fee | the matched zone's `delivery_fee` | a flat fee, or a distance band — admin → **Settings → Orders** |
| Free delivery from | the matched zone's `free_delivery_min` | one threshold in flat mode; per-band in distance mode |
| Delivery time | a booked slot per zone | always ASAP |
| Saving an address | only postcodes inside a zone were offered | any 5-digit Spanish postcode |
| Publishing a store | partner self-published once it had a zone | **admin only** |

> **Distance pricing is off by default.** Sections A and B below describe the
> flat mode a fresh database is in. Section G covers distance mode, which an
> admin has to switch on and configure. Nothing about *coverage* changed: a
> distance band moves the price, it never refuses an order.

**Nothing scopes the catalogue at all.** The header pill holds one control —
"Use my location" — and it only pre-fills the address form. It is deliberately
worded as *address*, never *delivery area*. There is no postcode field, no
"All areas", and no country picker: `Store.country` is still stored and shown
on the storefront, but nothing filters on it.

---

## A · Ordering from anywhere

| # | Steps | Expected |
|---|---|---|
| A1 | Browse logged out. Open the header location pill. | Panel offers **only** "Use my location" (plus "Save as delivery address" once detected). **No postcode field, no "All areas", no country picker.** |
| A2 | Look at the store list. | Every live store appears, whatever your location. |
| A3 | Add an address in `28001`. Add items from two different partner stores. | Both quote. Nothing is flagged out of area. |
| A4 | Change the delivery address to `08001` (Barcelona), then to `36201` (Vigo). | Subtotal and total are identical each time. No item is ever excluded. |
| A5 | Add an address with a postcode no store is near, e.g. `44126`. | Accepted, and checkout completes normally. |
| A6 | Place the order. | Succeeds. Every item is charged. |

## B · The flat fee (default mode)

| # | Steps | Expected |
|---|---|---|
| B1 | Admin → **Settings → Orders**. | Pricing mode is **One flat fee**, with **Delivery fee** and **Free delivery from** below it. |
| B2 | Set fee `4.00`, free-from `25.00`. Save. | Saved. |
| B3 | Customer checkout, subtotal €20. | Delivery reads €4.00. |
| B4 | Push subtotal to €25+. | Delivery reads **Free**. |
| B5 | Repeat B3 from a different postcode. | Same €4.00 — in flat mode the fee does not vary by address. |
| B6 | Cross-store cart (a Cesto item + a partner item). | One fee on the whole order, not one per store. |
| B7 | Cart page (before checkout), web and mobile. | Fee and "free over €X" note both read **€4.00 / €25.00** — they follow Settings now instead of the old hardcoded €3.50 / €30. |

## C · Delivery time

| # | Steps | Expected |
|---|---|---|
| C1 | Checkout, web and mobile. | A "Delivers ASAP" panel. **No slot picker.** |
| C2 | Open a past order that had a booked slot. | Reads "ASAP — within 60 min". *Known and accepted: the booked window is gone from history — see What changed.* |

## D · Addresses

| # | Steps | Expected |
|---|---|---|
| D1 | Add an address. | Postcode is a **plain text field**, not a dropdown of serviceable postcodes. |
| D2 | Enter `1234` or `abcde`. | Rejected — still 5 digits. |
| D3 | Enter any valid 5-digit code. | Accepted. |
| D4 | Look at the address list and the checkout address cards. | No "Not serviceable" badge anywhere. No address is greyed out or disabled. |
| D5 | Header pill → "Use my location" → "Save as delivery address". | Address form opens pre-filled with street, postcode and city. |
| D6 | Deny the location permission. | Legible message, no crash. The catalogue is unaffected — it never depended on location. |

## E · Store publication is admin-gated

> This is the one thing that got *stricter*.

| # | Steps | Expected |
|---|---|---|
| E1 | Approve a partner application. | Store is created in **draft**. |
| E2 | Partner logs in → their store page → set status **Live**, save. | **Refused, 422**: "Your store is waiting for approval from Cesto." |
| E3 | Confirm on the storefront. | The draft store is not visible or orderable. |
| E4 | Admin → Stores → that store → status **Live** → Save. | Publishes. Now visible to customers. |
| E5 | Partner sets their own store to **Paused**. | Allowed. Store disappears from customer surfaces; partner stays logged in. |
| E6 | Partner sets it back to **Live**. | Allowed — un-pausing an already-approved store is not publishing. |
| E7 | Admin sets the store to **Suspended**. Partner tries **Live**. | **Refused, 422**: "This store has been suspended by Cesto." |
| E8 | Admin → Stores → any store. | **No "Delivery zones" tab.** Identity / Branding / Shop hours / Contact / Products only. |
| E9 | Partner dashboard sidebar. | **No "Zones" entry.** |
| E10 | Partner dashboard setup checklist. | "Create a delivery zone" is replaced by **"Add your shop address"**. |

## F · Store country and address

| # | Steps | Expected |
|---|---|---|
| F1 | Admin → Stores → edit → Identity tab. | **Country** and a new free-text **Address** field. |
| F2 | Set an address, save, open the storefront. | Shows on the store page. |
| F3 | Set two stores to different countries. Browse the catalogue. | **Both still appear.** Country is displayed, never filtered on. |
| F4 | Reload with DevTools → Network open. | No request carries an `X-Browse-Postcode` or `X-Browse-Country` header. `GET /api/stores/countries` is never called (it 404s now). |

## G · Distance-based delivery pricing

> Needs `GOOGLE_MAPS_KEY` set on the API. Without it the Locate button
> returns 503 and no address is ever geocoded, so every order falls back to
> the flat fee — which is the correct behaviour, not a bug.

### G1 · Setting it up

| # | Steps | Expected |
|---|---|---|
| G1.1 | Admin → **Settings → Orders**. Pick **By distance**. | A dispatch-address field and an empty band table appear. The flat fields below relabel to **Fallback flat fee**. |
| G1.2 | Press **Save** with no origin and no bands. | **Refused, 422**: set an origin / add a band. It must not save a half-configured ladder that silently prices everything flat. |
| G1.3 | Type `Calle Gran Vía 1, 28013 Madrid` → **Locate**. | Coordinates appear (~`40.42, -3.70`) with the matched address beside them. |
| G1.4 | Type nonsense (`asdfgh`) → **Locate**. | Legible error. No coordinates written, nothing saved. |
| G1.5 | Type just `Madrid` → **Locate**. | Locates, plus a warning that the match is only approximate. |
| G1.6 | Add bands: `5 → 2.50, free from 30`; `20 → 4.50, free from 60`; leave the last row's km **blank** → `8.00`, free-from **blank**. Save. | Saved. Reopen the page: rows come back **sorted**, blank-km row last. |
| G1.7 | Enter the bands out of order (20, then blank, then 5) and save. | Server re-sorts them. What you see after saving is what gets charged. |

### G2 · What customers are charged

| # | Steps | Expected |
|---|---|---|
| G2.1 | Address in central Madrid, subtotal €20. Checkout. | Delivery **€2.50**, with a line under it reading e.g. `1.4 km · Hasta 5 km`. |
| G2.2 | Address ~10 km out, same €20 cart. | Delivery **€4.50**, `… · 5–20 km`. **The same cart costs more further away** — this is the whole feature. |
| G2.3 | Barcelona address, same cart. | Delivery **€8.00**, `… · Más de 20 km`. Order is **accepted** — distance never refuses. |
| G2.4 | Central Madrid, push subtotal to €30. | **Free** — the near band's own threshold. |
| G2.5 | The 10 km address, subtotal €30. | Still **€4.50**. That band's threshold is €60, not €30. This is the per-band behaviour; it is not a bug. |
| G2.6 | Barcelona address, subtotal €500. | Still **€8.00** — that band has no threshold, so it is never free. |
| G2.7 | Place G2.2's order and open it in admin. | `delivery_fee` on the order is €4.50. The fee is snapshotted; editing the bands afterwards does not change past orders. |
| G2.8 | Change the bands mid-checkout, then confirm the order. | Charged the ladder that was in force when the order was written, matching the quote the customer saw. |

### G3 · Falling back

Every one of these must charge the **fallback flat fee** — never €0, and never
a rejected order.

| # | Steps | Expected |
|---|---|---|
| G3.1 | An address saved before this feature shipped, used at checkout for the first time. | Priced by distance — it is geocoded on first quote. Check the DB: `addresses.latitude` is now populated. |
| G3.2 | An address the geocoder cannot place (invented street). | **Flat fee.** `geocode_failed_at` is stamped. |
| G3.3 | Reload checkout for that same address several times. | Google is called **once**, not once per reload — the failure stamp holds it off for 24h. |
| G3.4 | Unset `GOOGLE_MAPS_KEY`, restart the API, checkout with a fresh address. | Flat fee everywhere. No errors, no hang, saving an address is still instant. |
| G3.5 | Switch mode back to **One flat fee**. | Every order immediately prices flat again, bands kept but ignored. |
| G3.6 | Edit a saved address to a different street, then checkout. | Re-geocoded — it must **not** keep the old coordinates and price from where the customer used to live. |

### G4 · Before an address is picked

| # | Steps | Expected |
|---|---|---|
| G4.1 | Cart page in distance mode, web and mobile. | Fee shows as **"from €2.50"** (the cheapest band), plus a note that delivery is calculated by distance at checkout. |
| G4.2 | Checkout with no address selected yet. | Delivery reads "Pick an address", total is marked as excluding delivery. |
| G4.3 | A ladder where every band has a blank free-from. | **No** free-shipping progress bar in the cart. A bar that can never fill is worse than none. |

---

## What changed, for anyone triaging an old bug report

Removed outright: `delivery_zones`, `delivery_slots`, `addresses.zone_id`,
`orders.delivery_slot_id`, `users.browse_postcode`, `banners.target_zone`, the
`MV_STOREFRONT` flag, `/api/zones/*`, `/api/delivery/slots`,
`/api/admin/zones/*`, `/api/partner/zones/*`, and the store-zones tab.

Also removed: the whole **country browse scope** — the header country picker,
the `X-Browse-Country` header, `GET /api/stores/countries`, and `?country=` on
products and stores. `Store.country` stays as a stored, displayed field.

**Historical orders lost their booked delivery window.** The slot was never
snapshotted onto the order row, so dropping the column erased it. Accepted
deliberately — only the mobile client ever set one.

Old test cases that no longer mean anything: anything about a postcode showing
fewer stores, an address being "not serviceable", an item being "out of area",
a store needing a zone before going live, the browse-location pill, or the
country picker changing what is on screen.

**Added since:** distance-based delivery pricing (section G). If you are
re-reading an old report that says "the fee must be identical from every
postcode", check which mode the environment is in first — that is only true in
flat mode now. What has *not* changed is that no address is ever refused: a
far one is charged more, never turned away. If you see an order rejected for
where it is going, that is a bug.

## Reporting

Include: whether you were logged in, the delivery postcode, the store and
product, and whether the problem was in the **catalogue** (what you could see),
at **checkout** (what you could buy or what you were charged), or in
**publication** (admin/partner store status). Those are separate subsystems.
