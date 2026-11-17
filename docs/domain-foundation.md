# Preliminary domain and page foundations · TASK 1A sections 7–10

This is a frontend financial demonstration, not a production billing system. Types are preliminary and may be refined after the landlord confirms the remaining rules. The existing demo note editor, room maintenance toggle, filters, reset, Billing room-payment calculator, and Payments & Receipts payment corrections are functional. Only Billing records new charges and payments; Payments & Receipts records authorized corrections. The prototype does not provide production concurrency or authentication guarantees.

## Models and relationships

Defined in `src/domain/types/models.ts`:

| Model | Key relationships and purpose |
| --- | --- |
| `Tenant` | Fictional profile, explicit `ACTIVE` / `MOVED_OUT` status; account status is derived separately |
| `Room` | Bed count and private/shared configuration for reference; repair status; beds do not decide availability |
| `RoomAssignment` | Tenant → room with start/end dates and agreed rent; historical assignments remain after move-out |
| `ElectricityMeter` | Meter identity and serial number; ownership explicitly `UNCONFIRMED` |
| `MeterReading` | Meter → dated scaled-integer reading, confirmation state, optional authorized replacement reference |
| `ElectricityRate` | Effective-dated rate in integer centavos per kWh; no global mutable rate is used to price historical charges |
| `BillingPeriod` | Explicit labeled start/end dates and open/closed status; no permanent recurrence policy |
| `Charge` | Tenant + period → issued amount, due date, category and historical pricing snapshot; original/voided records can be retained |
| `Payment` | Tenant → received amount, date, method, recorded/voided state, optional authorized replacement reference |
| `PaymentAllocation` | Payment → charge with amount and date; optional source-credit reference; reversal state retains the original record |
| `TenantCredit` | Tenant + source payment → reserved advance amount; remaining credit is derived from explicit allocations |
| `Receipt` | Payment → amount and allocation-ID snapshots at issue time; sample reference and issued/voided state |
| `AuditEvent` | Actor reference, entity reference, action, date, reason, before/after snapshots |
| `PrototypeAppState` | Central collections shared by every page and the prototype repository |

IDs are explicit strings with referential validation. The type alias `PrototypeData` preserves the existing internal reducer/repository payload name without duplicating the state model.

### Status semantics

- Charge categories: `RENT`, `ELECTRICITY`, `WATER`, `WASHING_MACHINE`.
- Individual bill payment statuses are derived from active allocations: `UNPAID`, `PARTIALLY_PAID`, `PAID`.
- Room payment statuses follow the owner’s category-based definitions: `NO_BILLS`, `NOT_YET_PAID`, `PARTLY_PAID`, `PAID`. They are not calculated from total money divided by total billed.
- Room `Paid` requires every applicable bill to be fully settled and no required electricity obligation left unresolved. At least one fully settled applicable bill makes the room `Partly paid` while anything remains. `Not yet paid` means nothing applicable is fully settled. `No bills` means no bills or pending obligations exist.
- No charge in a category means **not applicable** in the sample matrix. No zero-value unpaid placeholder charge is manufactured.
- A missing current electricity reading is stored as an `ElectricityBillObligation` with `AWAITING_READING`, not as a Charge and not as a PHP 0 balance.
- Overdue is a date/balance condition, separate from partial/unpaid status.
- An active tenant may have outstanding debt and advance credit simultaneously. Credit does not automatically offset charges.

### Room occupancy — landlord clarification

Count **rooms, not beds**. Any current rental makes the room occupied, including one tenant renting a three-bed room. A room with unused beds is not automatically available to rent again. Empty rooms that are not under repair are available; rooms under repair are a separate count. `selectRoomSummary()` is shared by the Dashboard and Rooms. The current sample shows 4 occupied / 15 rooms, 10 available, and 1 under repair. Existing `Room.capacity` values are retained as bed information for storage compatibility, not used as a headcount restriction or a payment rule.

### Rental-rate categories

Rooms are categorized only by rental rate, using stable IDs `RATE_3500`, `RATE_4000`, and `RATE_5000`. The approved fixture has 8 rooms at PHP 3,500, 6 rooms at PHP 4,000, and 1 room at PHP 5,000, totaling 15 rooms. Room cards and filters display the rate itself. Bathroom type and air-conditioning descriptions are not category names or category data.

## Confirmed billing requirements preserved

### Rent and periods

Room rent is charged once per occupied room per billing period from the room’s rental-rate category and must be settled in full. The fixture stores the issued rent charge against one designated occupant’s assignment, so two occupants do not create two rent debts or imply joint liability. Assignment agreements and issued charges preserve their historical rate snapshots, so later category-rate changes do not rewrite past bills. No sample rent allocation is partial; the snapshot validator rejects a partial rent allocation, and the payment calculator rejects a typed partial rent amount. Explicit billing periods connect all categories. October/November calendar months and due dates are fixture examples only; there is no recurring-bill engine, fixed rent-cycle rule, proration rule, or bill-generation action. Room capacity in the demonstration records is capped at two active occupants.

