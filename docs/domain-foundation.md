# Preliminary domain and page foundations · TASK 1A sections 7–10

This is a read-only financial demonstration, not a production billing system. Types are preliminary and may be refined after the landlord confirms the remaining rules. The existing demo note editor, room maintenance toggle, filters, and reset remain functional. None of them issue charges, allocate payments, create receipts, or perform financial corrections.

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
- Payment statuses are derived from active allocations: `UNPAID`, `PARTIALLY_PAID`, `PAID`.
- Issuance state (`ISSUED` / `VOIDED`) is distinct from payment status.
- No charge in a category means **not applicable** in the sample matrix. No zero-value unpaid placeholder charge is manufactured.
- Overdue is a date/balance condition, separate from partial/unpaid status.
- An active tenant may have outstanding debt and advance credit simultaneously. Credit does not automatically offset charges.

### Room occupancy — landlord clarification

Count **rooms, not beds**. Any current rental makes the room occupied, including one tenant renting a three-bed room. A room with unused beds is not automatically available to rent again. Empty rooms that are not under repair are available; rooms under repair are a separate count. `selectRoomSummary()` is shared by Home and Rooms. The current sample shows 4 occupied / 6 rooms, 1 available, and 1 under repair. Existing `Room.capacity` values are retained as bed information for storage compatibility, not used as a headcount restriction or a payment rule.

## Confirmed billing requirements preserved

### Rent and periods

Agreed rent is recorded on the assignment and snapshotted onto issued rent charges. Explicit billing periods connect all categories. October/November calendar months and due dates are fixture examples only; there is no recurring-bill engine, fixed rent-cycle rule, proration rule, or bill-generation action.

### Electricity and rate history

Readings store integer **milli-kWh** (1000 units = 1 kWh); money stores integer **centavos**. November’s charge retains:

- Meter `meter-demo-a` and previous/current confirmed reading IDs.
- Previous 300,000 milli-kWh = 300 kWh; current 312,000 = 312 kWh.
- Consumption 12,000 milli-kWh = 12 kWh.
- Applied rate 1,300 centavos/kWh, effective November 1, 2026.
- Issued amount 15,600 centavos = **PHP 156.00**.

The historical October example uses PHP 12.00/kWh; a future December rate of PHP 14.50 is a separate rate record. Summaries use stored issued amounts, never the latest configured rate. A rate change cannot silently reprice old charges through a selector.

The future meter-entry workflow must find the previous confirmed reading, accept the current reading, and retain history. Corrections reference an original record plus an authorizing audit event and actor reference. Superseded readings remain available to historical charges. No correction UI or real authorization is implemented.

Meter ownership, shared-room allocation, meter rollover/replacement rules, fractional-consumption rounding, and the precise rate-selection policy are still unconfirmed. No ownership or tenant split is inferred. The fixtures’ electricity charges are illustrative tenant records, not evidence of a decided meter-allocation rule. The current snapshot validator checks exact-cent sample calculations; it is not a general-purpose bill-issuance calculator or a confirmed rounding policy.

### Manual charges and payments

Water is entered manually per tenant; no water meter model or calculation is added. Washing machine charges are optional manual entries.

Payments and allocations are separate. Alex’s rent, water, and partial electricity payments occur on different dates. Sam’s rent is partially paid independently of fully paid water. Jordan’s PHP 500.00 advance remains source-linked credit until explicitly allocated. Full, partial, advance, correction, reversal, and receipt issuance workflows are placeholders; there are no financial reducer actions.

Receipt references are fictional, not official tax receipts or generated documents. Their stored allocation IDs describe issuance-time allocation history rather than a dynamically recomputed receipt.

## Consistent sample ledger

All amounts below derive from fixture records, not dashboard-specific constants.

| Measure, as of November 13, 2026 | Amount |
| --- | ---: |
| November rent charges (9 × agreed PHP 3,500) | PHP 31,500.00 |
| November manually entered water (9 × PHP 150) | PHP 1,350.00 |
| November electricity example | PHP 156.00 |
| Optional November washing machine charge | PHP 80.00 |
| **November issued charges** | **PHP 33,086.00** |
| Explicitly allocated to November charges | PHP 16,300.00 |
| **November outstanding** | **PHP 16,786.00** |
| October charges paid during November | PHP 3,244.00 |
| Unapplied advance received in November | PHP 500.00 |
| **Cash received during November** | **PHP 20,044.00** |

Seven November charges are paid, two partially paid, and eleven unpaid. Two charges are overdue at the fixed demo date. The remaining outstanding charges are due November 20. The moved-out tenant’s October account is fully settled while their assignment and charge history remain visible.

The fixture factory generates fresh objects for reset/tests; it is not an executable bill-generation workflow. Contacts are invented, with reserved `example.com` email addresses and deliberately non-dialable `DEMO +63 000 ...` phone strings.

## Page foundations

- **Dashboard:** financial overview, independent category payment status, five recent payments, upcoming charge due dates, and assignment-based occupancy.
- **Tenants:** searchable directory, profiles, dated assignments/agreed amounts, tenant status, derived account balance/credit, and fictional contacts.
- **Rooms:** private/shared configuration, full/partial/empty/maintenance states, dated occupants, and preserved history.
- **Billing:** period selector, category matrix, detailed balances/status/due dates, effective-dated rates, confirmed readings, and charge snapshots.
- **Payments & Receipts:** payment/allocation history, partial-payment examples, advance credit, and fictional receipt snapshots.
- **Reports & Settings:** derived collection rows by sample period, confirmed/unconfirmed billing settings, seeded admin event, and explicit export/backup/recovery placeholders.

Unfinished tools are collapsed under clearly marked “Coming later” sections, not decorative action buttons. localStorage is demo persistence, not production backup. Restore sample records is under Reports & Settings and replaces only the prototype snapshot with fresh fixtures after confirmation.

## Persistence compatibility

The expanded schema uses envelope version **2**. The existing key `bhms:prototype:v1` is intentionally retained so version 1 snapshots can be detected and preserved. Loading an old schema shows fresh fixtures in memory and a recovery notice; saving remains disabled until the user explicitly confirms Restore sample records in Reports & Settings. No silent migration discards old notes or rewrites financial samples. The room-based UI revision does not change the stored shape or schema version; saved notes and rental records are preserved.

Runtime validation checks collection shapes, IDs, relationships, assignment dates/overlaps, occupied-room repair restrictions, safe-integer money, category-specific fields, reading/rate snapshots, allocation limits, source-credit reservations/consumption, receipt links, and correction/audit references. Bed counts do not restrict the number of rental records. A pure parser safely handles malformed JSON and incompatible envelopes. The repository also validates before writes and refuses invalid snapshots without replacing previously saved data. This is a useful prototype integrity boundary, not a replacement for future server validation and authorized financial transactions. localStorage is editable by browser users and is not secure financial storage.
