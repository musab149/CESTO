# Testing: customer order editing + partner-set delivery fees

Test plan for the two changes on `staging` in `db2614a` and `e86c341`:

1. A **customer** can add, remove and re-quantity the items on an order they
   have already placed, until it is dispatched. Cancel widened to match.
2. A **partner** (owner or manager) can set the delivery fee on their own
   orders. The three refusals are now shared with the admin route, and the fee
   is quantised to cents before the total is derived from it.

Each case is marked with how it is covered:

- **AUTO** — asserted by an automated suite (see *Running the automated suites*).
  All currently passing.
- **API** — needs a request against the running dev server with a real session.
  **Not yet run.**
- **UI** — needs a browser. **Not yet run.**

> Everything below was verified by code reading and the AUTO suites. No UI or
> HTTP case in this document has been executed. That is the work this plan is
> for.

---

## The model being tested

**The editable window is one list, in one place.** `EDITABLE_STATUSES` in
`packages/api/src/lib/editOrder.ts` is `['pending', 'confirmed', 'preparing']`,
and everything keys off it: customer item edits, admin item edits, partner item
edits, and both delivery-fee routes. If a case below expects a refusal at
`on_the_way`, that is the one constant to check.

| Rule | Why |
|---|---|
| Editable through `preparing`, closed at `on_the_way` | Past dispatch the contents are physically gone. This deliberately goes further than the MVP spec, which drew the customer's line at `confirmado` — do not "fix" it back to match the doc. |
| Cancel uses the same window | A customer who can strip an order to one item while it is being packed cannot coherently be refused a cancel in the same breath. |
| An issued **FACTURA** freezes the contents and the fee | The document is immutable and states the total. The correction is a credit note. |
| An issued **PROFORMA** freezes nothing | It is a quote, not a fiscal document, and revising a quote is what a quote is for. Until the CIF/NIF and the VAT review land, EVERY document is a proforma — so if a proforma ever starts locking, every order in the system silently freezes. |
| A **draft** invoice blocks nothing | It re-reads its order on load, so it follows the change instead of contradicting it. |
| One part of a split purchase has no fee of its own | The fee lives on the `ParentOrder`; every part carries zero. |
| Adds must come from the order's own shop | Otherwise `editOrder` spins the item into a second order with its own delivery fee — right for an admin building an order, alarming for a customer who tapped "add". |
| Nothing online is captured | No Stripe / Redsys / PayPal anywhere. An edit changes what is owed **on delivery**, which is why it can be self-service at all. There is no refund path to test. |

---

## Setup

You need, on staging or local:

| # | Fixture | How |
|---|---|---|
| S1 | A customer with orders in each of `pending`, `confirmed`, `preparing`, `on_the_way`, `delivered`, `cancelled` | Place one, then move it through admin |
| S2 | A `draft` order | Check out with an item whose stock is short |
| S3 | A **split** purchase (ParentOrder + ≥2 sub-orders) | Cart with products from two different shops |
| S4a | An order with an issued **proforma** | Admin → order → Invoice → Issue (this is what you get today) |
| S4b | An order with an issued **factura** | Only possible once Settings → Invoicing has a real CIF/NIF and the order's products have reviewed VAT. Otherwise force it in the DB: `UPDATE invoices SET kind='invoice' WHERE id=…` with the mutate trigger disabled |
| S5 | An order with a **draft** invoice (not issued) | Admin → order → Invoice, then leave it |
| S6 | A partner **owner** login, and a partner **manager** login on the same store | Manager needs a `PartnerStoreRole` row with `role = 'manager'` |
| S7 | A product in a partner store with **2+ active variants** | For the variant dropdown |
| S8 | A product with `stock_quantity = 0` | For the out-of-stock path |
| S9 | A **delisted** product (`is_active = false`) whose variant is still active | For case C7 — construct in the DB |

---

## A · Customer — when the edit affordance appears

Web, logged in as the customer, on `/orders/:id`.

| # | Case | Expected | Cover |
|---|---|---|---|
| A1 | Order is `pending` | "Editar artículos" shown on the Items card | UI |
| A2 | Order is `confirmed` | Shown | UI |
| A3 | Order is `preparing` | Shown, **and** on entering edit mode an amber warning says the order is already being packed | UI |
| A4 | Order is `on_the_way` | Button **absent** | UI |
| A5 | Order is `delivered` | Absent | UI |
| A6 | Order is `cancelled` | Absent | UI |
| A7 | Order is `draft` | Absent — stock was never reserved, so resolving it is what books the items | UI |
| A8 | Viewing one part of a split purchase | Items edit is offered (partner does this too); the **fee** is not — see F4 | UI |
| A9 | API accepts the window | `pending`/`confirmed`/`preparing` edit; the other four refuse with `not_editable` naming the status | AUTO |