### Electricity and rate history

Readings store integer **milli-kWh** (1000 units = 1 kWh); money stores integer **centavos**. Each occupied room has its own fictional meter. Electricity is cumulative: each confirmed charge covers the interval from the latest settled reading to the current payment-time reading.

Room 101 demonstrates normal monthly settlement:

- October: previous 300,000 milli-kWh (300 kWh) → current 312,000 (312 kWh), consumption 12,000 (12 kWh), applied 1,300 centavos/kWh, amount 15,600 centavos = **PHP 156.00**.
- November: previous 312,000 → current 325,000 (325 kWh), consumption 13,000 (13 kWh), applied 1,300 centavos/kWh, amount 16,900 centavos = **PHP 169.00**.

Room 104 skipped October. Its latest settled reading remains 300 kWh. No October electricity charge exists. If the tenant pays in November with a 325 kWh reading, the single November charge is **25 kWh × PHP 13.00 = PHP 325.00** and the next baseline becomes 325 kWh.

The historical October, current November, and future December rate records all use the mock PHP 13.00/kWh tariff. Summaries use stored issued amounts, never the latest configured rate. A later rate change cannot silently reprice old charges. If consumption crosses a rate-change boundary, the prototype uses the rate effective on the payment-calculation date and does not invent a split between rates; this policy is provisional.

The payment-time workflow retrieves the latest confirmed reading and applicable rate, accepts a current reading with up to three decimal places, shows consumption and amount, and persists nothing until confirmation. Confirmation adds one confirmed reading, one finalized charge, one payment, one allocation, and one receipt in a single reducer snapshot, then removes the unresolved obligation. A stable meter-interval ID prevents duplicate billing. A calculated-but-unconfirmed preview is UI-only; it is discarded on cancel.

Rooms 102 and 104 have `AWAITING_READING` obligations with no electricity Charge, no `₱0` payable amount, and a status that prevents the room from being marked Paid. Pending Payments and the Billing matrix show **Amount pending calculation** / **AWAITING READING** instead of a peso figure. Pending electricity is counted once, not as a separate bill for each skipped month.

Meter ownership, shared-room allocation, meter rollover/replacement rules, fractional-consumption rounding, and production concurrency guarantees are still unconfirmed. Browser localStorage cannot provide production-grade atomicity across tabs or devices. No ownership or tenant split is inferred. The fixtures’ electricity charges are illustrative tenant records, not evidence of a decided meter-allocation rule. The current snapshot validator checks exact-cent sample calculations; it is not a general-purpose bill-issuance calculator or a confirmed rounding policy.

### Manual charges and payments

Water is a sample PHP 100.00 manual charge per tenant, based on each billing period’s occupants; no water meter model or calculation is added. Washing machine charges are optional manual PHP 100.00-per-room entries, so two occupants share one room charge. Room Details stores the current/future washing-machine subscription as a room flag. Changes are saved explicitly and apply only to future applicable billing periods; issued washing charges, payments, and unpaid historical obligations remain unchanged. Saving the flag does not create a payment.

Room Details shows the room meter identifier, latest confirmed settled reading/date, and reading history. It does not permit unrestricted editing of settled readings. Meter corrections require an authorized workflow because changing a settled baseline could invalidate issued consumption or payment history; the prototype shows a disabled correction control instead. Billing remains the only payment-time electricity and payment workflow.

Payments and allocations are separate. Room 101 is fully settled in the sample. Room 102’s historical rent remains fully unpaid while its known November rent, water, and washing are paid; its electricity remains unresolved until a payment-time reading is entered. Room 104 has no current payments and two skipped electricity months represented by one cumulative obligation. Jordan’s PHP 500.00 advance remains source-linked credit until explicitly allocated. Billing’s room calculator is the only saving workflow: it selects the room’s unpaid categories, calculates checkbox amounts, reviews the total, and records the confirmed payment. Because the existing model owns charges by tenant, a room confirmation with multiple payers produces one payment and receipt per payer. Dashboard and Reports Pending Payments are view-only. Payments & Receipts provides the transaction and correction-history workspace and supports authorized Edit Payment corrections. Corrections complete in one review: the owner must confirm that an actual refund was returned or an additional payment was received before saving. A lower total can instead be labeled as an incorrect recorded amount with no fictional refund, and equal totals need no settlement confirmation. No pending refund or pending additional-payment queue is created. Full advance use, arbitrary reversals, and production receipt issuance remain unavailable.

