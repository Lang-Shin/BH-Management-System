# Room-level move-in advance and security deposit

Version 10 adds a room occupancy ledger beside the existing monthly billing ledger. Tenant names and amounts remain fictional demo data.

## Rules

- One advance and one security deposit are required per **room occupancy cycle**, not per tenant. Roommates share the same room-level obligation.
- Adding or replacing an occupant does not create another move-in obligation. The room cycle closes when the room becomes fully vacant, while its historical obligation remains for review.
- A same-day full replacement keeps the room cycle and its existing obligation. A vacancy followed by a later occupancy starts a new cycle and obligation.
- The next vacant-to-occupied transition starts a new cycle and a new obligation.
- Advance and deposit are each one month of the room's agreed rent snapshot at move-in. They are separate charges and may be paid partially and independently.
- Move-in charges use the shared payment, allocation, receipt, and correction workflow. They are excluded from monthly billed totals, applied rent totals, and rent-income reporting.
- Deposit cash is a held liability. The prototype never refunds, forfeits, consumes, or recognizes a deposit as income automatically.
- New obligations store the active policy version. Policy changes do not rewrite historical obligations or charges.

## Provisional policy v1

| Area | Default |
| --- | --- |
| Advance application | `LAST_MONTH` — review before applying; nothing is consumed automatically |
| Deposit disposition | Manual review |
| Transfer to a more expensive room | Propose the rent difference as a top-up; do not post it |
| Transfer to a cheaper room | Manual settlement review |
| Move-out | Manual settlement review |

The Billing page shows move-in balances, records payments, and surfaces transfer/move-out review notes. Payments and Reports show advance-collected, deposit-held, and outstanding amounts separately from monthly rent.

## Persistence and migration

The localStorage key stays `bhms:prototype:v1`. Version 10 reads valid version 7/8/9 snapshots non-destructively. Existing occupied rooms receive an active cycle but **no invented deposits or advances**. Existing rooms, labels, assignments, bills, payments, receipts, corrections, rates, meters, and readings are retained. Saving writes a version 10 envelope. Restore sample records remains an explicit replacement, not a migration.

## Verification

Domain tests cover obligation creation, roommate sharing, partial and full payments, overpayment rejection, payer validation, cycle closure, repeat occupancy, transfer proposals, policy versioning, and version 9 migration. UI tests cover the empty legacy state and a persisted move-in payment with its receipt.