---

## B · Customer — the operations

Enter edit mode first. **Nothing should reach the server until Save.**

| # | Case | Expected | Cover |
|---|---|---|---|
| B1 | Press `+` on a line | Quantity rises, turns brand-green, subtotal preview shows old struck through → new | UI |
| B2 | Press `−` down to 1 | `−` disables at 1; the line is never taken to 0 this way | UI |
| B3 | Hold `+` past 99 | Caps at 99 (server also caps) | UI |
| B4 | Press the bin on a line | Row greys, name strikes through, **Deshacer** replaces the stepper | UI |
| B5 | Press Deshacer | Line returns at its original quantity, subtotal preview reverts | UI |
| B6 | Open "Añadir productos" and search | Results come only from **this order's shop**; a Cesto house order searches the house catalogue | UI |
| B7 | Add a result | New row at the bottom with a **Nuevo** badge, qty 1, its own stepper | UI |
| B8 | Search for something already on the order | Its button reads **Añadido** and is disabled | UI |
| B9 | Search for a zero-stock variant (S8) | "Sin stock", Add disabled | UI |
| B10 | A product with 2+ variants (S7) | A variant dropdown appears with price per variant; picking one adds that variant | UI |
| B11 | Make several changes, press **Guardar cambios** | One request; items update; total recomputes; editor closes; page reflects the new order | UI · API |
| B12 | Make changes, press **Descartar** | Editor closes, **order unchanged** — reload to confirm nothing was sent | UI |
| B13 | Enter edit mode, change nothing | Save is disabled | UI |
| B14 | Remove every line | Save disabled, message: an order cannot be empty, cancel it instead | UI |
| B15 | No `replace` operation is offered | A size swap is remove + add. The API rejects `replace` from a customer | UI · API |

---

## C · Customer — refusals

`PUT /api/orders/:id/items`. C2/C4/C7 need a direct request; the UI prevents them.

| # | Case | Expected | Cover |
|---|---|---|---|
| C1 | Add from another shop, **via the UI** | Impossible — search is scoped to the order's shop | UI |
| C2 | Add another shop's variant **via the API** | **422**, naming the product, telling them to place a separate order. No second order is created | API |
| C3 | Edit an order with an issued **proforma** (S4a) | **Succeeds.** A quote does not freeze an order | AUTO · API |
| C3b | Edit an order with an issued **factura** (S4b) | **409** naming the invoice | AUTO · API |
| C4 | Edit a `draft` order (S2) via the API | **422** — waiting on stock | API |
| C5 | Edit another customer's order | **404**, never 403 — an unrelated account must not be able to probe whether an id exists | AUTO · API |
| C6 | Edit an `on_the_way` order via the API | **400** naming the status | AUTO · API |
| C7 | Add a delisted product with an active variant (S9) | **400** — "no longer available". `editOrder` only checks the variant, so the route checks the product | API |
| C8 | Edit an order with a **draft** invoice (S5) | **Succeeds**, and the draft invoice's lines and totals follow | AUTO · API |
| C9 | Send 51 operations | 422 from the schema (max 50) | API |

---

## D · Customer — stock and atomicity

The server refuses the **whole batch** on any shortfall. There is no partial apply.

| # | Case | Expected | Cover |
|---|---|---|---|
| D1 | Add more than the stock of an item | **409**; shortfalls listed inline per item with what is left; message says the order is unchanged | AUTO · UI |
| D2 | One valid op + one impossible op in the same save | Neither applies — the valid one does **not** sneak through | AUTO |
| D3 | After a refused batch | `product_variants.stock_quantity` is byte-identical to before | AUTO |
| D4 | Raise a quantity by 2 and save | Stock for that variant drops by exactly 2 | API |
| D5 | Remove a line and save | Stock for that variant rises by exactly its quantity | API |
| D6 | Two browser tabs save conflicting edits to the same order | Second save either applies on top or refuses for stock — never silently half-applies | UI |

---

## E · Cancel, now available at `preparing`

| # | Case | Expected | Cover |
|---|---|---|---|
| E1 | `preparing` order, customer view | **"Cancelar pedido" is now shown** — this is the change | UI |
| E2 | Cancel at `preparing` | Succeeds; status `cancelled`; **stock restored** for every line | API |
| E3 | Cancel at `on_the_way` | Refused, 400 | API |
| E4 | Cancel a `draft` | Still works, and stock is **not** incremented (it was never decremented) | API |
| E5 | `pending` / `confirmed` | Unchanged from before | UI |

---

## F · Partner — setting the delivery fee

`/partner/orders/:id`, in the Order summary card.

