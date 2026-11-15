# TASK 1A.4 — Room-based financial presentation

## Pre-implementation investigation (recorded before implementation)

- Initial Git status: ` M src/features/dashboard/dashboard-page.tsx`. Its existing removal of “How are collections counted?” is owner work and will be preserved. HEAD: `c5db3d2 feat(ui): implemented view receipt in Payments & Receipts page`.
- `Tenant` owns identity, not room identity. Dated `RoomAssignment` records retain start/end dates and historical room IDs. A moved-out tenant's Room 105 assignment is retained in the fixture.
- Every `Charge` has a tenant ID, period, category, issue/due dates and integer centavos. Rent additionally references `roomAssignmentId`; utilities do not. No charge has direct `roomId`, shared-charge ID, joint-liability marker or shared-allocation policy. Meter ownership is explicitly unconfirmed.
- `Payment` preserves payer tenant ID, ID, date, amount, method, state and correction reference. Explicit `PaymentAllocation` records link payment and charge IDs with dates, active/reversed state and optional source credit. Validation forbids cross-tenant allocations and over-allocation. One payer can nevertheless have historical charges in multiple rooms.
- Advance credit remains tenant/source-payment-specific. It is not an applied bill payment until explicitly allocated. Receipt snapshots retain issue-time allocation IDs. Corrections and audit events must remain untouched.
- Current selectors iterate each issued charge and valid allocation once. No existing shared-charge multiplication was found. Tenant-first UI originates in direct tenant iteration in Dashboard outstanding balances/Billing matrix and direct tenant lookup in reusable payment tables, Dashboard dues and Billing details.
- Dashboard metrics distinguish November bills/applied money from November cash received. Fixture: 23 charges, 10 payments, 10 receipts, one credit. November billed 3,308,600 cents, applied 1,630,000, outstanding 1,678,600; cash received 2,004,400 including 324,400 applied to October and 50,000 advance. October bills/applied 324,400, outstanding zero. Existing reconciliation and persistence tests cover these amounts.
- Reports currently contain only monthly aggregate totals and unchanged audit history; exports are placeholders. No CSV serializer/download exists in `src`. A minimal read-only room-summary CSV will share its selector with the new room report.
- Existing UI-only tenant/room forms, payment calculator and receipt viewing must remain; no schema, fixture, validator, reducer or persistence migration is needed.
- No AGENTS.md found. Theme, ambient glow and existing transition durations will not be edited (the current route transition is 360ms, despite the task's reference to 200ms).

## Attribution and presentation decisions

1. Rent uses its explicit assignment reference, including after move-out/transfer. Never substitute current occupancy.
2. For charges without an assignment reference, use a single distinct room among assignments overlapping that charge's billing period. This is a derived **period assignment context**, not proof of room ownership. More than one room or missing history is **Room needs review**, retained as a separate charge bucket, not guessed from issue/due/payment/current date. No records are rewritten.
3. Room summaries sum each included issued charge once and reuse the existing paid/balance calculations. Full-period category summaries retain all charges and all four category statuses. Paid means no included charge remains outstanding.
4. Due groups preserve room, period, category, due date and payment status; unresolved charges stay separate. Expandable underlying-charge details preserve distinct tenant obligations, IDs, amounts and allocations. Grouping is not joint liability or a new room charge.
5. Payment rows remain one per payment ID. Charge-allocation room contexts determine the room label; multi-room/unresolved/remainder cases are explicit. Unallocated advances may show the payer's room **at payment date**, labeled as context only. No advance is added to billed collections.
6. Tenant identities stay in Tenant Management, financial drill-down, payer details, individual credits, receipts and audit history. Summaries do not enumerate occupants. Reports and CSV retain period and unresolved attribution with reconciliation totals.

## Final implementation report

### 1. Initial Git status

```text
 M src/features/dashboard/dashboard-page.tsx
```

The pre-existing removal of “How are collections counted?” remains removed. No existing work was reset, discarded, staged or committed.

### 2. Root cause

Tenant-first presentation was embedded in UI lookups and grouping: Dashboard ranked `tenantAccount` results, the billing matrix iterated tenants, and payment/dues columns looked up tenant names. The old totals were not themselves evidence of double-counting; simply renaming columns would have repeated room rows and obscured obligations.

### 3. Charge/room relationships

The investigation above remains applicable. Rent has a stable assignment link; non-rent charges need explicitly labeled derived context. No direct room-owned or shared charge model exists. Each stored charge ID is counted once, never multiplied by occupancy or deduplicated merely because tenants have equal amounts. Original tenant charge ownership and payment payer IDs are unchanged.

### 4. Implemented presentation rules

- `chargeRoom` provides provenance (`rent-assignment`, `period-assignment`, `unresolved`). No current-room fallback for charges.
- `selectRoomFinance` groups issued charges by historical context; `financialTotals` uses the existing integer-centavo paid/balance functions and ignores voided/not-yet-issued charges.
- `selectRoomDues` keeps period, category, due date and payment status distinct. Unresolved charge buckets stay separate. Underlying owners, amounts, dates and allocations remain accessible.
- `paymentRooms` preserves one payment per transaction. Multi-room contexts and unallocated remainders are explicit. Unallocated money gets payment-date context only, not a claim of bill settlement.
- Shared-room totals are presentation totals of recorded obligations, not new joint room charges. Tenant names are not enumerated in closed room summaries.

### 5. Dashboard

- Outstanding balances now contain one row per room/context, ranked by outstanding amount, with unpaid/partial counts and charge drill-down. The existing top-four limit is preserved.
- Upcoming dues use room/category groups, separate periods/dates/statuses, and charge details. The existing six-row preview limit is preserved.
- Recent payments are room-first individual transactions with expandable payer/payment/allocation details, not merged room transactions. Existing five-payment limit preserved.
- Four main metrics retain their original selectors and collection-rate calculation. The removed collection explanation has not been restored.

### 6. Billing Management

- Category matrix contains one room/context per row and independently computes Rent, Electricity, Water and Washing machine status.
- A room category is not marked paid while any included amount remains outstanding. “No bill” remains distinct from unpaid.
- Charge disclosure shows original tenant, charge ID, historical context/provenance, period, due date, billed/applied/outstanding amounts, allocation/payment IDs, payer and inactive/reversal references where present.
- Individual bill detail table is room-first but retains each charge owner and ID. Electricity preview adds room context while retaining charge owner and the original meter/rate snapshot.
- Payment calculator remains the pre-existing UI-only tenant-specific calculator; this task adds no payment-recording feature.

### 7. Payments & Receipts

- Shared payment-history component makes Room the first column in both Dashboard and Payments.
- All ten sample payment IDs remain ten transactions; no amounts or dates change. Payer identity, payment ID, method, charge/allocation IDs, remainder and correction reference are available in Payment details.
- For a multi-room payment, the full transaction is labeled “Multiple rooms / contexts”; detail lists exact allocations and unallocated remainder. No full amount is assigned to one room.
- Individual advance-credit table stays tenant-specific as required. Its balances are unchanged and are not rolled into applied bill payments.
- Receipt list adds room context before the original receipt and “Received from” fields. Receipt detail continues using stored issue-time allocation IDs, including later reversed references, and now shows room/charge/allocation context. Snapshot amount, date, number and payer stay unchanged. The existing receipt preview is retained.

### 8. Reports and CSV

- Existing monthly report and audit log remain intact.
- New Room financial summary uses `selectRoomFinance` for a selectable month, with billed, applied, outstanding, status and underlying-charge details.
- New read-only Download room CSV uses exactly that selector and period; columns are Room, Billing period, Total billed (PHP), Applied to bills (PHP), Outstanding (PHP), Payment status, Attribution, Charge IDs.
- CSV includes unresolved rows, escaped text, spreadsheet-formula protection and UTF-8 BOM on download. It is not a backup, tenant-ledger export or official receipt. No existing CSV exporter was replaced because none existed.
- Cash received remains separately reported rather than being mislabeled as applied room collections.

### 9. Historical assignment handling

Tests and an isolated persisted browser fixture confirm October bills and a November payment against them stay with Room 105 after the payer moves to Room 103. A transfer within a billing period leaves utilities without a stable assignment reference in explicit review buckets; rent retains its recorded assignment. Later reversal/reallocation can change a transaction's current allocation context but does not rewrite its issued receipt's allocation context.

### 10. Financial reconciliation

Verified sample November room totals (PHP, derived from integer centavos):

| Room | Billed | Applied to bills | Outstanding |
| --- | ---: | ---: | ---: |
| Room 101 | 11,186.00 | 9,300.00 | 1,886.00 |
| Room 102 | 7,300.00 | 3,500.00 | 3,800.00 |
| Room 103 | 7,300.00 | 3,500.00 | 3,800.00 |
| Room 104 | 7,300.00 | 0.00 | 7,300.00 |
| **Total** | **33,086.00** | **16,300.00** | **16,786.00** |

- October Room 105: billed/applied PHP 3,244.00, outstanding PHP 0.00.
- Across both periods: billed PHP 36,330.00, applied PHP 19,544.00, outstanding PHP 16,786.00.
- November cash received remains PHP 20,044.00 = PHP 16,300.00 applied to November + PHP 3,244.00 applied to October + PHP 500.00 unallocated advance.
- Collection rate remains 49.3% displayed. No financial totals were changed by grouping.
- Reconciliation tests assert charge ID uniqueness/completeness, per-room balances against underlying charges, summed room totals against the original selectors, nonnegative balances for valid records, and exported CSV amounts/charge IDs against the same report rows. Browser downloads independently verify November/October totals and review-row inclusion.

### 11. Regression tests

`src/test/room-finance.test.tsx` adds 19 focused cases (including parameterized cases); application integration adds two more. Coverage includes:

1. Historical single-occupancy Room 105.
2. One summary for a three-tenant shared room.
3. Distinct charge IDs included exactly once, with unchanged input records.
4. Room balances equal underlying charge balances; all/October/November sums reconcile.
5. Additional partial payment changes only the referenced room.
6. Advance credit is not applied automatically.
7. Multi-room payment remains one transaction.
8. Payer identity/payment IDs remain in transaction detail.
9. Different due dates and periods stay separate.
10. Independent categories and payment states stay traceable.
11. Transfers/move-out do not reassign recorded rent or unambiguous prior-period utility context.
12. Voided payments/reversed allocations do not count as collected bill money.
13. Original Dashboard financial selectors/metrics remain unchanged.
14. Reports and CSV reconcile, including escaped text and unresolved buckets.
15. Shared category stays partly paid until all included bills are settled.
16. Future allocations and unallocated remainders are not counted as current applied payments.
17. Receipt issue-time allocation context survives transfer/reversal/reallocation.

The old tenant-based billing UI test now asserts room category status and period switching instead. Domain ownership/allocation/validation rules were not changed to satisfy the tests.

### 12. Responsive browser verification

Production build served locally through Vite preview; Chromium/Playwright ran at **1440, 1024, 768, 390 and 360px**. All five widths passed:

- Dashboard room balance uniqueness/ranking, room-first recent payments with five original transactions, payer disclosure and upcoming group columns.
- Four November billing rows, independent room category statuses, expanded tenant/charge details and historical October Room 105.
- Ten payment-history transactions, historical Room 105 payment, original payer/payment IDs, receipt room context/IDs and Escape closing.
- Four November room-report rows, actual CSV downloads reconciling to 3,308,600 / 1,630,000 / 1,678,600 centavos; October download reconciling to 324,400 / 324,400 / 0.
- Mobile drawer/desktop navigation, existing 360ms route animation, tenant module identity, no horizontal **page** overflow. Existing table-local scrolling remains available on wider/expanded detail tables.
- Persisted financial snapshot byte-for-byte unchanged after browsing, drill-down, period switching and CSV export.
- Additional isolated, validator-accepted browser snapshots tested within-period ambiguity (two review rows, no lost totals) and a multi-room payment (one transaction, two room allocations and PHP 50 unallocated remainder).
- No console or runtime errors.

Harness: `C:\Users\User\AppData\Local\Temp\opencode\bhms-task-1a-4-check.cjs` (temporary tooling outside the repository). Representative desktop/phone screenshots were inspected for balances, recent payments, dues, Billing, Payments and Reports. Screenshot paths: the same temporary directory, `bhms-1a4-{balances,recent,dues,billing,payments,report}-{1440,390}.png`. Captures wait for the existing count-up animations to finish.

### 13. Accessibility verification

Axe WCAG 2 A/AA and WCAG 2.1 AA scans passed for Dashboard, Billing, Payments, receipt dialog and Reports at all five widths, plus expanded multi-room/ambiguous-context scenarios. Native disclosure keyboard activation was tested with Enter; existing dialogs retain Escape/focus behavior. Table captions, row/column semantics and mobile labeled records are retained. Statuses have text, not only color. This is automated technical verification, not complete screen-reader/device certification or owner visual acceptance.

### 14. Automated validation

All commands completed successfully against the final source implementation:

| Command | Result |
| --- | --- |
| `npm run lint` | PASS, zero warnings |
| `npm run typecheck` | PASS |
| `npm run build` | PASS, strict compilation and Vite production bundle |
| `npm test` | PASS, **128 tests across 12 files** |
| `git diff --check` | PASS, no whitespace errors (normal LF/CRLF notices only) |

During development, an unnecessary regex escape and old tenant-row assertions were corrected. Two new UI tests initially selected identically named section/table regions; they now target the table by caption. Browser assertions were corrected to handle normal mobile field labels and whitespace. No application business rules were altered to mask a failure.

### 15. Files changed

New:
- `src/domain/calculations/room-finance.ts`
- `src/components/shared/charge-details.tsx`
- `src/components/shared/transaction-details.tsx`
- `src/features/reports/room-report.ts`
- `src/test/room-finance.test.tsx`
- `docs/task-1a-4-report.md`

Modified:
- `src/components/shared/payment-history-table.tsx`
- `src/features/dashboard/dashboard-page.tsx` (also preserves the initial owner change)
- `src/features/billing/billing-status-matrix.tsx`
- `src/features/billing/billing-page.tsx`
- `src/features/billing/electricity-preview.tsx`
- `src/features/payments/payments-page.tsx`
- `src/features/payments/receipt-dialog.tsx`
- `src/features/reports/reports-page.tsx`
- `src/test/app.test.tsx`
- `README.md`

### 16. Preserved functionality and restrictions

No changes to models, existing selectors in `summary.ts`, fixtures, stored schema/key/version, validation, reducer, repository, existing financial records, allocations or audit history. No data reset or migration. Tenant Management identities, UI-only add tenant/room and payment calculator, room repair toggle, notes, notification center, sample receipt viewing, charts and existing navigation remain. No CSS/theme/ambient glow/font/transition files changed. No dependency, backend, authentication, Cloudflare, payment-recording feature, deployment, commit or push was added/performed.

### 17. Known limitations / unresolved ownership questions

- Who legally/operationally owns shared-room rent, electricity, water and washing charges remains **unconfirmed**. Are charges per tenant, per room or a mixture? Are occupants jointly liable? This implementation does not decide.
- Which meter serves which room, and how shared utilities are divided, remains **unconfirmed**.
- Utilities have no immutable room-at-issue reference. A unique period assignment provides a labeled presentation context only; within-period transfers/missing history need review. Future production work should capture confirmed room/assignment ownership at issuance rather than infer it or rewrite historical records.
- No shared-source-charge identifier exists. Equal amounts on different charge IDs are not automatically duplicates and cannot safely be collapsed into one legal charge. This implementation prevents multiplication/double-counting of existing charge/allocation IDs; it cannot detect two separately recorded IDs representing an accidentally duplicated real-world shared invoice.
- Payment-date context for unallocated money is not a promise that the money pays bills for that room. Multi-room allocations and remainders stay explicit.
- Source model records payer as tenant ID, not a separate third-party payer identity. That original identity is preserved; broader payer rules need owner confirmation.
- Dashboard retains existing preview limits. Full charge/period detail remains in Billing/Reports. CSV is a room-summary export, not a complete transaction audit export.
- Browser verification used Chromium; physical-device and screen-reader checks, and owner visual acceptance, remain pending.

### 18. Final Git status

```text
 M README.md
 M src/components/shared/payment-history-table.tsx
 M src/features/billing/billing-page.tsx
 M src/features/billing/billing-status-matrix.tsx
 M src/features/billing/electricity-preview.tsx
 M src/features/dashboard/dashboard-page.tsx
 M src/features/payments/payments-page.tsx
 M src/features/payments/receipt-dialog.tsx
 M src/features/reports/reports-page.tsx
 M src/test/app.test.tsx
?? docs/task-1a-4-report.md
?? src/components/shared/charge-details.tsx
?? src/components/shared/transaction-details.tsx
?? src/domain/calculations/room-finance.ts
?? src/features/reports/room-report.ts
?? src/test/room-finance.test.tsx
```

### 19. Completion status

**PASS — TASK 1A.4 technical implementation and verification completed.** Unknown ownership/historical cases are exposed rather than invented. Owner visual acceptance and resolution of the above billing-policy questions remain pending. Stop here for owner review; no subsequent milestone, commit or push is authorized/performed.
