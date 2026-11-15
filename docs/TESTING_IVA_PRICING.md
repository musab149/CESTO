# Testing: IVA added on top of base prices

Test plan for the IVA change on local `staging` (not pushed yet):
`62bdd45`, `141d8a9`, `327bf0d`, `abc6917`, `d9479dd`, `141a539`.

What changed:

1. Prices typed in admin, retail and B2B alike, are **base prices without
   IVA**. Customers see and pay the base plus the product's IVA (0, 4, 10 or
   21 %). A product nobody has chosen a rate for sells at **0 %**.
2. Every new order line records the rate it was charged, so changing a
   product's rate later doesn't change orders already placed.
3. Retail checkout lists the IVA per rate and says **"IVA incluido"**. The B2B
   checkout reads **Base (sin IVA) + IVA per rate = Total**.
4. Admin: the IVA select has 0 %, prices are labelled "sin IVA" with the price
   with IVA beside them, "Set IVA" offers 0 %, quick-create preselects 0 %, the
   order builder prices with IVA, and its IVA box grows instead of scrolling.
5. The product import sheet has an `iva` column (blank = 0 %); the export
   writes it back.

---

## The model being tested

| Rule | Why |
|---|---|
| A price typed in admin is the base, without IVA | User decision, 2026-11-01. |
| Customer price = base + IVA, to the cent, rounded half up | One rounding rule (`lib/tax`), used by the API and by every screen, so the price shown is the price charged. |
| A product with no rate chosen sells at 0 % | The default. Its price does not change until somebody picks a rate. |
| "— 0 % por defecto —" is not the same as "0 % — Sin IVA" | The first means nobody has decided, so the product stays findable as undecided; the second is a decision. Both charge 0 %. |
| Each order line records its rate | Changing a product's rate later re-prices the shop, never past orders. |
| A discount agreed with a customer comes off the price with IVA | It comes off what they see. |
| The delivery fee is unchanged | User decision: leave it as it is. |

---

## Before you start

- Run the local app: API on `:3000`, shop and business panel on
  `http://localhost:5173`, admin on `http://localhost:5174`.
- The migration `20261101120000_vat_category_zero` must be applied to your
  local database. If it isn't: stop the API, then run
  `npm --workspace @grocery-app/api run migrate`.
- **Placing orders locally sends real emails** through the shared production
  Resend account, which allows 100 a day. One or two is fine. Placed orders
  also take stock.

## Accounts — LOCAL DATABASE ONLY

These exist only in the local database. They do not work on staging or
production.

| Role | Email | Password |
|---|---|---|
| B2B buyer (Supermercado Lavapiés), lands on `/business` | `compras.lavapies@cesto.test` | `Cliente2026!` |
| Retail shopper (Amir Khan) | `demo@groceryapp.es` | `demo1234` |
| Sales rep (Ana), at `/sales` | `ana.comercial@cesto.test` | `Comercial2026!` |
| Admin | `admin@groceryapp.es` | `admin1234` |

## Products used

All three are from Shaikh Cash & Carry, priced **15,00 € retail** and
**10,00 € B2B**:

- **Aceite de Coco ALI BABA** — set to 10 %.
- **Aceite de Almendra ALI BABA** — set to 21 %.
- **Aceite de Mostaza ALI BABA** — leave alone. It stays at 0 % and is the
  control.

---

## Steps

### 1. Admin: set the IVA

- [ ] Open **Aceite de Coco ALI BABA**. The IVA field shows
      "— 0 % por defecto —" with a hint that it sells at 0 %.
- [ ] Pick **10 %**. The hint changes to say prices are stored without IVA.
- [ ] On the Variants tab: "Prices are without IVA…", with
      **"With IVA: 16,50 €"** under the price and **"11,00 €"** under the B2B
      price. Save.
- [ ] In the Products list, select **Aceite de Almendra ALI BABA** and use
      **Set IVA / Fijar IVA**. 0 % is one of the options. Choose **21 %**.
- [ ] The list still shows 15,00 / 10,00, under the "Price excl. IVA" and
      "B2B excl. IVA" headers.

### 2. Retail checkout (log in as `demo@groceryapp.es`)

- [ ] Search "ALI BABA". Prices: Coco **16,50**, Almendra **18,15**,
      Mostaza **15,00**.
- [ ] Put 1 of each in the cart and go to checkout. Expect:
  - Subtotal **49,65**
  - IVA 10 %: base 15,00 → IVA **1,50**
  - IVA 21 %: base 15,00 → IVA **3,15**
  - No row for Mostaza
  - **"IVA incluido"** under the total

### 3. B2B checkout (log in as `compras.lavapies@cesto.test`)

- [ ] In the catalogue: Coco **11,00**, Almendra **12,10**, Mostaza **10,00**.
- [ ] Put 1 of each in the cart and go to checkout. Expect:
  - The lines still show their prices with VAT (12,10 / 11,00 / 10,00).
  - Base (without VAT): **30,00**
  - VAT 10 %: **1,00**
  - VAT 21 %: **2,10**
  - Delivery: added when we review it
  - Total before delivery: **33,10**
  - No "VAT included" note.
- [ ] Switch to ES: the same summary reads "Base (sin IVA)", "IVA 10 %", and
      so on.

### 4. Admin order builder

- [ ] Create a new order for **Supermercado Lavapiés**. The cards show
      11,00 / 12,10 / 10,00.
- [ ] Add all three. The IVA box shows 10 % (base 10,00 → 1,00) and 21 %
      (base 10,00 → 2,10), with no 0 % row. The box grows; nothing is hidden
      behind a scroll.
- [ ] For **Amir Khan** (retail), the same cards show 16,50 / 18,15 / 15,00.
- [ ] Open **Not in the catalogue**. The IVA buttons are 0/4/10/21 with 0 %
      preselected. Type price 10 and pick 21 %: it shows
      **"With IVA: 12,10 €"**, and the line goes in at **12,10**.

### 5. Rep panel (log in as `ana.comercial@cesto.test`)

- [ ] Start a new order for a client. Catalogue prices include IVA, the IVA
      box grows, and quick-create works as in step 4.

### 6. Past orders keep their rate

- [ ] Place the retail order from step 2.
- [ ] In admin, change Coco to 21 %.
- [ ] The shop now shows **18,15** for Coco.
- [ ] The order you placed keeps **16,50** and its 10 % IVA, on the order page
      and in the edit screen.

### 7. Spreadsheet import

- [ ] Download the import template. It has an **iva** column after
      `is_featured`, and an "IVA" row on the Instructions sheet.
- [ ] Import three products with iva **10**, **blank** and **7**:
  - The 7 is reported as an error.
  - The first product opens at 10 %.
  - The blank one shows "— 0 % por defecto —".
- [ ] Export the products. The `iva` column comes back filled in, blank for
      products with no rate chosen.

---

## Clean up afterwards

- Set the three oils back with **0 % — Sin IVA**; their prices return to the
  base. Choosing "— 0 % por defecto —" again does not change anything.
- Delete the products created by the import test.

## Running the automated suites

Run them with mail off, so a test checkout cannot spend the shared Resend
quota:

```sh
export RESEND_API_KEY=' ' RESEND_FROM=' ' FIREBASE_SERVICE_ACCOUNT=' '
cd packages/api
npm run test:vat-pricing    # 33 checks: every catalogue surface, cart, quote, checkout, staff orders, edits, Set IVA, a real sheet import
npm run test:tax            # 14 checks: the API's IVA rules, and that they match shared's copy
npm run test:order-line-vat # 16 checks: what the order editors and documents read
cd ../shared
npm run test:tax            # 44 checks: the shared IVA rules
```