| # | Case | Expected | Cover |
|---|---|---|---|
| F1 | Owner, order `pending`/`confirmed`/`preparing` | **Edit** link beside "Delivery fee" | UI |
| F2 | **Manager** on the same store (S6) | Also sees it — manager has the same order access as owner by design | UI |
| F3 | Order `on_the_way` / `delivered` / `cancelled` / `draft` | No Edit link | UI |
| F4 | One part of a split purchase (S3) | **No Edit link at all** — hidden, not disabled, because the fee belongs to the parent and there is nothing here to set | UI |
| F5 | Type a fee, Save | Fee updates, **Total** = subtotal + fee, **Subtotal unchanged**, toast "Delivery fee updated" | UI · API |
| F6 | Press Enter in the field / press Escape | Enter saves; Escape cancels without saving | UI |
| F7 | Enter `-1`, or `1001`, or letters | Inline error, **no request sent** | UI |
| F8 | Order has an issued **factura** (S4b) | **409** shown inline beside the field, wording tells them to *ask us* for a credit note | API |
| F8b | Order has an issued **proforma** (S4a) | Fee is still editable | API |
| F9 | Another store's order id | **404** — indistinguishable from a non-existent order | API |
| F10 | Fee 0 | Displays "Free"; Total equals Subtotal | UI |
| F11 | Set a **different** fee | Customer receives an "order updated" notification **and** email | API |
| F12 | Save the **same** fee again | **No notification** — saving an unchanged number is not news | API |
| F13 | Order moves to `on_the_way` while the editor is open, then Save | 422, message stays visible next to the field, editor does not close | UI |

---

## G · Regressions the shared code could have broken

These are the parts that already worked and must still work.

| # | Case | Expected | Cover |
|---|---|---|---|
| G1 | Admin edits a fee (any admin role) | Still works — **permissions deliberately unchanged**, not restricted to super_admin | API |
| G2 | **Admin edits ITEMS on an order with an issued factura** | **409 — this is new.** It previously applied the edit and silently desynced the invoice | AUTO · API |
| G3 | Admin edits items on an order with a **draft** invoice | Still allowed; the draft follows | AUTO |
| G4 | Admin sets a fee of `3.335` | Stored fee `3.34`, total = subtotal + `3.34`. **Fee and total must agree** | AUTO |
| G5 | Admin fee on a split sub-order | 422, same as before | AUTO |
| G6 | Partner edits items (pre-existing feature) | Unchanged | AUTO |
| G7 | Admin refuses a fee outside the window | 422 at all four non-editable statuses | AUTO |
| G8 | Normal checkout, single shop | Creates a standalone order with its own fee | API |
| G9 | Normal checkout, two shops | ParentOrder + sub-orders, subs carry fee 0 | AUTO |
| G10 | Draft-order stock confirmation | Unchanged | API |
| G11 | Rep-created order flow (admin → client → order → fee → invoice) | Unchanged end to end | UI |

---

## G2 · Documents — what each one is called and what it does

| # | Case | Expected | Cover |
|---|---|---|---|
| J1 | Admin order → "Descargar albarán" | Button no longer says *factura*. File saves as `Albaran-ES-XXXX.pdf`, document header reads **ALBARÁN** / **DELIVERY NOTE** | UI |
| J2 | Orders LIST → the same download icon | Same wording and same file. Both screens render the same document | UI |
| J3 | Partner order → download | Same, via the shared partner dictionary | UI |
| J4 | The albarán's content | Still has no invoice number, no tax IDs, no IVA table — that is correct for a delivery note. It simply no longer claims to be a factura | UI |
| J5 | Issue a proforma, then open the order | Edit controls are **still there**. No lock banner | UI |
| J6 | Issue a proforma, then press "Invoice" again | Button links to the existing document instead of offering a second one — a partial unique index allows only one issued non-credit-note per order | UI |
| J7 | Promote that invoice to `kind='invoice'` (S4b), reload | Edit controls gone, lock banner names the invoice | UI |
| J8 | The issue confirmation dialog | Lists three consequences, one per line, and the order-closing one is called out. A proforma adds the "not valid for IVA" note | UI |

---

## K · The holes closed on 2026-09-30 (audit follow-up)

An audit of every mutating order endpoint found three gaps. These cases pin
the fixes. K1 and K2 have no automated cover — the guards are inline route
logic and the suite has no HTTP harness — so they need running by hand.