Confirmed electricity payments generate a receipt and retain the meter interval. Receipt references are fictional, not official tax receipts or generated documents. Their stored allocation IDs describe issuance-time allocation history rather than a dynamically recomputed receipt. Corrections supersede the original receipt and issue a revised number such as `DEMO-RCT-006-R2`; the original remains stored for traceability. Revised receipts and Correction History show whether the correction was balanced, an incorrect recording with no refund, a completed refund, or an additional payment received. Legacy pending statuses are shown as unresolved and are never counted as completed money movement.

## Consistent sample ledger

All amounts below derive from fixture records, not dashboard-specific constants.

| Measure, as of November 13, 2026 | Amount |
| --- | ---: |
| November rent charges (4 occupied rooms × PHP 3,500) | PHP 14,000.00 |
| November manually entered water (7 occupants × PHP 100) | PHP 700.00 |
| November electricity examples (Room 101 PHP 169 + Room 103 PHP 156) | PHP 325.00 |
| Optional November washing machine charges (2 rooms × PHP 100) | PHP 200.00 |
| **November issued charges** | **PHP 15,225.00** |
| Explicitly allocated to November charges | PHP 11,525.00 |
| **November known outstanding** | **PHP 3,700.00** |
| November electricity awaiting readings | 2 obligations, no amounts |
| October finalized charges | PHP 19,142.00 |
| Explicitly allocated to October charges | PHP 8,086.00 |
| **October known outstanding** | **PHP 11,056.00** |
| Unapplied advance received in November | PHP 500.00 |
| **Cash received during November** | **PHP 20,111.00** |

Twelve November charges are paid and three are unpaid. Historical October arrears remain overdue. Room 101 is fully paid across both sample periods. Room 102’s historical rent is exactly PHP 3,500.00 and unpaid; its November rent, water, and washing are paid, while cumulative electricity awaits a reading. Room 103 is fully paid for November but has historical October arrears. Room 104 has no payments and has skipped electricity since its 300 kWh September baseline; its rent and water remain known outstanding. Room 105’s two moved-out occupants have fully settled October bills while their assignments and charge history remain visible.

The fixture factory generates fresh objects for reset/tests; it is not an executable bill-generation workflow. Contacts are invented, with reserved `example.com` email addresses and deliberately non-dialable `DEMO +63 000 ...` phone strings.

## Page foundations

- **Dashboard:** financial overview, independent category payment status, five recent payments, upcoming charge due dates, and assignment-based occupancy.
- **Tenants:** searchable directory, profiles, dated assignments/agreed amounts, tenant status, derived account balance/credit, and fictional contacts.
- **Rooms:** private/shared configuration, full/partial/empty/maintenance states, dated occupants, and preserved history.
- **Billing:** period selector, category matrix, detailed balances/status/due dates, effective-dated rates, room-based checkbox calculator, payment-time meter entry, calculated cumulative preview, review-before-save confirmation, confirmed readings, and charge snapshots. Billing is the only page that can create a payment.
- **Payments & Receipts:** transaction and correction workspaces, immediate-settlement Edit Payment review, payment/allocation history, confirmed electricity interval details, partial-payment examples, advance credit, and fictional receipt snapshots.
- **Reports & Settings:** derived collection rows by sample period, confirmed/unconfirmed billing settings, seeded admin event, and explicit export/backup/recovery placeholders.

Unfinished tools are collapsed under clearly marked “Coming later” sections, not decorative action buttons. localStorage is demo persistence, not production backup. Restore sample records is under Reports & Settings and replaces only the prototype snapshot with fresh fixtures after confirmation.

## Persistence compatibility

The expanded schema uses envelope version **7**. The existing key `bhms:prototype:v1` is intentionally retained so older snapshots can be detected and preserved. Loading an older or invalid schema shows fresh fixtures in memory and a recovery notice; saving remains disabled until the user explicitly confirms Restore sample records in Reports & Settings. No silent migration discards old notes or rewrites financial samples.

Runtime validation checks collection shapes, IDs, relationships, assignment dates/overlaps, occupied-room repair restrictions, safe-integer money, category-specific fields, unique electricity intervals, current-obligation baselines, reading/rate snapshots, allocation limits, source-credit reservations/consumption, receipt revisions, payment-correction links/settlements (including readable legacy pending statuses), and correction/audit references. Bed counts do not restrict the number of rental records. A pure parser safely handles malformed JSON and incompatible envelopes. The repository also validates before writes and refuses invalid snapshots without replacing previously saved data. This is a useful prototype integrity boundary, not a replacement for future server validation and authorized financial transactions. localStorage is editable by browser users and is not secure financial storage.
