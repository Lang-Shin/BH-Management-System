# Room-level move-in advance and security deposit

Version 11 adds a room occupancy ledger beside the existing monthly billing ledger and records the boarding-house non-refundable deposit policy. Tenant names and amounts remain fictional demo data.

## Rules

- One advance and one security deposit are required per **room occupancy cycle**, not per tenant. Roommates share the same room-level obligation.
- Adding or replacing an occupant does not create another move-in obligation. The room cycle closes when the room becomes fully vacant, while its historical obligation remains.
- A same-day full replacement keeps the room cycle and its existing obligation. A vacancy followed by a later occupancy starts a new cycle and obligation.
- Advance and deposit are each one month of the room's agreed rent snapshot at move-in. They are separate charges and may be paid partially and independently.
- The security deposit is recorded as **non-refundable** under the current policy. Each obligation stores the deposit terms and recognition policy that applied when it was created.
- Move-in charges use the shared payment, allocation, receipt, and correction workflow. They are excluded from monthly billed totals, applied rent totals, and rent-income reporting.
- Non-refundable does **not** mean automatically recognized as rental income. The prototype never refunds, forfeits, consumes, or recognizes a deposit as income automatically.
- Transferring an existing tenant never creates another full deposit. Moving to a more expensive room produces a read-only top-up proposal; nothing is posted automatically.
- New obligations store the active policy version. Policy changes do not rewrite historical obligations or charges.

## Policy v2 (Policy B)

| Area | Default |
| --- | --- |
| Advance application | `LAST_MONTH` — review before applying; nothing is consumed automatically |
| Deposit terms | `NON_REFUNDABLE` |
| Deposit income recognition | `NOT_RECOGNIZED` |
| Transfer to a more expensive room | Propose the rent difference as a top-up; do not post it |
| Transfer to a cheaper room | Manual settlement review |
| Move-out | Manual settlement review; no automatic refund or forfeiture |

Deposit terms remain configurable from Billing. Switching to `MANUAL_REVIEW` affects future obligations only and still does not create an automatic refund. The Billing page shows the non-refundable terms, records payments, and surfaces transfer/move-out notes. Tenant Overview and digital receipts state that the deposit is non-refundable and separate from rent. Payments and Reports show advance-collected, deposit-held, and outstanding amounts separately from monthly rent.

## Persistence and migration

The localStorage key stays `bhms:prototype:v1`. Version 11 reads valid version 7/8/9/10 snapshots non-destructively. Existing occupied rooms receive an active cycle but **no invented deposits or advances**. Version 10 obligations keep their recorded provisional deposit terms and are not rewritten; only the current policy advances to v2. Existing rooms, labels, assignments, bills, payments, receipts, corrections, rates, meters, and readings are retained. Saving writes a version 11 envelope. Restore sample records remains an explicit replacement, not a migration.

## Verification

Domain tests cover obligation creation, non-refundable snapshots, roommate sharing, partial and full payments, overpayment rejection, payer validation, cycle closure, repeat occupancy, move-out preservation without refunds or income, transfer proposals without duplicate deposits, policy versioning, and v9/v10 migration. UI tests cover the empty legacy state, persisted payments and receipts, non-refundable wording in Billing and tenant payment details, and versioned policy changes.