| # | Case | Expected | Cover |
|---|---|---|---|
| K1 | Admin soft-deletes an order carrying an issued **factura** (S4b) | **409.** Message says to cancel and issue a credit note instead. Deleting would hide the order while the document stayed valid and outstanding | API |
| K2 | Admin soft-deletes an order carrying an issued **proforma** (S4a) | **Succeeds** — a quote is not a claim | API |
| K3 | Raise a document against a **draft** order (S2) | **Proforma issues fine**, and the blocker list says why a factura cannot: stock is not reserved. A rep must still be able to quote a shop they are sourcing for | AUTO |
| K4 | Same draft, with the CIF and VAT review complete | Still cannot be a **factura** — `invoiceKindFor` returns `proforma`, not `invoice` | AUTO |
| K5 | Admin cancels an order carrying an issued factura | **Allowed** — the one deliberate asymmetry, because credit notes do not exist and every other actor is refused. The confirmation must **warn first**, naming the invoice and saying a credit note is now owed by hand | UI |
| K6 | Customer or partner tries the same | **409**, "contact us" | AUTO · API |
| K7 | Admin moves a `delivered` or `cancelled` order back to `pending` | **Refused.** Both are terminal in ALLOWED_TRANSITIONS, so nobody can reopen a closed order to re-edit it | API |
| K8 | Partner tries to cancel via `PUT /:id/status` | **Refused** — `cancelled` is not in the partner status enum at all, so they are forced through the guarded cancel route | API |

---

## H · Notifications — who hears what

The directions are deliberately not symmetrical.

| # | Case | Expected | Cover |
|---|---|---|---|
| H1 | Customer edits their own order | **Ops** gets "Order changed by customer" in the admin bell | API |
| H2 | ...and the alert email | Says whether the order was **already being prepared** | API |
| H3 | Customer edits their own order | The **customer gets nothing** — they just did it | API |
| H4 | **Partner** changes a fee | The **customer** is notified (they will owe a different amount at the door) | API |
| H5 | **Admin** changes a fee | Customer is **not** notified — deliberate: a rep is typically standing with them | API |
| H6 | Admin or partner edits **items** | Customer notified, as before | API |

---

## Data checks

Run after exercising the above.

```sql
-- 1. No order's parts disagree. Any row here predates the cents fix in
--    e86c341; it should return nothing for orders touched after it.
SELECT id, order_number, subtotal, delivery_fee, total
FROM orders
WHERE total <> subtotal + delivery_fee
  AND deleted_at IS NULL
ORDER BY created_at DESC;

-- 2. A customer edit is attributed to the customer, not an admin or partner.
SELECT action, editor_type, editor_customer_id, editor_admin_id,
       editor_partner_user_id, created_at
FROM order_edit_logs
WHERE editor_type = 'customer'
ORDER BY created_at DESC
LIMIT 20;
-- editor_customer_id set; the other two editor columns NULL.

-- 3. No issued invoice has drifted from the order it bills. The invoice total
--    is the sum of its line grosses, which is subtotal + delivery_fee, so it
--    should equal the order total exactly.
SELECT i.invoice_number, i.total AS invoice_total, o.total AS order_total,
       o.delivery_fee
FROM invoices i
JOIN orders o ON o.id = i.order_id
WHERE i.status = 'issued' AND i.total <> o.total;
-- Must be empty for anything invoiced after e86c341. A pre-existing row with a
-- fractional delivery_fee (scale > 2) can differ by a cent legitimately —
-- that is the bug the cents fix closed, and query 1 finds those. Any row here
-- with a clean 2dp fee means the guard has a hole.

-- 4. Sub-orders of a split still carry no fee of their own.
SELECT id, order_number, parent_order_id, delivery_fee
FROM orders
WHERE parent_order_id IS NOT NULL AND delivery_fee <> 0;
-- Must be empty.

-- 5. The new notification type is reaching the feed.
SELECT type, title_es, created_at FROM notifications
WHERE type = 'admin_order_edited' ORDER BY created_at DESC LIMIT 10;
```

---

## Running the automated suites

```bash
cd packages/api
npx ts-node src/lib/deliveryFee.test.ts          # 31 — the fee decision + arithmetic
npx ts-node src/lib/customerEditOrder.test.ts    # 23 — the customer as an editor
npx ts-node src/lib/editOrder.test.ts            # 15 — pre-existing edit mechanics
npx ts-node src/lib/invoicing.test.ts            # 27 — invoice immutability
npx ts-node src/routes/admin/createOrder.test.ts # 28 — rep-built orders
```

All five pass. `customerEditOrder` creates and removes its own fixtures, and
disarms the invoice triggers to clean up after itself — those triggers refusing
its own teardown is the clearest evidence they work.

---

## Deploy note

`db2614a` carries migration `20260930003530_customer_order_edits`, which adds
**two enum labels** (`OrderEditActor.customer`, `NotificationType.admin_order_edited`)
plus a nullable `editor_customer_id`. Additive, four statements, no DROP or
RENAME. Render runs `prisma migrate deploy` automatically on a `staging` push.

Promoting to `master` must carry this migration together with the four already
waiting there — a partial history leaves a column referencing a type that lacks
its label. `e86c341` needs no migration.
