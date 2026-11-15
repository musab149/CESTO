# Testing: linking a partner application to an existing store

Test plan for the admin flow that approves a `partner_store` application onto a
store Cesto already created, instead of creating a new one.

Each case is marked with how it is covered:

- **AUTO** — asserted by `cd packages/api && npm run test:store-linking` (45 cases, all passing)
- **API** — exercised against the running dev server with a real admin session
  (21 checks, all passing). Not an in-process harness — the same HTTP path the
  admin panel calls.
- **UI** — needs a browser; **not yet run**

---

## The model being tested

A store is **linkable** only if all of these hold:

| Condition | Why |
|---|---|
| `created_via = 'admin'` | A store created BY an approval already belongs to a partner. Offering it would hand one partner's storefront to another. |
| No `PartnerStoreRole` rows **at all** | Not merely no *active* ones. A deactivated role still means the store was somebody's. |
| `deleted_at IS NULL` | Linking to a tombstone is meaningless. |
| `deletion_scheduled_at IS NULL` | Linking a partner to a store that vanishes in five days is a trap. |

Provenance is a stored column, not derived. "Has no `PartnerStoreRole`" is true
both for an admin-created store and for an approval-created store whose partner
was removed — those must not be treated alike.

---

## A · Which stores are offered

| # | Case | Expected | Cover |
|---|---|---|---|
| A1 | `GET /api/admin/stores/linkable` as admin | 200, `{ items, total }` | AUTO · API |
| A2 | An unclaimed admin-created store | Appears | AUTO · API |
| A3 | A store created by a previous approval | Absent | AUTO |
| A4 | A tombstoned store (`deleted_at`) | Absent | AUTO |
| A5 | A store scheduled for deletion | Absent | AUTO |
| A6 | Each row carries product / order / zone counts | Present and numeric | AUTO · API |
| A7 | Unauthenticated request | 401 | AUTO |
| A8 | Every store already claimed | Empty list; UI shows "No stores available to link", not an error | AUTO (empty list) · UI (copy) |

## B · Linking

| # | Case | Expected | Cover |
|---|---|---|---|
| B1 | Approve with `store_id` of an eligible store | 200; partner gets an `owner` role on it | AUTO · API |
| B2 | Provenance after linking | Stays `admin` — linking is not creation | AUTO · API |
| B3 | The store afterwards | Gone from `/linkable` | AUTO · API |
| B4 | Link a store that already has a partner | **409**, no second owner attached | AUTO · API |
| B5 | Link an approval-created store | **409** | AUTO |
| B6 | Link a store scheduled for deletion | **409** | AUTO |
| B7 | Link a non-existent store id | 404 | AUTO |
| B8 | Two admins linking the same store concurrently | One wins, the other 409s — eligibility is re-checked *inside* the transaction | AUTO (sequential proxy) · **not** race-tested |

## C · The application survives approval

| # | Case | Expected | Cover |
|---|---|---|---|
| C1 | `PartnerProfile` after approval | Exists for the partner user | AUTO · API |
| C2 | Fields carried across | company, business_type, location, website, registration_no, phone | AUTO · API |
| C3 | `linked_store_id` | Points at the resolved store | AUTO · API |
| C4 | `linked_existing` | `true` when adopting, `false` when creating | AUTO |
| C5 | `User.is_business` | **Stays false** — a partner is a seller, not a wholesale buyer | AUTO · API |
| C6 | `/api/users/me` for that partner | Returns `partner_profile` | API |
| C7 | Profile page | Renders a "Partner application" panel with the submitted details | UI |
| C8 | Re-approving the same person | Profile is overwritten, newest application wins | AUTO (upsert path) |

## D · Creating a new store still works

| # | Case | Expected | Cover |
|---|---|---|---|
| D1 | Approve with `store` instead of `store_id` | Store created | AUTO · API |
| D2 | Its provenance | `partner_approval` | AUTO · API |
| D3 | Its status | `draft` — a partner publishes it themselves once it has a zone | AUTO · API |
| D4 | It in `/linkable` | Never appears | AUTO · API |
| D5 | Application data | Kept, with `linked_existing = false` | AUTO |

## E · Unlinking

| # | Case | Expected | Cover |
|---|---|---|---|
| E1 | `POST /:id/unlink-partner` as super_admin | 200, reports who was removed | AUTO · API |
| E2 | The role | Deleted | AUTO · API |
| E3 | The user account | **Survives** — they may be a customer too | AUTO · API |
| E4 | The `PartnerProfile` | **Survives**, `linked_store_id` cleared | AUTO · API |
| E5 | Products and orders | Stay with the store | AUTO (by omission) · API |
| E6 | An admin-created store afterwards | Returns to `/linkable`, `returned_to_link_pool: true` | AUTO · API |
| E7 | An approval-created store afterwards | Does **not** return; `returned_to_link_pool: false`; provenance unchanged | AUTO |
| E8 | Unlinking a store with no partner | 409 | AUTO · API |
| E9 | As an `ops` admin | 403, and the partner keeps the store | AUTO |

## F · Browser (not yet run)

| # | Case | Expected |
|---|---|---|
| F1 | Leads → Partner deals → Approve → "Link existing" | Picker lists only eligible stores |
| F2 | Each row | Shows name, slug, status, and the three counts |
| F3 | Select a store carrying data | Amber note: "The partner will gain access to everything already on this store." |
| F4 | Select, then click again | Deselects |
| F5 | Submit | Approval succeeds, modal closes, lead flips to approved |
| F6 | Re-open the modal for another lead | The store just linked is gone from the list |
| F7 | No eligible stores | Amber "No stores are available to link" panel, not an empty box |
| F8 | Partner logs in → `/profile` | "Partner application" panel with their submitted details |
| F9 | Same partner → Manage store | Lands on the linked store's dashboard |

---

## Results

**AUTO — 45/45 passing.** `cd packages/api && npm run test:store-linking`

**API — 21/21 passing** against the running dev server (localhost:3000) with a
real admin login, using a throwaway store carrying a real product so the
inherit-counts path ran with non-zero values. Covered A1/A2/A6, B1–B4, C1–C6,
D-branch, E1–E6, E8, and that products stay with the store through both link
and unlink. All fixtures removed afterwards; verified zero residue.

## Known gaps

1. **Nothing in section F has been run.** The admin dev server was not running,
   so no part of the picker UI has been rendered. This is the whole remaining
   risk: the endpoints beneath it are covered, the wiring to them is not.
2. **B8 is not a real race test.** Concurrency is handled by re-checking
   eligibility inside the approval transaction, and the sequential case is
   asserted — but nothing exercises two simultaneous requests.
3. **C7 (profile panel) is unrendered.** The data reaching it is verified;
   the panel itself is not.

## Note on generating tokens for manual testing

`src/lib/jwt.ts` reads `process.env` at import time but does not call
`dotenv.config()` — `server.ts` does that at line 9, before importing anything
that needs it. A standalone script that imports `jwt.ts` directly therefore
sees an empty environment, falls back to a random per-process secret, and
prints:

```
[jwt] WARNING: JWT_ADMIN_SECRET is missing or shorter than 32 chars.
```

The secret is fine; the script is at fault. Load dotenv first:

```ts
import dotenv from 'dotenv';
dotenv.config();
import { generateAdminAccessToken } from './src/lib/jwt';
```

Or skip token minting entirely and `POST /api/admin/auth/login`, which is what
the API pass below did.
